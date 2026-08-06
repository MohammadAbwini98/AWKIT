import type { Page, Locator, Frame, ElementHandle } from "playwright";
import { createPageFingerprint, fingerprintsEqual, hashFingerprint, hashToken, similarity } from "./locatorFingerprint";
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
import { hasPositionalIdentityGuard, isPositionalLocator, isValidLocatorFallbackApproval } from "@src/profiles/locatorApproval";
import { resolveStepSafety } from "./runtime/StepSafetyPolicy";
import { encodeClosedShadowSelector, isInstrumentedClosedShadow, registerClosedShadowEngine } from "./closedShadowBridge";
import {
  locatorCandidatesDigest,
  type LocatorElementFingerprint,
  type LocatorRecoveryRecord,
  type LocatorRecoveryStore
} from "./LocatorRecoveryStore";
import type { ElementBlueprint, LocatorBlueprintStore } from "./LocatorBlueprintStore";
import { computeFrameKey, computePageKey, documentFingerprintMatches } from "./LocatorBlueprintStore";

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
const RECOVERY_SCAN_CAP = 200;
const RECOVERY_SCORE_THRESHOLD = 0.86;
const RECOVERY_MARGIN = 0.08;
/** Bounded document-order window used only after the broad local-recovery scan has failed. */
const BLUEPRINT_NEIGHBORHOOD_RADIUS = 24;
/** Structural position is a tiebreaker, never a replacement for fingerprint identity. */
const BLUEPRINT_POSITION_BONUS = 0.03;

export interface LocatorRecoveryEvent {
  type: "preferred-candidate" | "local-recovery" | "memory-error" | "user-approved-fallback" | "guarded-positional";
  stepId: string;
  message: string;
  score?: number;
}

export interface LocatorFactoryOptions {
  recoveryStore?: LocatorRecoveryStore;
  blueprintStore?: LocatorBlueprintStore;
  scope?: { scenarioId: string; flowId?: string };
  recoveryGraceMs?: number;
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

export class LocatorFactory {
  constructor(
    private page: Page,
    private readonly options: LocatorFactoryOptions = {}
  ) {}

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

    // Guarded-positional: a SENSITIVE step whose only unique locator is positional re-proves the
    // recorded target identity before acting (never trusts the index alone). Non-sensitive positional
    // steps keep the lenient candidate/recovery path below.
    if (hasPositionalIdentityGuard(step)) {
      const level = resolveStepSafety(step).sideEffectLevel;
      if (level === "dangerousMutation" || level === "externalCommit") {
        return this.resolveGuardedPositional(step, spec.guard!);
      }
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
    const ordered = LocatorFactory.preferRemembered(ranked, applicableMemory?.winningCandidateSignature);

    if (ordered[0] !== ranked[0]) {
      this.emit({
        type: "preferred-candidate",
        stepId: step.id,
        message: `Using the last successful recorded locator first for "${step.name}".`
      });
    }

    let pass = await this.tryCandidates(root, ordered);
    if (pass.winner) {
      await this.rememberWinner(scopeKey, digest, pass.winner, step);
      
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
          await this.rememberWinner(scopeKey, digest, pass.winner, step);
          return pass.winner.locator;
        }
      }

