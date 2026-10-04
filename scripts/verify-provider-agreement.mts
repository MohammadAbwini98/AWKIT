/**
 * verify:provider-agreement — the L12 agreement rule (awkit-djnl.21.6) and its run provenance.
 *
 * Pure and fast (no browser, no host). Part A replays the AWKIT ranking and the provider's top picks
 * MEASURED on the L11 acceptance set on 2026-10-04 (benchmark diagnostics), so each case is a real page's
 * numbers, not an invented one: the three cases the rule must accept and every agreeing or high-scoring
 * case it must refuse. Part B checks the rule's own guards one at a time. Part C checks that a recovery the
 * rule accepted is reported as `awkit-provider-agreement` and a rejected one as before.
 *
 * The end-to-end proof (real recorder, real host, real LocatorFactory) is verify:dom-intelligence-acceptance.
 */
import type { LocatorElementFingerprint } from "@src/profiles/FlowProfile";
import type { LocatorRecoveryTrace } from "@src/runner/LocatorFactory";
import { toRecoveryProvenance } from "@src/runner/domIntelligence/recoveryProvenance";
import { fingerprintChanges, hashFingerprint } from "@src/runner/locatorFingerprint";
import {
  AGREEMENT_MIN_IDENTITY,
  AGREEMENT_MIN_PROVIDER_LEAD,
  AGREEMENT_MIN_PROVIDER_SCORE,
  decideProviderAgreement,
  type RecoveryDecision
} from "@src/runner/recoverySnapshot";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

const EXPECTED_ANCESTRY = ["div", "form", "section"];
/** A candidate whose ancestry matches the recorded one in `kept` of 3 levels. */
const candidate = (index: number, score: number, kept = 3) => ({
  index,
  score,
  fingerprint: { tag: "button", role: "button", name: "", text: "", attributes: {}, ancestry: EXPECTED_ANCESTRY.map((entry, i) => (i < kept ? entry : `other-${i}`)) } as LocatorElementFingerprint
});
const decision = (refusal: RecoveryDecision["refusal"], best?: ReturnType<typeof candidate>, runnerUp?: ReturnType<typeof candidate>): RecoveryDecision => ({ refusal, best, runnerUp, considered: 5 });
const ancestryOf = (fraction: number) => (fraction >= 1 ? 3 : fraction >= 0.66 ? 2 : fraction >= 0.33 ? 1 : 0);

interface MeasuredCase {
  id: string;
  expect: "accept" | "refuse";
  refusal: RecoveryDecision["refusal"];
  best?: [number, number, number];
  runnerUp?: [number, number];
  provider: Array<[number, number]>;
}

// [index, AWKIT score, ancestry fraction] / [index, AWKIT score] / [index, provider score], from the 2026-10-04 run.
const MEASURED: MeasuredCase[] = [
  { id: "text-drift", expect: "accept", refusal: "below-threshold", best: [159, 0.833, 1], runnerUp: [158, 0.725], provider: [[159, 98.41], [158, 81.37], [157, 76.16]] },
  { id: "duplicate-text-decoy", expect: "accept", refusal: "ambiguous-margin", best: [164, 0.95, 1], runnerUp: [149, 0.908], provider: [[164, 86.67], [163, 81.37], [162, 76.16]] },
  { id: "field-relabel", expect: "accept", refusal: "below-threshold", best: [155, 0.61, 1], runnerUp: [149, 0.313], provider: [[155, 87.5], [149, 61.61], [151, 61.61]] },
  { id: "list-item-link (lead 1.2)", expect: "refuse", refusal: "ambiguous-margin", best: [44, 0.9, 1], runnerUp: [53, 0.9], provider: [[53, 94.3], [44, 93.13], [62, 93.13]] },
  { id: "aria-retained (disagree)", expect: "refuse", refusal: "below-threshold", best: [159, 0.803, 1], runnerUp: [158, 0.7], provider: [[158, 80.32], [157, 75.1], [159, 72.64]] },
  { id: "same-tag-decoy-target-removed", expect: "refuse", refusal: "below-threshold", best: [158, 0.725, 1], runnerUp: [157, 0.475], provider: [[158, 77.67], [157, 72.46], [27, 60.87]] },
  { id: "other-region-decoy-target-removed", expect: "refuse", refusal: "ancestry-veto", best: [149, 0.908, 0.333], runnerUp: [26, 0.408], provider: [[149, 61.41], [27, 60.87], [26, 51.4]] },
  { id: "page-variant-same-url", expect: "refuse", refusal: "below-threshold", best: [27, 0.408, 0.333], runnerUp: [28, 0.408], provider: [[27, 66.33], [28, 59.97]] },
  { id: "combined-drift (agree, wrong)", expect: "refuse", refusal: "below-threshold", best: [158, 0.725, 1], runnerUp: [160, 0.692], provider: [[158, 75.82], [157, 70.61], [160, 63.15]] },
  { id: "popup, parent target gone", expect: "refuse", refusal: "below-threshold", best: [18, 0.575, 0.333], runnerUp: [8, 0.45], provider: [[8, 80.08], [18, 56.87], [56, 51.05]] },
  { id: "virtualized row unmounted (96.4, lead 0)", expect: "refuse", refusal: "ambiguous-margin", best: [29, 0.975, 1], runnerUp: [32, 0.975], provider: [[29, 96.43], [32, 96.43], [35, 96.43]] },
  { id: "iframe target gone", expect: "refuse", refusal: "no-candidate", provider: [] }
];

