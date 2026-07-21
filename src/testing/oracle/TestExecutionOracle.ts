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
 *   - `validateFlowDefinition` (`src/validation/FlowValidator.ts`) — the shared engine added by
 *     Tranche 2 Stage 2a
 *
 * ## Detection and production enforcement are tracked separately
 *
 * Phase 2 recorded 9 controlled defects that **no validator detected**. Stage 2a closed all 9 in the
 * shared engine, so they are now `status: "detected"`. But Stage 2a deliberately wires the engine
 * into nothing — the run gate, designer, save path and import are untouched until Stage 2b.
 *
 * Reporting those rules as simply "validated" would therefore overclaim: the *engine* catches them,
 * the *product* does not yet. So every expectation also declares {@link
 * MutationExpectation.productionEnforced} — whether a production caller actually blocks on it
 * today. `detected && !productionEnforced` is exactly the Stage 2b wiring checklist, and the
 * verifier reports that set under its own heading rather than letting it read as green.
 *
 * A defect that stops being detected, or a rule that silently becomes production-enforced without
 * the catalog being updated, both fail — this remains a regression guard on validation coverage.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { FlowProfile, StepType } from "../../profiles/FlowProfile";
import { validateConnectorStructure } from "../../profiles/FlowProfile";
import type { ScenarioProfile } from "../../profiles/ScenarioProfile";
import { PreRunValidator, type PreRunValidationIssue } from "../../reports/PreRunValidator";
import {
  activePathErrorsOf,
  errorsOf,
  validateFlowDefinition,
  warningsOf,
  type FlowValidationContext,
  type FlowValidationIssue,
  type FlowValidationReport
} from "../../validation/FlowValidator";
import { STEP_REQUIREMENTS } from "../../validation/StepRequirements";
import { ALL_NODE_TYPES, NODE_CATALOG } from "../random/NodeCatalog";
import type { Mutation, MutationKind } from "../random/RandomMutator";

/** Which layer is expected to reject a defect. */
export type DetectingValidator =
  | "validateConnectorStructure"
  | "preRunValidator"
  /** The shared engine, `src/validation/FlowValidator.ts` (Tranche 2 Stage 2a). */
  | "flowValidator"
  /** Nothing rejects it today. */
  | "none";

export interface MutationExpectation {
  readonly kind: MutationKind;
  readonly status: "detected" | "knownGap";
  readonly detectedBy: DetectingValidator;
  /**
   * Whether a **production** caller blocks on this defect today (run gate, save gate, import).
   *
   * `false` for every rule the Stage 2a engine detects but nothing calls yet. Kept separate from
   * `status` so the report cannot present engine coverage as product coverage.
   */
  readonly productionEnforced: boolean;
  /** Why this is (or is not) caught, with the citation. */
  readonly rationale: string;
  /** What wiring or fix the rule still needs. */
  readonly recommendation?: string;
  /** What the defect costs if it reaches the runner unvalidated. */
  readonly riskIfUnvalidated?: string;
}

