/**
 * Expected-outcome oracle for generated and mutated flows.
 *
 * The oracle runs a definition through the **real** validators and compares the result against a
 * declared expectation. It deliberately does not reimplement any validation rule — a generator
 * checked against a private copy of the rules proves only that the copy agrees with itself.
 *
 * Validators driven:
 *   - `validateConnectorStructure` (`src/profiles/FlowProfile.ts`) — the runtime save/execute gate
 *   - `PreRunValidator.validate` (`src/reports/PreRunValidator.ts`), which internally runs
 *     `FlowDependencyResolver.validate` and `SecurityPolicy`
 *
 * ## Known validation gaps are recorded, not passed
 *
 * Several defects the brief asks about are **not detected by anything today** — most notably there
 * is no flow-level reachability check at all. Asserting "the validator rejected it" for those would
 * fail; asserting "the validator accepted it" and calling that a pass would quietly bless the hole.
 *
 * So each mutation declares `status: "detected" | "knownGap"`. A `knownGap` is asserted to *still*
 * be a gap and is reported under its own loud heading with a recommendation. A gap that closes, or
 * a new gap that appears, both fail — the catalog is a regression guard on validation coverage, not
 * an excuse list.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { FlowProfile, StepType } from "../../profiles/FlowProfile";
import { validateConnectorStructure } from "../../profiles/FlowProfile";
import type { ScenarioProfile } from "../../profiles/ScenarioProfile";
import { PreRunValidator, type PreRunValidationIssue } from "../../reports/PreRunValidator";
import { ALL_NODE_TYPES, NODE_CATALOG } from "../random/NodeCatalog";
import type { Mutation, MutationKind } from "../random/RandomMutator";

/** Which layer is expected to reject a defect. */
export type DetectingValidator =
  | "validateConnectorStructure"
  | "preRunValidator"
  /** Nothing rejects it today. */
  | "none";

export interface MutationExpectation {
  readonly kind: MutationKind;
  readonly status: "detected" | "knownGap";
  readonly detectedBy: DetectingValidator;
  /** Why this is (or is not) caught, with the citation. */
  readonly rationale: string;
  /** For gaps: what closing it would take. */
  readonly recommendation?: string;
  /** For gaps: what the defect costs if it reaches the runner. */
  readonly riskIfUnvalidated?: string;
}