      if (pass.allMissing) {
        const recovered = await this.recoverLocally(root, step, applicableMemory.fingerprint);
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

  private static readonly GUARD_MATCH_THRESHOLD = 0.9;

  /**
   * Resolve a SENSITIVE step's guarded-positional locator by INDEPENDENTLY re-proving the recorded
   * target identity before the action: resolve the guard container, enumerate the candidate set, verify
   * the count is unchanged, then verify the element at the recorded index still matches the recorded
   * fingerprint and every precondition. Any mismatch throws SENSITIVE_TARGET_IDENTITY_CHANGED. It NEVER
   * falls back to another sibling, repairs the index, or acts on position alone.
   */
  private async resolveGuardedPositional(step: FlowStep, guard: LocatorGuard): Promise<Locator> {
    const context = step.locator?.context;
    const root = await this.buildRoot({
      frame: context?.frame,
      frameChain: context?.frameChain,
      shadow: context?.shadow,
      containers: guard.container
    });
    const fail = (detail: string): Error =>
      new Error(
        `SENSITIVE_TARGET_IDENTITY_CHANGED: refusing the sensitive action on "${step.name}" — ${detail}. ` +
          `Re-record the step to confirm the intended target.`
      );
    const candidates = root.locator(guard.candidateSelector);
    const count = await candidates.count().catch(() => 0);
    if (count !== guard.siblingCount) throw fail(`the candidate set changed (recorded ${guard.siblingCount}, found ${count})`);
    if (guard.index < 0 || guard.index >= count) throw fail(`recorded position ${guard.index} is out of range (${count} candidates)`);
    const target = candidates.nth(guard.index);
    const fingerprint = await LocatorFactory.fingerprintOne(target);
    if (!fingerprint) throw fail("the recorded target could not be re-identified");
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
        `Verified sensitive target identity for "${step.name}" ` +
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

  private async rememberWinner(
    scopeKey: string | undefined,
    candidatesDigest: string,
    winner: { locator: Locator; ranked: RankedCandidate },
    step: FlowStep
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
    await this.writeMemory(
      {
        version: 1,
        scopeKey,
        candidatesDigest,
        winningCandidateSignature: winner.ranked.signature,
        fingerprint,
        source: "recorded-candidate",
        updatedAt: new Date().toISOString()
      },
      step.id
    );
  }

  private async recoverLocally(
    root: LocatorRoot,
    step: FlowStep,
    expected: LocatorElementFingerprint
  ): Promise<{ locator: Locator; fingerprint: LocatorElementFingerprint; score: number } | undefined> {
    const visible = root.locator("*:visible");
    const fingerprints = await LocatorFactory.fingerprintMany(visible, RECOVERY_SCAN_CAP);
    const ranked = fingerprints
      .map(({ fingerprint, index }) => ({ fingerprint, index, score: similarity(expected, fingerprint) }))
      .filter(({ fingerprint }) => LocatorFactory.isCompatible(step, fingerprint))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (best && best.score >= RECOVERY_SCORE_THRESHOLD && (!runnerUp || best.score - runnerUp.score >= RECOVERY_MARGIN)) {
      return { locator: visible.nth(best.index), fingerprint: best.fingerprint, score: best.score };
    }

    return this.recoverFromBlueprint(step);
  }

  /**
   * Second recovery layer: inspect a small document-order neighborhood around the captured element
   * only after the broad visible-element scan could not identify a unique match. Identity still comes
   * from the shared fingerprint scorer; sibling/tag/viewport position contribute at most 0.03 total.
   */
  private async recoverFromBlueprint(
    step: FlowStep
  ): Promise<{ locator: Locator; fingerprint: LocatorElementFingerprint; score: number } | undefined> {
    const blueprintId = step.locator?.blueprintId;
    if (!blueprintId || !this.options.blueprintStore) return undefined;

    try {
      const frame = await this.blueprintFrame(step.locator?.context);
      const frameKey = computeFrameKey(step.locator?.context?.frameChain);
      const pageKey = computePageKey(frame.url(), await frame.title().catch(() => ""), frameKey);
      const pageBlueprint = await this.options.blueprintStore.get(pageKey);
      if (!pageBlueprint || pageBlueprint.frameKey !== (frameKey || undefined)) return undefined;
      const elementBlueprint = pageBlueprint.elements.find((element) => element.blueprintId === blueprintId);
      if (!elementBlueprint) return undefined;

      const currentDocumentFingerprint = await LocatorFactory.documentFingerprint(frame);
      if (!documentFingerprintMatches(pageBlueprint.documentFingerprint, currentDocumentFingerprint)) return undefined;

      const allElements = frame.locator("body *");
      const count = await allElements.count().catch(() => 0);
      const start = Math.max(0, elementBlueprint.documentOrder - BLUEPRINT_NEIGHBORHOOD_RADIUS);
      const end = Math.min(count - 1, elementBlueprint.documentOrder + BLUEPRINT_NEIGHBORHOOD_RADIUS);
      const ranked: Array<{ locator: Locator; fingerprint: LocatorElementFingerprint; score: number }> = [];

      for (let index = start; index <= end; index += 1) {
        const locator = allElements.nth(index);
        if (!(await locator.isVisible().catch(() => false))) continue;
        const fingerprint = await LocatorFactory.fingerprintOne(locator);
        if (!fingerprint || !LocatorFactory.isCompatible(step, fingerprint)) continue;
        const identityScore = similarity(elementBlueprint.fingerprint, fingerprint);
        if (identityScore < RECOVERY_SCORE_THRESHOLD) continue;
        const positionScore = await LocatorFactory.blueprintPositionScore(locator, index, elementBlueprint);
        ranked.push({ locator, fingerprint, score: Math.min(1, identityScore + positionScore * BLUEPRINT_POSITION_BONUS) });
      }

      ranked.sort((left, right) => right.score - left.score);
      const best = ranked[0];
      const runnerUp = ranked[1];
      if (!best || best.score < RECOVERY_SCORE_THRESHOLD) return undefined;
      if (runnerUp && best.score - runnerUp.score < RECOVERY_MARGIN) return undefined;
      return best;
    } catch {
      // Blueprint storage/page probing is additive and fail-safe: normal unresolved behavior wins.
      return undefined;
    }
  }

  private static async blueprintPositionScore(
    locator: Locator,
    documentOrder: number,
    blueprint: ElementBlueprint
  ): Promise<number> {
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
      const documentScore = 1 - Math.min(1, Math.abs(documentOrder - blueprint.documentOrder) / (BLUEPRINT_NEIGHBORHOOD_RADIUS + 1));
      const siblingScore = evidence.siblingIndex === blueprint.siblingIndex ? 1 : 0;
      const sameTagScore = evidence.sameTagIndex === blueprint.sameTagIndex ? 1 : 0;
      const expectedRegion = blueprint.boundingRegion;
      const regionScore = expectedRegion
        ? 1 -
          Math.min(
            1,
            Math.abs(evidence.boundingRegion.relativeX - expectedRegion.relativeX) +
              Math.abs(evidence.boundingRegion.relativeY - expectedRegion.relativeY) +
              Math.abs(evidence.boundingRegion.relativeWidth - expectedRegion.relativeWidth) +
              Math.abs(evidence.boundingRegion.relativeHeight - expectedRegion.relativeHeight)
          )
        : 0;
      return (documentScore + siblingScore + sameTagScore + regionScore) / (expectedRegion ? 4 : 3);
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
    return JSON.stringify({
      strategy: candidate.strategy,
      value: candidate.value,
      name: candidate.name ?? "",
      exact: candidate.exact ?? false
    });
  }

  private static preferRemembered(ranked: RankedCandidate[], signature?: string): RankedCandidate[] {
    if (!signature) return ranked;
    const index = ranked.findIndex((item) => item.signature === signature);
    return index > 0 ? [ranked[index], ...ranked.slice(0, index), ...ranked.slice(index + 1)] : ranked;
  }

  private static async fingerprintOne(locator: Locator): Promise<LocatorElementFingerprint | undefined> {
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

  private static isCompatible(step: FlowStep, fingerprint: LocatorElementFingerprint): boolean {
    const { tag, role } = fingerprint;
    switch (step.type) {
      case "fill":
        return role === "textbox" || tag === "textarea";
      case "select":
        return tag === "select" || role === "combobox";
      case "check":
      case "uncheck":
      case "radio":
        return role === "checkbox" || role === "radio";
      default:
        return true;
    }
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
   * Self-healing (safe by design): when several matches are visible, narrow by deterministic,
   * intent-free actionability — a single *enabled* match wins, else a single *in-viewport* match
   * wins. If two or more remain equally actionable we return `null` (never guess the wrong twin);
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
   * Among the given (visible) indices, return the index of the single actionable element, or -1
   * when zero or multiple remain. Prefers a single *enabled* match, then a single *in-viewport*
   * match — both deterministic and intent-free, so we never pick the wrong one of two equal twins.
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
    if (enabled.length === 1) return enabled[0];

    const pool = enabled.length > 1 ? enabled : indices;
    const inView: number[] = [];
    for (const i of pool) {
      let visible = false;
      try {
        visible = await locator.nth(i).evaluate((el) => {
          const r = (el as Element).getBoundingClientRect();
          const vw = window.innerWidth || document.documentElement.clientWidth || 0;
          const vh = window.innerHeight || document.documentElement.clientHeight || 0;
          return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
        });
      } catch {
        visible = false;
      }
      if (visible) inView.push(i);
    }
    if (inView.length === 1) return inView[0];

    return -1; // still ambiguous — do not guess
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
