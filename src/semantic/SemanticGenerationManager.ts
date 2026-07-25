/**
 * Generation lifecycle: create → populate → validate → activate, with rollback (plan §7.2).
 *
 * The invariant this file exists to enforce: **a rebuild never mutates the active generation.** A
 * new generation is built alongside, validated, and only then does the active pointer move — as a
 * single atomic rename. A crash at any point therefore leaves either the old generation active or
 * the new one active, never a half-swapped index.
 *
 * Population and validation both need the native host, so they are injected as callbacks. Everything
 * here stays pure filesystem + pointer work, which keeps it verifiable without Electron or Zvec.
 */

import fs from "node:fs";
import path from "node:path";

import {
  generationName,
  generationSequence,
  isGenerationName,
  semanticIndexLayout,
  type SemanticIndexMetadata
} from "./SemanticGenerationLayout";
import { readMetadata, writeMetadata } from "./SemanticGenerationReconciler";

/**
 * The active-generation pointer, kept separate from `metadata.json` so activation is one small
 * atomic write rather than a rewrite of the whole metadata document.
 */
export interface ActiveGenerationPointer {
  activeGeneration: string;
  /** Retained for rollback; null when this is the first generation. */
  previousGeneration: string | null;
  activatedAt: string;
}

export type GenerationValidation = { ok: true } | { ok: false; reason: string };

export class SemanticGenerationError extends Error {
  constructor(readonly reason: string, message?: string) {
    super(message ?? reason);
    this.name = "SemanticGenerationError";
  }
}

function pointerPath(runtimeRoot: string): string {
  return semanticIndexLayout(runtimeRoot).activeGenerationFile;
}

/** Write any JSON atomically: temp file then rename, so a crash cannot leave a truncated pointer. */
function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

export function readActivePointer(runtimeRoot: string): ActiveGenerationPointer | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(pointerPath(runtimeRoot), "utf8")) as ActiveGenerationPointer;
    return isGenerationName(parsed.activeGeneration) ? parsed : null;
  } catch {
    return null;
  }
}

/** List generation directories present on disk, newest first. */
export function listGenerations(runtimeRoot: string): string[] {
  const layout = semanticIndexLayout(runtimeRoot);
  try {
    return fs
      .readdirSync(layout.generations, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isGenerationName(e.name))
      .map((e) => e.name)
      .sort((a, b) => (generationSequence(b) ?? 0) - (generationSequence(a) ?? 0));
  } catch {
    return [];
  }
}

/**
 * Allocate the next generation directory.
 *
 * The sequence is derived from what is on disk, not from a counter in metadata: a counter can drift
 * from reality after a crash or a manual deletion and then hand out a name that already exists.
 */
export function createGeneration(runtimeRoot: string): { name: string; path: string } {
  const layout = semanticIndexLayout(runtimeRoot);
  const existing = listGenerations(runtimeRoot);
  const highest = existing.length > 0 ? (generationSequence(existing[0]) ?? 0) : 0;
  const name = generationName(highest + 1);
  const dir = path.join(layout.generations, name);

  if (fs.existsSync(dir)) throw new SemanticGenerationError("SEMANTIC_GENERATION_EXISTS", name);
  fs.mkdirSync(dir, { recursive: true });
  return { name, path: dir };
}

/**
 * Atomically make `name` the active generation, retaining the outgoing one for rollback.
 *
 * Refuses to activate a generation that does not exist on disk, and refuses to activate one that
 * failed validation — activating an unvalidated generation is how a rebuild corrupts a working index.
 */
