import type { Page, Locator } from "playwright";
import { createPageFingerprint, hashFingerprint, similarity } from "./locatorFingerprint";
import {
  locatorContainerChain,
  MAX_LOCATOR_CONTAINER_CHAIN,
  type FlowStep,
  type LocatorCandidate,
  type LocatorContext,
  type LocatorShadowHost
} from "@src/profiles/FlowProfile";
import { isPositionalLocator, isValidLocatorFallbackApproval } from "@src/profiles/locatorApproval";
import {
  locatorCandidatesDigest,
  type LocatorElementFingerprint,
  type LocatorRecoveryRecord,
  type LocatorRecoveryStore
} from "./LocatorRecoveryStore";

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
const RECOVERY_SCAN_CAP = 200;
const RECOVERY_SCORE_THRESHOLD = 0.86;
const RECOVERY_MARGIN = 0.08;

export interface LocatorRecoveryEvent {
  type: "preferred-candidate" | "local-recovery" | "memory-error" | "user-approved-fallback";
  stepId: string;
  message: string;
  score?: number;
}

export interface LocatorFactoryOptions {
  recoveryStore?: LocatorRecoveryStore;
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
    if (!best || best.score < RECOVERY_SCORE_THRESHOLD) return undefined;
    if (runnerUp && best.score - runnerUp.score < RECOVERY_MARGIN) return undefined;
    return { locator: visible.nth(best.index), fingerprint: best.fingerprint, score: best.score };
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
    let root: LocatorRoot = this.page;

    if (context?.frame?.selector) {
      root = this.page.frameLocator(context.frame.selector) as unknown as LocatorRoot;
    }

    const shadow = context?.shadow;
    if (shadow?.boundary === "closed" || shadow?.boundary === "unknown") {
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
