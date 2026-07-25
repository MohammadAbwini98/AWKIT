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

/**
 * Result of an activation.
 *
 * `metadataRepairRequired` exists because the active pointer is AUTHORITATIVE and metadata is
 * derived. Activation writes the pointer first; if the subsequent metadata write fails, the
 * activation has still *happened* and must not be reported as a failure — an earlier revision threw
 * here, and the rebuild's error handler then deleted the very generation the pointer had just been
 * switched to, leaving the pointer aimed at a deleted directory. Metadata is repaired from the
 * pointer instead (see `repairMetadataFromPointer`).
 */
export interface GenerationActivation {
  pointer: ActiveGenerationPointer;
  metadataRepairRequired: boolean;
}

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
  // The parent may be created recursively; the generation directory itself must NOT be, because
  // `recursive: true` succeeds silently on an existing directory and would hide a competing creator.
  fs.mkdirSync(layout.generations, { recursive: true });

  // Allocation is collision-safe: mkdir without `recursive` is the atomic claim. A check-then-create
  // would let two concurrent rebuilds pick the same sequence and one silently adopt the other's
  // directory. Phase 1B additionally serializes rebuilds through the mutation queue; this loop is
  // the second line of defence, not a substitute for it.
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const existing = listGenerations(runtimeRoot);
    const highest = existing.length > 0 ? (generationSequence(existing[0]) ?? 0) : 0;
    const name = generationName(highest + 1 + attempt);
    const dir = path.join(layout.generations, name);
    try {
      fs.mkdirSync(dir);
      return { name, path: dir };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
  throw new SemanticGenerationError("SEMANTIC_GENERATION_ALLOCATION_EXHAUSTED");
}

/**
 * Atomically make `name` the active generation, retaining the outgoing one for rollback.
 *
 * Refuses to activate a generation that does not exist on disk, and refuses to activate one that
 * failed validation — activating an unvalidated generation is how a rebuild corrupts a working index.
 */
export function activateGeneration(runtimeRoot: string, name: string, validation: GenerationValidation): GenerationActivation {
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

  // ── the commit point ──
  // Everything before this line may throw and leave the previous generation active. Everything
  // after it must NOT throw, because the switch has already happened.
  writeJsonAtomic(pointerPath(runtimeRoot), pointer);

  let metadataRepairRequired = false;
  try {
    const metadata: SemanticIndexMetadata = readMetadata(runtimeRoot);
    writeMetadata(runtimeRoot, { ...metadata, activeGeneration: name, lastSuccessfulRebuildAt: pointer.activatedAt });
  } catch {
    // Derived data only. The pointer already names the new generation, so the activation stands and
    // startup reconciliation will bring metadata back into line.
    metadataRepairRequired = true;
  }

  return { pointer, metadataRepairRequired };
}

/**
 * Bring metadata back into agreement with the authoritative pointer.
 *
 * Called on startup: if a metadata write failed during activation, or metadata was hand-edited, the
 * pointer wins. Returns true when a repair was performed.
 */
export function repairMetadataFromPointer(runtimeRoot: string): boolean {
  const pointer = readActivePointer(runtimeRoot);
  if (!pointer) return false;
  try {
    const metadata = readMetadata(runtimeRoot);
    if (metadata.activeGeneration === pointer.activeGeneration) return false;
    writeMetadata(runtimeRoot, { ...metadata, activeGeneration: pointer.activeGeneration });
    return true;
  } catch {
    return false;
  }
}

/**
 * Roll back to the retained predecessor.
 *
 * Only one step back is supported, deliberately: the retention window keeps exactly one rollback
 * target, so pretending to offer deeper history would be a lie about what is on disk.
 */
export function rollbackGeneration(runtimeRoot: string): GenerationActivation {
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

  // Same commit point as activateGeneration: once the pointer is written the rollback has happened,
  // so the derived metadata write must not be able to turn it back into a failure.
  writeJsonAtomic(pointerPath(runtimeRoot), pointer);

  let metadataRepairRequired = false;
  try {
    const metadata = readMetadata(runtimeRoot);
    writeMetadata(runtimeRoot, { ...metadata, activeGeneration: target });
  } catch {
    metadataRepairRequired = true;
  }

  return { pointer, metadataRepairRequired };
}

export type RebuildStatus =
  | "ACTIVATED"
  /** Pointer switched, but the derived metadata write failed. Startup repairs it. */
  | "ACTIVATED_METADATA_REPAIR_REQUIRED"
  | "VALIDATION_FAILED"
  | "POPULATE_FAILED"
  | "ACTIVATION_FAILED";

export interface RebuildOutcome {
  generation: string;
  status: RebuildStatus;
  /** True for both ACTIVATED statuses — the new generation IS live. */
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

  // Once the pointer names this generation, deleting it would leave the authoritative pointer aimed
  // at a missing directory. This flag is the guard: after activation, the cleanup path is disabled
  // unconditionally, whatever else fails afterwards.
  let activated = false;

  const discard = (): void => {
    if (activated) return;
    try {
      fs.rmSync(created.path, { recursive: true, force: true });
    } catch {
      /* a locked directory is reclaimed by the next startup reconciliation */
    }
  };

  try {
    await populate(created.name, created.path);
    const validation = await validate(created.name, created.path);

    if (!validation.ok) {
      discard();
      return {
        generation: created.name,
        status: "VALIDATION_FAILED",
        activated: false,
        reason: validation.reason,
        pointer: readActivePointer(runtimeRoot)
      };
    }

    const activation = activateGeneration(runtimeRoot, created.name, validation);
    activated = true; // set immediately: the pointer has switched, so cleanup is now forbidden
    return {
      generation: created.name,
      status: activation.metadataRepairRequired ? "ACTIVATED_METADATA_REPAIR_REQUIRED" : "ACTIVATED",
      activated: true,
      pointer: activation.pointer
    };
  } catch (error) {
    // Reached only when populate, validate, or the pre-commit part of activation failed. The
    // previously active index is untouched by construction.
    discard();
    return {
      generation: created.name,
      status: activated ? "ACTIVATED_METADATA_REPAIR_REQUIRED" : "POPULATE_FAILED",
      activated,
      reason: error instanceof SemanticGenerationError ? error.reason : "SEMANTIC_GENERATION_REBUILD_FAILED",
      pointer: readActivePointer(runtimeRoot)
    };
  }
}