export function activateGeneration(runtimeRoot: string, name: string, validation: GenerationValidation): ActiveGenerationPointer {
  if (!isGenerationName(name)) throw new SemanticGenerationError("SEMANTIC_GENERATION_INVALID_NAME", name);
  if (!validation.ok) throw new SemanticGenerationError("SEMANTIC_GENERATION_VALIDATION_FAILED", validation.reason);

  const layout = semanticIndexLayout(runtimeRoot);
  if (!fs.existsSync(path.join(layout.generations, name))) {
    throw new SemanticGenerationError("SEMANTIC_GENERATION_MISSING", name);
  }

  const current = readActivePointer(runtimeRoot);
  const pointer: ActiveGenerationPointer = {
    activeGeneration: name,
    // Do not record the incoming generation as its own predecessor; that would make rollback a no-op.
    previousGeneration: current && current.activeGeneration !== name ? current.activeGeneration : null,
    activatedAt: new Date().toISOString()
  };

  writeJsonAtomic(pointerPath(runtimeRoot), pointer);

  const metadata: SemanticIndexMetadata = readMetadata(runtimeRoot);
  writeMetadata(runtimeRoot, { ...metadata, activeGeneration: name, lastSuccessfulRebuildAt: pointer.activatedAt });

  return pointer;
}

/**
 * Roll back to the retained predecessor.
 *
 * Only one step back is supported, deliberately: the retention window keeps exactly one rollback
 * target, so pretending to offer deeper history would be a lie about what is on disk.
 */
export function rollbackGeneration(runtimeRoot: string): ActiveGenerationPointer {
  const current = readActivePointer(runtimeRoot);
  if (!current) throw new SemanticGenerationError("SEMANTIC_GENERATION_NO_ACTIVE");
  if (!current.previousGeneration) throw new SemanticGenerationError("SEMANTIC_GENERATION_NO_ROLLBACK_TARGET");

  const layout = semanticIndexLayout(runtimeRoot);
  const target = current.previousGeneration;
  if (!fs.existsSync(path.join(layout.generations, target))) {
    // The retained target was reclaimed or removed; say so rather than pointing at a missing path.
    throw new SemanticGenerationError("SEMANTIC_GENERATION_ROLLBACK_TARGET_MISSING", target);
  }

  const pointer: ActiveGenerationPointer = {
    activeGeneration: target,
    // After rolling back, the generation we came from becomes the forward target.
    previousGeneration: current.activeGeneration,
    activatedAt: new Date().toISOString()
  };
  writeJsonAtomic(pointerPath(runtimeRoot), pointer);

  const metadata = readMetadata(runtimeRoot);
  writeMetadata(runtimeRoot, { ...metadata, activeGeneration: target });
  return pointer;
}

export interface RebuildOutcome {
  generation: string;
  activated: boolean;
  reason?: string;
  pointer: ActiveGenerationPointer | null;
}

/**
 * Full rebuild: build a NEW generation, validate it, and activate only on success.
 *
 * On failure the new generation is discarded and the active pointer is left exactly as it was, so a
 * failed rebuild can never degrade a working index. `populate` and `validate` are injected because
 * both require the native host.
 */
export async function rebuildIntoNewGeneration(options: {
  runtimeRoot: string;
  populate: (generation: string, generationPath: string) => Promise<void>;
  validate: (generation: string, generationPath: string) => Promise<GenerationValidation>;
}): Promise<RebuildOutcome> {
  const { runtimeRoot, populate, validate } = options;
  const created = createGeneration(runtimeRoot);

  try {
    await populate(created.name, created.path);
    const validation = await validate(created.name, created.path);

    if (!validation.ok) {
      fs.rmSync(created.path, { recursive: true, force: true });
      return { generation: created.name, activated: false, reason: validation.reason, pointer: readActivePointer(runtimeRoot) };
    }

    const pointer = activateGeneration(runtimeRoot, created.name, validation);
    return { generation: created.name, activated: true, pointer };
  } catch (error) {
    // Discard the partial generation; the previously active index is untouched by construction.
    fs.rmSync(created.path, { recursive: true, force: true });
    return {
      generation: created.name,
      activated: false,
      reason: String((error as Error)?.message ?? error),
      pointer: readActivePointer(runtimeRoot)
    };
  }
}
