import type { Page, Locator, Frame, ElementHandle } from "playwright";
import { createPageFingerprint, fingerprintChanges, fingerprintsEqual, hashFingerprint, hashToken, similarity } from "./locatorFingerprint";
import {
  locatorContainerChain,
  locatorFrameChain,
  MAX_LOCATOR_CONTAINER_CHAIN,
  type FlowStep,
  type LocatorCandidate,
  type LocatorContext,
  type LocatorFrameContext,
  type LocatorGuard,
  type LocatorShadowHost,
  type SemanticPrecondition
} from "@src/profiles/FlowProfile";
import {
  hasPositionalIdentityGuard,
  isPositionalCandidate,
  isPositionalLocator,
  isValidLocatorFallbackApproval
} from "@src/profiles/locatorApproval";
import { resolveStepSafety } from "./runtime/StepSafetyPolicy";
import { encodeClosedShadowSelector, isInstrumentedClosedShadow, registerClosedShadowEngine } from "./closedShadowBridge";
import {
  locatorCandidateSignature,
  locatorCandidatesDigest,
  stepCandidatesDigest,
  type LocatorElementFingerprint,
  type LocatorRecoveryRecord,
  type LocatorRecoveryStore
} from "./LocatorRecoveryStore";
import type { ElementBlueprint, LocatorBlueprintStore } from "./LocatorBlueprintStore";
import { computeFrameKey, computePageKey, documentFingerprintMatches } from "./LocatorBlueprintStore";
import {
  BLUEPRINT_NEIGHBORHOOD_RADIUS,
  BLUEPRINT_POSITION_BONUS,
  RECOVERY_SCAN_CAP,
  RECOVERY_SCORE_THRESHOLD,
  blueprintPositionScore,
  captureBlueprintSnapshot,
  captureLocalSnapshot,
  decideBlueprintRecovery,
  decideProviderAgreement,
  gateRecovery,
  isPreExistingTwin,
  isRecoveryCompatible,
  preExistingTwins,
  rankLocalRecovery,
  recheckSnapshotWinner,
  sameElementFingerprint,
  type RecoveryDecision,
  type RecoveryRefusal,
  type ScoredCandidate
} from "./recoverySnapshot";
import {
  DOM_INTELLIGENCE_LIMITS,
  type DomCandidateProof,
  type DomIntelligenceProvider,
  type DomIntelligenceRecoveryOptions,
  type DomRepairSuggestion
} from "./domIntelligence/DomIntelligenceProvider";
import { countLookAlikes, fingerprintAt, proveCandidate, referenceStructurePresent, suggestRepair } from "./domIntelligence/repairSuggestion";
import { CAPTCHA_MARKER_SELECTOR, protectedDiagnosisAllowed } from "./domIntelligence/protectedDiagnosis";
import { buildDomReference, domReferenceId, type DomReferenceStore } from "./domIntelligence/domReference";
import { captureDomSnapshot } from "./domIntelligence/domSnapshot";
import { DOM_REFERENCE_CAPTURE_SOURCE, PROTECTED_LOGIN_SELECTOR } from "./domIntelligence/pageScripts";
import { compareRoutes, routeKey } from "./routeIdentity";
import { PIN_PAGE_SOURCE, newElementPin, pinnedLocator, type ElementPin } from "./elementPin";
import { detectRecorderProtectedLogin } from "@src/security/ProtectedLoginDetector";
import { capturePageContext } from "./domIntelligence/normalizeDom";
import { pageContextEnabled, type PageContextResult } from "./domIntelligence/pageContext";

let referenceCapture: ((element: Element) => { reference: unknown; url: string }) | undefined;

/** Guarded-positional read: the set size, the page fingerprint at `arg.index`, and that node pinned. */
const GUARD_READ = `
  var element = elements[arg.index];
  if (!element) return { count: elements.length };
  (${PIN_PAGE_SOURCE})(arg.token, arg.nonce, element);
  return { count: elements.length, print: (${createPageFingerprint.toString()})(element) };
`;
type GuardRead = (elements: Element[], arg: { index: number } & ElementPin) => { count: number; print?: LocatorElementFingerprint };
let guardRead: GuardRead | undefined;

/**
 * Anything Playwright can build sub-locators from: a `Page`, a `FrameLocator`, or a `Locator`.
 * All three expose the same `getBy*` / `locator()` builder surface, which lets us resolve a
 * candidate against a scoped container (dialog/row/card/iframe) exactly like against the page.
 */
interface LocatorRoot {
  locator(selector: string): Locator;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getByRole(role: any, options?: { name?: string; exact?: boolean }): Locator;
  getByText(text: string, options?: { exact?: boolean }): Locator;
  getByLabel(text: string, options?: { exact?: boolean }): Locator;
  getByPlaceholder(text: string, options?: { exact?: boolean }): Locator;
  getByTestId(testId: string): Locator;
}

/** Per-candidate resolution result, collected for diagnostics when nothing resolves uniquely. */
interface CandidateDiagnostic {
  strategy: string;
  value: string;
  count: number;
  visibleCount: number;
}

/** How many matches to probe for visibility before giving up (bounds pathological pages). */
const VISIBILITY_PROBE_CAP = 30;
/** Hard ceiling on frame-chain depth (matches the recorder's capture bound). */
const MAX_FRAME_CHAIN = 8;
/** How long to auto-wait for a not-yet-attached iframe segment before failing. */
const FRAME_WAIT_MS = 5_000;
/** Grace period a closed-shadow target gets to resolve via the bridge before the CDP fallback is tried. */
const CLOSED_SHADOW_FALLBACK_GRACE_MS = 1_000;
/** Cap on closed roots the CDP fallback registers per attempt (bounds pathological pages). */
const MAX_CDP_CLOSED_ROOTS = 50;

/** One recovery layer's outcome, for the bounded provenance trace (never page text or DOM). */
export interface LocatorRecoveryStage {
  stage: "local" | "blueprint" | "provider";
  outcome: "proven" | "refused" | "skipped" | "error" | "suggested";
  ms: number;
  reason?:
    | RecoveryRefusal
    | "no-blueprint"
    | "no-reference"
    | "sensitive"
    | "provider-unavailable"
    | "provider-timeout"
    | "provider-error"
    | "protected-surface"
    | "no-candidate"
    | "route-mismatch"
    | "not-actionable"
    /** L12.24: the winner lies outside the step's proven container. */
    | "outside-container"
    /** L12.12: identical list rows, and the recorded one is not mounted (virtualized or filtered). */
    | "list-row-not-mounted";
  /** Candidates the layer scored after pruning (or the provider returned). */
  candidates?: number;
  score?: number;
  runnerUpScore?: number;
  /**
   * L12.16: on a refused local layer, what differs between the recorded element and the closest candidate
   * (`fingerprintChanges` codes: field names only, never values).
   */
  changed?: string[];
}

/**
 * One trace per recovery attempt (all recorded candidates missed after the grace retry). Structured,
 * bounded, and free of page text: stage names, timings, counts, scores and refusal codes only.
 */
export interface LocatorRecoveryTrace {
  engine: LocatorRecoveryEngine;
  result: "recovered" | "unresolved";
  totalMs: number;
  stages: LocatorRecoveryStage[];
  suggestion?: DomRepairSuggestion;
  /**
   * L11.F: where recovery ran. The step's page alias (never a URL), the frame it targets and its depth,
   * and whether the page is on the route the remembered winner was proven on. Every candidate any layer
   * scored came from this page and frame only.
   */
  context: LocatorRecoveryContext;
  /** Recorded candidates (primary plus usable alternatives) that all missed before recovery ran. */
  candidatesTried: number;
}

export interface LocatorRecoveryContext {
  page: string;
  frame: "main" | "child";
  frameDepth: number;
  route: "match" | "mismatch" | "unbound";
}

/** An element as the Recorder's in-page generator describes it (label and a suggested locator). */
export interface DiagnosisElement {
  owner: { tag: string; role: string; name: string; type?: string };
  locator: { strategy: string; value: string; name?: string; exact?: boolean; quality?: unknown; context?: unknown; alternatives?: unknown };
}

export interface DiagnosisCandidate {
  /** `frame.locator("body *").nth(index)`. */
  index: number;
  providerScore: number;
  awkitScore?: number;
  proof: DomCandidateProof;
  element?: DiagnosisElement;
}

/** The read-only result of `LocatorFactory.diagnose` (Element Spy / Designer). No page text beyond labels. */
export interface LocatorDiagnosis {
  schemaVersion: 1;
  stepId: string;
  /** A sensitive step never recovers; the diagnosis still shows the proof for the user's own decision. */
  sensitive: boolean;
  identity: "recorded" | "none";
  /** The Recorder page alias the diagnosis read (set by the IPC handler, never a URL). */
  page?: string;
  frame?: "main" | "child";
  /** L11.F: the step's DOM reference against this page's route. A reference from another route is never used. */
  route?: "match" | "mismatch" | "unbound";
  recorded: { status: "resolved" | "ambiguous" | "missing" | "error"; strategy?: string; matches?: number; detail?: string };
  snapshot?: {
    outcome: "proven" | "refused";
    reason?: RecoveryRefusal;
    candidates: number;
    score?: number;
    runnerUpScore?: number;
    ms: number;
    element?: DiagnosisElement;
  };
  provider: {
    outcome: "ok" | "skipped" | "error";
    reason?: "provider-unavailable" | "provider-timeout" | "provider-error" | "no-reference" | "protected-surface" | "snapshot-failed" | "route-mismatch" | "page-variant";
    candidates: DiagnosisCandidate[];
    elements?: number;
    parseMs?: number;
    matchMs?: number;
    ms?: number;
  };
  /** L12.8: look-alikes of the element the saved locator finds now (absent when it finds none). */
  similar?: { outcome: "ok" | "unavailable"; count?: number; ms: number };
  /** L12.17: set when a Super User's opted-in diagnosis read a protected page; the detector's reason code. */
  protectedOverride?: string;
  timings: { totalMs: number };
}