export const MUTATION_EXPECTATIONS: Record<MutationKind, MutationExpectation> = {
  structuralLoopAcrossNodes: {
    kind: "structuralLoopAcrossNodes",
    status: "detected",
    detectedBy: "validateConnectorStructure",
    rationale:
      "FlowProfile.ts:536-541 rejects any edge with `kind === \"loop\"` or `type === \"loop\"` whose source and target differ. Enforced at execution time by FlowExecutor.ts:69-72, so it holds even if the UI is bypassed."
  },
  multipleStandardOutgoing: {
    kind: "multipleStandardOutgoing",
    status: "detected",
    detectedBy: "validateConnectorStructure",
    rationale: "FlowProfile.ts:549-554 rejects a node with more than one non-conditional / non-parallel outgoing connector."
  },
  loopNodeNonConditionalSibling: {
    kind: "loopNodeNonConditionalSibling",
    status: "detected",
    detectedBy: "validateConnectorStructure",
    rationale: "FlowProfile.ts:556-562 requires every additional outgoing connector from a self-looping node to be conditional."
  },
  missingRequiredLocator: {
    kind: "missingRequiredLocator",
    status: "detected",
    detectedBy: "preRunValidator",
    rationale:
      "PreRunValidator.ts:55-57 rejects a missing locator for click/fill/select/check/uncheck/uploadFile/downloadFile/readText/assertText/assertVisible."
  },

  // ── Gaps ────────────────────────────────────────────────────────────────────
  missingRequiredValue: {
    kind: "missingRequiredValue",
    status: "knownGap",
    detectedBy: "none",
    rationale:
      "PreRunValidator checks locators but never values. The renderer's `validateFlow` does check `requiresValue` (FlowChartDesigner.tsx:1003) — but it is advisory only and is not the save gate, and nothing in `src/` mirrors it.",
    riskIfUnvalidated:
      "A `fill` with no value resolves to empty at run time and silently types nothing; a `goto` with no value fails deep in the runner with a URL error instead of before launch.",
    recommendation: "Mirror the `requiresValue` check into PreRunValidator alongside the existing locator check."
  },
  invalidConnectorTarget: {
    kind: "invalidConnectorTarget",
    status: "knownGap",
    detectedBy: "none",
    rationale:
      "`validateConnectorStructure` only inspects edge kinds and per-source degree — it never checks that `edge.source`/`edge.target` resolve to real nodes. `FlowDependencyResolver` does this check, but at the *scenario* level for flow links, not inside a flow.",
    riskIfUnvalidated: "Execution walks off the graph: the edge leads nowhere and the branch terminates without an error the user can act on.",
    recommendation: "Add a node-existence check for every edge endpoint to `validateConnectorStructure`, which is already the enforced runtime gate."
  },
  unsupportedOperator: {
    kind: "unsupportedOperator",
    status: "knownGap",
    detectedBy: "none",
    rationale:
      "`ConnectorConditionOperator` is enforced by TypeScript at author time only. `JsonProfileStore` parses with an unvalidated cast (ProfileStore.ts:145,174), so an imported or hand-edited profile carries the bad literal straight through.",
    riskIfUnvalidated: "The conditional silently never matches, so the branch is skipped and the flow takes a path the author did not intend — with no error at all.",
    recommendation: "Validate connector config literals at the persistence boundary; this is the general case for the store's unvalidated cast."
  },
  duplicateNodeId: {
    kind: "duplicateNodeId",
    status: "knownGap",
    detectedBy: "none",
    rationale: "No validator checks node-id uniqueness within a flow. `FlowDependencyResolver` checks duplicate *order* across scenario flows, which is a different thing.",
    riskIfUnvalidated: "Edge resolution and per-node run records key off the id, so two nodes sharing one id corrupt both routing and reporting.",
    recommendation: "Add a uniqueness check for node and edge ids to `validateConnectorStructure`."
  },
  missingEndNode: {
    kind: "missingEndNode",
    status: "knownGap",
    detectedBy: "none",
    rationale:
      "The start/end-count rule lives only in the renderer's advisory `validateFlow` (FlowChartDesigner.tsx:989-990). It does not block save — `connectorStructureIssues` is the only save gate — and nothing in `src/` enforces it.",
    riskIfUnvalidated: "The flow runs to a dead end and reports completion without ever reaching a terminal node.",
    recommendation: "Promote the exactly-one-start / at-least-one-end rule into the shared runtime validator."
  },
  unreachableNode: {
    kind: "unreachableNode",
    status: "knownGap",
    detectedBy: "none",
    rationale:
      "**There is no reachability check anywhere.** Validation is per-node degree only; no BFS or DFS from Start exists at the flow level (see RANDOMIZED_TESTING_ARCHITECTURE.md §4).",
    riskIfUnvalidated: "Silently dead steps. The author believes a step runs; it never does, and nothing reports it — the most confusing possible failure mode.",
    recommendation:
      "Add a forward BFS from the Start node and report unreachable nodes. `verify-random-generator.mts` already implements exactly this walk and can be lifted into `src/`."
  },
  invalidLoopLimit: {
    kind: "invalidLoopLimit",
    status: "knownGap",
    detectedBy: "none",
    rationale:
      "The `1 ≤ maxIterations ≤ 1000` rule lives only in the renderer's advisory `validateFlow` (FlowChartDesigner.tsx:1027-1028). `FlowExecutor` truncates at `LOOP_CONNECTOR_HARD_CAP` at run time rather than rejecting.",
    riskIfUnvalidated: "A 0 silently skips the loop body; an over-cap value is silently truncated. Both change behavior without telling anyone.",
    recommendation: "Mirror the bounds check into `validateConnectorStructure` so it is enforced outside the renderer."
  },
  invalidTimeout: {
    kind: "invalidTimeout",
    status: "knownGap",
    detectedBy: "none",
    rationale: "No validator inspects `FlowStep.timeoutMs`. A negative value reaches Playwright directly.",
    riskIfUnvalidated: "Playwright treats a non-positive timeout as 'no timeout', so a step that should fail fast can hang until the campaign deadline.",
    recommendation: "Range-check `timeoutMs` in PreRunValidator."
  },
  missingFlowReference: {
    kind: "missingFlowReference",
    status: "knownGap",
    detectedBy: "none",
    rationale:
      "PreRunValidator.ts:44-48 checks the flow ids referenced by `scenario.flows`, but nothing checks the `flowId` on a `runFlow` *step* inside a flow.",
    riskIfUnvalidated: "The nested-flow call fails mid-run instead of before launch, after the browser is already open and earlier steps have applied their side effects.",
    recommendation: "Extend the existing PreRunValidator reference check to cover `runFlow` step targets — the flow set is already in scope there."
  }
};

/** Minimal single-flow scenario, so `PreRunValidator` can be driven against one flow. */
export function scenarioForFlow(profile: FlowProfile): ScenarioProfile {
  return {
    id: `${profile.id}-scenario`,
    name: `${profile.name} scenario`,
    executionMode: "sequential",
    maxParallelFlows: 1,
    flows: [{ order: 0, flowId: profile.id, required: true, inputs: {} }],
    links: [],
    failurePolicy: { stopOnRequiredFlowFailure: true, continueOnOptionalFlowFailure: true, takeScreenshotOnFailure: true }
  };
}

export interface ValidationResult {
  readonly connectorIssues: readonly string[];
  readonly preRunErrors: readonly PreRunValidationIssue[];
  readonly preRunWarnings: readonly PreRunValidationIssue[];
}

const preRunValidator = new PreRunValidator();

