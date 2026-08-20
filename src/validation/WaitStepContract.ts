/**
 * What a `wait` STEP NODE needs before it can execute — refined by its configured wait type.
 *
 * WHY THIS EXISTS:
 * `STEP_REQUIREMENTS` is a flat `Record<StepType, …>`: one answer per *type*. That is right for
 * `fill` or `click`, whose inputs never change, but the `wait` node is five different steps behind
 * one type literal. Its flat row (`requiresValue: true`) reported EVERY wait as
 * "requires a value or value source" — including a Fixed time wait carrying `Duration (ms) = 2000`,
 * which needs no value at all — while `selector`, which genuinely cannot run without a locator, was
 * checked for neither. The renderer's own `flowNodeRegistry` had already refined the rule by
 * subtype; the engine had not, so the run gate and the designer disagreed.
 *
 * THE CONTRACT IS READ OFF THE RUNTIME, not invented. `StepExecutor.executeWait`
 * (`src/runner/StepExecutor.ts`) is the only executor of this node:
 *
 * ```
 * const waitType = step.config?.waitType ?? "time";
 * case "selector":    locatorFactory.create(step.locator).waitFor(...)   // throws without a locator
 * case "textVisible": getByText(await resolveStepValue(step, step.value))
 * case "navigation":  waitForLoadState("load")                           // no step input
 * case "networkIdle": waitForLoadState("networkidle")                    // no step input
 * case "time":        waitForTimeout(Number(resolvedValue || step.timeoutMs || 1000))
 * ```
 *
 * So a fixed-time wait's duration has TWO legal channels — `value`/`valueSource`, then `timeoutMs`
 * (the field the designer's "Duration (ms)" box writes) — in that precedence. Either satisfies it.
 * This mirrors how `goto` already accepts `url` instead of `value` and `runFlow` accepts `flowId`:
 * the requirement is real, the field it is carried in is type-specific.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { FlowStep, NodeConfig } from "../profiles/FlowProfile";

/** The five wait-node subtypes `executeWait` dispatches on. */
export type WaitStepType = NonNullable<NodeConfig["waitType"]>;

/** Every wait subtype, exhaustively — the same literals `NodeConfig.waitType` permits. */
export const WAIT_STEP_TYPES: readonly WaitStepType[] = ["time", "selector", "navigation", "networkIdle", "textVisible"];

const KNOWN_WAIT_STEP_TYPES: ReadonlySet<string> = new Set<string>(WAIT_STEP_TYPES);

/** Whether a raw literal (e.g. from hand-edited JSON) names a wait subtype the runner dispatches on. */
export function isKnownWaitStepType(waitType: string): waitType is WaitStepType {
  return KNOWN_WAIT_STEP_TYPES.has(waitType);
}

/**
 * The subtype a wait step runs as. Mirrors `executeWait`'s `step.config?.waitType ?? "time"`,
 * including its `default:` arm — an unrecognised literal falls through to the fixed-time branch, so
 * validating it as anything else would describe a step the runner does not execute.
 */
export function resolveWaitStepType(step: FlowStep): WaitStepType {
  const configured = step.config?.waitType;
  return configured !== undefined && isKnownWaitStepType(configured) ? configured : "time";
}

/** What one wait step needs, and how to say so when it is missing. */
export interface WaitStepContract {
  readonly waitType: WaitStepType;
  /** `selector` resolves an element; the others never touch `step.locator`. */
  readonly requiresLocator: boolean;
  /** Whether this subtype needs a step input at all (a duration, or text to wait for). */
  readonly requiresValue: boolean;
  /**
   * How the missing input reads in a validation issue, after "Step <name> (wait) " — a duration is
   * not "a value or value source", and saying so sent users looking for a field the panel does not
   * show for this subtype.
   */
  readonly missingValueMessage: string;
  /** The same defect as a standalone sentence, for the properties panel's inline error. */
  readonly missingValueHint: string;
  /** The same, for a `selector` wait with no locator. */
  readonly missingLocatorHint: string;
}