/**
 * `snapshot` (default, L11): each recovery layer is one `evaluateAll`. `legacy`: the pre-L11
 * per-element loops (one round trip per element, 200-element local cap), kept for the old-vs-new
 * benchmark and as a kill switch. Both apply the same decision functions from `recoverySnapshot`.
 */
export type LocatorRecoveryEngine = "snapshot" | "legacy";

export interface LocatorRecoveryEvent {
  type:
    | "preferred-candidate"
    | "local-recovery"
    | "memory-error"
    | "user-approved-fallback"
    | "guarded-positional"
    | "recovery-trace"
    | "reference-refreshed";
  stepId: string;
  message: string;
  score?: number;
  trace?: LocatorRecoveryTrace;
}

export interface LocatorFactoryOptions {
  recoveryStore?: LocatorRecoveryStore;
  blueprintStore?: LocatorBlueprintStore;
  scope?: { scenarioId: string; flowId?: string };
  recoveryGraceMs?: number;
  recoveryEngine?: LocatorRecoveryEngine;
  /**
   * Optional DOM-intelligence provider for NON-EXECUTING repair suggestions after both recovery layers
   * refused. Absent, disabled, failing or slow providers change nothing (plan E4).
   */
  domIntelligence?: DomIntelligenceRecoveryOptions;
  onRecoveryEvent?: (event: LocatorRecoveryEvent) => void;
  /**
   * Called with the scope key of each recovery record successfully written, so the run that wrote it
   * can index it when it finishes (plan §14).
   *
   * This is a notification, not an emitter with subscribers — the caller accumulates into a `Set`, so
   * it costs O(1) per write and adds nothing to the locator resolution path. It exists because a
   * `LocatorRecoveryRecord` carries no run id, making "which records did THIS run write" underivable
   * afterwards without misattributing under concurrent runs.
   */
  onRemembered?: (scopeKey: string) => void;
}

interface RankedCandidate {
  candidate: LocatorCandidate;
  signature: string;
}

interface CandidatePass {
  winner?: { locator: Locator; ranked: RankedCandidate };
  primaryLocator: Locator | null;
  ambiguousPresent: boolean;
  allMissing: boolean;
  diagnostics: CandidateDiagnostic[];
}

interface FingerprintAt {
  index: number;
  fingerprint: LocatorElementFingerprint;
}

interface RecoveredElement {
  locator: Locator;
  fingerprint: LocatorElementFingerprint;
  score: number;
}

export class LocatorFactory {
  constructor(
    private page: Page,
    private readonly options: LocatorFactoryOptions = {}
  ) {}

  /**
   * Where the runner keeps L3 replay-proof tallies for `step` (the same runtime memory and scope key as
   * winner memory). The factory itself never reads `pendingUpgrade`; undefined without a store or scope.
   */
  replayProofMemory(step: FlowStep): { store: LocatorRecoveryStore; scopeKey: string } | undefined {
    const scopeKey = this.scopeKey(step);
    return scopeKey && this.options.recoveryStore ? { store: this.options.recoveryStore, scopeKey } : undefined;
  }

  /** Redirect locator creation to a different page (used by Route Change). */
  setPage(page: Page): void {
    this.page = page;
  }

  /**
   * Build a single Playwright locator from a candidate, rooted at the page (no fallback,
   * no visibility disambiguation). Used where multiple/absent matches are expected —
   * `count` assertions, element loops, and `waitFor`.
   */
  create(locator: FlowStep["locator"]): Locator {
    if (!locator) {
      throw new Error("Locator is required for this step.");
    }
    return this.buildOn(this.page, locator);
  }

  /**
   * Build one diagnostic/live-review candidate through the same frame, shadow-host and container
   * root used by normal replay. It deliberately does not choose a match; callers can count,
   * highlight, or prove uniqueness without inventing a parallel selector implementation.
   */
  async locateCandidate(candidate: LocatorCandidate, context?: LocatorContext): Promise<Locator> {
    if (context?.shadow?.boundary === "open" && candidate.strategy === "xpath") {
      throw new Error("XPath cannot be used for a target inside open Shadow DOM.");
    }
    return this.buildOn(await this.buildRoot(context), candidate);
  }

  /**
   * Resolve a step's locator to a *single* element for an action, with fallback support:
   *  1. Apply container/frame context so candidates resolve inside the right subtree.
   *  2. Try the primary, then `alternatives` in order.
   *  3. For each: a unique match wins; otherwise, if exactly one match is visible, use it
   *     (this is what disambiguates a hidden modal template from the visible modal).
   *  4. If nothing is present yet (all counts 0), return the primary so the caller's action
   *     auto-waits — preserving legacy behavior for elements that appear after a delay.
   *  5. If something is present but genuinely ambiguous, throw a clear diagnostic.
   */
  async resolve(step: FlowStep): Promise<Locator> {
    const spec = step.locator;
    if (!spec) {
      throw new Error("Locator is required for this step.");
    }
    const sideEffectLevel = resolveStepSafety(step).sideEffectLevel;
    const sensitiveAction = sideEffectLevel === "dangerousMutation" || sideEffectLevel === "externalCommit";

    // Guarded-positional identity is re-proven for every captured action; no action trusts index alone.
    if (hasPositionalIdentityGuard(step)) {
      return this.resolveGuardedPositional(step, spec.guard!, sensitiveAction);
    }

    // Instrumented closed shadow: the target lives inside a closed shadow root captured through the
    // runtime bridge. Resolve it via the custom selector engine (a normal, auto-waiting Locator).
    if (isInstrumentedClosedShadow(spec.context)) {
      return this.resolveClosedShadow(step);
    }

    if (spec.context?.shadow?.boundary === "open") {
      const hasXPath = spec.strategy === "xpath" || spec.alternatives?.some((candidate) => candidate.strategy === "xpath");
      if (hasXPath) throw new Error(`Shadow DOM step "${step.name}" cannot use XPath across a shadow boundary.`);
    }

    const root = await this.buildRoot(spec.context);
    const candidates: LocatorCandidate[] = [
      { strategy: spec.strategy, value: spec.value, name: spec.name, exact: spec.exact },
      ...(spec.alternatives ?? [])
    ];
    const ranked = candidates.map((candidate) => ({
      candidate,
      signature: LocatorFactory.candidateSignature(candidate)
    }));
    const scopeKey = this.scopeKey(step);
    const digest = locatorCandidatesDigest(ranked.map(({ signature }) => signature));
    const memory = scopeKey ? await this.readMemory(scopeKey, step.id) : undefined;
    const applicableMemory = memory?.candidatesDigest === digest ? memory : undefined;
    // A positional alternative (nth-child, xpath index) carries no identity proof: after a re-sort it
    // resolves uniquely to another row. Only a guarded or approved primary may act on position.
    const ordered = LocatorFactory.preferRemembered(ranked, applicableMemory?.winningCandidateSignature).filter(
      (item) => item === ranked[0] || !isPositionalCandidate(item.candidate)
    );

    if (ordered[0] !== ranked[0]) {
      this.emit({
        type: "preferred-candidate",
        stepId: step.id,
        message: `Using the last successful recorded locator first for "${step.name}".`
      });
    }

    let pass = await this.tryCandidates(root, ordered);
    if (pass.winner) {
      await this.rememberWinner(scopeKey, digest, pass.winner, step, applicableMemory);
      await this.maybeSeedReference(step, pass.winner.locator, sensitiveAction);

      if (isPositionalLocator(step.locator) && isValidLocatorFallbackApproval(step)) {
        this.emit({
          type: "user-approved-fallback",
          stepId: step.id,
          message: `Using user-approved positional fallback locator (lower resilience) for "${step.name}".`
        });
      }
      
      return pass.winner.locator;
    }

    // Recovery is deliberately unavailable until this exact step/candidate set has succeeded once.
    // The prior success supplies a page-local fingerprint and prevents open-ended guessing.
    if (pass.allMissing && applicableMemory?.fingerprint) {
      const graceMs = Math.max(0, Math.min(this.options.recoveryGraceMs ?? 500, 2_000));
      if (graceMs > 0) {
        await this.page.waitForTimeout(graceMs);
        pass = await this.tryCandidates(root, ordered);
        if (pass.winner) {
          await this.rememberWinner(scopeKey, digest, pass.winner, step, applicableMemory);
          return pass.winner.locator;
        }
      }

      // Sensitive actions may retry their exact recorded candidates after the bounded grace period,
      // but must never select a different element through broad or blueprint-guided recovery.
      if (pass.allMissing && !sensitiveAction) {
        const recovered = await this.recover(root, step, applicableMemory.fingerprint, {
          route: applicableMemory.route,
          twins: applicableMemory.twins,
          candidatesTried: ordered.length
        });
        if (recovered) {
          await this.writeMemory(
            {
              ...applicableMemory,
              fingerprint: recovered.fingerprint,
              source: "local-recovery",
              updatedAt: new Date().toISOString()
            },
            step.id
          );
          this.emit({
            type: "local-recovery",
            stepId: step.id,
            score: recovered.score,
            message:
              `RECOVERED locator for "${step.name}" with local similarity ${recovered.score.toFixed(3)} ` +
              `(all saved candidates missed). Re-record this step to replace the stale locator.`
          });
          return recovered.locator;
        }
      }
    }

    // Nothing matched anything yet: hand back the primary so the action auto-waits (legacy path).
    if (!pass.ambiguousPresent && pass.primaryLocator) return pass.primaryLocator;

    throw new Error(LocatorFactory.formatFailure(step, pass.diagnostics));
  }

