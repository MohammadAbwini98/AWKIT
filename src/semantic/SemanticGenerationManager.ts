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
  defaultSemanticIndexMetadata,
  generationName,
  generationSequence,
  isGenerationName,
  semanticIndexLayout,
  type SemanticIndexMetadata
} from "./SemanticGenerationLayout";
import {
  readMetadata,
  readMetadataStrict,
  writeMetadata,
  type ActiveGenerationIdentity
} from "./SemanticGenerationReconciler";

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

/**
 * Distinguishable outcomes of reading the active pointer.
 *
 * Four states, not two. An earlier revision returned `null` for "no pointer yet", "the file could
 * not be read", "the JSON is malformed", and "the name is not a generation" alike — and the
 * reconciler reads `null` as "there is no active generation, so nothing is protected". A damaged
 * pointer therefore presented as a first-run empty index, and the unclean-shutdown discard rule
 * deleted every generation on disk, including the live one.
 *
 * That is the same defect class the authoritative-pointer fix closed for `metadata.json`, relocated
 * one level up into the pointer's own reader: it is not enough for the pointer to be authoritative
 * if "unreadable" is indistinguishable from "absent".
 */
export type ActivePointerRead =
  | { status: "ok"; pointer: ActiveGenerationPointer }
  /** No pointer file at all — the normal first-use state. */
  | { status: "missing" }
  /** Present but not a well-formed pointer document. Active identity is UNKNOWN. */
  | { status: "invalid" }
  /** Present but could not be read (permissions, I/O, lock). Active identity is UNKNOWN. */
  | { status: "unreadable" };

function isGenerationNameValue(value: unknown): value is string {
  return typeof value === "string" && isGenerationName(value);
}

/** An ISO-8601 instant as written by `new Date().toISOString()`. */
function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

/**
 * Read the active pointer, distinguishing absence from damage.
 *
 * Every field is validated, not just `activeGeneration`: a document that is only partly well-formed
 * is a damaged document, and silently accepting it would let a garbage `previousGeneration` become a
 * rollback target or a garbage `activatedAt` corrupt retention ordering. Validation failure is
 * deliberately biased toward `invalid` (preserve everything, require recovery) rather than toward a
 * usable-looking pointer, because over-preserving wastes disk while under-preserving destroys the index.
 */
