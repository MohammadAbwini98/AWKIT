/**
 * The one place that decides WHICH packaged artifact a gate examines.
 *
 * Why this exists. Three verifiers each decided for themselves, and all three were wrong:
 * `verify-packaged-validation.mts` and `verify-packaged-walkthrough.mts` hardcoded
 * `SpecterStudio 0.1.0.exe`, and `verify-zvec-packaged-assets.mjs` took
 * `readdirSync(dist).filter(...)[0]` — directory order, which on Windows also lands on 0.1.0. The app
 * is at 0.1.13, so `verify:packaged-validation` hashed a July 30 artifact of a different version,
 * confirmed the Chromium inside THAT file, and reported 86 checks passing about a build nobody made.
 * Its freshness check is the only thing that ever noticed, and only by age rather than identity.
 *
 * A gate that validates the wrong file is worse than no gate: it manufactures confidence. So the rule
 * lives here once, and it is the same rule `scripts/package-portable.ps1` uses when it writes the
 * artifact (`dist\SpecterStudio $($packageJson.version).exe`).
 *
 * Deliberately NEVER falls back to another `.exe`. If the versioned artifact is absent the correct
 * answer is "that build does not exist", not "here is a different one" — falling back is precisely
 * how this defect stayed invisible through repeated packaging runs.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const helpersDir = dirname(fileURLToPath(import.meta.url));

/** Repository root, resolved from this file so callers need not agree on their own depth. */
export const repoRoot = resolve(helpersDir, "..", "..");

/** The version the packaging pipeline stamps into the artifact name. */
export function appVersion(root = repoRoot) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("package.json has no version, so no packaged artifact can be identified");
  }
  return pkg.version;
}

/** `dist/SpecterStudio <version>.exe` — the portable build for the CURRENT version. */
export function portableExePath(root = repoRoot) {
  return join(root, "dist", `SpecterStudio ${appVersion(root)}.exe`);
}

/** `dist/SpecterStudio Setup <version>.exe` — the NSIS installer for the CURRENT version. */
export function setupExePath(root = repoRoot) {
  return join(root, "dist", `SpecterStudio Setup ${appVersion(root)}.exe`);
}

/** The artifact's file name, for assertions against manifests such as `latest.yml`. */
export function setupExeName(root = repoRoot) {
  return `SpecterStudio Setup ${appVersion(root)}.exe`;
}

/**
 * A message that names the missing artifact AND the command that produces it, so a gate failing for
 * want of a build reads as a build step rather than as a defect in the app.
 */
export function missingArtifactHint(path, command) {
  return `${path} does not exist — run \`${command}\` first. Not falling back to another version: a gate that validates a different build reports confidence about code nobody shipped.`;
}

/** True when the current version's portable artifact is present. */
export function portableExeExists(root = repoRoot) {
  return existsSync(portableExePath(root));
}