  /**
   * L11 on-demand diagnosis for the Element Spy and the Designer (plan E4). READ-ONLY: it counts and
   * fingerprints, never clicks, fills, focuses or rewrites anything, and it never writes winner memory.
   *
   * It reports (1) what the saved locator resolves to now, (2) AWKIT's own snapshot proof against the
   * step's recorded identity, and (3) the provider's candidates, each re-proven by AWKIT with the same
   * competitor set, plus an optional locator suggestion from the Recorder's in-page generator. Applying a
   * suggestion is the user's explicit edit, elsewhere.
   */
  async diagnose(
    step: FlowStep,
    deps: {
      provider?: DomIntelligenceProvider;
      references?: DomReferenceStore;
      expected?: LocatorElementFingerprint;
      /** The `routeKey` the expected identity was proven on (winner memory), when known. */
      expectedRoute?: string;
      /** The saved flow the step belongs to, for a reference stored under its flow-scoped step id. */
      flowId?: string;
      /**
       * L12.17: the caller is an authorized, re-authenticated Super User who opted in for this request. Only an
       * allowed sign-in or MFA surface is then read; every other protected surface stays refused.
       */
      allowProtected?: boolean;
      /**
       * L12.22: told the moment the serializer has read a protected page under that override, before the provider
       * runs, so the read is audited even if anything after it throws.
       */
      onProtectedRead?: (reason: string) => void | Promise<void>;
      describe?: boolean;
    } = {}
  ): Promise<LocatorDiagnosis> {
    const started = performance.now();
    const spec = step.locator;
    if (!spec) throw new Error("Locator is required for this step.");
    const expected = deps.expected;
    const diagnosis: LocatorDiagnosis = {
      schemaVersion: 1,
      stepId: step.id,
      sensitive: LocatorFactory.isSensitive(step),
      identity: expected ? "recorded" : "none",
      recorded: { status: "missing" },
      provider: { outcome: "skipped", candidates: [] },
      timings: { totalMs: 0 }
    };
    let root: LocatorRoot;
    try {
      if (isInstrumentedClosedShadow(spec.context) || hasPositionalIdentityGuard(step)) {
        const locator = await this.resolve(step);
        const matches = await locator.count().catch(() => 0);
        diagnosis.recorded = { status: matches === 1 ? "resolved" : matches === 0 ? "missing" : "ambiguous", strategy: spec.strategy, matches };
        diagnosis.timings.totalMs = performance.now() - started;
        return diagnosis;
      }
      root = await this.buildRoot(spec.context);
    } catch (error) {
      diagnosis.recorded = { status: "error", strategy: spec.strategy, detail: (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200) };
      diagnosis.timings.totalMs = performance.now() - started;
      return diagnosis;
    }
    const ranked = [{ strategy: spec.strategy, value: spec.value, name: spec.name, exact: spec.exact }, ...(spec.alternatives ?? [])]
      .filter((candidate, index) => index === 0 || !isPositionalCandidate(candidate))
      .map((candidate) => ({ candidate, signature: LocatorFactory.candidateSignature(candidate) }));
    const pass = await this.tryCandidates(root, ranked);
    diagnosis.recorded = pass.winner
      ? { status: "resolved", strategy: pass.winner.ranked.candidate.strategy, matches: 1 }
      : { status: pass.ambiguousPresent ? "ambiguous" : "missing", strategy: spec.strategy, matches: Math.max(0, ...pass.diagnostics.map((d) => d.count)) };

    const frame = await this.blueprintFrame(spec.context).catch(() => this.page.mainFrame());
    diagnosis.frame = frame === this.page.mainFrame() ? "main" : "child";
    const describe = async (list: Locator, index: number): Promise<DiagnosisElement | undefined> =>
      deps.describe
        ? ((await list
            .nth(index)
            .evaluate((element) => {
              const describeElement = (window as unknown as Record<symbol, unknown>)[Symbol.for("awkit.recorder.describe")];
              return typeof describeElement === "function" ? (describeElement as (el: Element) => unknown)(element) : null;
            })
            .catch(() => null)) as DiagnosisElement | null) ?? undefined
        : undefined;

    // AWKIT's own proof, exactly as recovery would run it (never for a sensitive step's action, but
    // the diagnosis still shows what the proof says).
    if (expected) {
      const snapshotStarted = performance.now();
      const visible = root.locator("*:visible");
      try {
        const snapshot = await captureLocalSnapshot(visible, expected);
        const decision = snapshot.truncated ? undefined : rankLocalRecovery(step, expected, snapshot.candidates);
        diagnosis.snapshot = {
          outcome: decision?.winner ? "proven" : "refused",
          ...(snapshot.truncated ? { reason: "snapshot-truncated" as const } : decision?.refusal ? { reason: decision.refusal } : {}),
          candidates: decision?.considered ?? snapshot.candidates.length,
          ...(decision?.best ? { score: Number(decision.best.score.toFixed(3)) } : {}),
          ...(decision?.runnerUp ? { runnerUpScore: Number(decision.runnerUp.score.toFixed(3)) } : {}),
          ms: performance.now() - snapshotStarted,
          ...(decision?.winner ? { element: await describe(visible, decision.winner.index) } : {})
        };
      } catch {
        diagnosis.snapshot = { outcome: "refused", reason: "snapshot-failed", candidates: 0, ms: performance.now() - snapshotStarted };
      }
    }

    // The provider's candidates, each re-proven by AWKIT over the frame's competitor set.
    const providerStarted = performance.now();
    const referenceId = domReferenceId(step, deps.flowId ?? this.options.scope?.flowId);
    const reference = referenceId && deps.references ? await deps.references.get(referenceId, stepCandidatesDigest(spec)).catch(() => undefined) : undefined;
    // Either binding on another route makes this page a different route for the step (L11.F).
    const routes = [compareRoutes(deps.expectedRoute, routeKey(frame.url())), compareRoutes(reference?.route, routeKey(frame.url()))];
    diagnosis.route = routes.includes("mismatch") ? "mismatch" : routes.includes("match") ? "match" : "unbound";
    // A protected sign-in, MFA, CAPTCHA, passkey or device-approval surface: no HTML leaves the page, and the
    // Designer offers nothing to apply (it keys on this reason), whatever the provider's state.
    const detection = await detectRecorderProtectedLogin(this.page).catch(() => undefined);
    const protectedPage = Boolean(detection?.detected && detection.recommendedAction === "pause");
    // A password or one-time-code field makes the snapshot refuse the document even when the detector only warns.
    const protectedDocument = (await frame.locator(PROTECTED_LOGIN_SELECTOR).count().catch(() => 0)) > 0;
    // L12.17: a Super User's opted-in diagnosis may read an allowed sign-in or MFA page; a page the detector
    // paused on must name an allowed reason, so a CAPTCHA, security check or blocked-automation page never is
    // (protectedDiagnosisAllowed). The IPC enforces the role and re-authentication.
    // L12.21: the detector and this marker check read the top document, so the override applies only to a step in
    // it. ponytail: a sign-in form inside an iframe gets no override; checking every ancestor frame is the upgrade.
    const challenge = deps.allowProtected === true && (await this.page.locator(CAPTCHA_MARKER_SELECTOR).count().catch(() => 1)) > 0;
    const override =
      (protectedPage || protectedDocument) &&
      deps.allowProtected === true &&
      frame === this.page.mainFrame() &&
      !challenge &&
      (!protectedPage || protectedDiagnosisAllowed(detection?.reason));
    // Reported (and so audited and shown) only once the serializer actually read the page, below.
    const overrideReason = override ? (protectedPage ? detection!.reason : "login-form") : undefined;
    if (protectedPage && !override) diagnosis.provider = { outcome: "skipped", reason: "protected-surface", candidates: [] };
    else if (!deps.provider) diagnosis.provider = { outcome: "skipped", reason: "provider-unavailable", candidates: [] };
    else if (diagnosis.route === "mismatch") diagnosis.provider = { outcome: "skipped", reason: "route-mismatch", candidates: [] };
    else if (!reference) diagnosis.provider = { outcome: "skipped", reason: "no-reference", candidates: [] };
    else if (!(await referenceStructurePresent(frame, reference.element.path))) diagnosis.provider = { outcome: "skipped", reason: "page-variant", candidates: [] };
    else {
      const snapshot = await captureDomSnapshot(frame, { mode: "recover", expected, allowProtectedDocument: override }).catch(() => undefined);
      if (!snapshot) diagnosis.provider = { outcome: "error", reason: "snapshot-failed", candidates: [] };
      else if (snapshot.refused) diagnosis.provider = { outcome: "skipped", reason: "protected-surface", candidates: [] };
      else {
        if (overrideReason) {
          diagnosis.protectedOverride = overrideReason;
          await deps.onProtectedRead?.(overrideReason);
        }
        const result = await deps.provider.findRecoveryCandidates({
          html: snapshot.html,
          reference,
          maxCandidates: 5,
          timeoutMs: DOM_INTELLIGENCE_LIMITS.diagnosisTimeoutMs,
          ...(expected && !snapshot.candidatesTruncated ? { candidateIndices: snapshot.candidates.map((candidate) => candidate.index) } : {})
        });
        if (!result.ok) {
          diagnosis.provider = { outcome: "error", reason: result.code === "TIMEOUT" ? "provider-timeout" : result.code === "UNAVAILABLE" || result.code === "DISABLED" ? "provider-unavailable" : "provider-error", candidates: [] };
        } else {
          const decision = expected && !snapshot.candidatesTruncated ? rankLocalRecovery(step, expected, snapshot.candidates) : undefined;
          const agreement = expected ? decideProviderAgreement(decision, expected.ancestry, result.candidates) : undefined;
          const allElements = frame.locator("body *");
          const candidates: DiagnosisCandidate[] = [];
          for (const candidate of result.candidates) {
            const fingerprint = snapshot.candidates.find((entry) => entry.index === candidate.index)?.fingerprint ?? (await fingerprintAt(frame, candidate.index));
            candidates.push({
              index: candidate.index,
              providerScore: candidate.score,
              ...proveCandidate(step, expected, { index: candidate.index, fingerprint }, decision, agreement),
              ...(await describe(allElements, candidate.index).then((element) => (element ? { element } : {})))
            });
          }
          diagnosis.provider = { outcome: "ok", candidates, elements: result.elements, parseMs: result.parseMs, matchMs: result.matchMs };
        }
      }
    }
    diagnosis.provider.ms = performance.now() - providerStarted;

    // L12.8: how many elements on this page look like the one the saved locator finds now. A step whose element
    // has look-alikes depends on whatever makes it unique; position alone does not survive a re-sort.
    if (pass.winner && deps.provider?.findSimilar && !protectedPage && diagnosis.route !== "mismatch") {
      diagnosis.similar = await LocatorFactory.countSimilar(frame, pass.winner.locator, deps.provider);
    }
    diagnosis.timings.totalMs = performance.now() - started;
    return diagnosis;
  }

