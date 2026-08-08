import { app } from "electron";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { getResourcesRoot } from "./appPaths";

export type RoadmapSnapshot = Record<string, any>;

/**
 * Main-owned read boundary. Development reads the authoritative repository model directly; packaged
 * builds use the deterministic snapshot generated before compilation. Neither path needs localhost,
 * HTTP, a global Node installation, or a mutable file under app.asar/resources.
 */
export async function readRoadmapSnapshot(): Promise<RoadmapSnapshot> {
  if (!app.isPackaged) {
    try {
      const moduleUrl = pathToFileURL(join(process.cwd(), "tools", "roadmap", "lib", "model.mjs")).href;
      const model = (await import(/* @vite-ignore */ moduleUrl)) as {
        buildSnapshot: () => RoadmapSnapshot;
      };
      return model.buildSnapshot();
    } catch {
      // Development source may be absent in specialized test roots; use the bundled build snapshot.
    }
  }
  const text = await readFile(join(getResourcesRoot(), "embedded-roadmap-snapshot.json"), "utf8");
  return JSON.parse(text) as RoadmapSnapshot;
}
