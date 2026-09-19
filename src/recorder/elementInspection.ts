/**
 * Element Spy (Phase L L2): turn the page's untrusted inspection report into a bounded
 * `ElementInspection`, and decide whether a candidate may be applied to a recorded action.
 *
 * Only the documented fields survive, every string is bounded, and nothing here is persisted: the
 * RecorderService keeps one inspection in memory for a short TTL. "Use in action" is explicit and
 * narrow: a globally unique, non-positional candidate, outside any shadow root, applied to a plain
 * single-target element step on the same page and in the same frame chain. The step keeps its frame
 * chain, interaction evidence, prerequisite and execution decision; what described the previously
 * captured target (identity, guard, alternatives, container scope, blueprint, approvals) is dropped,
 * because it no longer describes the new locator.
 */
import { locatorFrameChain, type LocatorContext, type LocatorFrameContext, type LocatorQuality, type LocatorStrategy, type StepLocator } from "@src/profiles/FlowProfile";
import type { ElementInspection, ElementInspectionCandidate, RecordedAction, RecordedActionLocator } from "./RecorderTypes";
import type { UpgradeContext } from "./upgradeContext";

export const ELEMENT_INSPECTION_TTL_MS = 5 * 60_000;
const MAX_CANDIDATES = 8;
const MAX_VALUE = 1_000;
const MAX_NAME = 200;
const MAX_CONTEXT_JSON = 8_000;
const STRATEGIES: ReadonlySet<string> = new Set(["role", "label", "placeholder", "text", "testId", "id", "css", "xpath", "tagName"]);
const SEMANTIC: ReadonlySet<string> = new Set(["role", "label", "placeholder", "text", "testId", "id"]);
/** Single-target element steps whose whole locator a user may replace. */
const APPLICABLE_ACTIONS: ReadonlySet<string> = new Set(["click", "dblclick", "contextMenu", "fill", "check", "uncheck", "select", "hover", "press"]);

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 10_000) : 0);
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

function candidateOf(raw: unknown): (ElementInspectionCandidate & { strategy: LocatorStrategy }) | undefined {
  const source = record(raw);
  if (!source || typeof source.strategy !== "string" || !STRATEGIES.has(source.strategy)) return undefined;
  const value = text(source.value, MAX_VALUE);
  if (!value) return undefined;
  return {
    strategy: source.strategy as LocatorStrategy,
    value,
    ...(typeof source.name === "string" && source.name ? { name: text(source.name, MAX_NAME) } : {}),
    ...(source.exact === true ? { exact: true } : {}),
    count: count(source.count),
    ...(typeof source.visibleCount === "number" ? { visibleCount: count(source.visibleCount) } : {}),
    fallback: source.fallback === true
  };
}

function qualityOf(raw: unknown): LocatorQuality | undefined {
  const source = record(raw);
  if (!source || typeof source.strategy !== "string") return undefined;
  const confidence = source.confidence === "high" || source.confidence === "medium" ? source.confidence : "low";
  const disambiguation = ["compound", "container", "shadow", "positional"].includes(String(source.disambiguation)) ? (source.disambiguation as LocatorQuality["disambiguation"]) : undefined;
  return {
    strategy: (source.strategy === "fallback" || STRATEGIES.has(source.strategy) ? source.strategy : "fallback") as LocatorQuality["strategy"],
    isUnique: source.isUnique === true,
    matchCount: count(source.matchCount),
    ...(typeof source.visibleMatchCount === "number" ? { visibleMatchCount: count(source.visibleMatchCount) } : {}),
    confidence,
    ...(typeof source.warning === "string" ? { warning: text(source.warning, 300) } : {}),
    ...(typeof source.candidateCount === "number" ? { candidateCount: count(source.candidateCount) } : {}),
    ...(disambiguation ? { disambiguation } : {})
  };
}

/** Plain JSON only, bounded; a report whose field is oversized loses it rather than bloating memory. */
function boundedJson<T>(raw: unknown): T | undefined {
  const source = record(raw);
  if (!source) return undefined;
  try {
    const json = JSON.stringify(source);
    return json.length <= MAX_CONTEXT_JSON ? (JSON.parse(json) as T) : undefined;
  } catch {
    return undefined;
  }
}

export interface InspectionOrigin {
  pageAlias: string;
  /** Frame-graph chain from the main process; empty/absent for the top document. */
  frameChain?: LocatorFrameContext[];
  upgradeContext?: UpgradeContext;
}