  /** L12.8: look-alikes of one resolved element in `frame`, from the provider's `find_similar`. Never throws. */
  private static async countSimilar(frame: Frame, target: Locator, provider: DomIntelligenceProvider): Promise<LocatorDiagnosis["similar"]> {
    const started = performance.now();
    const count = await countLookAlikes(frame, target, provider);
    return count === undefined ? { outcome: "unavailable", ms: performance.now() - started } : { outcome: "ok", count, ms: performance.now() - started };
  }

  /**
   * L11.G: the bounded, redacted context of `page` for the failure analysis, through the DOM-intelligence
   * provider (normalizeDom.ts). Resolves with a refusal when it is switched off, the step is not eligible
   * (decided before anything is read from the page) or there is no provider.
   */
  async capturePageContext(page: Page = this.page, eligible = true): Promise<PageContextResult> {
    const fallback = (await this.options.domIntelligence?.pageContextDefault?.().catch(() => false)) ?? false;
    if (!pageContextEnabled(process.env, fallback)) return { ok: false, reason: "disabled", metrics: { totalMs: 0 } };
    if (!eligible) return { ok: false, reason: "suppressed", metrics: { totalMs: 0 } };
    return capturePageContext(page, this.options.domIntelligence?.provider);
  }

  private static isSensitive(step: FlowStep): boolean {
    const level = resolveStepSafety(step).sideEffectLevel;
    return level === "dangerousMutation" || level === "externalCommit";
  }

  /**
   * How close a re-derived fingerprint must be to a recorded one to count as the same element, when
   * the recorded confidence is not `exact`. Public because L3 §8's repair proof anchors on the SAME
   * definition of identity: a second threshold would let a repair accept an element the guarded path
   * would have refused.
   */
  static readonly GUARD_MATCH_THRESHOLD = 0.9;

  /**
   * Resolve a guarded-positional locator by INDEPENDENTLY re-proving the recorded
   * target identity before the action: resolve the guard container, enumerate the candidate set, verify
   * the count is unchanged, then verify the element at the recorded index still matches the recorded
   * fingerprint and every precondition. Any mismatch throws an identity-changed error. It NEVER
   * falls back to another sibling, repairs the index, or acts on position alone.
   */
  private async resolveGuardedPositional(step: FlowStep, guard: LocatorGuard, sensitiveAction: boolean): Promise<Locator> {
    const context = step.locator?.context;
    const root = await this.buildRoot({
      frame: context?.frame,
      frameChain: context?.frameChain,
      shadow: context?.shadow,
      containers: guard.container
    });
    const fail = (detail: string): Error =>
      new Error(
        `${sensitiveAction ? "SENSITIVE_TARGET_IDENTITY_CHANGED" : "TARGET_IDENTITY_CHANGED"}: refusing the ${sensitiveAction ? "sensitive " : ""}action on "${step.name}" — ${detail}. ` +
          `Re-record the step to confirm the intended target.`
      );
    // One evaluate counts the set, reads the identity at the recorded index and pins that node, so the
    // action lands on the node proven here, never on whatever holds the index later (elementPin).
    const pin = newElementPin();
    guardRead ??= new Function("elements", "arg", GUARD_READ) as GuardRead;
    const read = await root.locator(guard.candidateSelector).evaluateAll(guardRead, { index: guard.index, ...pin }).catch(() => undefined);
    const count = read?.count ?? 0;
    if (count !== guard.siblingCount) throw fail(`the candidate set changed (recorded ${guard.siblingCount}, found ${count})`);
    if (guard.index < 0 || guard.index >= count) throw fail(`recorded position ${guard.index} is out of range (${count} candidates)`);
    const fingerprint = read?.print ? hashFingerprint(read.print) : undefined;
    if (!fingerprint) throw fail("the recorded target could not be re-identified");
    const target = await pinnedLocator(root, pin);
    // "exact" (the recorder's capture confidence) requires the identity-bearing fields to be UNCHANGED —
    // strict equality, so a bare control (empty text/attributes) is not falsely rejected the way a fuzzy
    // score would be. "high" keeps a tolerant similarity threshold.
    const identityOk =
      guard.confidence === "exact"
        ? fingerprintsEqual(fingerprint, guard.fingerprint)
        : similarity(fingerprint, guard.fingerprint) >= LocatorFactory.GUARD_MATCH_THRESHOLD;
    if (!identityOk) {
      throw fail("the element at the recorded position no longer matches the recorded target identity");
    }
    for (const precondition of guard.preconditions ?? []) {
      if (!(await LocatorFactory.checkGuardPrecondition(target, precondition))) {
        throw fail(`precondition "${precondition.kind}" no longer holds`);
      }
    }
    this.emit({
      type: "guarded-positional",
      stepId: step.id,
      message:
        `Verified ${sensitiveAction ? "sensitive " : ""}target identity for "${step.name}" ` +
        `(exact fingerprint match, ${count} candidates, ${(guard.preconditions ?? []).length} precondition(s)).`
    });
    return target;
  }

  /** Re-derive one semantic precondition on the resolved target and compare its hashed value. */
  private static async checkGuardPrecondition(target: Locator, precondition: SemanticPrecondition): Promise<boolean> {
    try {
      if (precondition.kind === "dialogTitle") {
        const raw = await target.evaluate((node) => {
          const dialog = (node as Element).closest('[role="dialog"], [role="alertdialog"], dialog');
          return dialog ? (dialog.getAttribute("aria-label") || dialog.textContent || "") : "";
        });
        return hashToken(String(raw).replace(/\s+/g, " ").trim().slice(0, 80)) === precondition.expected;
      }
      if (precondition.kind === "labelContent") {
        // No named inner functions (esbuild `__name` gotcha). Escape the id for the quoted attribute
        // selector so parity with capture holds even for ids with special characters.
        const raw = await target.evaluate((node) => {
          const el = node as Element;
          let labelText = "";
          const id = el.getAttribute("id");
          if (id) {
            const escaped = id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            const labelled = document.querySelector('label[for="' + escaped + '"]');
            if (labelled) labelText = labelled.textContent || "";
          }
          if (!labelText && el.closest) {
            const wrapping = el.closest("label");
            if (wrapping) labelText = wrapping.textContent || "";
          }
          return labelText;
        });
        return hashToken(String(raw).replace(/\s+/g, " ").trim().slice(0, 80)) === precondition.expected;
      }
    } catch {
      return false;
    }
    // Unknown precondition kinds are conservatively satisfied (forward-compat): the fingerprint and
    // candidate-count checks already gate the action.
    return true;
  }

  private async tryCandidates(root: LocatorRoot, ranked: RankedCandidate[]): Promise<CandidatePass> {
    const diagnostics: CandidateDiagnostic[] = [];
    let ambiguousPresent = false;
    let primaryLocator: Locator | null = null;

    for (const item of ranked) {
      let locator: Locator;
      try {
        locator = this.buildOn(root, item.candidate);
      } catch {
        continue;
      }
      if (!primaryLocator) primaryLocator = locator;
      const single = await LocatorFactory.pickSingle(locator, item.candidate, diagnostics);
      if (single) {
        return {
          winner: { locator: single, ranked: item },
          primaryLocator,
          ambiguousPresent,
          allMissing: false,
          diagnostics
        };
      }
      const last = diagnostics[diagnostics.length - 1];
      if (last && last.count > 1) ambiguousPresent = true;
    }

    return {
      primaryLocator,
      ambiguousPresent,
      allMissing: diagnostics.length > 0 && diagnostics.every(({ count }) => count === 0),
      diagnostics
    };
  }

  /** Reference bindings already known present (or just written) in this process: `${referenceId}:${digest}`. */
  private static readonly seededReferences = new Set<string>();

  /**
   * L11 reference refresh (plan E7), deliberately conservative: only with a DOM-intelligence store, only
   * for a non-sensitive step with a blueprint id, only when the RECORDED locator itself matched exactly
   * one element (never from a recovery), and only when no reference is bound to the step's current
   * candidates. Memoized per process, so a step's later successes pay nothing.
   */
  private async maybeSeedReference(step: FlowStep, locator: Locator, sensitiveAction: boolean): Promise<void> {
    const references = this.options.domIntelligence?.references;
    const referenceId = domReferenceId(step, this.options.scope?.flowId);
    if (!references || !referenceId || sensitiveAction || !step.locator) return;
    const bindingDigest = stepCandidatesDigest(step.locator);
    const key = `${referenceId}:${bindingDigest}`;
    if (LocatorFactory.seededReferences.has(key)) return;
    LocatorFactory.seededReferences.add(key);
    try {
      if (await references.get(referenceId, bindingDigest)) return;
      if ((await locator.count()) !== 1) return;
      referenceCapture ??= new Function(
        "element",
        `return { reference: (${DOM_REFERENCE_CAPTURE_SOURCE})(element), url: String(element.ownerDocument.location.href) };`
      ) as (element: Element) => { reference: unknown; url: string };
      const captured = await locator.evaluate(referenceCapture);
      // Bound to the route of the document the element lives in, like the Recorder's own capture.
      const reference = buildDomReference(captured.reference, { referenceId, bindingDigest, source: "runtime-refresh", route: routeKey(captured.url) });
      if (reference) {
        await references.put(reference);
        this.emit({ type: "reference-refreshed", stepId: step.id, message: `Refreshed the DOM-intelligence reference for "${step.name}" from its recorded locator.` });
      }
    } catch {
      // Best-effort: a missing reference only means no repair suggestion for this step.
    }
  }

