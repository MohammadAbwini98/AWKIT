/**
 * Authoritative generation catalog for every flow node type.
 *
 * WHY THIS IS A `Record<StepType, …>` AND NOT A RUNTIME SCAN:
 * `StepType` (src/profiles/FlowProfile.ts) is the real source of truth for what the runner can
 * execute. Typing the catalog as an exhaustive `Record` makes `tsc --noEmit` — the repo's primary
 * gate — fail the moment someone adds a node type without giving the randomizer a way to generate
 * it. That is a stronger and cheaper drift guard than a runtime registry scan, and it keeps `src/`
 * framework-agnostic (`src/AGENTS.md`): the renderer's `flowNodeRegistry.ts` cannot be imported
 * here. `scripts/verify-random-generator.mts` additionally asserts catalog ↔ registry parity so
 * label/section drift is caught too.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { StepType } from "../../profiles/FlowProfile";

/** How a node participates in graph construction. */
export type NodeRole =
  /** Exactly one per flow, no incoming edges. */
  | "start"
  /** At least one per flow, no outgoing edges. */
  | "terminal"
  /** Ordinary action node: one in, one out. */
  | "action"
  /** Fans out to multiple outgoing branches evaluated by connector conditions. */
  | "branch"
  /** Repeats a body with a bounded iteration count. */
  | "loop"
  /** Invokes another flow (subject to the runner's depth-5 recursion guard). */
  | "subflow";

/**
 * Why a node type is excluded from unattended generation by default.
 *
 * These are NOT "unsupported" — every one executes in `StepExecutor`. They are excluded because
 * generating them blind would either hang a headless campaign or reach outside the local lab, both
 * of which violate the safety rules in `docs/testing/RANDOMIZED_TESTING_SAFETY.md`.
 */
export type GenerationGate =
  /** Blocks on a human. Only generated when a campaign opts into interactive mode. */
  | "requiresHuman"
  /** Needs a real captured browser session on disk. */
  | "requiresSession"
  /** Needs a configured external data source (Oracle). Env-gated integration campaigns only. */
  | "requiresExternalDataSource"
  /** Needs a popup to have been opened first — only valid in a generated popup sequence. */
  | "requiresPopupContext"
  /** Needs a fixture the local mock site does not serve yet. */
  | "missingLocalFixture";

export interface NodeGenerationSpec {
  readonly type: StepType;
  readonly role: NodeRole;
  /** Node needs a `locator` to execute. Mirrors the renderer catalog's `requiresLocator`. */
  readonly requiresLocator: boolean;
  /** Node needs a `value`/`valueSource` to execute. Mirrors `requiresValue`. */
  readonly requiresValue: boolean;
  /**
   * Excluded from default unattended generation, with the reason. `undefined` = freely generated.
   * A campaign can still opt a gated type in explicitly (see `GenerationConstraints`).
   */
  readonly gate?: GenerationGate;
  /** Default relative weight when a campaign does not override it. `0` means never picked. */
  readonly weight: number;
  /** Short note explaining the gate or any non-obvious generation constraint. */
  readonly note?: string;
}

/**
 * Every `StepType`, exhaustively. Weights bias generation toward the interaction/assertion nodes
 * that the mock site can actually exercise end-to-end.
 */
