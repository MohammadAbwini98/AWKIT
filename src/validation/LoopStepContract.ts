/**
 * What a `loop` STEP NODE needs, refined by its iteration source and its per-iteration action.
 *
 * WHY THIS EXISTS — the fifth and worst instance of the class behind `awkit-3p6x` (the wait node),
 * `awkit-jtok` (Smart Wait conditions), `awkit-56un` (assertions) and the `scroll` node. For `loop`
 * the flat row `{ requiresLocator: false, requiresValue: true }` was wrong for EVERY possible
 * configuration at once:
 *
 *  - **The loop's input is never `step.value`.** Its iteration source is `config.loopType` plus
 *    `config.iterationCount` / `step.locator` / the workflow data source, and the runtime reads
 *    `step.value` only for the `fill` action. So every loop reported "requires a value or value
 *    source" — and the Loop panel has no value field (`sections: ["loop", "execution"]`), so the
 *    demand could not be satisfied from the designer at all. A correctly configured Loop node was
 *    permanently "Draft — not runnable".
 *  - **The locator was never required, and its absence is SILENT.** `performLoopAction` computes
 *    `const base = step.locator ? create(step.locator) : null` and then every action arm is guarded
 *    by `if (target)`. A click/delete/fill loop with no locator therefore runs its full iteration
 *    count doing nothing, reports `passed`, and mapping outputs records the iterations as completed.
 *    Nothing anywhere says the loop did not act.
 *  - **`elements` with no locator iterates zero times.** `count = step.locator ? … : 0`, so the loop
 *    body never runs and the step still passes.
 *
 * THE CONTRACT IS READ OFF THE RUNTIME (`StepExecutor.executeLoop` / `performLoopAction`):
 *
 * ```
 * loopType   = cfg.loopType ?? "fixedCount"
 * actionType = cfg.loopActionType ?? "click"
 * elements   → count = step.locator ? create(step.locator).count() : 0
 * dataRows   → count = workflowDataSource ? rows.length : 0      // runtime binding
 * fixedCount → count = cfg.iterationCount ?? 1
 * click/delete → if (target) target.click()      // target is null without a locator
 * fill         → if (target) target.fill(await resolveStepValue(step))
 * scroll       → mouse.wheel(0, cfg.scrollAmount ?? 500)          // no target needed
 * customFlow   → if (targetFlowId && runChildFlow) runChildFlow(cfg.targetFlowId)
 * ```
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { FlowStep, NodeConfig } from "../profiles/FlowProfile";

export type LoopType = NonNullable<NodeConfig["loopType"]>;
export type LoopActionType = NonNullable<NodeConfig["loopActionType"]>;

export const LOOP_TYPES: readonly LoopType[] = ["fixedCount", "elements", "dataRows"];
export const LOOP_ACTION_TYPES: readonly LoopActionType[] = ["click", "fill", "scroll", "delete", "customFlow"];

const KNOWN_LOOP_TYPES: ReadonlySet<string> = new Set<string>(LOOP_TYPES);
const KNOWN_ACTIONS: ReadonlySet<string> = new Set<string>(LOOP_ACTION_TYPES);

/**
 * Actions whose arm is guarded by `if (target)` — without a locator they are silent no-ops.
 *
 * Exported so the DESIGNER panel decides by the same set. It edits `FlowDesignerNodeData`, not a
 * `FlowStep`, and a private copy of this set is how the panel and the gate would drift apart.
 */
