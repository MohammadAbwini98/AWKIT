/**
 * What a `scroll` STEP NODE needs, refined by its configured scroll target.
 *
 * WHY THIS EXISTS — the fourth instance of the class behind `awkit-3p6x` (the wait node),
 * `awkit-jtok` (Smart Wait conditions) and `awkit-56un` (assertions). `STEP_REQUIREMENTS` answers
 * one requirement per step *type*, and `scroll` carries its input in `config`, not in `value`:
 *
 *  - **The scroll distance was invisible to the gate.** The runtime reads
 *    `cfg.scrollAmount ?? Number(resolveStepValue(step, step.value) || 500)`, and the designer writes
 *    `config.scrollAmount` (`flowProfileMapping.ts`). `hasRequiredValue` knew only
 *    `step.value`/`valueSource`, so EVERY designer-authored scroll node reported "requires a value or
 *    value source" — and the Scroll node's property panel has no value field at all
 *    (`sections: ["scroll", "execution"]`), so the demand was unsatisfiable through the UI.
 *  - **A scroll-to-element was never checked for the element.** `cfg.scrollTarget === "element" &&
 *    step.locator` guards the `scrollIntoViewIfNeeded` branch: with the target set but no locator the
 *    condition is false and the runner silently falls through to a page wheel instead. Nothing fails;
 *    it just scrolls the wrong thing.
 *
 * THE CONTRACT IS READ OFF THE RUNTIME (`StepExecutor` case `"scroll"`):
 *
 * ```
 * const amount = cfg.scrollAmount ?? Number((await resolveStepValue(step, step.value)) || 500);
 * if (cfg.scrollTarget === "element" && step.locator) → resolve(step).scrollIntoViewIfNeeded()
 * else → mouse.wheel(dx, dy) with cfg.scrollDirection ?? "down"
 * ```
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { FlowStep, NodeConfig } from "../profiles/FlowProfile";

export const SCROLL_TARGETS: readonly NonNullable<NodeConfig["scrollTarget"]>[] = ["page", "element"];
export const SCROLL_DIRECTIONS: readonly NonNullable<NodeConfig["scrollDirection"]>[] = ["up", "down", "left", "right"];

const KNOWN_TARGETS: ReadonlySet<string> = new Set<string>(SCROLL_TARGETS);
const KNOWN_DIRECTIONS: ReadonlySet<string> = new Set<string>(SCROLL_DIRECTIONS);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Whether a scroll step resolves an element rather than the page.
 *
 * Mirrors the runtime's `cfg.scrollTarget === "element"` exactly — including that an unrecognised
 * literal is NOT "element" and therefore takes the page branch, which is what the runner does.
 */
export function scrollTargetsElement(step: FlowStep): boolean {
  return step.config?.scrollTarget === "element";
}

/** What one scroll step needs. Shaped like {@link StepRequirement} so the caller can swap it in. */
export function scrollStepContract(step: FlowStep): { requiresLocator: boolean; requiresValue: boolean } {
  return { requiresLocator: scrollTargetsElement(step), requiresValue: true };
}

/**
 * Whether the step states a scroll distance through any channel the runner reads.
 *
 * A scroll-to-element needs no distance at all — `scrollIntoViewIfNeeded` ignores `amount` — so that
 * target is satisfied by its locator alone. For a page scroll the distance may come from
 * `config.scrollAmount` (the designer's "Amount" box), a literal `value`, or a `valueSource`.
 *
 * Presence is what is checked here, not usability: an unusable `scrollAmount` is reported separately
 * by {@link scrollConfigDefects} so one mistake produces one issue rather than two.
 */
export function hasScrollDistance(step: FlowStep): boolean {
  if (scrollTargetsElement(step)) return true;
  if (step.config?.scrollAmount !== undefined) return true;
  if (step.valueSource !== undefined) return true;
  return isNonEmptyString(step.value);
}

/** A scroll configuration the runner would act on incorrectly. */
export interface ScrollConfigDefect {
  readonly field: string;
  readonly detail: string;
}

export function scrollConfigDefects(step: FlowStep): ScrollConfigDefect[] {
  const config = step.config;
  const defects: ScrollConfigDefect[] = [];

  if (config?.scrollTarget !== undefined && !KNOWN_TARGETS.has(config.scrollTarget)) {
    defects.push({
      field: "scrollTarget",
      detail: `names an unknown scroll target "${String(config.scrollTarget)}"; the runner would scroll the page instead of an element`
    });
  }
  if (config?.scrollDirection !== undefined && !KNOWN_DIRECTIONS.has(config.scrollDirection)) {
    // An unknown direction leaves both `dx` and `dy` at 0 — `mouse.wheel(0, 0)` scrolls nowhere.
    defects.push({
      field: "scrollDirection",
      detail: `names an unknown scroll direction "${String(config.scrollDirection)}"; both wheel axes stay at zero, so the page would not move`
    });
  }

  // A scroll-to-element never reads the distance, so an odd amount there is inert, not a defect.
  if (!scrollTargetsElement(step)) {
    const amount = config?.scrollAmount;
    if (amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0)) {
      defects.push({
        field: "scrollAmount",
        detail: `scrolls by ${String(amount)}px; it must be a non-zero finite number of pixels`
      });
    }
    // The literal is only read when `scrollAmount` is absent, and `Number("lots")` is NaN —
    // `mouse.wheel(0, NaN)` moves nothing while looking configured.
    if (amount === undefined && step.valueSource === undefined && isNonEmptyString(step.value)) {
      const parsed = Number(step.value);
      if (!Number.isFinite(parsed) || parsed === 0) {
        defects.push({
          field: "value",
          detail: `scrolls by "${step.value}", which is not a usable number of pixels; the runner would pass NaN to the mouse wheel`
        });
      }
    }
  }

  return defects;
}