export const NODE_CATALOG: Record<StepType, NodeGenerationSpec> = {
  // ---- structural ----
  start: { type: "start", role: "start", requiresLocator: false, requiresValue: false, weight: 0 },
  end: { type: "end", role: "terminal", requiresLocator: false, requiresValue: false, weight: 0 },

  // ---- navigation ----
  goto: { type: "goto", role: "action", requiresLocator: false, requiresValue: true, weight: 8 },
  routeChange: {
    type: "routeChange",
    role: "action",
    requiresLocator: false,
    requiresValue: false,
    weight: 2
  },

  // ---- interaction ----
  click: { type: "click", role: "action", requiresLocator: true, requiresValue: false, weight: 10 },
  scroll: { type: "scroll", role: "action", requiresLocator: false, requiresValue: true, weight: 3 },

  // ---- input ----
  fill: { type: "fill", role: "action", requiresLocator: true, requiresValue: true, weight: 10 },
  select: { type: "select", role: "action", requiresLocator: true, requiresValue: true, weight: 5 },
  check: { type: "check", role: "action", requiresLocator: true, requiresValue: false, weight: 4 },
  uncheck: {
    type: "uncheck",
    role: "action",
    requiresLocator: true,
    requiresValue: false,
    weight: 3
  },
  radio: { type: "radio", role: "action", requiresLocator: true, requiresValue: true, weight: 3 },
  uploadFile: {
    type: "uploadFile",
    role: "action",
    requiresLocator: true,
    requiresValue: true,
    gate: "missingLocalFixture",
    weight: 1,
    note: "mock-site /form has a file input but no multipart endpoint; needs an upload fixture first."
  },

  // ---- capture ----
  readText: {
    type: "readText",
    role: "action",
    requiresLocator: true,
    requiresValue: false,
    weight: 5
  },
  screenshot: {
    type: "screenshot",
    role: "action",
    requiresLocator: false,
    requiresValue: false,
    weight: 3
  },
  downloadFile: {
    type: "downloadFile",
    role: "action",
    requiresLocator: true,
    requiresValue: false,
    gate: "missingLocalFixture",
    weight: 1,
    note: "mock-site serves no downloadable file; needs a Content-Disposition route first."
  },

  // ---- assertion ----
  assertText: {
    type: "assertText",
    role: "action",
    requiresLocator: true,
    requiresValue: true,
    weight: 8
  },
  assertVisible: {
    type: "assertVisible",
    role: "action",
    requiresLocator: true,
    requiresValue: false,
    weight: 8
  },

  // ---- control ----
  wait: { type: "wait", role: "action", requiresLocator: false, requiresValue: true, weight: 6 },
  condition: {
    type: "condition",
    role: "branch",
    requiresLocator: false,
    requiresValue: true,
    weight: 6
  },
  loop: { type: "loop", role: "loop", requiresLocator: false, requiresValue: true, weight: 4 },
  runFlow: {
    type: "runFlow",
    role: "subflow",
    requiresLocator: false,
    requiresValue: true,
    weight: 3,
    note: "Runner enforces a max nested depth of 5 with self/indirect detection — never exceed it."
  },
  manualHandoff: {
    type: "manualHandoff",
    role: "action",
    requiresLocator: false,
    requiresValue: false,
    gate: "requiresHuman",
    weight: 0,
    note: "Blocks on a human; would hang an unattended campaign."
  },

  // ---- session / protected login ----
  saveSession: {
    type: "saveSession",
    role: "action",
    requiresLocator: false,
    requiresValue: false,
    gate: "requiresSession",
    weight: 0
  },
  reuseSession: {
    type: "reuseSession",
    role: "action",
    requiresLocator: false,
    requiresValue: false,
    gate: "requiresSession",
    weight: 0,
    note: "Needs a previously captured session profile on disk."
  },
  protectedLoginHandoff: {
    type: "protectedLoginHandoff",
    role: "action",
    requiresLocator: false,
    requiresValue: false,
    gate: "requiresHuman",
    weight: 0,
    note: "Never generated unattended. The lab must not automate any protected-login surface."
  },
  autoSecureLogin: {
    type: "autoSecureLogin",
    role: "action",
    requiresLocator: false,
    requiresValue: true,
    gate: "requiresHuman",
    weight: 0,
    note: "Launches the user's real Chrome for a manual login. Never generated unattended."
  },

  // ---- popup ----
  switchToPopup: {
    type: "switchToPopup",
    role: "action",
    requiresLocator: false,
    requiresValue: false,
    gate: "requiresPopupContext",
    weight: 2,
    note: "StepExecutor throws without popupExpectation; only emit inside a generated popup sequence."
  },
  closePopup: {
    type: "closePopup",
    role: "action",
    requiresLocator: false,
    requiresValue: false,
    gate: "requiresPopupContext",
    weight: 2,
    note: "Throws without config.popupAlias or pageAlias."
  },
  switchToMainPage: {
    type: "switchToMainPage",
    role: "action",
    requiresLocator: false,
    requiresValue: false,
    gate: "requiresPopupContext",
    weight: 2,
    note: 'Throws unless the "main" alias is registered.'
  },

  // ---- data source ----
  oracle: {
    type: "oracle",
    role: "action",
    requiresLocator: false,
    requiresValue: false,
    gate: "requiresExternalDataSource",
    weight: 0,
    note: "Env-gated integration campaigns only; packaged builds must stay fail-closed."
  }
};

/** Every node type, in catalog order. */
export const ALL_NODE_TYPES: readonly StepType[] = Object.keys(NODE_CATALOG) as StepType[];

/** Node types generated by default: no gate and a positive weight. */
export const DEFAULT_GENERATABLE_NODE_TYPES: readonly StepType[] = ALL_NODE_TYPES.filter((type) => {
  const spec = NODE_CATALOG[type];
  return spec.gate === undefined && spec.weight > 0;
});

/** Node types deliberately excluded from unattended generation, with their reasons. */
export const GATED_NODE_TYPES: ReadonlyArray<{ type: StepType; gate: GenerationGate }> =
  ALL_NODE_TYPES.flatMap((type) => {
    const spec = NODE_CATALOG[type];
    return spec.gate ? [{ type, gate: spec.gate }] : [];
  });

export function nodeSpec(type: StepType): NodeGenerationSpec {
  return NODE_CATALOG[type];
}
