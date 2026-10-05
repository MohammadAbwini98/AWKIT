import type { ElementHandle, Locator } from "playwright";
import type { FlowStep, LocatorElementFingerprint } from "@src/profiles/FlowProfile";
import type { ElementBlueprint } from "./LocatorBlueprintStore";
import { ancestrySimilarity, createFingerprintHasher, createPageFingerprint, fingerprintsEqual, similarity } from "./locatorFingerprint";
import { PIN_PAGE_SOURCE, newElementPin, pinnedLocator, type ElementPin } from "./elementPin";

/**
 * L11 single-snapshot locator recovery (docs/plans/ai-upgrade-v5/L11-performance-dom-intelligence.md,
 * E1–E3).
 *
 * The legacy recovery loops paid one Playwright round trip per scored element (and `nth(i)` on
 * `*:visible` re-queries the page each time), which is where the measured 1.5–2.5 s p50 went. Here each
 * layer is ONE `evaluateAll`: Playwright hands the page its own match list for the selector, in the order
 * `nth(i)` resolves, so an index returned from the page names exactly the element `nth(i)` will.
 *
 * The decision rules are NOT redefined here: `rankLocalRecovery` and `decideBlueprintRecovery` are the
 * only implementations, used by the legacy per-element loops and the snapshot alike, with the unchanged
 * 0.86 threshold, 0.08 margin, 0.5 ancestry veto and step-type compatibility.
 *
 * Page code is kept as plain source strings, never transpiled closures: esbuild's `keepNames` wraps named
 * inner functions in a `__name` helper that does not exist in the page (the recorder gotcha).
 */

export const RECOVERY_SCORE_THRESHOLD = 0.86;
export const RECOVERY_MARGIN = 0.08;
/**
 * Same label is not identity: tag, role, name and text weigh 0.80 of `similarity()`, so once the
 * target is gone any same-label element clears 0.86. A recovered element must also keep at least half
 * of its recorded ancestry path (2 of 3 levels, so one inserted wrapper still passes). A veto only.
 */
export const RECOVERY_MIN_ANCESTRY = 0.5;
/** Legacy per-element scan bound (kept for the legacy engine and the benchmark only). */
export const RECOVERY_SCAN_CAP = 200;
/**
 * Pruned elements the snapshot scores. The cap bounded round trips before; now it bounds one page walk.
 * Over it the snapshot refuses: a margin taken over part of the competitors proves nothing.
 */
export const SNAPSHOT_PRUNED_CAP = 5_000;
/** Bounded document-order window used only after the broad local-recovery scan has failed. */
export const BLUEPRINT_NEIGHBORHOOD_RADIUS = 24;
/** Structural position is a tiebreaker, never a replacement for fingerprint identity. */
export const BLUEPRINT_POSITION_BONUS = 0.03;

export interface ScoredCandidate {
  index: number;
  fingerprint: LocatorElementFingerprint;
  score: number;
}

export type RecoveryRefusal =
  | "no-candidate"
  | "below-threshold"
  | "ambiguous-margin"
  | "ancestry-veto"
  | "snapshot-truncated"
  | "snapshot-failed"
  | "stale-snapshot"
  | "blueprint-unavailable"
  | "page-variant"
  | "pre-existing-twin";

export interface RecoveryDecision {
  winner?: ScoredCandidate;
  refusal?: RecoveryRefusal;
  best?: ScoredCandidate;
  runnerUp?: ScoredCandidate;
  /** Compatible candidates scored (after pruning). */
  considered: number;
}

