/**
 * Field-level semantic diff for persistence round-trip testing.
 *
 * Compares an original definition against the definition that came back after a save/load cycle
 * and reports **every** structural difference, addressed by path
 * (`nodes[3].locator.value`, `edges[1].maxLoopCount`).
 *
 * ## What "semantic" means here, precisely
 *
 * The only normalization applied is `undefined` ≡ absent. That is not leniency: `JSON.stringify`
 * deletes `undefined`-valued keys, so `{ a: undefined }` and `{}` are the *same document* once
 * persisted, and reporting them as a difference would bury the real findings in noise.
 *
 * Everything else is reported. In particular this module does **not**:
 *  - ignore, default or substitute a field that disappeared;
 *  - redact values (the lab only ever generates opaque secret *references*, so nothing sensitive
 *    can reach a diff in the first place — see `SafeTestData`);
 *  - allow callers to exclude fields from the comparison.
 *
 * A caller may *classify* a difference after the fact (`classifyDifference`), which changes how it
 * is reported, never whether it is reported.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */

export type DifferenceKind =
  /** Present before, gone after — data loss. */
  | "lost"
  /** Absent before, present after — the round trip fabricated a value. */
  | "fabricated"
  /** Present on both sides with a different value. */
  | "changed";

export interface FieldDifference {
  readonly path: string;
  readonly kind: DifferenceKind;
  readonly before: unknown;
  readonly after: unknown;
}

/** How much a difference matters. Assigned by the caller from the defect catalog, not guessed here. */
export type DifferenceSeverity =
  /** Changes what the flow does when executed. */
  | "executionAffecting"
  /** Weakens a security-relevant guarantee (a secret reference, a safety policy). */
  | "securityAffecting"
  /** The saved document is still executable, but the editor lost authoring information. */
  | "editingFidelity"
  /** Value is re-derived identically on every save; harmless but makes saves non-idempotent. */
  | "cosmetic";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `undefined` and an absent key are indistinguishable after JSON serialization. */
function isAbsent(value: unknown): boolean {
  return value === undefined;
}

function primitivesEqual(before: unknown, after: unknown): boolean {
  if (before === after) return true;
  // NaN !== NaN, but two NaNs are the same document.
  return typeof before === "number" && typeof after === "number" && Number.isNaN(before) && Number.isNaN(after);
}

function join(path: string, segment: string): string {
  return path === "" ? segment : `${path}.${segment}`;
}

function walk(before: unknown, after: unknown, path: string, out: FieldDifference[]): void {
  const beforeAbsent = isAbsent(before);
  const afterAbsent = isAbsent(after);

  if (beforeAbsent && afterAbsent) return;
  if (beforeAbsent) {
    out.push({ path, kind: "fabricated", before, after });
    return;
  }
  if (afterAbsent) {
    out.push({ path, kind: "lost", before, after });
    return;
  }

  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) {
      out.push({ path, kind: "changed", before, after });
      return;
    }
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      walk(before[index], after[index], `${path}[${index}]`, out);
    }
    return;
  }

  if (isPlainObject(before) || isPlainObject(after)) {
    if (!isPlainObject(before) || !isPlainObject(after)) {
      out.push({ path, kind: "changed", before, after });
      return;
    }
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    // Sorted so a diff is byte-stable across runs — a defect report that reorders itself is not a
    // report you can diff between builds.
    for (const key of [...keys].sort()) {
      walk(before[key], after[key], join(path, key), out);
    }
    return;
  }

  if (!primitivesEqual(before, after)) {
    out.push({ path, kind: "changed", before, after });
  }
}

/** Every difference between two definitions, deterministically ordered. */
export function diffSemantic(before: unknown, after: unknown, rootPath = ""): FieldDifference[] {
  const differences: FieldDifference[] = [];
  walk(before, after, rootPath, differences);
  return differences;
}

/**
 * Collapse a concrete path to a stable *shape* by replacing array indices with `[]`.
 * `nodes[7].locator.value` → `nodes[].locator.value`. Grouping the raw diff of a 40-node flow by
 * shape turns hundreds of lines into a handful of distinct defects.
 */
export function differenceShape(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}

export interface DifferenceGroup {
  readonly shape: string;
  readonly kind: DifferenceKind;
  readonly occurrences: number;
  /** One concrete instance, kept verbatim so the report shows real before/after values. */
  readonly example: FieldDifference;
  /** Node types the shape was observed on. Empty when the path is not node-scoped. */
  readonly nodeTypes: readonly string[];
}

/**
 * Group raw differences by shape and kind.
 *
 * `nodeTypeAt` resolves the step type for a concrete path so a defect can be attributed to the node
 * types it affects — "locators are dropped from screenshot and wait steps" is actionable in a way
 * that "nodes[].locator is lost" is not.
 */
export function groupDifferences(
  differences: readonly FieldDifference[],
  nodeTypeAt?: (path: string) => string | undefined
): DifferenceGroup[] {
  const groups = new Map<string, { shape: string; kind: DifferenceKind; occurrences: number; example: FieldDifference; nodeTypes: Set<string> }>();

  for (const difference of differences) {
    const shape = differenceShape(difference.path);
    const id = `${shape}::${difference.kind}`;
    let group = groups.get(id);
    if (!group) {
      group = { shape, kind: difference.kind, occurrences: 0, example: difference, nodeTypes: new Set() };
      groups.set(id, group);
    }
    group.occurrences += 1;
    const nodeType = nodeTypeAt?.(difference.path);
    if (nodeType) group.nodeTypes.add(nodeType);
  }

  return [...groups.values()]
    .map<DifferenceGroup>((group) => ({
      shape: group.shape,
      kind: group.kind,
      occurrences: group.occurrences,
      example: group.example,
      nodeTypes: [...group.nodeTypes].sort()
    }))
    .sort((a, b) => (a.shape === b.shape ? a.kind.localeCompare(b.kind) : a.shape.localeCompare(b.shape)));
}

/** `nodes[12].config.fullPage` → 12. `undefined` when the path is not node-scoped. */
export function nodeIndexFromPath(path: string): number | undefined {
  const match = /^nodes\[(\d+)\]/.exec(path);
  return match ? Number(match[1]) : undefined;
}

/** `edges[3].maxLoopCount` → 3. `undefined` when the path is not edge-scoped. */
export function edgeIndexFromPath(path: string): number | undefined {
  const match = /^edges\[(\d+)\]/.exec(path);
  return match ? Number(match[1]) : undefined;
}