  private async rememberWinner(
    scopeKey: string | undefined,
    candidatesDigest: string,
    winner: { locator: Locator; ranked: RankedCandidate },
    step: FlowStep,
    previous?: LocatorRecoveryRecord
  ): Promise<void> {
    if (!scopeKey || !this.options.recoveryStore) return;
    const fingerprint = await LocatorFactory.fingerprintOne(winner.locator);
    if (!fingerprint) {
      this.emit({
        type: "memory-error",
        stepId: step.id,
        message: `Could not fingerprint the resolved element for "${step.name}"; winner memory was saved without local recovery data.`
      });
    }
    // L12.23: the look-alikes are scanned once, when this identity is first remembered; an unchanged winner
    // keeps the twins already recorded, so a normal step pays no extra page walk.
    const twins = !fingerprint
      ? undefined
      : previous?.twins && previous.fingerprint && sameElementFingerprint(previous.fingerprint, fingerprint)
        ? previous.twins
        : await this.captureTwins(step, fingerprint);
    await this.writeMemory(
      {
        version: 1,
        scopeKey,
        candidatesDigest,
        winningCandidateSignature: winner.ranked.signature,
        fingerprint,
        ...(twins ? { twins } : {}),
        route: await this.stepRoute(step),
        source: "recorded-candidate",
        updatedAt: new Date().toISOString()
      },
      step.id
    );
  }

  /**
   * Recovery after every recorded candidate missed (and the grace retry): local layer, then blueprint
   * layer, each proven by the shared gate; then, only if both refused, a NON-EXECUTING provider
   * suggestion. Emits one bounded `recovery-trace` event per attempt.
   */
  private async recover(
    root: LocatorRoot,
    step: FlowStep,
    expected: LocatorElementFingerprint,
    memory: { route?: string; twins?: LocatorElementFingerprint[]; candidatesTried: number }
  ): Promise<RecoveredElement | undefined> {
    const engine: LocatorRecoveryEngine = this.options.recoveryEngine ?? "snapshot";
    const started = performance.now();
    const stages: LocatorRecoveryStage[] = [];
    const frameDepth = step.locator?.context?.frameChain?.length ?? (step.locator?.context?.frame?.selector ? 1 : 0);
    const context: LocatorRecoveryContext = {
      page: step.pageAlias || "main",
      frame: frameDepth > 0 ? "child" : "main",
      frameDepth,
      route: compareRoutes(memory.route, await this.stepRoute(step))
    };
    let recovered: RecoveredElement | undefined;
    let suggestion: DomRepairSuggestion | undefined;
    let container: ElementHandle | undefined;
    try {
      // The remembered identity was proven on another route: a similar control here is not that element,
      // and no layer (local, blueprint or provider) may look for one (L11.F).
      if (context.route === "unbound") context.route = await this.referenceRoute(step);
      if (context.route === "mismatch") {
        stages.push({ stage: "local", outcome: "refused", reason: "route-mismatch", ms: performance.now() - started });
        return undefined;
      }
      // L12.23: no layer may act on a look-alike that stood beside the target when it was remembered.
      const distinct = (found: RecoveredElement | undefined): RecoveredElement | undefined => {
        if (!found || !isPreExistingTwin(memory.twins, found.fingerprint)) return found;
        const stage = stages[stages.length - 1];
        if (stage) Object.assign(stage, { outcome: "refused", reason: "pre-existing-twin" });
        return undefined;
      };
      recovered = await this.requireActionable(
        step,
        distinct(engine === "legacy" ? await this.recoverLocallyLegacy(root, step, expected, stages) : await this.recoverLocallySnapshot(root, step, expected, stages)),
        stages
      );
      // L12.24: the local layer already searches inside the step's container; the later layers read the whole
      // frame, so a proven container scopes the blueprint window and vetoes an agreed winner outside it.
      container = recovered ? undefined : await this.provenContainer(step, root);
      recovered ??= await this.requireActionable(step, distinct(await this.recoverFromBlueprint(step, engine, stages, container)), stages);
      if (!recovered && this.options.domIntelligence) {
        const stageStarted = performance.now();
        const outcome = await suggestRepair({
          page: this.page,
          frame: await this.blueprintFrame(step.locator?.context).catch(() => this.page.mainFrame()),
          step,
          expected,
          referenceId: domReferenceId(step, this.options.scope?.flowId),
          options: this.options.domIntelligence
        }).catch(() => ({ stage: { outcome: "error" as const, reason: "provider-error" as const } }));
        stages.push({ stage: "provider", ms: performance.now() - stageStarted, ...outcome.stage });
        suggestion = "suggestion" in outcome ? outcome.suggestion : undefined;
        // L12: AWKIT's best candidate the provider independently ranked first, already re-proven and pinned.
        if ("agreed" in outcome && outcome.agreed) recovered = await this.requireActionable(step, distinct(await this.insideContainer(outcome.agreed, container, stages)), stages);
      }
      return recovered;
    } finally {
      await container?.dispose().catch(() => undefined);
      this.emitTrace(step, {
        engine,
        result: recovered ? "recovered" : "unresolved",
        totalMs: performance.now() - started,
        stages,
        suggestion,
        context,
        candidatesTried: memory.candidatesTried
      });
    }
  }

  /**
   * L12.24: the element the step's recorded container chain resolves to now, when it resolves to exactly one.
   * Undefined without a container in the step's context, or when it is missing or ambiguous: the later layers
   * then search the whole frame, as before.
   */
  private async provenContainer(step: FlowStep, root: LocatorRoot): Promise<ElementHandle | undefined> {
    if (!locatorContainerChain(step.locator?.context).length) return undefined;
    const scope = root as unknown as Locator;
    if ((await scope.count().catch(() => 0)) !== 1) return undefined;
    return (await scope.elementHandle({ timeout: 1_000 }).catch(() => null)) ?? undefined;
  }

  /** L12.24: refuse a whole-frame layer's winner that lies outside the step's proven container. */
  private async insideContainer(found: RecoveredElement, container: ElementHandle | undefined, stages: LocatorRecoveryStage[]): Promise<RecoveredElement | undefined> {
    if (!container || (await found.locator.evaluate((element, scope) => (scope as Node).contains(element), container).catch(() => false))) return found;
    const stage = stages[stages.length - 1];
    if (stage) Object.assign(stage, { outcome: "refused", reason: "outside-container" });
    return undefined;
  }

  /**
   * L12.23: the distinguishable look-alikes of a just-proven winner in its whole document (not only its
   * container: a twin outside it is what a document-wide layer would pick). Undefined when the page is too
   * large to scan or cannot be read, so nothing is vetoed rather than a partial list trusted.
   */
  private async captureTwins(step: FlowStep, fingerprint: LocatorElementFingerprint): Promise<LocatorElementFingerprint[] | undefined> {
    try {
      const frame = await this.blueprintFrame(step.locator?.context);
      const snapshot = await captureLocalSnapshot(frame.locator("body *"), fingerprint);
      return snapshot.truncated ? undefined : preExistingTwins(fingerprint, snapshot.candidates);
    } catch {
      return undefined;
    }
  }

  /** The route of the document the step's element lives in: its frame's for a frame step, else the page's. */
  private async stepRoute(step: FlowStep): Promise<string | undefined> {
    const frame = await this.blueprintFrame(step.locator?.context).catch(() => this.page.mainFrame());
    return routeKey(frame.url());
  }

  /**
   * The route binding when winner memory has none (a record written before routes were kept): the step's
   * DOM reference, captured on its own document, against that document's current route. `unbound` when
   * there is no routed reference either.
   */
  private async referenceRoute(step: FlowStep): Promise<LocatorRecoveryContext["route"]> {
    const references = this.options.domIntelligence?.references;
    const referenceId = domReferenceId(step, this.options.scope?.flowId);
    if (!references || !referenceId || !step.locator) return "unbound";
    try {
      const reference = await references.get(referenceId, stepCandidatesDigest(step.locator));
      if (!reference?.route) return "unbound";
      return compareRoutes(reference.route, routeKey((await this.blueprintFrame(step.locator.context)).url()));
    } catch {
      return "unbound";
    }
  }

  /** Steps whose Playwright action needs an enabled element (click, fill, check and select auto-wait for it). */
  private static readonly ENABLED_ACTIONS: ReadonlySet<string> = new Set(["click", "dblclick", "contextMenu", "clickAndHold", "fill", "select", "check", "uncheck", "radio"]);

  /**
   * L11.F: a recovered element must be able to take the step's action NOW. A disabled look-alike (a
   * loading skeleton with the target's name) can score as the target, and an action on it would wait on
   * that pinned node until the page replaced it, then fail. Such a winner refuses its layer
   * (`not-actionable`), so the step falls back to its recorded locator's own auto-wait.
   */
  private async requireActionable(step: FlowStep, recovered: RecoveredElement | undefined, stages: LocatorRecoveryStage[]): Promise<RecoveredElement | undefined> {
    if (!recovered || !LocatorFactory.ENABLED_ACTIONS.has(step.type)) return recovered;
    if (await recovered.locator.isEnabled().catch(() => false)) return recovered;
    const stage = stages[stages.length - 1];
    if (stage) Object.assign(stage, { outcome: "refused", reason: "not-actionable" });
    return undefined;
  }

