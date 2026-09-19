/**
 * Phase L L2 task 4: capture-time upgrade context. The page reads the exact target's bounded semantic
 * neighbourhood while it still exists (`locator.upgradeContext`, capture-only); RecorderService takes it
 * off the action before anything else sees it, bounds it here, marks which texts are bound values, and
 * keeps it in a memory-only TTL store for L3 and the Element Spy. It is never written to the draft, a
 * profile, a log or a report, and nothing here needs a model.
 */
import type { RecordedAction } from "./RecorderTypes";

export const UPGRADE_CONTEXT_TTL_MS = 10 * 60_000;
export const UPGRADE_CONTEXT_MAX_ENTRIES = 500;

const MAX_TEXT = 80;
const MAX_VALUE = 200;
const CONTAINER_KINDS = new Set(["dialog", "row", "card", "listItem", "form", "landmark"]);

export interface UpgradeContextCandidate {
  strategy: string;
  value: string;
  name?: string;
  count: number;
  fallback: boolean;
}

export interface UpgradeContextContainer {
  kind: string;
  tag: string;
  role: string;
  name: string;
}

/** Where a bound text came from: the action's own input value, or a value an earlier step typed/selected. */
export interface BoundValueMarker {
  field: string;
  source: "action-value" | "earlier-input";
}

export interface UpgradeContext {
  schemaVersion: 1;
  capturedAt: string;
  target: { tag: string; role: string; name: string; type: string };
  candidates: UpgradeContextCandidate[];
  containers: UpgradeContextContainer[];
  heading: string;
  siblingActions: string[];
  pageKey: string;
  pageAlias: string;
  frame: "top" | "child";
  /** Frame-graph chain length when the target is in a child frame (built by the main process, trusted). */
  frameDepth: number;
  shadow: "none" | "open";
  /** The target's in-page fingerprint, memory-only (the finalizer hashes the persisted copy). */
  fingerprint?: Record<string, unknown>;
  boundValues: BoundValueMarker[];
}

const text = (value: unknown, max = MAX_TEXT): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 10_000) : 0);

/** The fingerprint is kept only when it is a small plain object of primitives. */
function fingerprintOf(raw: unknown): Record<string, unknown> | undefined {
  const source = record(raw);
  if (!source) return undefined;
  try {
    const json = JSON.stringify(source);
    return json.length <= 4_000 ? (JSON.parse(json) as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Bound untrusted page data into an {@link UpgradeContext}; undefined when it is not one. */
export function sanitizeUpgradeContext(
  raw: unknown,
  where: { pageAlias: string; frameDepth: number },
  now: Date = new Date()
): UpgradeContext | undefined {
  const source = record(raw);
  const target = record(source?.target);
  if (!source || !target) return undefined;
  const candidates = Array.isArray(source.candidates)
    ? source.candidates
        .map(record)
        .filter((c): c is Record<string, unknown> => Boolean(c && typeof c.strategy === "string" && typeof c.value === "string" && c.value))
        .slice(0, 5)
        .map((c) => ({
          strategy: text(c.strategy, 20),
          value: text(c.value, MAX_VALUE),
          ...(typeof c.name === "string" && c.name ? { name: text(c.name) } : {}),
          count: count(c.count),
          fallback: c.fallback === true
        }))
    : [];
  const containers = Array.isArray(source.containers)
    ? source.containers
        .map(record)
        .filter((c): c is Record<string, unknown> => Boolean(c && typeof c.kind === "string" && CONTAINER_KINDS.has(c.kind)))
        .slice(0, 6)
        .map((c) => ({ kind: String(c.kind), tag: text(c.tag, 20), role: text(c.role, 30), name: text(c.name) }))
    : [];
  const fingerprint = fingerprintOf(source.fingerprint);
  return {
    schemaVersion: 1,
    capturedAt: now.toISOString(),
    target: { tag: text(target.tag, 20), role: text(target.role, 30), name: text(target.name), type: text(target.type, 20) },
    candidates,
    containers,
    heading: text(source.heading),
    siblingActions: Array.isArray(source.siblingActions) ? source.siblingActions.map((s) => text(s, 60)).filter(Boolean).slice(0, 6) : [],
    pageKey: text(source.pageKey, 300),
    pageAlias: where.pageAlias,
    frame: where.frameDepth > 0 ? "child" : "top",
    frameDepth: where.frameDepth,
    shadow: source.shadow === "open" ? "open" : "none",
    ...(fingerprint ? { fingerprint } : {}),
    boundValues: []
  };
}

/** Static values the user typed or selected in earlier steps: the texts L3 must never treat as page intent. */
export function boundValueSources(actions: readonly RecordedAction[]): string[] {
  const values = new Set<string>();
  for (const action of actions) {
    if (action.type !== "fill" && action.type !== "select" && action.type !== "type") continue;
    const value = typeof action.valueSource?.value === "string" ? action.valueSource.value.trim() : "";
    if (value.length >= 2) values.add(value.toLowerCase());
  }
  return [...values];
}

/**
 * Mark every context text that contains a bound value — the action's own input, or an earlier step's.
 * The marker names the field, never the value.
 */
export function markBoundValues(context: UpgradeContext, earlierInputs: readonly string[], actionValue?: string): UpgradeContext {
  const own = typeof actionValue === "string" && actionValue.trim().length >= 2 ? actionValue.trim().toLowerCase() : "";
  const fields: Array<[string, string]> = [
    ["target.name", context.target.name],
    ["heading", context.heading],
    ...context.containers.map((c, i): [string, string] => [`containers.${i}.name`, c.name]),
    ...context.siblingActions.map((s, i): [string, string] => [`siblingActions.${i}`, s]),
    ...context.candidates.map((c, i): [string, string] => [`candidates.${i}`, `${c.value} ${c.name ?? ""}`])
  ];
  const boundValues: BoundValueMarker[] = [];
  for (const [field, value] of fields) {
    const haystack = value.toLowerCase();
    if (!haystack) continue;
    if (own && haystack.includes(own)) boundValues.push({ field, source: "action-value" });
    else if (earlierInputs.some((input) => haystack.includes(input))) boundValues.push({ field, source: "earlier-input" });
  }
  return { ...context, boundValues };
}

/** Remove the capture-only field from an action's locators and return the page's raw context. */
export function takeUpgradeContext(action: Omit<RecordedAction, "id">): unknown {
  const raw = action.locator?.upgradeContext;
  if (action.locator) delete action.locator.upgradeContext;
  if (action.targetLocator) delete action.targetLocator.upgradeContext;
  return raw;
}
