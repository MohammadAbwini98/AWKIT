import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "../tools/roadmap/lib/model.mjs";
import { ASSIGNMENTS_PATH, SOURCES, sourcePath } from "../tools/roadmap/lib/sources.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(repoRoot, "resources/embedded-roadmap-snapshot.json");
const mtimes = await Promise.all(
  [...SOURCES.map((source) => sourcePath(source.id)), ASSIGNMENTS_PATH].map((path) =>
    stat(path).then((value) => value.mtimeMs).catch(() => 0)
  )
);
const deterministicNow = Math.max(0, ...mtimes);
const snapshot = buildSnapshot({ now: deterministicNow });
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot)}\n`, "utf8");
console.log(`Embedded roadmap snapshot: ${snapshot.stats.items} records from ${snapshot.sources.length} sources.`);
