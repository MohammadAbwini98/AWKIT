/**
 * On-disk layout of the semantic index, and the path-confinement rule that guards it.
 *
 * Everything lives under the per-user runtime root (plan §7.1):
 *
 *   semantic-index/
 *     metadata.json
 *     active-generation.json
 *     generations/gen-000001/ ...
 *     rebuild/rebuild-state.json
 *     quarantine/
 *     logs/
 *
 * Framework-agnostic: the caller supplies the runtime root, so this module never imports Electron
 * and can be exercised by verifiers directly. Nothing here writes into `resources/`, `vendor/`, or
 * `app.asar`.
 */

import path from "node:path";

export const SEMANTIC_INDEX_DIR = "semantic-index";
export const GENERATIONS_DIR = "generations";
export const QUARANTINE_DIR = "quarantine";
export const REBUILD_DIR = "rebuild";
export const LOGS_DIR = "logs";
export const METADATA_FILE = "metadata.json";
export const ACTIVE_GENERATION_FILE = "active-generation.json";
export const REBUILD_STATE_FILE = "rebuild-state.json";

/** `gen-000001` — zero-padded so lexical order matches creation order. */
const GENERATION_PATTERN = /^gen-\d{6}$/;

export interface SemanticIndexLayout {
  root: string;
  generations: string;
  quarantine: string;
  rebuild: string;
  logs: string;
  metadataFile: string;
  activeGenerationFile: string;
  rebuildStateFile: string;
}

/** Resolve the full layout under a runtime root (e.g. `%LOCALAPPDATA%/SpecterStudio`). */
export function semanticIndexLayout(runtimeRoot: string): SemanticIndexLayout {
  const root = path.resolve(runtimeRoot, SEMANTIC_INDEX_DIR);
  return {
    root,
    generations: path.join(root, GENERATIONS_DIR),
    quarantine: path.join(root, QUARANTINE_DIR),
    rebuild: path.join(root, REBUILD_DIR),
    logs: path.join(root, LOGS_DIR),
    metadataFile: path.join(root, METADATA_FILE),
    activeGenerationFile: path.join(root, ACTIVE_GENERATION_FILE),
    rebuildStateFile: path.join(root, REBUILD_DIR, REBUILD_STATE_FILE)
  };
}

/** Is `name` a well-formed generation directory name? */
export function isGenerationName(name: string): boolean {
  return GENERATION_PATTERN.test(name);
}

/** `1` → `gen-000001`. */
export function generationName(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Generation sequence must be a positive integer, got ${sequence}.`);
  }
  return `gen-${String(sequence).padStart(6, "0")}`;
}

/** `gen-000007` → `7`; `null` when the name is not a generation. */
export function generationSequence(name: string): number | null {
  if (!isGenerationName(name)) return null;
  return Number.parseInt(name.slice("gen-".length), 10);
}

/** Absolute path of a generation directory. */
export function generationPath(runtimeRoot: string, name: string): string {
  if (!isGenerationName(name)) throw new Error(`Not a valid generation name: ${name}`);
  return path.join(semanticIndexLayout(runtimeRoot).generations, name);
}

/**
 * Is `candidate` a legitimate generation directory inside this runtime root?
 *
 * The host re-implements this check independently (see `native-hosts/zvec/zvec-host.cjs`). The
 * duplication is deliberate: if it lived in only one place, a future gap in IPC validation would
 * become arbitrary filesystem access. Both sides must agree before a collection is opened.
 *
 * Rejects the generations root itself, anything outside it, any nesting deeper than one level, and
 * any traversal that escapes via `..`.
 */
export function isConfinedGenerationPath(runtimeRoot: string, candidate: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;

  const generationsRoot = semanticIndexLayout(runtimeRoot).generations;
  const resolved = path.resolve(candidate);
  const relative = path.relative(generationsRoot, resolved);

  // "" means the generations root itself, which is not a generation.
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;

  // Exactly one path segment, and it must look like a generation.
  const segments = relative.split(/[\\/]/).filter(Boolean);
  if (segments.length !== 1) return false;
  return isGenerationName(segments[0]);
}

export interface SemanticIndexMetadata {
  semanticSchemaVersion: number;
  activeGeneration: string | null;
  storeAdapter: "zvec";
  storeVersion: string | null;
  ftsEnabled: boolean;
  vectorEnabled: boolean;
  lastSuccessfulUpdateAt: string | null;
  lastSuccessfulRebuildAt: string | null;
  /**
   * False whenever the process is running with the index open. It is set true only by an orderly
   * shutdown, so a crash or power loss leaves it false and the next startup knows to reconcile
   * (plan §12). This is the entire mechanism behind unclean-shutdown detection.
   */
  cleanShutdown: boolean;
}

export function defaultSemanticIndexMetadata(): SemanticIndexMetadata {
  return {
    semanticSchemaVersion: 1,
    activeGeneration: null,
    storeAdapter: "zvec",
    storeVersion: null,
    ftsEnabled: true,
    vectorEnabled: false,
    lastSuccessfulUpdateAt: null,
    lastSuccessfulRebuildAt: null,
    cleanShutdown: true
  };
}