  /** L11 local layer: one `evaluateAll` over the root's visible elements, pruned exactly, then the gate. */
  private async recoverLocallySnapshot(
    root: LocatorRoot,
    step: FlowStep,
    expected: LocatorElementFingerprint,
    stages: LocatorRecoveryStage[]
  ): Promise<RecoveredElement | undefined> {
    const started = performance.now();
    const visible = root.locator("*:visible");
    let decision: RecoveryDecision;
    try {
      const snapshot = await captureLocalSnapshot(visible, expected);
      if (snapshot.truncated) {
        stages.push({ stage: "local", outcome: "refused", reason: "snapshot-truncated", ms: performance.now() - started, candidates: snapshot.candidates.length });
        return undefined;
      }
      decision = rankLocalRecovery(step, expected, snapshot.candidates);
    } catch {
      stages.push({ stage: "local", outcome: "error", reason: "snapshot-failed", ms: performance.now() - started });
      return undefined;
    }
    return this.proveSnapshotWinner(visible, root, decision, "local", started, stages, expected);
  }

  /**
   * Pre-L11 local layer, kept for the benchmark and as a kill switch: one round trip per element. Its
   * winner goes through the same proof and pin as the snapshot's (its slow scan is where the page moves).
   */
  private async recoverLocallyLegacy(
    root: LocatorRoot,
    step: FlowStep,
    expected: LocatorElementFingerprint,
    stages: LocatorRecoveryStage[]
  ): Promise<RecoveredElement | undefined> {
    const started = performance.now();
    const visible = root.locator("*:visible");
    const decision = rankLocalRecovery(step, expected, await LocatorFactory.fingerprintMany(visible, RECOVERY_SCAN_CAP));
    return this.proveSnapshotWinner(visible, root, decision, "local", started, stages, expected);
  }

  /**
   * A layer names its winner by index; the page may have changed since. The element now at that index
   * must still carry the winner's identity and ancestry, or the layer refuses (fail closed). The proven
   * node is pinned by the same evaluate, and the step acts on that node only, never on the index.
   */
  private async proveSnapshotWinner(
    list: Locator,
    scope: { locator(selector: string): Locator },
    decision: RecoveryDecision,
    stage: "local" | "blueprint",
    started: number,
    stages: LocatorRecoveryStage[],
    expected?: LocatorElementFingerprint
  ): Promise<RecoveredElement | undefined> {
    if (!decision.winner) {
      LocatorFactory.recordStage(stages, stage, decision, started);
      // L12.16: what changed between the recorded element and the closest one, for the report (codes only).
      if (expected && decision.best) stages[stages.length - 1].changed = fingerprintChanges(expected, decision.best.fingerprint);
      return undefined;
    }
    const locator = await recheckSnapshotWinner(list, scope, decision.winner).catch(() => undefined);
    if (!locator) {
      stages.push({ stage, outcome: "refused", reason: "stale-snapshot", ms: performance.now() - started, candidates: decision.considered, score: decision.winner.score });
      return undefined;
    }
    LocatorFactory.recordStage(stages, stage, decision, started);
    return { locator, fingerprint: decision.winner.fingerprint, score: decision.winner.score };
  }

  private static recordStage(stages: LocatorRecoveryStage[], stage: "local" | "blueprint", decision: RecoveryDecision, started: number): void {
    stages.push({
      stage,
      outcome: decision.winner ? "proven" : "refused",
      ...(decision.refusal ? { reason: decision.refusal } : {}),
      ms: performance.now() - started,
      candidates: decision.considered,
      ...(decision.best ? { score: Number(decision.best.score.toFixed(3)) } : {}),
      ...(decision.runnerUp ? { runnerUpScore: Number(decision.runnerUp.score.toFixed(3)) } : {})
    });
  }

  private emitTrace(step: FlowStep, trace: LocatorRecoveryTrace): void {
    const summary = trace.stages
      .map(
        (stage) =>
          `${stage.stage}=${stage.outcome}${stage.reason ? `(${stage.reason})` : ""} ${stage.ms.toFixed(0)}ms` +
          // L12.16: the closest element the layer refused, and what differs from the recorded one (codes only).
          (stage.changed && stage.score !== undefined ? ` [closest ${stage.score.toFixed(2)}, differs in ${stage.changed.length ? stage.changed.join(" ") : "nothing recorded"}]` : "")
      )
      .join(", ");
    this.emit({
      type: "recovery-trace",
      stepId: step.id,
      message: `Locator recovery for "${step.name}" ${trace.result} in ${trace.totalMs.toFixed(0)} ms [${trace.engine}]: ${summary}.`,
      trace
    });
  }

  /**
   * Second recovery layer: inspect a small document-order neighborhood around the captured element
   * only after the broad visible-element scan could not identify a unique match. Identity still comes
   * from the shared fingerprint scorer; sibling/tag/viewport position contribute at most 0.03 total.
   * With a proven `container` (L12.24) only the window's elements inside it are candidates.
   */
  private async recoverFromBlueprint(step: FlowStep, engine: LocatorRecoveryEngine, stages: LocatorRecoveryStage[], container?: ElementHandle): Promise<RecoveredElement | undefined> {
    const started = performance.now();
    const skipped = (reason: LocatorRecoveryStage["reason"]): undefined => {
      stages.push({ stage: "blueprint", outcome: "skipped", reason, ms: performance.now() - started });
      return undefined;
    };
    const blueprintId = step.locator?.blueprintId;
    if (!blueprintId || !this.options.blueprintStore) return skipped("no-blueprint");

    try {
      const frame = await this.blueprintFrame(step.locator?.context);
      const frameKey = computeFrameKey(step.locator?.context?.frameChain);
      const pageKey = computePageKey(frame.url(), await frame.title().catch(() => ""), frameKey);
      const pageBlueprint = await this.options.blueprintStore.get(pageKey);
      if (!pageBlueprint || pageBlueprint.frameKey !== (frameKey || undefined)) return skipped("blueprint-unavailable");
      const elementBlueprint = pageBlueprint.elements.find((element) => element.blueprintId === blueprintId);
      if (!elementBlueprint) return skipped("blueprint-unavailable");
      const allElements = frame.locator("body *");

      if (engine === "snapshot") {
        const snapshot = await captureBlueprintSnapshot(allElements, elementBlueprint, container);
        if (!documentFingerprintMatches(pageBlueprint.documentFingerprint, snapshot.documentFingerprint)) {
          stages.push({ stage: "blueprint", outcome: "refused", reason: "page-variant", ms: performance.now() - started });
          return undefined;
        }
        return this.proveSnapshotWinner(allElements, frame, decideBlueprintRecovery(step, elementBlueprint, snapshot.window), "blueprint", started, stages);
      }

      const currentDocumentFingerprint = await LocatorFactory.documentFingerprint(frame);
      if (!documentFingerprintMatches(pageBlueprint.documentFingerprint, currentDocumentFingerprint)) {
        stages.push({ stage: "blueprint", outcome: "refused", reason: "page-variant", ms: performance.now() - started });
        return undefined;
      }
      const decision = await LocatorFactory.legacyBlueprintDecision(step, allElements, elementBlueprint, container);
      return this.proveSnapshotWinner(allElements, frame, decision, "blueprint", started, stages);
    } catch {
      // Blueprint storage/page probing is additive and fail-safe: normal unresolved behavior wins.
      stages.push({ stage: "blueprint", outcome: "error", reason: "snapshot-failed", ms: performance.now() - started });
      return undefined;
    }
  }

  /** Pre-L11 blueprint window: up to three round trips per element, the same gate as the snapshot. */
  private static async legacyBlueprintDecision(step: FlowStep, allElements: Locator, blueprint: ElementBlueprint, container?: ElementHandle): Promise<RecoveryDecision> {
    const count = await allElements.count().catch(() => 0);
    const start = Math.max(0, blueprint.documentOrder - BLUEPRINT_NEIGHBORHOOD_RADIUS);
    const end = Math.min(count - 1, blueprint.documentOrder + BLUEPRINT_NEIGHBORHOOD_RADIUS);
    const ranked: ScoredCandidate[] = [];
    let considered = 0;
    for (let index = start; index <= end; index += 1) {
      const locator = allElements.nth(index);
      if (container && !(await locator.evaluate((element, scope) => (scope as Node).contains(element), container).catch(() => false))) continue;
      if (!(await locator.isVisible().catch(() => false))) continue;
      const fingerprint = await LocatorFactory.fingerprintOne(locator);
      if (!fingerprint || !isRecoveryCompatible(step, fingerprint)) continue;
      considered += 1;
      const identityScore = similarity(blueprint.fingerprint, fingerprint);
      if (identityScore < RECOVERY_SCORE_THRESHOLD) continue;
      const positionScore = await LocatorFactory.legacyBlueprintPositionScore(locator, index, blueprint);
      ranked.push({ index, fingerprint, score: Math.min(1, identityScore + positionScore * BLUEPRINT_POSITION_BONUS) });
    }
    ranked.sort((left, right) => right.score - left.score);
    return gateRecovery(ranked, blueprint.fingerprint.ancestry, considered);
  }

  private static async legacyBlueprintPositionScore(locator: Locator, documentOrder: number, blueprint: ElementBlueprint): Promise<number> {
    try {
      const evidence = await locator.evaluate((node) => {
        const element = node as Element;
        const siblings = element.parentElement ? Array.from(element.parentElement.children) : [];
        const siblingIndex = siblings.indexOf(element);
        const sameTagIndex = siblings.filter((sibling) => sibling.tagName === element.tagName).indexOf(element);
        const rect = element.getBoundingClientRect();
        return {
          siblingIndex,
          sameTagIndex,
          boundingRegion: {
            relativeX: window.innerWidth ? rect.x / window.innerWidth : 0,
            relativeY: window.innerHeight ? rect.y / window.innerHeight : 0,
            relativeWidth: window.innerWidth ? rect.width / window.innerWidth : 0,
            relativeHeight: window.innerHeight ? rect.height / window.innerHeight : 0
          }
        };
      });
      return blueprintPositionScore({ index: documentOrder, ...evidence }, blueprint);
    } catch {
      return 0;
    }
  }

  private async blueprintFrame(context?: LocatorContext): Promise<Frame> {
    if (context?.frameChain?.length) return this.resolveFrameChain(context.frameChain);
    if (context?.frame?.selector) return this.resolveFrameChain([{ selector: context.frame.selector }]);
    return this.page.mainFrame();
  }

