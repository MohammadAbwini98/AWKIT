import { createHash } from "node:crypto";
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
  | "pre-existing-twin"
  /** L12.25: the memory does not hold the complete set of look-alikes, so no winner can be told apart from one. */
  | "twins-unproven";

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
 * L12.25 (awkit-djnl.21.25): EVERY such look-alike is remembered, as a compact identity digest. L12.24 kept the 8
 * closest fingerprints of the whole document, hidden ones included, while the local layer acts on the VISIBLE
 * elements of the step's container: with 8 or more closer hidden look-alikes, a visible one that had always stood
 * beside the target was not kept and recovery acted on it (independent QC: 8 and 12 hidden). No cap that is chosen
 * from a wider pool than an acting layer's can be safe, and each layer's pool changes as tabs open and close, so the
 * set is complete instead: every compatible look-alike in the step's frame (hidden or not, inside the container or
 * not) scoring at least AGREEMENT_MIN_IDENTITY, the lowest score any layer may act on. The veto only compares
 * identity, so a digest is all it needs. Over MAX_TWIN_DIGESTS, or when the page cannot be scanned, the set is
 * unknown and recovery from that memory refuses (`twins-unproven`); so does memory written before L12.25.
 */
export const TWIN_SCORE_FLOOR = AGREEMENT_MIN_IDENTITY;
/** A storage bound, not a safety one: past it nothing is remembered and recovery refuses. 16 hex chars each. */
export const MAX_TWIN_DIGESTS = 1024;

/** The identity `sameElementFingerprint` compares, as 64 bits. A collision can only refuse a recovery. */
export function twinDigest(fingerprint: LocatorElementFingerprint): string {
  const attributes = Object.keys(fingerprint.attributes)
    .sort()
    .map((key) => [key, fingerprint.attributes[key]]);
  return createHash("sha256")
    .update(JSON.stringify([fingerprint.tag, fingerprint.role, fingerprint.name, fingerprint.text, attributes, fingerprint.ancestry]))
    .digest("hex")
    .slice(0, 16);
}

/** Digests of every distinguishable look-alike of `target`, or undefined when there are too many to keep. */
export function preExistingTwinDigests(
  step: Pick<FlowStep, "type">,
  target: LocatorElementFingerprint,
  candidates: ReadonlyArray<{ fingerprint: LocatorElementFingerprint }>
): string[] | undefined {
  const digests = new Set<string>();
  for (const { fingerprint } of candidates) {
    if (!isRecoveryCompatible(step, fingerprint) || sameElementFingerprint(fingerprint, target) || similarity(target, fingerprint) < TWIN_SCORE_FLOOR) continue;
    digests.add(twinDigest(fingerprint));
    if (digests.size > MAX_TWIN_DIGESTS) return undefined;
  }
  return [...digests].sort();
}

/**
 * L12.27 (awkit-djnl.21.27): the set a passing resolve remembers. The current scan, plus what earlier successes saw
 * (a look-alike present then, absent now, can come back once the target is gone), minus the winner itself. Undefined,
 * so recovery refuses, when the current scan is unknown. Over MAX_TWIN_DIGESTS the current scan alone is kept: it
 * is complete for the latest proven success, which is the guarantee; the older digests are extra.
 */
export function mergeTwinDigests(previous: readonly string[] | undefined, current: readonly string[] | undefined, winner: LocatorElementFingerprint): string[] | undefined {
  if (!current) return undefined;
  const self = twinDigest(winner);
  const merged = new Set([...current, ...(previous ?? [])].filter((digest) => digest !== self));
  return merged.size > MAX_TWIN_DIGESTS ? [...current].sort() : [...merged].sort();
}

/** Why a recovery winner may not act on this memory, or undefined when it may. */
export function twinVeto(twinDigests: readonly string[] | undefined, winner: LocatorElementFingerprint): "pre-existing-twin" | "twins-unproven" | undefined {
  if (!twinDigests) return "twins-unproven";
  return twinDigests.includes(twinDigest(winner)) ? "pre-existing-twin" : undefined;
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

/**
 * L12.27: the same walk, keyed in the page by two independent 32-bit hashes and the length of exactly what the
 * look-alike set is derived from (the kept raw fingerprints in page order, and whether the walk was cut short). When
 * that key equals `arg.known` nothing else leaves the page. An accidental collision is about 1 in 2^64; a page that
 * crafted one gains nothing it could not do by relabelling its own controls.
 */
const LOOK_ALIKE_SCAN = `
  var scan = (function (elements, arg) { ${LOCAL_SCAN} })(elements, arg);
  var text = JSON.stringify([scan.truncated, scan.kept.map(function (k) { return k.f; })]);
  var h1 = 0x811c9dc5 | 0, h2 = 0x2545f491 | 0;
  for (var c = 0; c < text.length; c++) {
    var ch = text.charCodeAt(c);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ ch, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  var key = text.length.toString(16) + "-" + (h1 >>> 0).toString(16) + "-" + (h2 >>> 0).toString(16);
  if (arg.known === key) return { key: key, same: true };
  return { key: key, same: false, truncated: scan.truncated, kept: scan.kept };
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
let lookAlikeScan: PageFunction<LocalScanArg & { known: string }, { key: string; same: boolean; truncated?: boolean; kept?: RawLocalScan["kept"] }> | undefined;
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
 * L12.27 (awkit-djnl.21.27): the local snapshot's page walk for the look-alike memory, which every passing resolve now
 * runs. `key` is taken in the page from the same walk as the candidates (LOOK_ALIKE_SCAN), so it can never describe
 * another moment of the page. With `known` equal to it the result is `same` and nothing else crosses from the page
 * (shipping and hashing 400 fingerprints was most of the cost on a 400-row table): the caller keeps its set, which
 * would come out the same.
 */
export async function scanLookAlikes(
  list: Locator,
  expected: Pick<LocatorElementFingerprint, "tag" | "role">,
  known?: string
): Promise<{ key: string; same: true } | { key: string; same: false; truncated: boolean; candidates: Array<{ index: number; fingerprint: LocatorElementFingerprint }> }> {
  lookAlikeScan ??= pageFunction<LocalScanArg & { known: string }, { key: string; same: boolean; truncated?: boolean; kept?: RawLocalScan["kept"] }>(LOOK_ALIKE_SCAN);
  const raw = await list.evaluateAll(lookAlikeScan, { tag: expected.tag, role: expected.role ?? "", cap: SNAPSHOT_PRUNED_CAP, known: known ?? "" });
  if (raw.same) return { key: raw.key, same: true };
  const hash = createFingerprintHasher();
  return { key: raw.key, same: false, truncated: raw.truncated === true, candidates: (raw.kept ?? []).map(({ i, f }) => ({ index: i, fingerprint: hash(f) })) };
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
