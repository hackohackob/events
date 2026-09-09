import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger";
import { run } from "./util";
import { STATE_DIR, VERSION, type GatewayConfig } from "./config";

/**
 * Self-update, pulled from the events server.
 *
 * Releases are unpacked side by side and a symlink is moved, so an update is a
 * single atomic operation and the previous release is still on the card if the
 * new one will not start:
 *
 *   /opt/em-gateway/releases/1.2.0/
 *   /opt/em-gateway/releases/1.3.0/
 *   /opt/em-gateway/current -> releases/1.3.0
 *
 * The bundle's SHA-256 is checked before anything is unpacked. It is a small
 * amount of code for the one thing that must not go wrong unattended: a box in
 * a field with no keyboard, and half a release on it.
 *
 * `config.json` lives in the state directory, never inside a release, so an
 * update never disturbs a deployed box's settings.
 */
const INSTALL_ROOT = process.env.GATEWAY_INSTALL_ROOT?.trim() || "/opt/em-gateway";
const RELEASES_DIR = join(INSTALL_ROOT, "releases");
const CURRENT_LINK = join(INSTALL_ROOT, "current");
const WORK_DIR = join(STATE_DIR, "update");

export interface UpdateResult {
  ok: boolean;
  detail: string;
  version?: string;
}

interface BundleMeta {
  version: string;
  sha256: string;
  size: number;
  notes?: string;
}

export async function applyUpdate(config: GatewayConfig, latestVersion?: string): Promise<UpdateResult> {
  const base = config.serverUrl.replace(/\/+$/, "");
  const headers = { "X-Gateway-Key": config.gatewayKey };

  if (latestVersion && latestVersion === VERSION) {
    return { ok: true, detail: `Already on ${VERSION}.`, version: VERSION };
  }

  let meta: BundleMeta;
  try {
    const res = await fetch(`${base}/radio-gateway/bundle.json`, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { ok: false, detail: `The server has no update published (${res.status}).` };
    meta = (await res.json()) as BundleMeta;
  } catch (err) {
    return { ok: false, detail: `Could not ask the server for an update: ${(err as Error).message}` };
  }

  if (meta.version === VERSION) {
    return { ok: true, detail: `Already on ${VERSION}.`, version: VERSION };
  }
  log.info("update", `downloading version ${meta.version} (${Math.round(meta.size / 1024)} KB)`);

  let bundle: Buffer;
  try {
    const res = await fetch(`${base}/radio-gateway/bundle`, { headers, signal: AbortSignal.timeout(300_000) });
    if (!res.ok) return { ok: false, detail: `Download failed (${res.status}).` };
    bundle = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return { ok: false, detail: `Download failed: ${(err as Error).message}` };
  }

  const digest = createHash("sha256").update(bundle).digest("hex");
  if (meta.sha256 && digest !== meta.sha256) {
    log.error("update", "the downloaded bundle does not match its checksum — refusing to install it");
    return { ok: false, detail: "The download was corrupt (checksum mismatch)." };
  }

  try {
    rmSync(WORK_DIR, { recursive: true, force: true });
    mkdirSync(WORK_DIR, { recursive: true });
    const archive = join(WORK_DIR, "bundle.tar.gz");
    writeFileSync(archive, bundle);

    const target = join(RELEASES_DIR, meta.version);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });

    const extract = await run("tar", ["-xzf", archive, "-C", target, "--strip-components=1"], {
      timeoutMs: 180_000,
    });
    if (extract.code !== 0) {
      return { ok: false, detail: `Could not unpack the update: ${extract.stderr.trim()}` };
    }
    if (!existsSync(join(target, "dist", "index.js"))) {
      rmSync(target, { recursive: true, force: true });
      return { ok: false, detail: "The bundle is missing dist/index.js — it was not built for release." };
    }

    // A relative symlink so the tree can be moved or imaged wholesale.
    const link = await run("ln", ["-sfn", join("releases", meta.version), CURRENT_LINK], { timeoutMs: 10_000 });
    if (link.code !== 0) {
      return { ok: false, detail: `Could not switch to the new release: ${link.stderr.trim()}` };
    }

    await pruneOldReleases(meta.version);
    rmSync(WORK_DIR, { recursive: true, force: true });

    log.warn("update", `installed ${meta.version} — restarting into it`);
    // systemd brings the service straight back up on the new symlink; exiting
    // is the whole restart.
    setTimeout(() => {
      void run("systemctl", ["restart", "em-gateway"], { timeoutMs: 15_000 }).then(() => process.exit(0));
    }, 1500);

    return { ok: true, detail: `Installed ${meta.version}. Restarting.`, version: meta.version };
  } catch (err) {
    return { ok: false, detail: `Update failed: ${(err as Error).message}` };
  }
}

/**
 * Keep the incoming release and the one being replaced; delete everything else.
 *
 * The previous version of this filtered out both of those and *then* sliced the
 * first entry off what was left, so in the ordinary case there was nothing to
 * delete and old releases accumulated forever. Found on the first box with
 * three releases and 25 MB sitting in /opt.
 */
async function pruneOldReleases(keep: string): Promise<void> {
  const res = await run("sh", ["-c", `ls -1t ${RELEASES_DIR} 2>/dev/null`], { timeoutMs: 8000 });
  const versions = res.stdout.split("\n").map((v) => v.trim()).filter(Boolean);
  const protect = new Set([keep, VERSION]);
  for (const version of versions) {
    if (protect.has(version)) continue;
    rmSync(join(RELEASES_DIR, version), { recursive: true, force: true });
    log.info("update", `removed old release ${version}`);
  }
}
