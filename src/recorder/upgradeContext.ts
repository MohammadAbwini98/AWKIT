/**
 * Phase L L2 task 4: capture-time upgrade context. The page reads the exact target's bounded semantic
 * neighbourhood while it still exists (`locator.upgradeContext`, capture-only); RecorderService takes it
 * off the action before anything else sees it, bounds it here, marks which texts are bound values, and
 * keeps it in a memory-only TTL store for L3 and the Element Spy. It is never written to the draft, a
 * profile, a log or a report, and nothing here needs a model.
 *
 * Container identity (owner decision D1, options A+B, 2026-09-24): a container's name is shown to an AI
 * request only when it was authored (`aria-label`/`aria-labelledby`), never when the page computed it
 * from the container's content (a table row's name is its cell text). A container's `data-testid` is
 * shown only when it looks authored and stable. Both are decided here, in main, from what the page
 * reports; anything that cannot be established is left out rather than offered.
 */
import { SemanticRedactor } from "../semantic/SemanticRedactor";
import type { RecordedAction } from "./RecorderTypes";

export const UPGRADE_CONTEXT_TTL_MS = 10 * 60_000;
export const UPGRADE_CONTEXT_MAX_ENTRIES = 500;

const MAX_TEXT = 80;
const MAX_VALUE = 200;
const MAX_TEST_ID = 60;
/** How much of a container's own text the page reports for the rules below (the page clips at the same length). */
const MAX_CONTAINER_TEXT = 500;
const CONTAINER_KINDS = new Set(["dialog", "row", "card", "listItem", "form", "landmark"]);
/** Kinds that repeat once per record. Their own name and test id are record data unless shown otherwise. */
const RECORD_KINDS = new Set(["row", "card", "listItem"]);
const TEST_ID_SHAPE = /^[A-Za-z][A-Za-z0-9]*(?:[-_.:][A-Za-z0-9]+)*$/;
const redactor = new SemanticRedactor();

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
  /** The accessible name as the page computed it. Element Spy shows it; an AI request only when {@link authoredName}. */
  name: string;
  /** D1 B: the name was authored (`aria-label`/`aria-labelledby`) and passed {@link offeredContainerName}. */
  authoredName?: true;
  /** D1 A: the container's own `data-testid`, present only when it passed {@link offeredContainerTestId}. */
  testId?: string;
}

/** What the page reports about one container before main decides what may be offered. */
interface RawContainer {
  kind: string;
  name: string;
  /** `aria-label`, `aria-labelledby`, or `content` (computed from what the container shows). */
  nameSource: string;
  /** The container's own visible text, bounded. Used for the rules below, then dropped. */
  text: string | undefined;
}

const words = (value: string): Set<string> => new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3));
/** Nothing a redaction rule recognises (email, long digit run, secret-shaped key/value, URL, path). */
const unredacted = (value: string): boolean => redactor.redactText(value) === value;

/**
 * D1 B: a container name may reach an AI request only when it was authored, carries nothing sensitive,
 * and — for a record (row, card, list item) — is not that record's data in another form: no digit
 * (record keys) and not a repeat of the record's own text. A name the page computed from content never
 * qualifies. Bound values are marked separately (`markBoundValues`) and dropped from the request.
 */
export function offeredContainerName(container: RawContainer): boolean {
  const { kind, name, nameSource, text } = container;
  if ((nameSource !== "aria-label" && nameSource !== "aria-labelledby") || !name || !unredacted(name)) return false;
  if (!RECORD_KINDS.has(kind)) return true;
  if (text === undefined || /\d/.test(name)) return false;
  return !text.toLowerCase().includes(name.toLowerCase());
}

/**
 * D1 A: a container test id may reach an AI request only when it looks authored and stable. Refused:
 * any digit (row numbers, record keys, generated ids, hashes), anything a redaction rule recognises,
 * and any word of it that also appears in the container's own text unless its authored name says the
 * same (`contact-carol-white` in Carol White's row is her data; `lu-scope-billing` under an authored
 * "Billing address" is not). Without the container's text the rule cannot run, so the id is left out.
 * ponytail: over-refuses an authored id that echoes its container's visible heading; the model then
 * simply is not offered it, which is the safe direction.
 */
export function offeredContainerTestId(testId: string, container: RawContainer, nameOffered: boolean): string | undefined {
  if (!testId || testId.length > MAX_TEST_ID || !TEST_ID_SHAPE.test(testId) || /\d/.test(testId) || !unredacted(testId)) return undefined;
  if (container.text === undefined) return undefined;
  const content = words(container.text);
  const authored = nameOffered ? words(container.name) : new Set<string>();
  const tokens = testId.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  return tokens.some((token) => content.has(token) && !authored.has(token)) ? undefined : testId;
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
        .map((c): UpgradeContextContainer => {
          const raw: RawContainer = {
            kind: String(c.kind),
            name: text(c.name),
            nameSource: typeof c.nameSource === "string" ? c.nameSource : "content",
            text: typeof c.text === "string" ? text(c.text, MAX_CONTAINER_TEXT) : undefined
          };
          const authoredName = offeredContainerName(raw);
          const testId = offeredContainerTestId(text(c.testId, MAX_TEST_ID + 1), raw, authoredName);
          return {
            kind: raw.kind,
            tag: text(c.tag, 20),
            role: text(c.role, 30),
            name: raw.name,
            ...(authoredName ? { authoredName: true as const } : {}),
            ...(testId ? { testId } : {})
          };
        })
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
    ...context.containers.map((c, i): [string, string] => [`containers.${i}.testId`, c.testId ?? ""]),
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