  private static async documentFingerprint(frame: Frame): Promise<string> {
    return frame
      .evaluate(() => {
        const all = document.body ? document.body.querySelectorAll("*") : [];
        const histogram = new Map<string, number>();
        for (let index = 0; index < all.length && index < 5000; index += 1) {
          const tag = all[index].tagName.toLowerCase();
          const role = all[index].getAttribute("role");
          const key = role ? `${tag}:${role}` : tag;
          histogram.set(key, (histogram.get(key) ?? 0) + 1);
        }
        const sorted: string[] = [];
        histogram.forEach((count, key) => sorted.push(`${key}=${count}`));
        return sorted.sort().join("|");
      })
      .catch(() => "");
  }

  private scopeKey(step: FlowStep): string | undefined {
    const scope = this.options.scope;
    return scope ? `${scope.scenarioId}\u0000${scope.flowId ?? ""}\u0000${step.id}` : undefined;
  }

  private async readMemory(scopeKey: string, stepId: string): Promise<LocatorRecoveryRecord | undefined> {
    try {
      return await this.options.recoveryStore?.get(scopeKey);
    } catch (error) {
      this.emit({ type: "memory-error", stepId, message: `Locator memory read failed: ${String(error)}` });
      return undefined;
    }
  }

  private async writeMemory(record: LocatorRecoveryRecord, stepId: string): Promise<void> {
    try {
      await this.options.recoveryStore?.put(record);
      // Only after the write SUCCEEDED. Reporting a key whose record was never stored would have the
      // run ask the index to project something that does not exist.
      this.options.onRemembered?.(record.scopeKey);
    } catch (error) {
      this.emit({ type: "memory-error", stepId, message: `Locator memory write failed: ${String(error)}` });
    }
  }

  private emit(event: LocatorRecoveryEvent): void {
    this.options.onRecoveryEvent?.(event);
  }

  private static candidateSignature(candidate: LocatorCandidate): string {
    return locatorCandidateSignature(candidate);
  }

  private static preferRemembered(ranked: RankedCandidate[], signature?: string): RankedCandidate[] {
    if (!signature) return ranked;
    const index = ranked.findIndex((item) => item.signature === signature);
    return index > 0 ? [ranked[index], ...ranked.slice(0, index), ...ranked.slice(index + 1)] : ranked;
  }

  /**
   * The one way an element's identity is read. Public so L3 §8's repair proof re-derives identity
   * through exactly this pipeline (page fingerprint, then `hashFingerprint`) rather than a second
   * copy that could drift from what `resolveGuardedPositional` and `recoverLocally` compare against.
   */
  static async fingerprintOne(locator: Locator): Promise<LocatorElementFingerprint | undefined> {
    try {
      return hashFingerprint(await locator.evaluate(createPageFingerprint));
    } catch {
      return undefined;
    }
  }

  private static async fingerprintMany(locator: Locator, cap: number): Promise<FingerprintAt[]> {
    const result: FingerprintAt[] = [];
    const count = Math.min(await locator.count().catch(() => 0), cap);
    for (let index = 0; index < count; index += 1) {
      const fingerprint = await LocatorFactory.fingerprintOne(locator.nth(index));
      if (fingerprint) result.push({ index, fingerprint });
    }
    return result;
  }

  /** Build a scoped root from frame/shadow/container context, resolving each segment strictly. */
  private async buildRoot(context?: LocatorContext): Promise<LocatorRoot> {
    let root: LocatorRoot = await this.frameRoot(context);

    const shadow = context?.shadow;
    // An instrumented closed shadow is resolved by the custom engine in `resolveClosedShadow`, not here.
    if ((shadow?.boundary === "closed" || shadow?.boundary === "unknown") && !isInstrumentedClosedShadow(context)) {
      throw new Error(`This locator cannot execute because its ${shadow.boundary} shadow boundary requires review.`);
    }
    if (shadow?.boundary === "open") {
      if (!shadow.hosts?.length) throw new Error("Open Shadow DOM locator context is missing its host chain.");
      for (let index = 0; index < shadow.hosts.length; index += 1) {
        root = await this.resolveShadowHost(root, shadow.hosts[index], index);
      }
    }

    const containers = locatorContainerChain(context);
    if (containers.length > MAX_LOCATOR_CONTAINER_CHAIN) {
      throw new Error(`Locator container chain exceeds the supported ${MAX_LOCATOR_CONTAINER_CHAIN}-segment bound.`);
    }
    for (let index = 0; index < containers.length; index += 1) {
      const container = containers[index];
      let containerLocator = this.buildOn(root, container);
      if (container.hasText) containerLocator = containerLocator.filter({ hasText: container.hasText });
      const diagnostics: CandidateDiagnostic[] = [];
      const single = await LocatorFactory.pickSingle(containerLocator, container, diagnostics);
      if (single) {
        root = single as unknown as LocatorRoot;
      } else if (diagnostics.every(({ count }) => count === 0)) {
        // A not-yet-present container may still appear during the action's normal auto-wait window.
        root = containerLocator.first() as unknown as LocatorRoot;
      } else {
        const detail = diagnostics.map((d) => `${d.strategy}: ${d.count} match(es)`).join(", ");
        throw new Error(`Locator container chain segment ${index + 1} did not resolve strictly (${detail}).`);
      }
    }

    return root;
  }

  /** Resolve just the frame scope (frame chain / legacy frame / page) as a root, without shadow/container. */
  private async frameRoot(context?: LocatorContext): Promise<LocatorRoot> {
    if (context?.frameChain?.length) return (await this.resolveFrameChain(context.frameChain)) as unknown as LocatorRoot;
    if (context?.frame?.selector) return this.page.frameLocator(context.frame.selector) as unknown as LocatorRoot;
    return this.page;
  }

  /**
   * Resolve an instrumented closed-shadow target via the custom selector engine — a normal auto-waiting
   * Locator, so the caller acts on it like any other. The engine walks the recorded host chain (open
   * roots via `host.shadowRoot`, closed roots via the bridge's retained reference) inside the frame root.
   */
  private async resolveClosedShadow(step: FlowStep): Promise<Locator> {
    await registerClosedShadowEngine();
    const selector = encodeClosedShadowSelector(step.locator?.context);
    if (!selector) {
      throw new Error(`Closed-shadow step "${step.name}" is missing its host chain or target signature. Re-record it.`);
    }
    const root = await this.frameRoot(step.locator?.context);
    const locator = root.locator(selector);

    // Give the pre-navigation bridge and the DOM a real chance to make the target resolvable before
    // deciding it is unreachable. This keeps the CDP fallback OFF for the normal case (a root the bridge
    // instrumented) and for merely not-yet-attached timing; only a genuinely unresolvable closed root —
    // one created before instrumentation could observe it — triggers the Chromium-only fallback below.
    await locator.first().waitFor({ state: "attached", timeout: CLOSED_SHADOW_FALLBACK_GRACE_MS }).catch(() => undefined);
    if ((await locator.count().catch(() => 0)) === 0) {
      await this.attemptCdpFallback(step.locator?.context, selector).catch(() => undefined);
    }
    return locator;
  }

  /**
   * Fallback for pre-instrumentation closed roots: uses CDP to find closed shadow roots
   * and registers them with the runtime bridge so the custom selector engine can find them.
   */
  private async attemptCdpFallback(context: LocatorContext | undefined, selector: string): Promise<void> {
    const shadow = context?.shadow;
    if (!shadow || shadow.boundary !== "closed" || !shadow.instrumented) return;

    const cdp = await this.page.context().newCDPSession(this.page).catch(() => null);
    if (!cdp) return;

    try {
      const { root } = await cdp.send("DOM.getDocument", { pierce: true, depth: -1 });
      const closedRoots: Array<{ hostId: number, rootId: number }> = [];
      const walk = (node: any) => {
        if (closedRoots.length >= MAX_CDP_CLOSED_ROOTS) return;
        if (node.shadowRoots) {
          for (const sr of node.shadowRoots) {
            if (sr.shadowRootType === "closed") {
              closedRoots.push({ hostId: node.backendNodeId, rootId: sr.backendNodeId });
            }
            walk(sr);
          }
        }
        if (node.children) {
          for (const child of node.children) walk(child);
        }
      };
      walk(root);

      if (closedRoots.length > 0) {
        const specStr = selector.substring(selector.indexOf("=") + 1);
        const spec = JSON.parse(specStr);
        const token = spec.token;

        for (const { hostId, rootId } of closedRoots) {
          const hostObj = await cdp.send("DOM.resolveNode", { backendNodeId: hostId }).catch(() => null);
          const rootObj = await cdp.send("DOM.resolveNode", { backendNodeId: rootId }).catch(() => null);

          if (hostObj?.object?.objectId && rootObj?.object?.objectId) {
            await cdp.send("Runtime.callFunctionOn", {
              functionDeclaration: `function(token, shadowRoot) {
                var fn = window[Symbol.for("awtkit-cs-fn-" + token)];
                if (typeof fn === "function") fn(token, this, shadowRoot);
              }`,
              objectId: hostObj.object.objectId,
              arguments: [
                { value: token },
                { objectId: rootObj.object.objectId }
              ]
            }).catch(() => null);
          }
        }
      }
    } catch {
      // Ignore CDP errors — the normal timeout will handle resolution failure
    } finally {
      await cdp.detach().catch(() => {});
    }
  }

