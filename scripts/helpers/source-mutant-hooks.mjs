/**
 * Node module hooks for out-of-tree mutation gates: one source file is mutated IN MEMORY as it loads.
 *
 * Chained after tsx, so this `load` runs first: `--import` on a Node with `module.register`, where the parent
 * sets AWKIT_SOURCE_MUTANT_REGISTER and this file registers itself; `--loader` on an older Node. When
 * AWKIT_SOURCE_MUTANT names a file, that file is read from disk, `find` is replaced by `replace`, the result is
 * transpiled by the repository's own TypeScript, and a marker is written so the parent can prove the mutant
 * really loaded. The URL is unchanged, so the module's own imports resolve exactly as before. Every other
 * module goes to tsx.
 *
 * The file on disk is never written. The parent proves `find` occurs exactly once before it spawns.
 */
import * as nodeModule from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";

let mutant = JSON.parse(process.env.AWKIT_SOURCE_MUTANT ?? "null");
if (isMainThread && process.env.AWKIT_SOURCE_MUTANT_REGISTER === "1") nodeModule.register(import.meta.url, { data: mutant });

export function initialize(data) {
  mutant = data;
}

export async function load(url, context, nextLoad) {
  if (mutant && url.startsWith("file:") && resolve(fileURLToPath(url.split("?")[0])).toLowerCase() === resolve(mutant.file).toLowerCase()) {
    const ts = nodeModule.createRequire(import.meta.url)("typescript");
    const source = readFileSync(mutant.file, "utf8").split(mutant.find).join(mutant.replace);
    const { outputText } = ts.transpileModule(source, {
      fileName: mutant.file,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    });
    writeFileSync(mutant.marker, mutant.id);
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
