import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";

/**
 * Serves the gateway firmware the appliances update themselves from.
 *
 * A release is a single `em-gateway-<version>.tar.gz` dropped into the bundle
 * directory (see `orangepi/scripts/build-bundle.sh`). Nothing else is needed —
 * no registry, no upload endpoint, no database row — because "copy a file to
 * the server" is a deploy step that works from a phone on a train, and the
 * boxes poll for it on their own.
 *
 * The newest version wins, and its checksum is computed once and cached against
 * the file's mtime and size, so a re-published bundle is picked up without a
 * restart while a box downloading one is not re-hashing 20 MB on every poll.
 */
export interface GatewayBundle {
  version: string;
  sha256: string;
  size: number;
  path: string;
  notes?: string;
}

const FILENAME = /^em-gateway-(\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)?)\.tar\.gz$/;

@Injectable()
export class RadioBundleService {
  private readonly logger = new Logger(RadioBundleService.name);
  private cache: (GatewayBundle & { mtimeMs: number }) | null = null;

  /**
   * Where release tarballs are looked for. In production this is the bind mount
   * from `docker-compose.prod.yml`; the fallback is relative to the process's
   * own directory, which `npm run start -w @events/backend` sets to
   * `apps/backend` in both development and the image.
   */
  private get directory(): string {
    return process.env.RADIO_GATEWAY_BUNDLE_DIR?.trim() || join(process.cwd(), "data", "gateway");
  }

  /** The newest published release, or null when none has been uploaded. */
  current(): GatewayBundle | null {
    const dir = this.directory;
    if (!existsSync(dir)) return null;

    let best: { version: string; file: string } | null = null;
    for (const file of readdirSync(dir)) {
      const match = FILENAME.exec(file);
      if (!match) continue;
      const version = match[1]!;
      if (!best || compareVersions(version, best.version) > 0) best = { version, file };
    }
    if (!best) return null;

    const path = join(dir, best.file);
    const stats = statSync(path);
    if (this.cache?.path === path && this.cache.mtimeMs === stats.mtimeMs && this.cache.size === stats.size) {
      return this.cache;
    }

    const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
    const notesPath = join(dir, `em-gateway-${best.version}.notes.txt`);
    const bundle: GatewayBundle & { mtimeMs: number } = {
      version: best.version,
      sha256,
      size: stats.size,
      path,
      notes: existsSync(notesPath) ? readFileSync(notesPath, "utf8").trim() : undefined,
      mtimeMs: stats.mtimeMs,
    };
    this.cache = bundle;
    this.logger.log(`gateway bundle ${bundle.version} ready (${Math.round(bundle.size / 1024)} KB)`);
    return bundle;
  }

  /**
   * What the heartbeat advertises. Falls back to the environment so a
   * deployment that distributes firmware some other way can still tell boxes
   * they are behind.
   */
  latestVersion(): string | undefined {
    return this.current()?.version ?? process.env.RADIO_GATEWAY_VERSION?.trim() ?? undefined;
  }
}

/** Numeric-segment comparison; a suffix like `-rc1` sorts before the release. */
function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => v.split(/[-.]/).map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
