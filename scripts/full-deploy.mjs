#!/usr/bin/env node
// One command to ship the mobile app end to end: bump → tag → build → submit.
//
//   npm run full-deploy                 # patch bump, both platforms, build + submit
//   npm run full-deploy -- minor        # or major, or an explicit 1.4.0
//   npm run full-deploy -- --skip-release   # current version, no bump/tag/push
//   npm run full-deploy -- --platform ios   # or android; default is both
//   npm run full-deploy -- --no-submit      # build only, leave the stores alone
//   npm run full-deploy -- --dry-run        # print the plan, run nothing
//
// What each stage does:
//
//   1. release-mobile.mjs bumps apps/mobile/package.json + build.gradle,
//      commits, tags `mobile-v<version>` and pushes. The tag push also kicks
//      off the "Mobile build (local APK)" GitHub workflow, which attaches a
//      free signed APK to the Release — that runs in parallel with everything
//      below and is not waited on here.
//   2. `eas build --profile production` builds the AAB and/or IPA on EAS.
//      versionCode / buildNumber come from EAS (appVersionSource: remote).
//   3. `eas submit --profile production` pushes the finished builds to
//      App Store Connect (iOS) and the Play internal track (Android).
//
// Credentials, for when a stage fails on auth:
//   • Android build  — local keystore, apps/mobile/credentials.json
//   • Android submit — ~/keystores/extrememedics-play-service-account.json
//   • iOS build      — distribution cert + profile on EAS servers
//   • iOS submit     — App Store Connect API key on EAS servers

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mobile = join(root, "apps", "mobile");

const dryRun = process.argv.includes("--dry-run");

const run = (cmd) => execSync(cmd, { stdio: "pipe" }).toString().trim();
const exec = (cmd, cwd = root) => {
  if (dryRun) return console.log(`  [dry-run] ${cmd}`);
  return execSync(cmd, { stdio: "inherit", cwd });
};
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};
const step = (n, total, msg) => console.log(`\n━━ [${n}/${total}] ${msg}\n`);

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const skipRelease = flag("--skip-release");
const noSubmit = flag("--no-submit");
const platform = value("--platform") ?? "all";
if (!["all", "ios", "android"].includes(platform)) {
  fail(`Unknown --platform "${platform}". Use: all | ios | android`);
}

// The bump is the first bare (non-flag) argument; everything else is a flag or
// a flag's value, so skip those.
const flagValues = new Set([value("--platform")].filter(Boolean));
const bump = args.find((a) => !a.startsWith("--") && !flagValues.has(a)) ?? "patch";

const platforms = platform === "all" ? ["ios", "android"] : [platform];

// ── Preflight ───────────────────────────────────────────────────────────────
// Fail here rather than 40 minutes into a build that can never be submitted.
if (!existsSync(join(mobile, "eas.json"))) fail(`No eas.json at ${mobile}.`);

try {
  run("npx eas-cli whoami");
} catch {
  fail("Not logged in to EAS. Run `npx eas-cli login` first.");
}

if (!noSubmit && platforms.includes("android")) {
  const easJson = JSON.parse(readFileSync(join(mobile, "eas.json"), "utf8"));
  const keyPath = easJson.submit?.production?.android?.serviceAccountKeyPath;
  if (!keyPath) fail("submit.production.android.serviceAccountKeyPath is missing from eas.json.");
  if (!existsSync(keyPath)) {
    fail(`The Play service-account key is missing:\n    ${keyPath}\n  Restore it, or re-run with --no-submit.`);
  }
}

const version = JSON.parse(readFileSync(join(mobile, "package.json"), "utf8")).version;

console.log(`\nFull deploy  ${platforms.join(" + ")}`);
console.log(`  version : ${version}${skipRelease ? " (unchanged)" : ` → ${bump} bump`}`);
console.log(`  submit  : ${noSubmit ? "no" : "yes"}`);
if (dryRun) console.log("  dry-run : nothing below actually runs");

const total = 1 + (skipRelease ? 0 : 1) + (noSubmit ? 0 : platforms.length);
let n = 0;

// ── 1. Bump, tag, push ──────────────────────────────────────────────────────
if (!skipRelease) {
  step(++n, total, `Releasing (${bump}) — bump, commit, tag, push`);
  exec(`node ${JSON.stringify(join(root, "scripts", "release-mobile.mjs"))} ${bump}`);
}

const released = JSON.parse(readFileSync(join(mobile, "package.json"), "utf8")).version;

// ── 2. Build on EAS ─────────────────────────────────────────────────────────
step(++n, total, `Building ${platforms.join(" + ")} on EAS (this takes a while)`);
exec(`npx eas-cli build --platform ${platform} --profile production --non-interactive`, mobile);

// ── 3. Submit to the stores ─────────────────────────────────────────────────
// Sequentially, so a failure names the platform that failed instead of
// interleaving two output streams.
if (!noSubmit) {
  for (const p of platforms) {
    step(++n, total, `Submitting ${p}`);
    exec(`npx eas-cli submit --platform ${p} --profile production --latest --non-interactive`, mobile);
  }
}

// ── Done ────────────────────────────────────────────────────────────────────
console.log(`\n✔ Mobile ${released} deployed.\n`);
if (!skipRelease) {
  console.log(`  APK       — GitHub ▸ Actions, lands on the mobile-v${released} Release`);
}
if (!noSubmit) {
  if (platforms.includes("ios")) {
    console.log("  iOS       — processing in App Store Connect, then visible in TestFlight");
  }
  if (platforms.includes("android")) {
    console.log("  Android   — live on the Play internal testing track");
    console.log("              (production stays locked until the app leaves Draft;");
    console.log("               the service account can only reach testing tracks)");
  }
}
console.log("");