console.log("A. Measured acceptance-set cases");
for (const row of MEASURED) {
  const best = row.best && candidate(row.best[0], row.best[1], ancestryOf(row.best[2]));
  const runnerUp = row.runnerUp && candidate(row.runnerUp[0], row.runnerUp[1]);
  const agreed = decideProviderAgreement(decision(row.refusal, best, runnerUp), EXPECTED_ANCESTRY, row.provider.map(([index, score]) => ({ index, score })));
  check(`${row.id}: ${row.expect}`, row.expect === "accept" ? agreed?.index === row.best?.[0] : agreed === undefined, agreed ?? "refused");
}
const accepted = MEASURED.filter((row) => row.expect === "accept").length;
check("the measured set has cases on both sides (3 accepted, 9 refused)", accepted === 3 && MEASURED.length - accepted === 9);

console.log("B. Each guard on its own (starting from an accepted case)");
const base = () => decision("below-threshold", candidate(10, 0.83), candidate(11, 0.7));
const top = (score = 95, lead = 20) => [{ index: 10, score }, { index: 11, score: score - lead }];
check("baseline: accepted", decideProviderAgreement(base(), EXPECTED_ANCESTRY, top())?.index === 10);
check("AWKIT's own winner is never re-decided here", decideProviderAgreement({ ...base(), winner: candidate(10, 0.9) }, EXPECTED_ANCESTRY, top()) === undefined);
check("an ancestry-veto refusal is never overturned", decideProviderAgreement({ ...base(), refusal: "ancestry-veto" }, EXPECTED_ANCESTRY, top()) === undefined);
check("a page-variant refusal is never overturned", decideProviderAgreement({ ...base(), refusal: "page-variant" }, EXPECTED_ANCESTRY, top()) === undefined);
check("a different provider top is refused", decideProviderAgreement(base(), EXPECTED_ANCESTRY, [{ index: 11, score: 95 }, { index: 10, score: 70 }]) === undefined);
check(`provider score just under ${AGREEMENT_MIN_PROVIDER_SCORE} is refused`, decideProviderAgreement(base(), EXPECTED_ANCESTRY, top(AGREEMENT_MIN_PROVIDER_SCORE - 0.01)) === undefined);
check(`provider score at ${AGREEMENT_MIN_PROVIDER_SCORE} is accepted`, decideProviderAgreement(base(), EXPECTED_ANCESTRY, top(AGREEMENT_MIN_PROVIDER_SCORE))?.index === 10);
check(`provider lead just under ${AGREEMENT_MIN_PROVIDER_LEAD} is refused`, decideProviderAgreement(base(), EXPECTED_ANCESTRY, top(95, AGREEMENT_MIN_PROVIDER_LEAD - 0.01)) === undefined);
check("a single provider candidate needs no lead", decideProviderAgreement(base(), EXPECTED_ANCESTRY, [{ index: 10, score: 90 }])?.index === 10);
check(`AWKIT identity just under ${AGREEMENT_MIN_IDENTITY} is refused`, decideProviderAgreement(decision("below-threshold", candidate(10, AGREEMENT_MIN_IDENTITY - 0.001), candidate(11, 0.2)), EXPECTED_ANCESTRY, top()) === undefined);
check("ancestry under half is refused (the veto runs here)", decideProviderAgreement(decision("below-threshold", candidate(10, 0.83, 1), candidate(11, 0.7)), EXPECTED_ANCESTRY, top()) === undefined);
check("below threshold with AWKIT's own margin broken is refused", decideProviderAgreement(decision("below-threshold", candidate(10, 0.83), candidate(11, 0.79)), EXPECTED_ANCESTRY, top()) === undefined);
check("ambiguous margin with a clear provider lead is accepted", decideProviderAgreement(decision("ambiguous-margin", candidate(10, 0.95), candidate(11, 0.93)), EXPECTED_ANCESTRY, top())?.index === 10);
check("no decision, no agreement", decideProviderAgreement(undefined, EXPECTED_ANCESTRY, top()) === undefined);
check("no provider candidates, no agreement", decideProviderAgreement(base(), EXPECTED_ANCESTRY, []) === undefined);