export function readActivePointerStrict(runtimeRoot: string): ActivePointerRead {
  let raw: string;
  try {
    raw = fs.readFileSync(pointerPath(runtimeRoot), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { status: "missing" } : { status: "unreadable" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { status: "invalid" };
  const candidate = parsed as Record<string, unknown>;

  if (!isGenerationNameValue(candidate.activeGeneration)) return { status: "invalid" };
  // `null` is meaningful (no rollback target); anything else must be a real generation name. A
  // MISSING property is damage rather than absence — every writer in this file emits all three fields.
  if (candidate.previousGeneration !== null && !isGenerationNameValue(candidate.previousGeneration)) {
    return { status: "invalid" };
  }
  if (!isIsoTimestamp(candidate.activatedAt)) return { status: "invalid" };

  return {
    status: "ok",
    pointer: {
      activeGeneration: candidate.activeGeneration,
      previousGeneration: candidate.previousGeneration,
      activatedAt: candidate.activatedAt
    }
  };
}

/**
 * Tolerant read for callers that genuinely only need "the pointer, if it is usable".
 *
 * Defined in terms of the strict reader so both share one validation rule. Callers that make
 * DESTRUCTIVE decisions must NOT use this — they cannot tell absence from damage through it, which
 * is precisely the confusion that made reconciliation delete a live index. Use
 * `resolveActiveIdentity` instead.
 */
export function readActivePointer(runtimeRoot: string): ActiveGenerationPointer | null {
  const read = readActivePointerStrict(runtimeRoot);
  return read.status === "ok" ? read.pointer : null;
}

/**
 * The single mapping from "how the pointer read went" to "what reconciliation may assume".
 *
 * Exists as one exported function, and is the only way the service constructs an identity, so the
 * damaged-reads-as-absent collapse cannot be reintroduced by a caller writing the mapping inline.
 */
export function activeIdentityFromPointerRead(read: ActivePointerRead): ActiveGenerationIdentity {
  switch (read.status) {
    case "ok":
      return { status: "known", generation: read.pointer.activeGeneration };
    case "missing":
      return { status: "none" };
    case "invalid":
    case "unreadable":
      return { status: "unknown" };
  }
}

/** Read the pointer and map it to a reconciliation identity in one step. */
export function resolveActiveIdentity(runtimeRoot: string): ActiveGenerationIdentity {
  return activeIdentityFromPointerRead(readActivePointerStrict(runtimeRoot));
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
  // `highest` is recomputed every iteration, so a lost race simply re-reads the new highest and
  // tries the next number. Adding the attempt counter to the sequence also worked, but skipped
  // sequence numbers after a collision for no benefit.
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const existing = listGenerations(runtimeRoot);
    const highestOnDisk = existing.length > 0 ? (generationSequence(existing[0]) ?? 0) : 0;

    // Names referenced by the pointer are claimed even when their directory is gone. Without this,
    // deleting the active generation lets the allocator reissue its exact name, and the pointer then
    // silently resolves to a brand-new empty directory — identity confusion rather than a clean
    // "active generation missing" state.
    const pointer = readActivePointer(runtimeRoot);
    const claimed = [pointer?.activeGeneration, pointer?.previousGeneration]
      .map((n) => (n ? (generationSequence(n) ?? 0) : 0))
      .reduce((a, b) => Math.max(a, b), 0);

    const highest = Math.max(highestOnDisk, claimed);
    const name = generationName(highest + 1);
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
 * Outcome of a metadata repair.
 *
 * Deliberately not a boolean: "nothing needed repairing" and "the repair itself failed" are
 * completely different situations, and collapsing them into `false` meant a persistent write failure
 * looked identical to a healthy startup. A failure must reach the health surface.
 */
export type MetadataRepairResult =
  | { status: "notNeeded" }
  | { status: "repaired"; activeGeneration: string }
  | { status: "failed"; reason: "READ_FAILED" | "WRITE_FAILED" | "POINTER_UNREADABLE" };

/**
 * Bring metadata back into agreement with the authoritative pointer.
 *
 * Called on startup: if a metadata write failed during activation, or metadata was hand-edited, the
 * pointer wins. Never throws — AWKIT startup must not depend on this succeeding.
 */
export function repairMetadataFromPointer(runtimeRoot: string): MetadataRepairResult {
  const pointerRead = readActivePointerStrict(runtimeRoot);

  // A damaged pointer is NOT "nothing to repair". Repairing metadata *from* it would propagate the
  // damage into derived data, and reporting `notNeeded` would hide a state that requires recovery.
  if (pointerRead.status === "invalid" || pointerRead.status === "unreadable") {
    return { status: "failed", reason: "POINTER_UNREADABLE" };
  }
  if (pointerRead.status === "missing") return { status: "notNeeded" };
  const pointer = pointerRead.pointer;

  // The STRICT reader is mandatory here. The tolerant `readMetadata()` never throws — it returns
  // defaults on any failure — so wrapping it in try/catch produced an unreachable READ_FAILED branch
  // and, worse, silently treated an unreadable file as "activeGeneration: null".
  const read = readMetadataStrict(runtimeRoot);
  if (read.status === "unreadable" || read.status === "invalid") {
    return { status: "failed", reason: "READ_FAILED" };
  }
  const metadata: SemanticIndexMetadata = read.status === "ok" ? read.metadata : defaultSemanticIndexMetadata();

  if (metadata.activeGeneration === pointer.activeGeneration) return { status: "notNeeded" };

  try {
    writeMetadata(runtimeRoot, { ...metadata, activeGeneration: pointer.activeGeneration });
    return { status: "repaired", activeGeneration: pointer.activeGeneration };
  } catch {
    // The pointer still governs, so the index is usable, but metadata is now knowingly stale:
    // surface it as degraded rather than pretending the startup was clean.
    return { status: "failed", reason: "WRITE_FAILED" };
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
  | "ALLOCATION_FAILED"
  | "POPULATE_FAILED"
  | "VALIDATION_FAILED"
  | "ACTIVATION_FAILED";

/**
 * Which stage a rebuild reached. Tracked explicitly because the failure status must name the stage
 * that actually failed: an earlier revision reported POPULATE_FAILED for a thrown validator or a
 * failed pointer write, which is misleading for both recovery decisions and support diagnostics.
 */
type RebuildStage = "allocate" | "populate" | "validate" | "activate";

const STAGE_FAILURE: Record<RebuildStage, RebuildStatus> = {
  allocate: "ALLOCATION_FAILED",
  populate: "POPULATE_FAILED",
  validate: "VALIDATION_FAILED",
  activate: "ACTIVATION_FAILED"
};

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

  let stage: RebuildStage = "allocate";
  let created: { name: string; path: string };
  try {
    created = createGeneration(runtimeRoot);
  } catch (error) {
    return {
      generation: "(unallocated)",
      status: "ALLOCATION_FAILED",
      activated: false,
      reason: error instanceof SemanticGenerationError ? error.reason : "SEMANTIC_GENERATION_ALLOCATION_FAILED",
      pointer: readActivePointer(runtimeRoot)
    };
  }

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
    stage = "populate";
    await populate(created.name, created.path);

    stage = "validate";
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

    stage = "activate";
    const activation = activateGeneration(runtimeRoot, created.name, validation);
    activated = true; // set immediately: the pointer has switched, so cleanup is now forbidden
    return {
      generation: created.name,
      status: activation.metadataRepairRequired ? "ACTIVATED_METADATA_REPAIR_REQUIRED" : "ACTIVATED",
      activated: true,
      pointer: activation.pointer
    };
  } catch (error) {
    // The previously active index is untouched by construction. `stage` names the step that actually
    // threw, so a thrown validator is not reported as a populate failure.
    discard();
    return {
      generation: created.name,
      status: STAGE_FAILURE[stage],
      activated: false,
      reason: error instanceof SemanticGenerationError ? error.reason : `SEMANTIC_GENERATION_${stage.toUpperCase()}_THREW`,
      pointer: readActivePointer(runtimeRoot)
    };
  }
}