/** Whether a fingerprint can be the target of `step` at all (a fill needs a text control, …). */
export function isRecoveryCompatible(step: Pick<FlowStep, "type">, fingerprint: Pick<LocatorElementFingerprint, "tag" | "role">): boolean {
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

/**
 * Local recovery's one decision rule: the best compatible candidate wins only with score >= 0.86, a
 * 0.08 margin over the runner-up, and at least half of its recorded ancestry path.
 */
export function rankLocalRecovery(
  step: Pick<FlowStep, "type">,
  expected: LocatorElementFingerprint,
  candidates: ReadonlyArray<{ index: number; fingerprint: LocatorElementFingerprint }>
): RecoveryDecision {
  const ranked = candidates
    .filter(({ fingerprint }) => isRecoveryCompatible(step, fingerprint))
    .map(({ index, fingerprint }) => ({ index, fingerprint, score: similarity(expected, fingerprint) }))
    .sort((a, b) => b.score - a.score);
  return gateRecovery(ranked, expected.ancestry, ranked.length);
}

/**
 * The gate every recovery layer shares, over candidates already sorted best first: threshold, margin
 * over the runner-up, then the ancestry veto on the best. Refuses rather than choosing between near-ties.
 */
export function gateRecovery(ranked: readonly ScoredCandidate[], expectedAncestry: string[], considered: number): RecoveryDecision {
  const [best, runnerUp] = ranked;
  const base = { best, runnerUp, considered };
  if (!best) return { ...base, refusal: considered === 0 ? "no-candidate" : "below-threshold" };
  if (best.score < RECOVERY_SCORE_THRESHOLD) return { ...base, refusal: "below-threshold" };
  if (runnerUp && best.score - runnerUp.score < RECOVERY_MARGIN) return { ...base, refusal: "ambiguous-margin" };
  if (ancestrySimilarity(expectedAncestry, best.fingerprint.ancestry) < RECOVERY_MIN_ANCESTRY) return { ...base, refusal: "ancestry-veto" };
  return { ...base, winner: best };
}

/**
 * L12 agreement rule (awkit-djnl.21.6): the provider's top pick may act when AWKIT refused only on
 * score or margin AND both scorers name the same element with a clear lead.
 *
 * Measured on the L11 acceptance set (2026-10-04): AWKIT's best and the provider's top were the same
 * element in reworded text (0.833 / 98.4, lead 17), duplicate text (0.95 margin 0.04 / 86.7, lead 5.3) and
 * a relabelled field (0.61 / 87.5, lead 26), all correct. The same-tag decoy (0.725 / 77.7) and combined
 * drift (0.725 / 75.8) also agreed but were wrong, and the provider's floor refuses both. Wrong picks the
 * provider scored higher (virtualized row 96.4 with lead 0, skeleton 91.7, navigated page 94.4) are refused
 * by the lead, the actionability veto and the route binding, which all still run.
 *
 * Everything else in the gate holds: compatibility, the ancestry veto, AWKIT's own margin when it refused on
 * score, and an identity floor that means the structure matched and only the label or text drifted.
 */
export const AGREEMENT_MIN_PROVIDER_SCORE = 85;
export const AGREEMENT_MIN_PROVIDER_LEAD = 5;
export const AGREEMENT_MIN_IDENTITY = 0.6;

export function decideProviderAgreement(
  decision: RecoveryDecision | undefined,
  expectedAncestry: string[],
  provider: ReadonlyArray<{ index: number; score: number }>
): ScoredCandidate | undefined {
  if (!decision || decision.winner) return undefined;
  if (decision.refusal !== "below-threshold" && decision.refusal !== "ambiguous-margin") return undefined;
  const { best, runnerUp } = decision;
  const [top, second] = provider;
  if (!best || !top || top.index !== best.index) return undefined;
  if (best.score < AGREEMENT_MIN_IDENTITY || top.score < AGREEMENT_MIN_PROVIDER_SCORE) return undefined;
  // The gate refused before it reached the ancestry veto, so the veto runs here.
  if (ancestrySimilarity(expectedAncestry, best.fingerprint.ancestry) < RECOVERY_MIN_ANCESTRY) return undefined;
  if (second && top.score - second.score < AGREEMENT_MIN_PROVIDER_LEAD) return undefined;
  // Refused on score: AWKIT's own margin must still hold, so the agreement never breaks a near-tie.
  if (decision.refusal === "below-threshold" && runnerUp && best.score - runnerUp.score < RECOVERY_MARGIN) return undefined;
  return best;
}

/**
 * L12.23 (awkit-djnl.21.23): look-alikes that stood beside the target when its step first succeeded. A
 * recovery winner identical to one of them (identity AND ancestry) is that same untouched element, not the
 * target: the target is gone and its twin was always there. Measured on the DOM Coverage Lab, each layer
 * otherwise acted on one: an Archive "Download statement" link (local, 0.867), the billing address "Edit"
 * (blueprint, 0.994) and a hidden tab's "Save" shown after a tab switch (blueprint, 0.995).
 *
 * Only twins DISTINGUISHABLE from the target are kept: an identical fingerprint (identical list rows) was never
 * what told the target apart, so vetoing it would refuse every row's own recovery. Hidden elements count, since
 * a hidden twin can be shown later.
 *
 * L12.24: the 8 CLOSEST twins are kept, not the first 8 in page order. Keeping page order let a near-identical
 * look-alike that came 9th win once the target was gone (crowded-twins: 0.983 against eight at 0.867). Kept
 * by score, an unkept twin scores at or below all 8 kept ones, so while they stand it cannot lead them by the
 * 0.08 margin (the blueprint's position bonus is at most 0.03), and a best candidate that is a kept twin
 * refuses its layer. It could win only if the kept twins above it drifted or vanished too: the drifted-twin
 * limit already recorded, not a new one. Storage stays bounded at 8 hashed fingerprints.
 */
export const MAX_RECORDED_TWINS = 8;

export function preExistingTwins(
  target: LocatorElementFingerprint,
  candidates: ReadonlyArray<{ fingerprint: LocatorElementFingerprint }>
): LocatorElementFingerprint[] {
  const twins = new Map<string, { fingerprint: LocatorElementFingerprint; score: number }>();
  for (const { fingerprint } of candidates) {
    const score = similarity(target, fingerprint);
    if (sameElementFingerprint(fingerprint, target) || score < RECOVERY_SCORE_THRESHOLD) continue;
    twins.set(JSON.stringify(fingerprint), { fingerprint, score });
  }
  // Stable sort: equal scores keep page order.
  return [...twins.values()].sort((a, b) => b.score - a.score).slice(0, MAX_RECORDED_TWINS).map((twin) => twin.fingerprint);
}

export function isPreExistingTwin(twins: readonly LocatorElementFingerprint[] | undefined, winner: LocatorElementFingerprint): boolean {
  return Boolean(twins?.some((twin) => sameElementFingerprint(twin, winner)));
}

export interface BlueprintEvidence {
  index: number;
  fingerprint: LocatorElementFingerprint;
  siblingIndex: number;
  sameTagIndex: number;
  boundingRegion: { relativeX: number; relativeY: number; relativeWidth: number; relativeHeight: number };
}

/** Positional agreement with the blueprint in [0, 1]; it only ever adds up to 0.03 to identity. */
export function blueprintPositionScore(evidence: Omit<BlueprintEvidence, "fingerprint">, blueprint: ElementBlueprint): number {
  const documentScore = 1 - Math.min(1, Math.abs(evidence.index - blueprint.documentOrder) / (BLUEPRINT_NEIGHBORHOOD_RADIUS + 1));
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
}

/** Blueprint recovery's one decision rule over the visible, compatible window candidates. */
export function decideBlueprintRecovery(
  step: Pick<FlowStep, "type">,
  blueprint: ElementBlueprint,
  window: ReadonlyArray<BlueprintEvidence>
): RecoveryDecision {
  const ranked: ScoredCandidate[] = [];
  let considered = 0;
  for (const evidence of window) {
    if (!isRecoveryCompatible(step, evidence.fingerprint)) continue;
    considered += 1;
    const identityScore = similarity(blueprint.fingerprint, evidence.fingerprint);
    if (identityScore < RECOVERY_SCORE_THRESHOLD) continue;
    const position = blueprintPositionScore(evidence, blueprint);
    ranked.push({ index: evidence.index, fingerprint: evidence.fingerprint, score: Math.min(1, identityScore + position * BLUEPRINT_POSITION_BONUS) });
  }
  ranked.sort((left, right) => right.score - left.score);
  return gateRecovery(ranked, blueprint.fingerprint.ancestry, considered);
}

/** Identity-and-ancestry equality: the stale-snapshot guard's definition of "still the same element". */
export function sameElementFingerprint(left: LocatorElementFingerprint, right: LocatorElementFingerprint): boolean {
  return (
    fingerprintsEqual(left, right) &&
    left.ancestry.length === right.ancestry.length &&
    left.ancestry.every((entry, index) => entry === right.ancestry[index])
  );
}

// ── Page code ────────────────────────────────────────────────────────────────────────────────────

/**
 * The implicit-role table of `createPageFingerprint`, restated for the cheap in-page prune. It must never
 * disagree with the fingerprint's own role (verify:dom-intelligence-snapshot checks every fixture element);
 * a disagreement could only prune a real competitor, which is why the kept set is re-checked against the
 * full fingerprint before it leaves the page.
 */
const ROLE_OF = `function (el) {
  var explicit = (el.getAttribute("role") || "").replace(/\\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
  if (explicit) return explicit;
  var tag = el.tagName.toLocaleLowerCase();
  var type = (el.getAttribute("type") || "").replace(/\\s+/g, " ").trim().toLocaleLowerCase().slice(0, 160);
  if (tag === "button") return "button";
  if (tag === "a" && el.hasAttribute("href")) return "link";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input" && (type === "button" || type === "submit" || type === "reset")) return "button";
  if (tag === "input" && type === "checkbox") return "checkbox";
  if (tag === "input" && type === "radio") return "radio";
  if (tag === "input") return "textbox";
  return "";
}`;

/** Playwright's `isElementVisible` (injected script, 1.6x), restated for the blueprint window scan. */
const IS_VISIBLE = `function (root) {
  var textVisible = function (node) {
    var range = node.ownerDocument.createRange();
    range.selectNode(node);
    var rect = range.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  var styleVisible = function (el, style) {
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility()) return false;
    } else {
      var details = el.closest("details,summary");
      if (details !== el && details && details.nodeName === "DETAILS" && !details.open) return false;
    }
    return style.visibility === "visible";
  };
  var visit = function (el) {
    var style = el.ownerDocument.defaultView ? el.ownerDocument.defaultView.getComputedStyle(el) : null;
    if (!style) return true;
    if (style.display === "contents") {
      for (var child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1 && visit(child)) return true;
        if (child.nodeType === 3 && textVisible(child)) return true;
      }
      return false;
    }
    if (!styleVisible(el, style)) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  return visit(root);
}`;

const LOCAL_SCAN = `
  var fingerprint = (${createPageFingerprint.toString()});
  var roleOf = (${ROLE_OF});
  var kept = [];
  var truncated = false;
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var keep = el.tagName.toLocaleLowerCase() === arg.tag || (arg.role !== "" && roleOf(el) === arg.role);
    if (!keep) continue;
    var print = fingerprint(el);
    if (print.tag !== arg.tag && !(arg.role !== "" && print.role === arg.role)) continue;
    if (kept.length >= arg.cap) { truncated = true; break; }
    kept.push({ i: i, f: print });
  }
  return { visible: elements.length, kept: kept, truncated: truncated };
`;

const BLUEPRINT_SCAN = `
  var fingerprint = (${createPageFingerprint.toString()});
  var isVisible = (${IS_VISIBLE});
  var histogram = new Map();
  var all = document.body ? document.body.querySelectorAll("*") : [];
  for (var h = 0; h < all.length && h < 5000; h++) {
    var tagName = all[h].tagName.toLowerCase();
    var roleName = all[h].getAttribute("role");
    var key = roleName ? tagName + ":" + roleName : tagName;
    histogram.set(key, (histogram.get(key) || 0) + 1);
  }
  var sorted = [];
  histogram.forEach(function (count, key) { sorted.push(key + "=" + count); });
  var start = Math.max(0, arg.start);
  var end = Math.min(elements.length - 1, arg.end);
  var width = window.innerWidth;
  var height = window.innerHeight;
  var window_ = [];
  for (var i = start; i <= end; i++) {
    var el = elements[i];
    if (arg.container && !arg.container.contains(el)) continue;
    if (!isVisible(el)) continue;
    var siblings = el.parentElement ? Array.prototype.slice.call(el.parentElement.children) : [];
    var sameTag = siblings.filter(function (sibling) { return sibling.tagName === el.tagName; });
    var rect = el.getBoundingClientRect();
    window_.push({
      i: i,
      f: fingerprint(el),
      s: siblings.indexOf(el),
      t: sameTag.indexOf(el),
      r: {
        relativeX: width ? rect.x / width : 0,
        relativeY: height ? rect.y / height : 0,
        relativeWidth: width ? rect.width / width : 0,
        relativeHeight: height ? rect.height / height : 0
      }
    });
  }
  return { count: elements.length, documentFingerprint: sorted.sort().join("|"), window: window_ };
`;

/** LOCAL_SCAN, then the element at `arg.index` is pinned in the same task (see `recheckSnapshotWinner`). */
const RECHECK_SCAN = `
  var scan = function (elements, arg) { ${LOCAL_SCAN} };
  var raw = scan(elements, arg);
  if (elements[arg.index]) (${PIN_PAGE_SOURCE})(arg.token, arg.nonce, elements[arg.index]);
  return raw;
`;

type PageFunction<A, R> = (elements: Element[], arg: A) => R;

let localScan: PageFunction<LocalScanArg, RawLocalScan> | undefined;
let recheckScan: PageFunction<RecheckArg, RawLocalScan> | undefined;
let blueprintScan: PageFunction<BlueprintScanArg, RawBlueprintScan> | undefined;

interface LocalScanArg {
  tag: string;
  role: string;
  cap: number;
}

interface RecheckArg extends LocalScanArg, ElementPin {
  index: number;
}

interface RawLocalScan {
  visible: number;
  kept: Array<{ i: number; f: LocatorElementFingerprint }>;
  truncated: boolean;
}

interface BlueprintScanArg {
  start: number;
  end: number;
  /** L12.24: the step's proven container; only window elements inside it are candidates. */
  container?: Node;
}

interface RawBlueprintScan {
  count: number;
  documentFingerprint: string;
  window: Array<{ i: number; f: LocatorElementFingerprint; s: number; t: number; r: BlueprintEvidence["boundingRegion"] }>;
}

function pageFunction<A, R>(body: string): PageFunction<A, R> {
  // A real Function object, so Playwright evaluates it as a function (a string would be an expression).
  return new Function("elements", "arg", body) as PageFunction<A, R>;
}

export interface LocalSnapshot {
  /** Visible elements Playwright matched for the root. */
  visible: number;
  /** Pruned, hashed candidates in `nth` order of the same `*:visible` locator. */
  candidates: Array<{ index: number; fingerprint: LocatorElementFingerprint }>;
  truncated: boolean;
  ms: number;
}

/**
 * One round trip: fingerprints of every visible element that shares the recorded tag or (non-empty)
 * role, in `visible.nth()` order. Pruning is exact (plan E2): anything else scores at most 0.70, below
 * the 0.78 floor at which a runner-up can matter. Throws when the page cannot be evaluated.
 */
export async function captureLocalSnapshot(
  visible: Locator,
  expected: Pick<LocatorElementFingerprint, "tag" | "role">,
  cap = SNAPSHOT_PRUNED_CAP
): Promise<LocalSnapshot> {
  const started = performance.now();
  localScan ??= pageFunction<LocalScanArg, RawLocalScan>(LOCAL_SCAN);
  const raw = await visible.evaluateAll(localScan, { tag: expected.tag, role: expected.role ?? "", cap });
  const hash = createFingerprintHasher();
  return {
    visible: raw.visible,
    candidates: raw.kept.map(({ i, f }) => ({ index: i, fingerprint: hash(f) })),
    truncated: raw.truncated,
    ms: performance.now() - started
  };
}

/**
 * The proof-time re-check (stale-snapshot guard). A snapshot names its winner by index, and the page can
 * change between the snapshot and the proof. Re-fingerprinting `nth(index)` alone is not enough: an
 * identical twin inserted before the winner would shift the index onto itself and still match. So the
 * same list is scanned again, and exactly ONE element may carry the winner's identity and ancestry, at the
 * same index. Any other outcome refuses (undefined).
 *
 * The same evaluate pins the node at that index, and the proven result is a locator for that node only
 * (`elementPin`), so the action cannot land on whatever holds the index later. `scope` is where `list`
 * was built (its page, frame or container).
 */
export async function recheckSnapshotWinner(
  list: Locator,
  scope: { locator(selector: string): Locator },
  winner: { index: number; fingerprint: LocatorElementFingerprint }
): Promise<Locator | undefined> {
  recheckScan ??= pageFunction<RecheckArg, RawLocalScan>(RECHECK_SCAN);
  const pin = newElementPin();
  const raw = await list.evaluateAll(recheckScan, { tag: winner.fingerprint.tag, role: "", cap: SNAPSHOT_PRUNED_CAP, index: winner.index, ...pin });
  if (raw.truncated) return undefined;
  const hash = createFingerprintHasher();
  const matches = raw.kept.filter(({ f }) => sameElementFingerprint(hash(f), winner.fingerprint));
  return matches.length === 1 && matches[0].i === winner.index ? pinnedLocator(scope, pin) : undefined;
}

export interface BlueprintSnapshot {
  count: number;
  documentFingerprint: string;
  window: BlueprintEvidence[];
  ms: number;
}

/**
 * One round trip: the blueprint's visible document-order window plus the page's tag/role histogram. With a
 * `container`, window elements outside it are not candidates (the histogram stays the whole document's).
 */
export async function captureBlueprintSnapshot(allElements: Locator, blueprint: Pick<ElementBlueprint, "documentOrder">, container?: ElementHandle): Promise<BlueprintSnapshot> {
  const started = performance.now();
  blueprintScan ??= pageFunction<BlueprintScanArg, RawBlueprintScan>(BLUEPRINT_SCAN);
  const raw = await allElements.evaluateAll(blueprintScan, {
    start: blueprint.documentOrder - BLUEPRINT_NEIGHBORHOOD_RADIUS,
    end: blueprint.documentOrder + BLUEPRINT_NEIGHBORHOOD_RADIUS,
    ...(container ? { container } : {})
  });
  const hash = createFingerprintHasher();
  return {
    count: raw.count,
    documentFingerprint: raw.documentFingerprint,
    window: raw.window.map((entry) => ({
      index: entry.i,
      fingerprint: hash(entry.f),
      siblingIndex: entry.s,
      sameTagIndex: entry.t,
      boundingRegion: entry.r
    })),
    ms: performance.now() - started
  };
}

/** Test seam: the in-page role table and visibility replica, for parity checks against Playwright. */
export const SNAPSHOT_PAGE_SOURCES = Object.freeze({ roleOf: ROLE_OF, isVisible: IS_VISIBLE });