  /**
   * Resolve an ordered outer→inner iframe chain through Playwright's Frame graph. Each segment is
   * resolved in its PARENT frame (never by scripting the child document): a unique selector match wins;
   * an ambiguous match is disambiguated by the recorded index or by the iframe element's identity; the
   * resolved frame's identity is then re-verified. Any failure throws `FRAME_IDENTITY_CHANGED` and never
   * silently enters a sibling frame. Returns the innermost Frame as the scoped root for the target.
   */
  private async resolveFrameChain(chain: LocatorFrameContext[]): Promise<Frame> {
    if (chain.length > MAX_FRAME_CHAIN) {
      throw new Error(`Locator frame chain exceeds the supported ${MAX_FRAME_CHAIN}-segment bound.`);
    }
    let frame: Frame = this.page.mainFrame();
    for (let index = 0; index < chain.length; index += 1) {
      const seg = chain[index];
      const fail = (why: string): Error =>
        new Error(
          `FRAME_IDENTITY_CHANGED: iframe segment ${index + 1} (${seg.selector}) ${why}. ` +
            `Refusing to enter a sibling frame — re-record the step.`
        );
      const iframes = frame.locator(seg.selector);
      let count = await iframes.count().catch(() => 0);
      if (count === 0) {
        await iframes.first().waitFor({ state: "attached", timeout: FRAME_WAIT_MS }).catch(() => undefined);
        count = await iframes.count().catch(() => 0);
      }
      if (count === 0) throw fail("was not found");

      let handle: ElementHandle<Element> | null = null;
      if (count === 1) {
        handle = await iframes.elementHandle();
      } else if (typeof seg.index === "number" && seg.index < count) {
        handle = await iframes.nth(seg.index).elementHandle();
      } else {
        handle = await this.matchFrameByIdentity(iframes, count, seg);
      }
      if (!handle) throw fail("could not be uniquely identified");

      try {
        const child = await handle.contentFrame();
        if (!child) throw fail("is not an iframe");
        if (!(await LocatorFactory.frameIdentityMatches(handle, seg))) throw fail("identity no longer matches");
        frame = child;
      } finally {
        await handle.dispose().catch(() => undefined);
      }
    }
    return frame;
  }

  /** Among several `selector` matches, return the single one whose identity matches `seg`, else null. */
  private async matchFrameByIdentity(iframes: Locator, count: number, seg: LocatorFrameContext): Promise<ElementHandle<Element> | null> {
    if (!seg.name && !seg.title && !seg.url) return null; // nothing to disambiguate on
    let match: ElementHandle<Element> | null = null;
    for (let i = 0; i < Math.min(count, 20); i += 1) {
      const handle = await iframes.nth(i).elementHandle().catch(() => null);
      if (!handle) continue;
      if (await LocatorFactory.frameIdentityMatches(handle, seg)) {
        if (match) {
          await handle.dispose().catch(() => undefined);
          await match.dispose().catch(() => undefined);
          return null; // two frames share the recorded identity — refuse to guess
        }
        match = handle;
      } else {
        await handle.dispose().catch(() => undefined);
      }
    }
    return match;
  }

  /**
   * Verify the iframe ELEMENT's recorded identity from the PARENT side (stable across the child frame's
   * own navigation). `name`/`title` are authoritative when recorded; `url` (resolved src origin+pathname)
   * is a fallback identity used only when neither is present.
   */
  private static async frameIdentityMatches(handle: ElementHandle<Element>, seg: LocatorFrameContext): Promise<boolean> {
    if (!seg.name && !seg.title && !seg.url) return true;
    const current = await handle
      .evaluate((el) => {
        const iframe = el as HTMLIFrameElement;
        let url: string | undefined;
        try {
          const parsed = new URL(iframe.src);
          url = parsed.origin === "null" ? undefined : parsed.origin + parsed.pathname;
        } catch {
          url = undefined;
        }
        return { name: iframe.getAttribute("name") || undefined, title: iframe.getAttribute("title") || undefined, url };
      })
      .catch(() => null);
    if (!current) return false;
    if (seg.name || seg.title) {
      if (seg.name && current.name !== seg.name) return false;
      if (seg.title && current.title !== seg.title) return false;
      return true;
    }
    return !seg.url || current.url === seg.url;
  }

  /** Resolve one host strictly, then use it as the root for the next host or final target. */
  private async resolveShadowHost(root: LocatorRoot, host: LocatorShadowHost, index: number): Promise<LocatorRoot> {
    const candidates: LocatorCandidate[] = [
      { strategy: host.strategy, value: host.value, name: host.name, exact: host.exact },
      ...(host.alternatives ?? [])
    ];
    const diagnostics: CandidateDiagnostic[] = [];
    let primary: Locator | undefined;
    for (const candidate of candidates) {
      if (candidate.strategy === "xpath") continue;
      const locator = this.buildOn(root, candidate);
      primary ??= locator;
      const single = await LocatorFactory.pickSingle(locator, candidate, diagnostics);
      if (single) return single as unknown as LocatorRoot;
    }
    if (primary && diagnostics.length > 0 && diagnostics.every(({ count }) => count === 0)) {
      // Preserve Playwright auto-waiting for a dynamically attached open root/host.
      return primary as unknown as LocatorRoot;
    }
    const detail = diagnostics.map((d) => `${d.strategy}=${d.value}: ${d.count}`).join(", ");
    throw new Error(`Shadow host ${index + 1} did not resolve strictly (${detail || "no supported candidates"}).`);
  }

  /** Build one Playwright locator for `candidate` against an arbitrary root. */
  private buildOn(root: LocatorRoot, candidate: LocatorCandidate): Locator {
    switch (candidate.strategy) {
      case "id":
        return root.locator(`#${candidate.value}`);
      case "css":
      case "tagName":
        return root.locator(candidate.value);
      case "xpath":
        return root.locator(`xpath=${candidate.value}`);
      case "text":
        return root.getByText(candidate.value, candidate.exact ? { exact: true } : undefined);
      case "label":
        return root.getByLabel(candidate.value, candidate.exact ? { exact: true } : undefined);
      case "placeholder":
        return root.getByPlaceholder(candidate.value, candidate.exact ? { exact: true } : undefined);
      case "testId":
        return root.getByTestId(candidate.value);
      case "role":
        return root.getByRole(
          candidate.value,
          candidate.name ? { name: candidate.name, exact: candidate.exact ?? false } : undefined
        );
      default:
        throw new Error(`Unsupported locator strategy: ${(candidate as LocatorCandidate).strategy}`);
    }
  }

  /**
   * Return `locator` if it resolves to exactly one element, or the single *actionable* match when
   * several exist; otherwise `null`. Always records a diagnostic entry. Playwright 1.49 has no
   * `filter({ visible })`, so visibility is probed per-index via `nth(i).isVisible()`.
   *
   * Self-healing (safe by design): when several matches are visible, a single *enabled* match wins.
   * Viewport position is not identity (a same-label decoy above the fold is not the recorded target
   * below it), so it is never a tiebreak. If two or more remain equally actionable we return `null`;
   * the caller then fails with a clear diagnostic. This only converts would-be failures into
   * successes — it never changes which element an already-unambiguous step resolves to.
   */
  private static async pickSingle(
    locator: Locator,
    meta: LocatorCandidate,
    diagnostics: CandidateDiagnostic[]
  ): Promise<Locator | null> {
    let count = 0;
    try {
      count = await locator.count();
    } catch {
      count = 0;
    }

    if (count === 1) {
      diagnostics.push({ strategy: meta.strategy, value: meta.value, count: 1, visibleCount: 1 });
      return locator;
    }

    const visibleIndices: number[] = [];
    if (count > 1) {
      const cap = Math.min(count, VISIBILITY_PROBE_CAP);
      for (let i = 0; i < cap; i += 1) {
        let visible = false;
        try {
          visible = await locator.nth(i).isVisible();
        } catch {
          visible = false;
        }
        if (visible) visibleIndices.push(i);
      }
    }

    diagnostics.push({ strategy: meta.strategy, value: meta.value, count, visibleCount: visibleIndices.length });
    if (visibleIndices.length === 1) return locator.nth(visibleIndices[0]);

    if (visibleIndices.length > 1) {
      const actionable = await LocatorFactory.narrowToActionable(locator, visibleIndices);
      if (actionable >= 0) return locator.nth(actionable);
    }
    return null;
  }

  /**
   * Among the given (visible) indices, return the index of the single *enabled* element, or -1 when
   * zero or multiple remain — we never pick one of two equally actionable twins.
   */
  private static async narrowToActionable(locator: Locator, indices: number[]): Promise<number> {
    const enabled: number[] = [];
    for (const i of indices) {
      let ok = true;
      try {
        ok = await locator.nth(i).isEnabled();
      } catch {
        ok = true; // non-disableable elements are "enabled"
      }
      if (ok) enabled.push(i);
    }
    return enabled.length === 1 ? enabled[0] : -1;
  }

  /** Build an actionable, end-user-readable diagnostic when no candidate resolved uniquely. */
  private static formatFailure(step: FlowStep, diagnostics: CandidateDiagnostic[]): string {
    const spec = step.locator;
    const quality = spec?.quality;
    const head =
      quality && quality.isUnique === false
        ? `This step cannot continue because the saved locator matches ${quality.matchCount} elements.`
        : `This step could not run because its locator matched multiple elements on the page.`;

    const tried = diagnostics.length
      ? diagnostics
          .map((d) => `  • ${d.strategy}=${d.value} → ${d.count} match(es), ${d.visibleCount} visible`)
          .join("\n")
      : "  • (no candidates matched any element)";

    const scope: string[] = [];
    const containers = locatorContainerChain(spec?.context);
    if (containers.length) {
      scope.push(`containers: ${containers.map((c, index) => `${index + 1}:${c.type}/${c.strategy}`).join(" > ")}`);
    }
    if (spec?.context?.frame) scope.push(`frame: ${spec.context.frame.selector}`);
    if (spec?.context?.shadow) {
      const shadow = spec.context.shadow;
      scope.push(`shadow: ${shadow.boundary}${shadow.hosts?.length ? ` (${shadow.hosts.length} host(s))` : ""}`);
    }
    const scopeLine = scope.length ? `\nContext: ${scope.join("; ")}` : "";

    return [
      head,
      `Step: ${step.name} (${step.type})`,
      `Tried:\n${tried}${scopeLine}`,
      "Re-record the step, add a stable data-testid, or give the element a unique accessible label so it targets exactly one element."
    ].join("\n");
  }
}