/** Run a flow through every validator that applies to it. */
export function validateFlowProfile(profile: FlowProfile): ValidationResult {
  const connectorIssues = validateConnectorStructure(profile.edges);
  const issues = preRunValidator.validate({ scenario: scenarioForFlow(profile), flows: [profile] });
  return {
    connectorIssues,
    preRunErrors: issues.filter((issue) => issue.severity === "error"),
    preRunWarnings: issues.filter((issue) => issue.severity === "warning")
  };
}

/**
 * Which node types `PreRunValidator` actually enforces a locator for — **measured, not copied**.
 *
 * The validator holds its list as a private inline array (`PreRunValidator.ts:55`). Duplicating it
 * here would mean testing a copy, so instead this probes the real validator with a minimal flow per
 * locator-requiring type and records which ones it rejects. Any type the node catalog marks
 * `requiresLocator` that does *not* appear in the result is a validator coverage hole, and the
 * check stays correct automatically when a node type is added.
 */
export function deriveLocatorValidatedTypes(): Set<StepType> {
  const validated = new Set<StepType>();
  for (const type of ALL_NODE_TYPES) {
    if (!NODE_CATALOG[type].requiresLocator) continue;
    const probe: FlowProfile = {
      id: `locator-probe-${type}`,
      name: `locator probe ${type}`,
      version: 1,
      nodes: [{ id: "probe-node", type, name: `probe-${type}` }],
      edges: []
    };
    const issues = preRunValidator.validate({ scenario: scenarioForFlow(probe), flows: [probe] });
    if (issues.some((issue) => issue.severity === "error" && issue.key === "locator.probe-node")) {
      validated.add(type);
    }
  }
  return validated;
}

/**
 * The expectation used when a locator is stripped from a type `PreRunValidator` does not cover.
 * Kept separate from `MUTATION_EXPECTATIONS` because it is a property of the *type*, not the defect.
 */
export const UNVALIDATED_LOCATOR_TYPE_EXPECTATION: MutationExpectation = {
  kind: "missingRequiredLocator",
  status: "knownGap",
  detectedBy: "none",
  rationale:
    "PreRunValidator.ts:55 hardcodes the list of types it enforces a locator for, and that list has drifted from the node catalog's `requiresLocator` flags. A type marked as requiring a locator but absent from the list is never checked.",
  riskIfUnvalidated:
    "The step fails at run time with a raw Playwright resolution error, after the browser is open and earlier steps have already applied their side effects — instead of before launch with a clear message.",
  recommendation:
    "Derive the list from the node catalog instead of hardcoding it, so the two cannot drift. `deriveLocatorValidatedTypes()` in this module measures the current drift."
};

export interface OracleContext {
  /** From `deriveLocatorValidatedTypes()`. Lets locator mutations be judged per node type. */
  readonly locatorValidatedTypes?: ReadonlySet<StepType>;
}

export interface OracleVerdict {
  readonly mutation: Mutation;
  readonly expectation: MutationExpectation;
  readonly result: ValidationResult;
  /** Any error-severity signal from any validator. */
  readonly rejected: boolean;
  /** Whether the observed outcome matched what the expectation declared. */
  readonly matchesExpectation: boolean;
  /** Set when the outcome differed, describing how. */
  readonly discrepancy?: string;
}

/** Judge one mutated flow against its declared expectation. */
export function judgeMutation(profile: FlowProfile, mutation: Mutation, context: OracleContext = {}): OracleVerdict {
  // Whether a stripped locator is caught depends on the node type, so the expectation is resolved
  // per mutation rather than read straight from the table.
  const unvalidatedType =
    mutation.kind === "missingRequiredLocator" &&
    context.locatorValidatedTypes !== undefined &&
    mutation.targetType !== undefined &&
    !context.locatorValidatedTypes.has(mutation.targetType);
  const expectation = unvalidatedType ? UNVALIDATED_LOCATOR_TYPE_EXPECTATION : MUTATION_EXPECTATIONS[mutation.kind];
  const result = validateFlowProfile(profile);
  const rejected = result.connectorIssues.length > 0 || result.preRunErrors.length > 0;

  const shouldReject = expectation.status === "detected";
  const matchesExpectation = rejected === shouldReject;

  let discrepancy: string | undefined;
  if (!matchesExpectation) {
    discrepancy = shouldReject
      ? `Expected ${expectation.detectedBy} to reject this defect, but every validator accepted it. Validation coverage has REGRESSED.`
      : `A validator now rejects this defect, which the catalog records as a known gap. The gap may have been closed — update the catalog. Signals: ${[
          ...result.connectorIssues,
          ...result.preRunErrors.map((issue) => issue.message)
        ].join(" | ")}`;
  }

  return discrepancy === undefined
    ? { mutation, expectation, result, rejected, matchesExpectation }
    : { mutation, expectation, result, rejected, matchesExpectation, discrepancy };
}

/** Every mutation the validators do not currently catch. */
export const KNOWN_VALIDATION_GAPS: readonly MutationExpectation[] = Object.values(MUTATION_EXPECTATIONS).filter(
  (expectation) => expectation.status === "knownGap"
);