export const LOOP_ACTIONS_NEEDING_A_TARGET: ReadonlySet<LoopActionType> = new Set<LoopActionType>(["click", "delete", "fill"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** The iteration source the loop runs as. Mirrors `cfg.loopType ?? "fixedCount"`, unknown included. */
export function resolveLoopType(step: FlowStep): LoopType {
  const configured = step.config?.loopType;
  return configured !== undefined && KNOWN_LOOP_TYPES.has(configured) ? (configured as LoopType) : "fixedCount";
}

/** The per-iteration action. Mirrors `cfg.loopActionType ?? "click"`. */
export function resolveLoopAction(step: FlowStep): LoopActionType {
  const configured = step.config?.loopActionType;
  return configured !== undefined && KNOWN_ACTIONS.has(configured) ? (configured as LoopActionType) : "click";
}

/** What one loop step needs. Shaped like {@link StepRequirement} so the caller can swap it in. */
export function loopStepContract(step: FlowStep): { requiresLocator: boolean; requiresValue: boolean } {
  const action = resolveLoopAction(step);
  // `elements` must have something to count, and any targeted action must have something to act on.
  const requiresLocator = resolveLoopType(step) === "elements" || LOOP_ACTIONS_NEEDING_A_TARGET.has(action);
  return { requiresLocator, requiresValue: true };
}

/**
 * Whether the loop states where its iterations come from.
 *
 * This is the loop's real "value": not `step.value`, which the runner reads only for a `fill`
 * action, but the iteration SOURCE its `loopType` selects.
 *
 *  - `elements`  — the locator supplies the count; reported by the locator rule, so it counts as
 *    stated here rather than producing a second issue about the same missing field.
 *  - `dataRows`  — the workflow data source is a run-time binding that cannot be read from the
 *    profile, so it is accepted; rejecting it would fail every data-driven flow.
 *  - `fixedCount` — `config.iterationCount`. A bare loop states none, which is why an unconfigured
 *    Loop node is still reported (and why the type-level `requiresValue: true` row stays true).
 *    Only PRESENCE is checked: the 1…1000 range is `validateStepLoopBounds`' job.
 */
export function hasLoopIterationSource(step: FlowStep): boolean {
  switch (resolveLoopType(step)) {
    case "elements":
      // The locator IS the source, and the locator rule already demands it. Returning `false` here
      // reported one missing field twice, which double-counts a single mistake in the "not runnable"
      // badge — the same trap the fixed-time wait's `timeoutMs` handling exists to avoid.
      return true;
    case "dataRows":
      return true;
    case "fixedCount":
    default:
      return step.config?.iterationCount !== undefined;
  }
}

/** A loop configuration the runner would execute as a no-op or as something else. */
export interface LoopConfigDefect {
  readonly field: string;
  readonly detail: string;
}

export function loopConfigDefects(step: FlowStep): LoopConfigDefect[] {
  const config = step.config;
  const defects: LoopConfigDefect[] = [];
  const action = resolveLoopAction(step);

  if (config?.loopType !== undefined && !KNOWN_LOOP_TYPES.has(config.loopType)) {
    defects.push({
      field: "loopType",
      detail: `names an unknown loop source "${String(config.loopType)}"; the runner would fall back to a fixed count`
    });
  }
  if (config?.loopActionType !== undefined && !KNOWN_ACTIONS.has(config.loopActionType)) {
    defects.push({
      field: "loopActionType",
      detail: `names an unknown loop action "${String(config.loopActionType)}"; the runner would fall back to clicking`
    });
  }

  // `fill` is the one action that reads `step.value`, through `resolveStepValue(step)`.
  if (action === "fill" && step.valueSource === undefined && !isNonEmptyString(step.value)) {
    defects.push({ field: "value", detail: "fills on every iteration but has no value to fill; each iteration would write an empty string" });
  }

  // `customFlow` is guarded by `if (targetFlowId && this.runChildFlow)` — with no target the whole
  // loop body is skipped silently and the step still reports passed.
  if (action === "customFlow" && !isNonEmptyString(config?.targetFlowId)) {
    defects.push({ field: "targetFlowId", detail: "runs a child flow on every iteration but names none (config.targetFlowId), so every iteration would do nothing" });
  }

  return defects;
}

/** The child flow a `customFlow` loop action calls, for reference checking. */
export function resolveLoopChildFlowId(step: FlowStep): string | undefined {
  if (resolveLoopAction(step) !== "customFlow") return undefined;
  const target = step.config?.targetFlowId;
  return isNonEmptyString(target) ? target : undefined;
}
