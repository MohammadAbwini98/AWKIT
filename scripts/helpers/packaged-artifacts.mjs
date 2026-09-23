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
import { readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
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

/** The newest file under `dir`, recursively, by mtime. */
export async function newestFileMtime(dir) {
  let newest = { path: dir, mtimeMs: 0 };
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const found = entry.isDirectory()
      ? await newestFileMtime(full)
      : entry.isFile()
        ? { path: full, mtimeMs: (await stat(full)).mtimeMs }
        : newest;
    if (found.mtimeMs > newest.mtimeMs) newest = found;
  }
  return newest;
}

/**
 * A packaged tree older than the sources it claims to contain proves nothing: every packaged check
 * would drive a stale bundle and report a result about code that is no longer in the repository.
 * Returns null when `dist/win-unpacked` is at least as new as `src/` and `app/`, otherwise a message
 * naming the newer source file.
 *
 * SUPPORTING evidence, not provenance. It refuses a bundle that predates an ordinary edit, but mtime
 * cannot see a touched or copied-in app.asar, sources restored with their old mtimes, an edit made
 * while the build ran, or any input outside src/ and app/ (resources/, package.json, build config,
 * node_modules). What a package contains is established by the app.asar content check and
 * dist/release-provenance.json. A fresh checkout makes every source newer, so a dist/ copied onto
 * another checkout is refused unless the whole tree is copied with its timestamps preserved.
 */
export async function stalePackagedPayload(root = repoRoot) {
  const unpackedDir = join(root, "dist", "win-unpacked");
  const asarPath = join(unpackedDir, "resources", "app.asar");
  const packaged = await stat(existsSync(asarPath) ? asarPath : join(unpackedDir, "SpecterStudio.exe"));
  const newestSource = (await Promise.all([join(root, "src"), join(root, "app")].map(newestFileMtime)))
    .reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a));
  // No readable source file means nothing was compared; that is not "fresh".
  if (newestSource.mtimeMs === 0) return "no readable file under src/ or app/ — the packaged payload's freshness cannot be established.";
  if (newestSource.mtimeMs <= packaged.mtimeMs) return null;
  return (
    `dist/win-unpacked is STALE — ${relative(root, newestSource.path)} ` +
    `(${new Date(newestSource.mtimeMs).toISOString()}) is newer than the packaged payload ` +
    `(${new Date(packaged.mtimeMs).toISOString()}). Re-run "npm run package:portable" first.`
  );
}
