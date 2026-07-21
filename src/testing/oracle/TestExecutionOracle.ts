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
 * Phase 2 recorded 9 controlled defects that **no validator detected**. Stage 2a closed all 9 in
 * the shared engine; Stage 2b wired that engine into production — `PreRunValidator` delegates all
 * flow-definition rules to it, so the run gate now rejects every one of these defects when it is
 * execution-blocking (active-path error, or any connector-structure error). Every expectation
 * therefore declares `productionEnforced: true`; the {@link MutationExpectation.productionEnforced}
 * flag is retained as a regression guard — if a rule ever stops reaching the gate, flipping the
 * flag back is the honest (and loud) way to record it.
 *
 * A defect that stops being detected, or an expectation that no longer matches what the validators
 * do, both fail — this remains a regression guard on validation coverage.
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
   * Whether a **production** caller acts on this defect today (the run gate blocks it, or — for
   * the off-path-by-definition `unreachableNode` — reports it as a deliberate non-blocking
   * finding). All `true` since Stage 2b wired the engine into `PreRunValidator`. Kept separate
   * from `status` so engine coverage can never silently stand in for product coverage if the
   * wiring regresses.
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
      "Since Stage 2b PreRunValidator delegates to the engine, whose locator-required set derives from the exhaustive STEP_REQUIREMENTS table — every type is covered, including `radio`, which the deleted hardcoded list omitted (`awkit-acw`, closed)."
  },

  // ── Closed by the Stage 2a engine; production wiring lands in Stage 2b ──────
  missingRequiredValue: {
    kind: "missingRequiredValue",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: true,
    rationale:
      "FlowValidator's `missingRequiredValue` rule checks `STEP_REQUIREMENTS[type].requiresValue` against value/valueSource (plus `url` for `goto` and the resolved target for `runFlow`). Enforced at the run gate since Stage 2b via PreRunValidator delegation; the designer surfaces it with navigation.",
    riskIfUnvalidated:
      "A `fill` with no value resolves to empty at run time and silently types nothing; a `goto` with no value fails deep in the runner with a URL error instead of before launch.",
    recommendation: "Enforced at the run gate since Stage 2b."
  },
  invalidConnectorTarget: {
    kind: "invalidConnectorTarget",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: true,
    rationale:
      "FlowValidator's `brokenConnectorEndpoint` rule resolves every `edge.source`/`edge.target` against the node set. `validateConnectorStructure` deliberately keeps inspecting only edge kinds and per-source degree — the endpoint rule lives in the engine, which the run gate calls since Stage 2b.",
    riskIfUnvalidated: "Execution walks off the graph: the edge leads nowhere and the branch terminates without an error the user can act on.",
    recommendation: "Enforced at the run gate and surfaced in the designer since Stage 2b."
  },
  unsupportedOperator: {
    kind: "unsupportedOperator",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: true,
    rationale:
      "FlowValidator's `unsupportedOperator` rule validates the operator literal against an exhaustive `Record<ConnectorConditionOperator, true>`. TypeScript still enforces the union at author time only, and `JsonProfileStore` parses with an unvalidated cast (ProfileStore.ts:145,174), so an imported profile carries the bad literal straight through to the runner.",
    riskIfUnvalidated: "The conditional silently never matches, so the branch is skipped and the flow takes a path the author did not intend — with no error at all.",
    recommendation: "Enforced at the run gate and reported at import since Stage 2b. The store's unvalidated cast itself remains — validation runs after parse, deliberately not inside the store."
  },
  duplicateNodeId: {
    kind: "duplicateNodeId",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: true,
    rationale:
      "FlowValidator's `duplicateNodeId`/`duplicateEdgeId` rules count ids within the flow. Nothing in production checks id uniqueness; `FlowDependencyResolver` checks duplicate *order* across scenario flows, which is a different thing.",
    riskIfUnvalidated: "Edge resolution and per-node run records key off the id, so two nodes sharing one id corrupt both routing and reporting.",
    recommendation: "Enforced at the run gate and surfaced in the designer since Stage 2b."
  },
  missingEndNode: {
    kind: "missingEndNode",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: true,
    rationale:
      "FlowValidator's `missingStartNode`/`multipleStartNodes`/`missingEndNode`/`unreachableEndNode` rules own flow structure. The equivalent rule still lives only in the renderer's advisory `validateFlow` (FlowChartDesigner.tsx:989-990), which does not block save — `connectorStructureIssues` is the only save gate.",
    riskIfUnvalidated: "The flow runs to a dead end and reports completion without ever reaching a terminal node.",
    recommendation: "Enforced at the run gate and surfaced in the designer since Stage 2b."
  },
  unreachableNode: {
    kind: "unreachableNode",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: true,
    rationale:
      "FlowValidator computes a forward BFS from Start (lifted from `verify-random-generator.mts`) and reports every unreached node. This was the one defect class with **no check anywhere** in the product; there is still none outside the engine.",
    riskIfUnvalidated: "Silently dead steps. The author believes a step runs; it never does, and nothing reports it — the most confusing possible failure mode.",
    recommendation:
      "Surfaced since Stage 2b in the designer issue list, the library status and the run-gate report as a NON-blocking off-path finding — off-path by definition, so it never blocks a run. Stage 2c adds the explicit Legacy Compatibility treatment."
  },
  invalidLoopLimit: {
    kind: "invalidLoopLimit",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: true,
    rationale:
      "FlowValidator's `invalidLoopBounds` rule range-checks connector `loop.maxIterations`, `maxLoopCount`, and node `loop.maxIterations`/`config.iterationCount`/`config.maxIterations` against 1…1000. The rule still lives in production only in the renderer's advisory `validateFlow` (FlowChartDesigner.tsx:1027-1028); `FlowExecutor` truncates at `LOOP_CONNECTOR_HARD_CAP` rather than rejecting.",
    riskIfUnvalidated: "A 0 silently skips the loop body; an over-cap value is silently truncated. Both change behavior without telling anyone.",
    recommendation: "Enforced at the run gate and surfaced in the designer since Stage 2b."
  },
  invalidTimeout: {
    kind: "invalidTimeout",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: true,
    rationale:
      "FlowValidator's `invalidTimeout` rule rejects a non-positive or non-finite `timeoutMs` on a step or on any before/after wait. No production validator inspects `FlowStep.timeoutMs`; a negative value still reaches Playwright directly.",
    riskIfUnvalidated: "Playwright treats a non-positive timeout as 'no timeout', so a step that should fail fast can hang until the campaign deadline.",
    recommendation: "Enforced at the run gate since Stage 2b."
  },
  missingFlowReference: {
    kind: "missingFlowReference",
    status: "detected",
    detectedBy: "flowValidator",
    productionEnforced: true,
    rationale:
      "FlowValidator's `missingFlowReference` rule resolves each `runFlow` step's target exactly as the runner does (`step.flowId ?? step.config?.targetFlowId`, StepExecutor.ts:955) against the context's flow ids. PreRunValidator.ts:44-48 still checks only the ids referenced by `scenario.flows`, never a `runFlow` step inside a flow.",
    riskIfUnvalidated: "The nested-flow call fails mid-run instead of before launch, after the browser is already open and earlier steps have applied their side effects.",
    recommendation: "Enforced at the run gate since Stage 2b — PreRunValidator supplies its flow library as the engine's reference context."
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
  const issues = preRunValidator.validate({
    scenario: scenarioForFlow(profile),
    flows: [profile],
    // Stage 2b: PreRunValidator delegates flow rules to the engine, so it needs the same library
    // context — otherwise a corpus flow whose `runFlow` targets a sibling would be misreported.
    referenceableFlowIds: context.referenceableFlowIds
  });
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
 * Before Stage 2b the validator held a private inline array (the drifted list of `awkit-acw`);
 * since Stage 2b it delegates to the engine's `STEP_REQUIREMENTS`. Either way this probes the real
 * validator with a minimal flow per locator-requiring type and records which ones it rejects, so
 * the drift measurement stays honest about what the production gate does — it detects via the
 * structured `missingRequiredLocator` code on the probe node.
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
    if (issues.some((issue) => issue.severity === "error" && issue.code === "missingRequiredLocator" && issue.nodeId === "probe-node")) {
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
 * The expectation used when a locator is stripped from a type `PreRunValidator` does not cover.
 * Kept separate from `MUTATION_EXPECTATIONS` because it is a property of the *type*, not the
 * defect.
 *
 * Since Stage 2b this is a **tripwire that should never fire**: the hardcoded drifted list
 * (`awkit-acw`) is gone and PreRunValidator delegates to the engine's exhaustive
 * `STEP_REQUIREMENTS` table, so `deriveLocatorValidatedTypes()` covers every locator-requiring
 * type and `judgeMutation` never selects this expectation. If drift somehow reappears, the judge
 * uses it again and the oracle's exact-drift assertion fails loudly.
 */
export const UNVALIDATED_LOCATOR_TYPE_EXPECTATION: MutationExpectation = {
  kind: "missingRequiredLocator",
  status: "detected",
  detectedBy: "flowValidator",
  productionEnforced: true,
  rationale:
    "The engine's locator-required set derives from `STEP_REQUIREMENTS`, an exhaustive `Record<StepType, …>` that `tsc --noEmit` fails on if a type is added without a decision; PreRunValidator delegates to it since Stage 2b, so no type can escape the production gate.",
  riskIfUnvalidated:
    "The step fails at run time with a raw Playwright resolution error, after the browser is open and earlier steps have already applied their side effects — instead of before launch with a clear message.",
  recommendation: "None — `deriveLocatorValidatedTypes()` keeps measuring the production gate so any regression is caught."
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
 * Rules the shared engine detects that **no production caller enforces**. This was the Stage 2b
 * wiring checklist; the wiring landed, so it is now empty and serves as a regression guard — an
 * entry reappearing means a rule stopped reaching the run gate.
 */
export const PRODUCTION_UNENFORCED_RULES: readonly MutationExpectation[] = [
  ...Object.values(MUTATION_EXPECTATIONS),
  UNVALIDATED_LOCATOR_TYPE_EXPECTATION
].filter((expectation) => expectation.status === "detected" && !expectation.productionEnforced);