export const MUTATION_EXPECTATIONS: Record<MutationKind, MutationExpectation> = {
  structuralLoopAcrossNodes: {
    kind: "structuralLoopAcrossNodes",
    status: "detected",
    detectedBy: "validateConnectorStructure",
    productionEnforced: true,
    rationale:
      "FlowProfile.ts:536-541 rejects any edge with `kind === \"loop\"` or `type === \"loop\"` whose source and target differ. Enforced at execution time by FlowExecutor.ts:69-72, so it holds even if the UI is bypassed."
  },
  multipleStandardOutgoing: {
    kind: "multipleStandardOutgoing",
    status: "detected",
    detectedBy: "validateConnectorStructure",
    productionEnforced: true,
    rationale: "FlowProfile.ts:549-554 rejects a node with more than one non-conditional / non-parallel outgoing connector."
  },
  loopNodeNonConditionalSibling: {
    kind: "loopNodeNonConditionalSibling",
    status: "detected",
    detectedBy: "validateConnectorStructure",
    productionEnforced: true,
    rationale: "FlowProfile.ts:556-562 requires every additional outgoing connector from a self-looping node to be conditional."
  },
  missingRequiredLocator: {
    kind: "missingRequiredLocator",
    status: "detected",
    detectedBy: "preRunValidator",
    productionEnforced: true,
    rationale:
      "PreRunValidator.ts:55-57 rejects a missing locator for click/fill/select/check/uncheck/uploadFile/downloadFile/readText/assertText/assertVisible. `radio` is absent from that hardcoded list (`awkit-acw`) and is judged by UNVALIDATED_LOCATOR_TYPE_EXPECTATION instead; the Stage 2a engine derives the list from STEP_REQUIREMENTS and covers every type."
  },

  // ── Closed by the Stage 2a engine; production wiring lands in Stage 2b ──────
  missingRequiredValue: {
    kind: "missingRequiredValue",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: false,
    rationale:
      "FlowValidator's `missingRequiredValue` rule checks `STEP_REQUIREMENTS[type].requiresValue` against value/valueSource (plus `url` for `goto` and the resolved target for `runFlow`). PreRunValidator still checks locators but never values, and the renderer's `validateFlow` (FlowChartDesigner.tsx:1003) remains advisory.",
    riskIfUnvalidated:
      "A `fill` with no value resolves to empty at run time and silently types nothing; a `goto` with no value fails deep in the runner with a URL error instead of before launch.",
    recommendation: "Stage 2b: PreRunValidator delegates to the engine, so this rule reaches the run gate."
  },
  invalidConnectorTarget: {
    kind: "invalidConnectorTarget",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: false,
    rationale:
      "FlowValidator's `brokenConnectorEndpoint` rule resolves every `edge.source`/`edge.target` against the node set. `validateConnectorStructure` still only inspects edge kinds and per-source degree, and `FlowDependencyResolver` checks flow links at the *scenario* level, not inside a flow.",
    riskIfUnvalidated: "Execution walks off the graph: the edge leads nowhere and the branch terminates without an error the user can act on.",
    recommendation: "Stage 2b: wire the engine into the run gate and designer."
  },
  unsupportedOperator: {
    kind: "unsupportedOperator",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: false,
    rationale:
      "FlowValidator's `unsupportedOperator` rule validates the operator literal against an exhaustive `Record<ConnectorConditionOperator, true>`. TypeScript still enforces the union at author time only, and `JsonProfileStore` parses with an unvalidated cast (ProfileStore.ts:145,174), so an imported profile carries the bad literal straight through to the runner.",
    riskIfUnvalidated: "The conditional silently never matches, so the branch is skipped and the flow takes a path the author did not intend — with no error at all.",
    recommendation: "Stage 2b: validate at the persistence/import boundary; this is the general case for the store's unvalidated cast."
  },
  duplicateNodeId: {
    kind: "duplicateNodeId",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: false,
    rationale:
      "FlowValidator's `duplicateNodeId`/`duplicateEdgeId` rules count ids within the flow. Nothing in production checks id uniqueness; `FlowDependencyResolver` checks duplicate *order* across scenario flows, which is a different thing.",
    riskIfUnvalidated: "Edge resolution and per-node run records key off the id, so two nodes sharing one id corrupt both routing and reporting.",
    recommendation: "Stage 2b: wire the engine into the run gate and designer."
  },
  missingEndNode: {
    kind: "missingEndNode",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: false,
    rationale:
      "FlowValidator's `missingStartNode`/`multipleStartNodes`/`missingEndNode`/`unreachableEndNode` rules own flow structure. The equivalent rule still lives only in the renderer's advisory `validateFlow` (FlowChartDesigner.tsx:989-990), which does not block save — `connectorStructureIssues` is the only save gate.",
    riskIfUnvalidated: "The flow runs to a dead end and reports completion without ever reaching a terminal node.",
    recommendation: "Stage 2b: wire the engine into the run gate and designer."
  },
  unreachableNode: {
    kind: "unreachableNode",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: false,
    rationale:
      "FlowValidator computes a forward BFS from Start (lifted from `verify-random-generator.mts`) and reports every unreached node. This was the one defect class with **no check anywhere** in the product; there is still none outside the engine.",
    riskIfUnvalidated: "Silently dead steps. The author believes a step runs; it never does, and nothing reports it — the most confusing possible failure mode.",
    recommendation:
      "Stage 2b: wire into the designer as a Not-Runnable badge. Note this issue is classified `onActivePath: false` by definition, so under the design's staged enforcement it is Legacy-Compatibility-tolerable rather than an immediate block."
  },
  invalidLoopLimit: {
    kind: "invalidLoopLimit",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: false,
    rationale:
      "FlowValidator's `invalidLoopBounds` rule range-checks connector `loop.maxIterations`, `maxLoopCount`, and node `loop.maxIterations`/`config.iterationCount`/`config.maxIterations` against 1…1000. The rule still lives in production only in the renderer's advisory `validateFlow` (FlowChartDesigner.tsx:1027-1028); `FlowExecutor` truncates at `LOOP_CONNECTOR_HARD_CAP` rather than rejecting.",
    riskIfUnvalidated: "A 0 silently skips the loop body; an over-cap value is silently truncated. Both change behavior without telling anyone.",
    recommendation: "Stage 2b: wire the engine into the run gate and designer."
  },
  invalidTimeout: {
    kind: "invalidTimeout",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: false,
    rationale:
      "FlowValidator's `invalidTimeout` rule rejects a non-positive or non-finite `timeoutMs` on a step or on any before/after wait. No production validator inspects `FlowStep.timeoutMs`; a negative value still reaches Playwright directly.",
    riskIfUnvalidated: "Playwright treats a non-positive timeout as 'no timeout', so a step that should fail fast can hang until the campaign deadline.",
    recommendation: "Stage 2b: wire the engine into the run gate."
  },
  missingFlowReference: {
    kind: "missingFlowReference",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: false,
    rationale:
      "FlowValidator's `missingFlowReference` rule resolves each `runFlow` step's target exactly as the runner does (`step.flowId ?? step.config?.targetFlowId`, StepExecutor.ts:955) against the context's flow ids. PreRunValidator.ts:44-48 still checks only the ids referenced by `scenario.flows`, never a `runFlow` step inside a flow.",
    riskIfUnvalidated: "The nested-flow call fails mid-run instead of before launch, after the browser is already open and earlier steps have applied their side effects.",
    recommendation: "Stage 2b: PreRunValidator passes its flow set to the engine as `referenceableFlowIds` — the set is already in scope there."
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
  /** Full report from the shared engine, including reachability and active-path classification. */
  readonly flowReport: FlowValidationReport;
  readonly flowErrors: readonly FlowValidationIssue[];
  readonly flowWarnings: readonly FlowValidationIssue[];
  /** The subset a Stage 2b run gate would block on. */
  readonly flowActivePathErrors: readonly FlowValidationIssue[];
}

const preRunValidator = new PreRunValidator();

/**
 * Run a flow through every validator that applies to it.
 *
 * `context.referenceableFlowIds` must carry the flow library the profile belongs to. Without it the
 * engine skips `missingFlowReference` entirely — an absent set means "the caller does not know the
 * library", never "no flow exists" — so a corpus flow whose `runFlow` targets a sibling would
 * otherwise be reported broken.
 */
export function validateFlowProfile(profile: FlowProfile, context: FlowValidationContext = {}): ValidationResult {
  const connectorIssues = validateConnectorStructure(profile.edges);
  const issues = preRunValidator.validate({ scenario: scenarioForFlow(profile), flows: [profile] });
  const flowReport = validateFlowDefinition(profile, context);
  return {
    connectorIssues,
    preRunErrors: issues.filter((issue) => issue.severity === "error"),
    preRunWarnings: issues.filter((issue) => issue.severity === "warning"),
    flowReport,
    flowErrors: errorsOf(flowReport),
    flowWarnings: warningsOf(flowReport),
    flowActivePathErrors: activePathErrorsOf(flowReport)
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
 * The same measurement against the Stage 2a engine — **probed, not read from `STEP_REQUIREMENTS`**.
 *
 * Reading the table would only prove the table agrees with itself. This drives the real
 * `validateFlowDefinition` with a minimal flow per locator-requiring type and records which ones it
 * reports, so the verifier's drift check exercises the rule rather than the data behind it.
 */
export function deriveEngineLocatorValidatedTypes(): Set<StepType> {
  const validated = new Set<StepType>();
  for (const type of ALL_NODE_TYPES) {
    if (!NODE_CATALOG[type].requiresLocator) continue;
    const probe: FlowProfile = {
      id: `engine-locator-probe-${type}`,
      name: `engine locator probe ${type}`,
      version: 1,
      nodes: [{ id: "probe-node", type, name: `probe-${type}` }],
      edges: []
    };
    const report = validateFlowDefinition(probe);
    if (report.issues.some((issue) => issue.code === "missingRequiredLocator" && issue.nodeId === "probe-node")) {
      validated.add(type);
    }
  }
  return validated;
}

/**
 * Node types the engine's `STEP_REQUIREMENTS` table and the test lab's `NODE_CATALOG` disagree
 * about. Both mirror the renderer's `flowNodeCatalog.ts`; `scripts/verify-validation.mts` closes
 * the triangle by comparing all three. A non-empty result means a requirement flag has drifted.
 */
export function requirementTableDrift(): Array<{ type: StepType; field: "requiresLocator" | "requiresValue"; engine: boolean; catalog: boolean }> {
  const drift: Array<{ type: StepType; field: "requiresLocator" | "requiresValue"; engine: boolean; catalog: boolean }> = [];
  for (const type of ALL_NODE_TYPES) {
    for (const field of ["requiresLocator", "requiresValue"] as const) {
      const engine = STEP_REQUIREMENTS[type][field];
      const catalog = NODE_CATALOG[type][field];
      if (engine !== catalog) drift.push({ type, field, engine, catalog });
    }
  }
  return drift;
}

/**
 * The expectation used when a locator is stripped from a type `PreRunValidator` does not cover
 * (today: `radio` — `awkit-acw`). Kept separate from `MUTATION_EXPECTATIONS` because it is a
 * property of the *type*, not the defect.
 *
 * Stage 2a flips this to `detected`: the engine derives its locator-required set from the
 * exhaustive `STEP_REQUIREMENTS` table, so no type can escape the check. `productionEnforced`
 * stays `false` because `PreRunValidator.ts:55` still holds its own hardcoded, drifted list —
 * that is deleted in Stage 2b when it delegates to the engine.
 */
export const UNVALIDATED_LOCATOR_TYPE_EXPECTATION: MutationExpectation = {
  kind: "missingRequiredLocator",
  status: "detected",
  detectedBy: "flowValidator",
  productionEnforced: false,
  rationale:
    "PreRunValidator.ts:55 hardcodes the list of types it enforces a locator for, and that list has drifted from the node catalog's `requiresLocator` flags. The Stage 2a engine derives the same set from `STEP_REQUIREMENTS`, an exhaustive `Record<StepType, …>` that `tsc --noEmit` fails on if a type is added without a decision, so the engine's set cannot drift the same way.",
  riskIfUnvalidated:
    "The step fails at run time with a raw Playwright resolution error, after the browser is open and earlier steps have already applied their side effects — instead of before launch with a clear message.",
  recommendation:
    "Stage 2b: PreRunValidator delegates to the engine and its hardcoded list is deleted. `deriveLocatorValidatedTypes()` in this module measures the remaining production drift until then."
};

export interface OracleContext {
  /** From `deriveLocatorValidatedTypes()`. Lets locator mutations be judged per node type. */
  readonly locatorValidatedTypes?: ReadonlySet<StepType>;
  /** The flow library the judged profile belongs to, so `runFlow` targets resolve (see above). */
  readonly referenceableFlowIds?: ReadonlySet<string>;
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
  // Whether a stripped locator is caught by *production* depends on the node type, so the
  // expectation is resolved per mutation rather than read straight from the table.
  const unvalidatedType =
    mutation.kind === "missingRequiredLocator" &&
    context.locatorValidatedTypes !== undefined &&
    mutation.targetType !== undefined &&
    !context.locatorValidatedTypes.has(mutation.targetType);
  const expectation = unvalidatedType ? UNVALIDATED_LOCATOR_TYPE_EXPECTATION : MUTATION_EXPECTATIONS[mutation.kind];
  const result = validateFlowProfile(profile, { referenceableFlowIds: context.referenceableFlowIds });
  // Any error-severity signal from any layer counts as rejection. Deliberately *not* restricted to
  // active-path errors: `unreachableNode` is off-path by definition, and requiring an active-path
  // error would score that rule as undetected even though the engine reports it correctly.
  const rejected = result.connectorIssues.length > 0 || result.preRunErrors.length > 0 || result.flowErrors.length > 0;

  const shouldReject = expectation.status === "detected";
  const matchesExpectation = rejected === shouldReject;

  let discrepancy: string | undefined;
  if (!matchesExpectation) {
    discrepancy = shouldReject
      ? `Expected ${expectation.detectedBy} to reject this defect, but every validator accepted it. Validation coverage has REGRESSED.`
      : `A validator now rejects this defect, which the catalog records as a known gap. The gap may have been closed — update the catalog. Signals: ${[
          ...result.connectorIssues,
          ...result.preRunErrors.map((issue) => issue.message),
          ...result.flowErrors.map((issue) => `${issue.code}: ${issue.message}`)
        ].join(" | ")}`;
  }

  return discrepancy === undefined
    ? { mutation, expectation, result, rejected, matchesExpectation }
    : { mutation, expectation, result, rejected, matchesExpectation, discrepancy };
}

/**
 * Every mutation no validator catches. Emptied by Stage 2a — kept as a regression guard: if this
 * grows again, a defect class has stopped being detected.
 */
export const KNOWN_VALIDATION_GAPS: readonly MutationExpectation[] = Object.values(MUTATION_EXPECTATIONS).filter(
  (expectation) => expectation.status === "knownGap"
);

/**
 * Rules the shared engine detects that **no production caller enforces yet** — the Stage 2b wiring
 * checklist. Not a validation gap (the rule exists and is proven) and not done either: until the
 * run gate, designer and import call the engine, a profile that arrives by import, hand edit or IPC
 * still reaches the runner unchecked.
 */
export const PRODUCTION_UNENFORCED_RULES: readonly MutationExpectation[] = [
  ...Object.values(MUTATION_EXPECTATIONS).filter((expectation) => expectation.status === "detected" && !expectation.productionEnforced),
  UNVALIDATED_LOCATOR_TYPE_EXPECTATION
];