export function sanitizeInspection(raw: unknown, origin: InspectionOrigin, now: Date = new Date()): ElementInspection | { refused: "protected-login" } | undefined {
  const source = record(raw);
  if (!source) return undefined;
  if (source.refused === "protected-login") return { refused: "protected-login" };
  const primary = candidateOf(record(source.locator) ? { ...(source.locator as Record<string, unknown>), count: 1 } : undefined);
  if (!primary) return undefined;
  const locatorSource = source.locator as Record<string, unknown>;
  const owner = record(source.owner) ?? {};
  const quality = qualityOf(locatorSource.quality);
  const context = boundedJson<LocatorContext>(locatorSource.context);
  const guard = boundedJson<StepLocator["guard"]>(locatorSource.guard);
  const alternatives = Array.isArray(locatorSource.alternatives)
    ? locatorSource.alternatives
        .map(candidateOf)
        .filter((candidate) => candidate !== undefined)
        .slice(0, 3)
        .map(({ count: _count, fallback: _fallback, visibleCount: _visible, ...candidate }) => candidate)
    : [];
  const { count: _count, fallback: _fallback, visibleCount: _visible, ...primaryLocator } = primary;
  const frameChain = origin.frameChain?.length ? origin.frameChain : undefined;
  const locator: StepLocator = {
    ...primaryLocator,
    ...(quality ? { quality } : {}),
    ...(context || frameChain ? { context: { ...(context ?? {}), ...(frameChain ? { frameChain } : {}) } } : {}),
    ...(alternatives.length ? { alternatives } : {}),
    // Kept only so the quality class can say "guarded-positional"; never applied from the Spy.
    ...(guard ? { guard } : {})
  };
  return {
    schemaVersion: 1,
    inspectedAt: now.toISOString(),
    pageAlias: origin.pageAlias,
    // Trusted: derived from the Frame graph, never from the page's own claim.
    topDocument: !frameChain,
    owner: { tag: text(owner.tag, 40), role: text(owner.role, 40), name: text(owner.name, 120), type: text(owner.type, 40) },
    locator,
    candidates: Array.isArray(source.candidates) ? source.candidates.map(candidateOf).filter((candidate) => candidate !== undefined).slice(0, MAX_CANDIDATES) : [],
    ...(frameChain ? { frameChain } : {}),
    ...(origin.upgradeContext ? { upgradeContext: origin.upgradeContext } : {})
  };
}

const frameKey = (chain: readonly LocatorFrameContext[]): string => JSON.stringify(chain.map((frame) => [frame.selector ?? "", frame.index ?? null]));

/** Why a candidate cannot be applied to this action, or undefined when it can. */
export function inspectionApplyBlocker(action: RecordedAction | undefined, inspection: ElementInspection, candidateIndex: number): string | undefined {
  const candidate = inspection.candidates[candidateIndex];
  if (!candidate) return "That candidate is not part of the current inspection.";
  if (candidate.count !== 1 || candidate.fallback) return "Only a unique, non-positional candidate can be used in an action.";
  const boundary = inspection.locator.context?.shadow?.boundary;
  if (boundary && boundary !== "none") return "Elements inside a shadow root keep their recorded locator: a page-wide candidate cannot express the shadow-host chain.";
  if (!action?.locator) return "Choose a recorded element step.";
  if (!APPLICABLE_ACTIONS.has(action.type) || action.targetLocator) return "This step type keeps its recorded locator.";
  if (action.locator.interaction?.requiresHover) return "A hover-gated step keeps its recorded locator.";
  const actionShadow = action.locator.context?.shadow?.boundary;
  if (actionShadow && actionShadow !== "none") return "This step targets an element inside a shadow root and keeps its recorded locator.";
  if ((action.pageAlias ?? "main") !== inspection.pageAlias) return "The inspected element is on a different page than this step.";
  const actionFrames = locatorFrameChain(action.locator.context as LocatorContext | undefined);
  if (frameKey(actionFrames) !== frameKey(inspection.frameChain ?? [])) {
    return "The inspected element is in a different frame than this step; a candidate is only applied inside the step's own frame chain.";
  }
  return undefined;
}

/**
 * The replacement locator for an applicable candidate: resolved by the user, proven unique at inspection.
 * Keeps the step's frame chain (verified equal by {@link inspectionApplyBlocker}), interaction evidence,
 * prerequisite and execution decision.
 */
export function locatorFromInspection(action: RecordedAction, inspection: ElementInspection, candidateIndex: number): RecordedActionLocator {
  const candidate = inspection.candidates[candidateIndex];
  const previous = action.locator;
  const frames = locatorFrameChain(previous?.context as LocatorContext | undefined);
  return {
    strategy: candidate.strategy,
    value: candidate.value,
    ...(candidate.name ? { name: candidate.name } : {}),
    ...(candidate.exact ? { exact: true } : {}),
    quality: {
      strategy: candidate.strategy,
      isUnique: true,
      matchCount: 1,
      ...(typeof candidate.visibleCount === "number" ? { visibleMatchCount: candidate.visibleCount } : {}),
      confidence: SEMANTIC.has(candidate.strategy) ? "high" : "medium",
      candidateCount: inspection.candidates.length
    },
    ...(frames.length ? { context: { frameChain: frames } } : {}),
    ...(previous?.interaction ? { interaction: previous.interaction } : {}),
    ...(previous?.prerequisite ? { prerequisite: previous.prerequisite } : {}),
    ...(previous?.executionDecision ? { executionDecision: previous.executionDecision } : {}),
    resolution: "resolved",
    resolvedBy: "user"
  };
}
