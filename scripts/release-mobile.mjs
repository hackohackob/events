#!/usr/bin/env node
// Bump the mobile app version, tag a `mobile-v<version>` release, and push it —
// which triggers the "Mobile build (local APK)" GitHub Actions workflow.
//
//   npm run release:mobile            # patch bump (default)
//   npm run release:mobile -- minor   # or major
//   npm run release:mobile -- 1.4.0   # or an explicit version
//
// Source of truth is apps/mobile/package.json; app.config.ts reads it.
// versionCode (Android build number) is auto-incremented remotely by EAS.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "apps", "mobile", "package.json");

const run = (cmd) => execSync(cmd, { stdio: "pipe" }).toString().trim();
const exec = (cmd) => execSync(cmd, { stdio: "inherit" });
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

const arg = (process.argv[2] || "patch").trim();

// ── Compute the next version ────────────────────────────────────────────────
const raw = readFileSync(pkgPath, "utf8");
const cur = (/"version":\s*"([^"]+)"/.exec(raw) || [])[1];
if (!cur || !/^\d+\.\d+\.\d+$/.test(cur)) fail(`apps/mobile/package.json version "${cur}" must be plain semver (x.y.z).`);
const [maj, min, pat] = cur.split(".").map(Number);

let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg;
else if (arg === "major") next = `${maj + 1}.0.0`;
else if (arg === "minor") next = `${maj}.${min + 1}.0`;
else if (arg === "patch") next = `${maj}.${min}.${pat + 1}`;
else fail(`Unknown bump "${arg}". Use: patch | minor | major | x.y.z`);

const tag = `mobile-v${next}`;

// ── Preflight ───────────────────────────────────────────────────────────────
try {
  run("git rev-parse --is-inside-work-tree");
} catch {
  fail("Not inside a git repository.");
}
const dirty = run("git status --porcelain");
if (dirty) fail(`Working tree is not clean — commit or stash first so the release contains only the version bump:\n${dirty}`);
if (run(`git tag -l ${tag}`)) fail(`Tag ${tag} already exists.`);
const branch = run("git rev-parse --abbrev-ref HEAD");

console.log(`\nReleasing mobile  ${cur} → ${next}   (tag ${tag}, branch ${branch})\n`);

// ── Bump (preserve file formatting), commit, tag, push ──────────────────────
writeFileSync(pkgPath, raw.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`));

exec(`git add ${JSON.stringify(pkgPath)}`);
exec(`git commit -m "release(mobile): v${next}"`);
exec(`git tag -a ${tag} -m "Mobile ${next}"`);
exec(`git push origin ${branch}`);
exec(`git push origin ${tag}`);

console.log(`\n✔ Released ${tag}. The "Mobile build (local APK)" workflow is now running —`);
console.log(`  watch it at: GitHub ▸ Actions, and the signed APK lands on the ${tag} Release.\n`);