console.log("C. Run provenance");
const trace = (providerOutcome: "proven" | "refused" | "suggested", result: "recovered" | "unresolved", reason?: string): LocatorRecoveryTrace =>
  ({
    engine: "snapshot",
    result,
    totalMs: 60,
    candidatesTried: 1,
    context: { page: "main", frame: "main", frameDepth: 0, route: "match" },
    stages: [
      { stage: "local", outcome: "refused", reason: "below-threshold", ms: 10, candidates: 3, score: 0.83 },
      { stage: "blueprint", outcome: "skipped", reason: "no-blueprint", ms: 0 },
      { stage: "provider", outcome: providerOutcome, ms: 30, candidates: 3, score: 98.4, ...(reason ? { reason } : {}) }
    ],
    suggestion: { provider: "scrapling", candidates: 3, best: { providerScore: 98.4, awkitScore: 0.833, proof: providerOutcome === "suggested" ? "below-threshold" : "agreed" } }
  }) as LocatorRecoveryTrace;
const agreed = toRecoveryProvenance(trace("proven", "recovered"));
check("an agreed recovery is attributed to awkit-provider-agreement", agreed.actedOn === "awkit-provider-agreement", agreed.actedOn);
check("...with a provider-agreement-proven event from AWKIT", agreed.events.some((e) => e.event === "provider-agreement-proven" && e.source === "awkit"));
check("...and its suggestion event no longer claims effect none", agreed.events.some((e) => e.event === "provider-suggestion-generated" && e.effect === undefined));
const notActionable = toRecoveryProvenance(trace("refused", "unresolved", "not-actionable"));
check("an agreed element that cannot act is rejected with its reason", notActionable.events.some((e) => e.event === "provider-suggestion-rejected" && e.reason === "refused:not-actionable"), notActionable.events);
check("...has no actedOn and falls back to the recorded locator", notActionable.actedOn === undefined && notActionable.events.at(-1)?.event === "fallback-used");
check("...and its suggestion is effect none", notActionable.events.some((e) => e.event === "provider-suggestion-generated" && e.effect === "none"));
const rejected = toRecoveryProvenance(trace("suggested", "unresolved"));
check("a plain suggestion is still rejected with AWKIT's proof code", rejected.events.some((e) => e.event === "provider-suggestion-rejected" && e.reason === "below-threshold"));
const awkit = toRecoveryProvenance({ ...trace("suggested", "recovered"), stages: [{ stage: "local", outcome: "proven", ms: 10, candidates: 3, score: 0.95 }], suggestion: undefined });
check("AWKIT's own recovery is still awkit-proof", awkit.actedOn === "awkit-proof");

console.log("D. L12.16 what changed, as field names only");
const recorded = hashFingerprint({ tag: "button", role: "button", name: "save changes", text: "save changes", attributes: { id: "order-save", "data-testid": "save" }, ancestry: ["div", "form", "section"] });
const same = fingerprintChanges(recorded, recorded);
check("an identical element differs in nothing", same.length === 0, same);
const drifted = hashFingerprint({ tag: "button", role: "button", name: "save", text: "save", attributes: { id: "order-save-v2" }, ancestry: ["span", "div", "form"] });
const changes = fingerprintChanges(recorded, drifted);
check("reworded text, a changed id, a removed test id and a moved element are each named", JSON.stringify(changes) === JSON.stringify(["name", "text", "attribute:data-testid", "attribute:id", "position"]), changes);
check("no change code carries a value (only names)", changes.every((code) => !/order|save|v2/.test(code)), changes);
const retagged = fingerprintChanges(recorded, { ...recorded, tag: "a", role: "link" });
check("a different kind of element names tag and role", retagged.includes("tag") && retagged.includes("role"), retagged);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
