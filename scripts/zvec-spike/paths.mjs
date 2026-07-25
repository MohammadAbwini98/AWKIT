import path from "node:path";
import fs from "node:fs";

// Phase 0 spike runtime root. Matches the plan's Review Round 1 correction (§19.3):
// all collection data and reports must live only under this path — never under
// resources/, vendor/, app.asar, or the repository source tree.
export const SPIKE_ROOT = path.join(
  process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? ".", "AppData", "Local"),
  "SpecterStudio",
  "zvec-phase-0"
);

export const COLLECTIONS_DIR = path.join(SPIKE_ROOT, "collections");
export const REPORTS_DIR = path.join(SPIKE_ROOT, "reports");

export function ensureSpikeDirs() {
  for (const dir of [SPIKE_ROOT, COLLECTIONS_DIR, REPORTS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function writeReport(name, data) {
  ensureSpikeDirs();
  const file = path.join(REPORTS_DIR, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  return file;
}

export function freshCollectionPath(name) {
  return path.join(COLLECTIONS_DIR, name);
}

export function removeCollectionDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
