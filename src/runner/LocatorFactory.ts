import type { Page, Locator } from "playwright";
import { createHash } from "node:crypto";
import type { FlowStep, LocatorCandidate, LocatorContext } from "@src/profiles/FlowProfile";
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
  type: "preferred-candidate" | "local-recovery" | "memory-error";
  stepId: string;
  message: string;
  score?: number;
}

export interface LocatorFactoryOptions {
  recoveryStore?: LocatorRecoveryStore;
  scope?: { scenarioId: string; flowId?: string };
  recoveryGraceMs?: number;
  onRecoveryEvent?: (event: LocatorRecoveryEvent) => void;
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

/** Browser-evaluated and intentionally self-contained: Playwright serializes this function body. */
function createPageFingerprint(element: Element): LocatorElementFingerprint {
  const tag = element.tagName.toLocaleLowerCase();
  const type = (element.getAttribute("type") || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
  const explicitRole = (element.getAttribute("role") || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase()
    .slice(0, 160);
  const implicitRole =
    tag === "button"
      ? "button"
      : tag === "a" && element.hasAttribute("href")
        ? "link"
        : tag === "select"
          ? "combobox"
          : tag === "textarea"
            ? "textbox"
            : tag === "input" && ["button", "submit", "reset"].includes(type)
              ? "button"
              : tag === "input" && type === "checkbox"
                ? "checkbox"
                : tag === "input" && type === "radio"
                  ? "radio"
                  : tag === "input"
                    ? "textbox"
                    : "";
  let controlLabels = "";
  if ("labels" in element) {
    const labels = (element as HTMLInputElement).labels;
    if (labels) {
      for (let index = 0; index < labels.length; index += 1) {
        controlLabels += ` ${labels[index].textContent || ""}`;
      }
    }
  }
  const text = (element.textContent || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
  const rawName =
    element.getAttribute("aria-label") ||
    controlLabels ||
    element.getAttribute("alt") ||
    element.getAttribute("placeholder") ||
    element.getAttribute("title") ||
    text;
  const name = rawName.replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
  const attributes: Record<string, string> = {};
  for (const key of ["id", "name", "type", "placeholder", "data-testid", "aria-label"]) {
    const value = (element.getAttribute(key) || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase()
      .slice(0, 160);
    if (value) attributes[key] = value;
  }
  const ancestry: string[] = [];
  let parent = element.parentElement;
  while (parent && ancestry.length < 3) {
    let ancestor = parent.tagName.toLocaleLowerCase();
    const parentRole = (parent.getAttribute("role") || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
    const parentId = (parent.getAttribute("id") || "").replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
    const parentTestId = (parent.getAttribute("data-testid") || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase()
      .slice(0, 160);
    if (parentRole) ancestor += `|${parentRole}`;
    if (parentId) ancestor += `|${parentId}`;
    if (parentTestId) ancestor += `|${parentTestId}`;
    ancestry.push(ancestor);
    parent = parent.parentElement;
  }
  return { tag, role: explicitRole || implicitRole, name, text, attributes, ancestry };
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
      .map(({ fingerprint, index }) => ({ fingerprint, index, score: LocatorFactory.similarity(expected, fingerprint) }))
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
      return LocatorFactory.hashFingerprint(await locator.evaluate(createPageFingerprint));
    } catch {
      return undefined;
    }
  }

  /**
   * Persist equality-preserving token hashes instead of page text/labels/attribute values. This
   * keeps lexical overlap useful for local similarity without turning locator memory into a second
   * store of customer-visible business data.
   */
  private static hashFingerprint(fingerprint: LocatorElementFingerprint): LocatorElementFingerprint {
    const hash = (value: string): string =>
      createHash("sha256").update(value).digest("hex").slice(0, 20);
    const hashTokens = (value: string): string =>
      [...new Set(value.split(/\s+/).filter(Boolean).map(hash))].sort().join(" ");
    return {
      tag: fingerprint.tag,
      role: fingerprint.role,
      name: hashTokens(fingerprint.name),
      text: hashTokens(fingerprint.text),
      attributes: Object.fromEntries(
        Object.entries(fingerprint.attributes).map(([key, value]) => [key, hash(value)])
      ),
      ancestry: fingerprint.ancestry.map(hash)
    };
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

  private static similarity(a: LocatorElementFingerprint, b: LocatorElementFingerprint): number {
    const textScore = (left: string, right: string): number => {
      if (!left || !right) return 0;
      if (left === right) return 1;
      const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
      const rightTokens = new Set(right.split(/\s+/).filter(Boolean));
      const common = [...leftTokens].filter((token) => rightTokens.has(token)).length;
      return common / Math.max(leftTokens.size, rightTokens.size, 1);
    };
    const attributeKeys = new Set([...Object.keys(a.attributes), ...Object.keys(b.attributes)]);
    const attributeScore = attributeKeys.size
      ? [...attributeKeys].filter((key) => a.attributes[key] && a.attributes[key] === b.attributes[key]).length /
        attributeKeys.size
      : 0;
    const ancestryScore =
      Math.max(a.ancestry.length, b.ancestry.length) > 0
        ? a.ancestry.filter((value, index) => value === b.ancestry[index]).length /
          Math.max(a.ancestry.length, b.ancestry.length)
        : 0;
    return (
      (a.tag === b.tag ? 0.12 : 0) +
      (a.role && a.role === b.role ? 0.18 : 0) +
      textScore(a.name, b.name) * 0.32 +
      textScore(a.text, b.text) * 0.18 +
      attributeScore * 0.1 +
      ancestryScore * 0.1
    );
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

  /** Build a scoped root from container/frame context, resolving the container to one element. */
  private async buildRoot(context?: LocatorContext): Promise<LocatorRoot> {
    let root: LocatorRoot = this.page;

    if (context?.frame?.selector) {
      root = this.page.frameLocator(context.frame.selector) as unknown as LocatorRoot;
    }

    const container = context?.container;
    if (container) {
      let containerLocator = this.buildOn(root, container);
      if (container.hasText) containerLocator = containerLocator.filter({ hasText: container.hasText });
      const single = await LocatorFactory.pickSingle(containerLocator, container, []);
      root = (single ?? containerLocator.first()) as unknown as LocatorRoot;
    }

    return root;
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
    if (spec?.context?.container) {
      const c = spec.context.container;
      scope.push(`container: ${c.type} (${c.strategy}=${c.value})`);
    }
    if (spec?.context?.frame) scope.push(`frame: ${spec.context.frame.selector}`);
    const scopeLine = scope.length ? `\nContext: ${scope.join("; ")}` : "";

    return [
      head,
      `Step: ${step.name} (${step.type})`,
      `Tried:\n${tried}${scopeLine}`,
      "Re-record the step, add a stable data-testid, or give the element a unique accessible label so it targets exactly one element."
    ].join("\n");
  }
}