const CONTRACTS: Record<WaitStepType, Omit<WaitStepContract, "waitType">> = {
  time: {
    requiresLocator: false,
    requiresValue: true,
    missingValueMessage: "is a fixed-time wait with no duration: set Duration (ms), or bind a value source that resolves to one.",
    missingValueHint: "This Fixed time wait has no duration — set Duration (ms), or bind a value source that resolves to one.",
    missingLocatorHint: ""
  },
  selector: {
    requiresLocator: true,
    requiresValue: false,
    missingValueMessage: "waits for an element and needs a locator.",
    missingValueHint: "",
    missingLocatorHint: "This Selector visible wait has no selector to wait for."
  },
  textVisible: {
    requiresLocator: false,
    requiresValue: true,
    missingValueMessage: "waits for text to appear but names no text: set a value or value source.",
    missingValueHint: "This Text visible wait names no text — set the text, or bind a value source.",
    missingLocatorHint: ""
  },
  navigation: { requiresLocator: false, requiresValue: false, missingValueMessage: "", missingValueHint: "", missingLocatorHint: "" },
  networkIdle: { requiresLocator: false, requiresValue: false, missingValueMessage: "", missingValueHint: "", missingLocatorHint: "" }
};

/**
 * The contract for a wait subtype literal.
 *
 * Keyed on the literal rather than on a `FlowStep` so the DESIGNER can consult the same table: the
 * properties panel edits `FlowDesignerNodeData`, which is not a `FlowStep`, and giving it its own
 * copy of the rule is how the renderer and the engine came to disagree about `navigation` waits in
 * the first place. One table, two callers.
 */
export function waitStepContractFor(waitType: string | undefined): WaitStepContract {
  const resolved = waitType !== undefined && isKnownWaitStepType(waitType) ? waitType : "time";
  return { waitType: resolved, ...CONTRACTS[resolved] };
}

/** The contract for this exact step, resolved from its configured wait type. */
export function waitStepContract(step: FlowStep): WaitStepContract {
  return waitStepContractFor(step.config?.waitType);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * A duration the runner would accept: `Number(x)` must be finite and above zero.
 *
 * Exported so the properties panel judges "Duration (ms)" by the SAME predicate the run gate uses —
 * a panel that calls 0ms acceptable while the gate rejects it is the drift this module exists to end.
 */
export function isUsableWaitDuration(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Whether a fixed-time wait states a duration through either legal channel.
 *
 * `valueSource` is accepted unresolved: it is data-driven (a DataSource row, a runtime input, a
 * secret) and cannot be read at validation time, so rejecting it would fail every parameterised
 * flow. A `timeoutMs` that is present but unusable (zero, negative, NaN, Infinity) is deliberately
 * NOT counted here — `validateTimeouts` already reports it as `invalidTimeout`, and reporting the
 * same defect twice under two codes would double the error count the designer badge shows.
 */
export function hasWaitStepDuration(step: FlowStep): boolean {
  if (step.valueSource !== undefined) return true;
  if (isNonEmptyString(step.value)) return true;
  return step.timeoutMs !== undefined;
}

/**
 * A literal fixed-time duration the runner cannot turn into a wait, or `undefined` when there is
 * nothing to report.
 *
 * `executeWait` computes `Number(resolvedValue || step.timeoutMs || 1000)` and hands the result
 * straight to `page.waitForTimeout`. A literal like `"soon"` becomes `NaN` there, and `"-5"` a
 * negative — neither is a wait, and neither surfaces until the browser is already open. Only a
 * LITERAL `value` is judged: with a `valueSource` present the literal is never read (see
 * `resolveStepValue`), so the resolved text is what would need checking and it does not exist yet.
 */
export function invalidLiteralWaitDuration(step: FlowStep): string | undefined {
  if (resolveWaitStepType(step) !== "time") return undefined;
  if (step.valueSource !== undefined) return undefined;
  if (!isNonEmptyString(step.value)) return undefined;
  const parsed = Number(step.value);
  return isUsableWaitDuration(parsed) ? undefined : step.value;
}
