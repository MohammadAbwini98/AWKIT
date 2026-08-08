/**
 * What each step type needs before it can execute — the validation engine's source of truth.
 *
 * WHY THIS IS AN EXHAUSTIVE `Record<StepType, …>`:
 * `PreRunValidator.ts:55` holds the same knowledge as a hardcoded inline array, and that array has
 * drifted from the designer catalog (`radio` requires a locator but is absent from it — `awkit-acw`).
 * An inline array cannot be checked by the compiler. Typing this as an exhaustive `Record` makes
 * `tsc --noEmit` — the repo's primary gate — fail the moment a `StepType` is added without deciding
 * what that type requires, so this table cannot silently drift the way the array did.
 *
 * It deliberately lives in `src/validation/` rather than being imported from the renderer's
 * `flowNodeCatalog.ts` (a React module, off-limits per `src/AGENTS.md`) or from
 * `src/testing/random/NodeCatalog.ts` (test-lab infrastructure — production validation must not
 * depend on the test lab). `scripts/verify-validation.mts` asserts all three tables agree, so the
 * duplication is guarded rather than assumed.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { StepType } from "../profiles/FlowProfile";

export interface StepRequirement {
  /** Step cannot resolve a target element without a `locator`. */
  readonly requiresLocator: boolean;
  /** Step cannot act without a `value` / `valueSource` (or `url` for `goto`, `flowId` for `runFlow`). */
  readonly requiresValue: boolean;
}

/** Every `StepType`, exhaustively. Mirrors the designer catalog's `requiresLocator`/`requiresValue`. */
export const STEP_REQUIREMENTS: Record<StepType, StepRequirement> = {
  // ---- structural ----
  start: { requiresLocator: false, requiresValue: false },
  end: { requiresLocator: false, requiresValue: false },

  // ---- navigation ----
  goto: { requiresLocator: false, requiresValue: true },
  routeChange: { requiresLocator: false, requiresValue: false },

  // ---- interaction ----
  click: { requiresLocator: true, requiresValue: false },
  press: { requiresLocator: false, requiresValue: true },
  /** `locator` is the drag source; the drop target is `targetLocator` (enforced at runtime). */
  drag: { requiresLocator: true, requiresValue: false },
  hover: { requiresLocator: true, requiresValue: false },
  scroll: { requiresLocator: false, requiresValue: true },

  // ---- input ----
  fill: { requiresLocator: true, requiresValue: true },
  select: { requiresLocator: true, requiresValue: true },
  check: { requiresLocator: true, requiresValue: false },
  uncheck: { requiresLocator: true, requiresValue: false },
  /** The type `PreRunValidator`'s hardcoded list omits — the drift `awkit-acw` records. */
  radio: { requiresLocator: true, requiresValue: true },
  uploadFile: { requiresLocator: true, requiresValue: true },

  // ---- capture ----
  readText: { requiresLocator: true, requiresValue: false },
  screenshot: { requiresLocator: false, requiresValue: false },
  downloadFile: { requiresLocator: true, requiresValue: false },

  // ---- assertion ----
  assertText: { requiresLocator: true, requiresValue: true },
  assertVisible: { requiresLocator: true, requiresValue: false },

  // ---- control ----
  wait: { requiresLocator: false, requiresValue: true },
  condition: { requiresLocator: false, requiresValue: true },
  loop: { requiresLocator: false, requiresValue: true },
  runFlow: { requiresLocator: false, requiresValue: true },
  manualHandoff: { requiresLocator: false, requiresValue: false },

  // ---- session / protected login ----
  saveSession: { requiresLocator: false, requiresValue: false },
  reuseSession: { requiresLocator: false, requiresValue: false },
  protectedLoginHandoff: { requiresLocator: false, requiresValue: false },
  autoSecureLogin: { requiresLocator: false, requiresValue: true },

  // ---- popup ----
  switchToPopup: { requiresLocator: false, requiresValue: false },
  closePopup: { requiresLocator: false, requiresValue: false },
  switchToMainPage: { requiresLocator: false, requiresValue: false },

  // ---- data source ----
  oracle: { requiresLocator: false, requiresValue: false }
};

/** Every known step type, in table order. Used to reject unknown literals from imported JSON. */
export const ALL_STEP_TYPES: readonly StepType[] = Object.keys(STEP_REQUIREMENTS) as StepType[];

const KNOWN_STEP_TYPES: ReadonlySet<string> = new Set<string>(ALL_STEP_TYPES);

/** Whether a raw literal (e.g. from hand-edited JSON) names a step type the runner can execute. */
export function isKnownStepType(type: string): type is StepType {
  return KNOWN_STEP_TYPES.has(type);
}

/** Requirements for a step type. Unknown literals require nothing — they fail their own rule. */
export function stepRequirement(type: StepType): StepRequirement {
  return STEP_REQUIREMENTS[type] ?? { requiresLocator: false, requiresValue: false };
}
