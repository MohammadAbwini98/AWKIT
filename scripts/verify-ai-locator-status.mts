/**
 * verify:ai-locator-status — the Intelligent Locator status vocabulary (Phase L, L3 §10).
 *
 * `verify:ai-locator-upgrade-gui` proves the surface in the real app; this proves the table behind
 * it, which is where a badge actually becomes wrong. Every case is built from a real `FlowProfile`
 * and pushed through the SAME `describeFlowLocatorUpgrades` the IPC channel calls, so what is
 * asserted is the view a renderer would receive — not a hand-made object shaped like one.
 *
 * What it is looking for, in the words of the §10 rules it enforces:
 *   - a proposal is never "verified" because it compiled, and never "applied" because it is eligible;
 *   - capture proof is not replay eligibility, and replay eligibility is not authorization;
 *   - a refusal never reads as a success, and a success never reads as an AI repair;
 *   - absent evidence renders as unavailable, never as a gate that passed;
 *   - a missing AI runtime is never reported as a locator, Recorder or Runner fault;
 *   - nothing sensitive reaches a view or an evidence row.
 *
 * Pure: no Electron, no browser, no filesystem. Run: npm run verify:ai-locator-status
 */
import {
  appliedEvidence,
  pendingEvidence,
  qualityEvidence,
  resolveLocatorStatus,
  type LocatorBadgeId,
  type LocatorEvidenceRow,
  type LocatorStatusStateId
} from "@src/ai/locatorStatus";
import { describeFlowLocatorUpgrades, type LocatorPromotionRefusal } from "@src/ai/locatorPromotion";
import { createPendingUpgrade, mergeReplayProof, pendingUpgradeDigests, LOCATOR_UPGRADE_REPLAY_POLICY, type LocatorReplayProofRecord } from "@src/ai/pendingUpgrade";
import { compileLocatorPlan } from "@src/ai/locatorPlan";
import type { FlowProfile, FlowStep, LocatorElementFingerprint, LocatorProvenance, PendingProofEvidence, StepLocator } from "@src/profiles/FlowProfile";
import { createLocatorApprovalBinding, hasPositionalIdentityGuard } from "@src/profiles/locatorApproval";
import { classifyLocatorQuality } from "@src/recorder/LocatorQualityClass";
import { decideAiAction, type AiPolicyConfig } from "@src/security/authz/AiAutonomyPolicy";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const FLOW_ID = "l3-status";
const STEP_ID = "step-archive";
const ENABLED: AiPolicyConfig = { enabled: true };
const COMMITTED = { ...LOCATOR_UPGRADE_REPLAY_POLICY, committed: true };

// A typed value and a named secret that must never surface anywhere in a view or an evidence row.
const SECRET_NAME = "prod-archive-token";
const TYPED_VALUE = "Quarterly report 2026";

const guardedLocator: StepLocator = {
  strategy: "css",
  value: "#lu-archive-visible",
  resolution: "resolved",
  resolvedBy: "recorder",
  quality: { strategy: "css", isUnique: true, matchCount: 1, confidence: "medium" }
};

const semanticLocator: StepLocator = {
  strategy: "testId",
  value: "archive-button",
  resolution: "resolved",
  resolvedBy: "recorder",
  quality: { strategy: "testId", isUnique: true, matchCount: 1, confidence: "high" }
};

const stepWith = (locator: StepLocator, extra: Partial<FlowStep> = {}): FlowStep => ({
  id: STEP_ID,
  type: "click",
  name: "Archive item",
  position: { x: 0, y: 0 },
  value: TYPED_VALUE,
  valueSource: { type: "secret", value: SECRET_NAME },
  locator,
  ...extra
});

const flowWith = (step: FlowStep): FlowProfile => ({
  id: FLOW_ID,
  name: "L3 status",
  description: "Fixture for verify:ai-locator-status",
  version: 1,
  nodes: [step],
  edges: []
});

const PLAN = { version: 1, target: { strategy: "role", value: "button", name: "Archive", exact: true }, scopes: [] };

function proposalFor(
  step: FlowStep,
  options: { proof: "capture-proven" | "unprovable-now"; evidence?: PendingProofEvidence; createdAt?: string }
): FlowStep {
  const compiled = compileLocatorPlan(PLAN, step.locator?.context);
  if (!compiled.ok) throw new Error(`fixture plan did not compile: ${compiled.code}`);
  const pending = createPendingUpgrade({
    step,
    compiled,
    meaningChange: false,
    proof: options.proof,
    ...(options.evidence ? { proofEvidence: options.evidence } : {}),
    modelId: "fixture-provider",
    now: new Date(options.createdAt ?? "2026-09-20T10:00:00.000Z")
  });
  if (!pending) throw new Error("fixture produced no pending candidate");
  return { ...step, locator: { ...step.locator!, pendingUpgrade: pending } };
}

/** A tally for the step exactly as it stands, so the digests match rather than being assumed to. */
function tallyFor(step: FlowStep, outcomes: readonly { outcome: "proven" | "rejected"; rowKey: string }[]): LocatorReplayProofRecord[] {
  const digests = pendingUpgradeDigests(step);
  if (!digests) throw new Error("fixture step produced no digests");
  const scopeKey = ["fixture-scenario", FLOW_ID, STEP_ID].join(String.fromCharCode(0));
  let record: LocatorReplayProofRecord | undefined;
  for (const entry of outcomes) {
    record = mergeReplayProof(record, { scopeKey, ...digests, outcome: entry.outcome, code: entry.outcome === "proven" ? "PROVEN" : "WRONG_ELEMENT", rowKey: entry.rowKey, now: new Date() });
  }
  return record ? [record] : [];
}

/** The whole path a renderer sees: profile → main's view → the §10 table. */
function statusOf(
  step: FlowStep,
  options: { proofs?: readonly LocatorReplayProofRecord[]; policy?: AiPolicyConfig; editorDirty?: boolean; replayPolicy?: typeof LOCATOR_UPGRADE_REPLAY_POLICY } = {}
) {
  const profile = flowWith(step);
  const view = describeFlowLocatorUpgrades({
    profile,
    replayProofs: options.proofs ?? [],
    policy: options.policy ?? ENABLED,
    editorDirty: options.editorDirty ?? false,
    ...(options.replayPolicy ? { replayPolicy: options.replayPolicy } : {})
  });
  const pending = view.pending.find((entry) => entry.stepId === STEP_ID);
  const applied = view.applied.find((entry) => entry.stepId === STEP_ID);
  const quality = classifyLocatorQuality(step.locator);
  const status = resolveLocatorStatus({ quality, pending, applied, editorDirty: options.editorDirty ?? false });
  const evidence: LocatorEvidenceRow[] = [...qualityEvidence(quality), ...(pending ? pendingEvidence(pending) : []), ...(applied ? appliedEvidence(applied) : [])];
  return { view, pending, applied, status, evidence };
}

const row = (evidence: readonly LocatorEvidenceRow[], id: string): LocatorEvidenceRow | undefined => evidence.find((entry) => entry.id === id);

/**
 * One case, asserted on badge AND state AND whether Apply may be offered. Asserting all three is the
 * point: a badge alone cannot distinguish "proven" from "applied", and `applyOffered` is the field a
 * wrong table would get wrong most quietly.
 */
function expect(label: string, actual: { badge: LocatorBadgeId; state: LocatorStatusStateId; applyOffered: boolean; headline: string }, want: { badge: LocatorBadgeId; state: LocatorStatusStateId; applyOffered: boolean }): void {
  check(
    label,
    actual.badge === want.badge && actual.state === want.state && actual.applyOffered === want.applyOffered,
    `badge=${actual.badge} state=${actual.state} apply=${actual.applyOffered} (wanted ${want.badge}/${want.state}/${want.applyOffered}) — ${actual.headline}`
  );
}

console.log("\n1. A locator with no AI proposal reports what it IS, and never an AI state");
{
  const semantic = statusOf(stepWith(semanticLocator));
  expect("a strong semantic locator is Semantic", semantic.status, { badge: "semantic", state: "no-upgrade", applyOffered: false });
  check("...and its evidence names the class and the deciding reason", row(semantic.evidence, "quality")?.value === "Strong semantic" && semantic.evidence.some((entry) => entry.id.startsWith("quality-reason-")));
  check("...with no proposal or provenance invented for it", semantic.pending === undefined && semantic.applied === undefined);

  const guarded = statusOf(stepWith(guardedLocator));
  expect("a CSS locator that needs review is Guarded", guarded.status, { badge: "guarded", state: "no-upgrade", applyOffered: false });

  // Built from the real contracts rather than cast: `hasPositionalIdentityGuard` reads the guard's
  // own fields, so a fixture shaped loosely enough to compile could be classified review-required
  // and the check below would pass for the wrong reason.
  const fingerprint: LocatorElementFingerprint = { tag: "button", role: "button", name: "Archive", text: "Archive", attributes: {}, ancestry: ["ul", "li"] };
  const positionalLocator: StepLocator = {
    strategy: "css",
    value: "li:nth-child(3) button",
    resolution: "resolved",
    quality: { strategy: "fallback", isUnique: true, matchCount: 1, confidence: "low", disambiguation: "positional" },
    identity: {
      schemaVersion: 1,
      primary: { strategy: "css", value: "li:nth-child(3) button" },
      owner: { tag: "button", role: "button" },
      fingerprint,
      confidence: { level: "guarded", basis: ["fingerprint", "position"] }
    },
    guard: { candidateSelector: "li button", fingerprint, siblingCount: 6, index: 2, confidence: "high" }
  };
  check("the positional fixture really is a guarded positional locator", hasPositionalIdentityGuard({ locator: positionalLocator }));
  const positional = statusOf(stepWith(positionalLocator));
  expect("a guarded positional locator is Guarded too", positional.status, { badge: "guarded", state: "no-upgrade", applyOffered: false });
  check("...and says its position is re-proven before every action", /re-proven/i.test(JSON.stringify(positional.evidence)));
}

console.log("\n2. A proposal is never reported as proof it does not have");
{
  const unproven = statusOf(proposalFor(stepWith(guardedLocator), { proof: "unprovable-now" }));
  expect("a candidate no browser proof ran for is pending proof", unproven.status, { badge: "pending-proof", state: "proposed-unproven", applyOffered: false });
  check("...and says it is never executed", /never executed/i.test(unproven.status.headline));
  check("...with the saved locator named as the one still in use", row(unproven.evidence, "current")?.value.includes("#lu-archive-visible") === true);

  const captured = statusOf(proposalFor(stepWith(guardedLocator), { proof: "capture-proven" }));
  expect("a capture-proven candidate with no replays is AI semantic, not applied", captured.status, { badge: "ai-semantic", state: "capture-proven", applyOffered: false });
  check("...labelled capture-proven rather than replay-proven", captured.status.label === "AI semantic (capture-proven)", captured.status.label);
  check("...and not offered for apply", captured.pending?.promotable === false && captured.pending.blockedReason === "PROOF_NOT_SATISFIED", JSON.stringify(captured.pending?.blockedReason));
}

console.log("\n3. Replay evidence is counted, and never rounded up");
{
  const step = proposalFor(stepWith(guardedLocator), { proof: "capture-proven" });
  const partial = statusOf(step, { proofs: tallyFor(step, [{ outcome: "proven", rowKey: "row-a" }]) });
  expect("one passing replay is still short of the policy", partial.status, { badge: "ai-semantic", state: "replay-partial", applyOffered: false });
  check("...and the evidence states both counts against their thresholds", /1 of 3 passing replays, across 1 of 2 distinct data rows/.test(row(partial.evidence, "replay")?.value ?? ""), row(partial.evidence, "replay")?.value);

  const sameRow = statusOf(step, { proofs: tallyFor(step, [{ outcome: "proven", rowKey: "row-a" }, { outcome: "proven", rowKey: "row-a" }, { outcome: "proven", rowKey: "row-a" }]) });
  expect("three replays on ONE data row do not satisfy the policy", sameRow.status, { badge: "ai-semantic", state: "replay-partial", applyOffered: false });
  check("...reporting 3 replays but only 1 distinct row", /3 of 3 passing replays, across 1 of 2/.test(row(sameRow.evidence, "replay")?.value ?? ""), row(sameRow.evidence, "replay")?.value);

  const rejected = statusOf(step, { proofs: tallyFor(step, [{ outcome: "proven", rowKey: "row-a" }, { outcome: "rejected", rowKey: "row-b" }]) });
  expect("one refusal makes the suggestion rejected, whatever passed before it", rejected.status, { badge: "rejected", state: "replay-rejected", applyOffered: false });
  check("...and says it can never be applied", /never be applied/i.test(rejected.status.headline));
  check("...with the refusal in the evidence rather than a passing tally", /Refused on a run/.test(row(rejected.evidence, "replay")?.value ?? ""), row(rejected.evidence, "replay")?.value);

  const eligible = statusOf(step, { proofs: tallyFor(step, [{ outcome: "proven", rowKey: "row-a" }, { outcome: "proven", rowKey: "row-b" }, { outcome: "proven", rowKey: "row-c" }]) });
  expect("enough replays across enough rows is eligible and offers Apply", eligible.status, { badge: "ai-semantic", state: "eligible", applyOffered: true });
  check("...labelled replay-proven", eligible.status.label === "AI semantic (replay-proven)", eligible.status.label);
  check("...and the saved locator is still described as the one in use", row(eligible.evidence, "current")?.value.includes("#lu-archive-visible") === true);
}

console.log("\n4. Eligibility is not authorization");
{
  const step = proposalFor(stepWith(guardedLocator), { proof: "capture-proven" });
  const proofs = tallyFor(step, [{ outcome: "proven", rowKey: "row-a" }, { outcome: "proven", rowKey: "row-b" }, { outcome: "proven", rowKey: "row-c" }]);

  const dirty = statusOf(step, { proofs, editorDirty: true });
  expect("unsaved editor changes defer a fully proven upgrade", dirty.status, { badge: "ai-semantic", state: "deferred-editor-dirty", applyOffered: false });
  check("...telling the user what to do about it", /Save the flow/.test(dirty.status.headline), dirty.status.headline);
  check("...while main's own dry run still reports the candidate itself as ready", dirty.pending?.promotable === true);

  const off = statusOf(step, { proofs, policy: { enabled: false } });
  expect("the AI master switch off blocks the apply without changing the proof", off.status, { badge: "ai-semantic", state: "blocked", applyOffered: false });
  check("...naming the settings, not a locator fault", /not permitted to change locators/.test(off.status.headline), off.status.headline);

  // T3 comes from the step's own safety policy and step type, never from a flag a fixture invents:
  // the precondition is asserted against `decideAiAction` first, so a fixture that stopped being T3
  // fails here rather than quietly proving that a non-sensitive step is allowed.
  const dangerous = stepWith(guardedLocator, { safety: { sideEffectLevel: "dangerousMutation", retryable: false } } as Partial<FlowStep>);
  check("the sensitive fixture really is T3 to the autonomy policy", decideAiAction("locatorSemanticUpgrade", "locatorChange", { step: dangerous }, ENABLED).reason === "T3_SENSITIVE_STEP");
  const sensitive = proposalFor(dangerous, { proof: "capture-proven" });
  const t3 = statusOf(sensitive, { proofs: tallyFor(sensitive, [{ outcome: "proven", rowKey: "row-a" }, { outcome: "proven", rowKey: "row-b" }, { outcome: "proven", rowKey: "row-c" }]) });
  check("a sensitive step is refused as T3, never as missing evidence", t3.pending?.blockedReason === "T3_SENSITIVE_STEP", String(t3.pending?.blockedReason));
  check("...and says AI never changes that kind of step", /never changes/i.test(t3.status.headline), t3.status.headline);
  check("...with Apply neither offered nor shown, although the replay evidence is complete", t3.status.applyOffered === false && t3.status.applyVisible === false && t3.pending?.replays === 3);
  expect("...badged as rejected, in the forbidden state", t3.status, { badge: "rejected", state: "forbidden", applyOffered: false });

  // T3 outranks the proposal's own lifecycle: an UNPROVEN candidate on a step that became sensitive
  // must not read as "not proven yet", which would imply more replays would eventually allow it.
  const unprovenOnT3 = statusOf(proposalFor(dangerous, { proof: "unprovable-now" }));
  expect("an unproven candidate on a sensitive step is forbidden, not merely unproven", unprovenOnT3.status, { badge: "rejected", state: "forbidden", applyOffered: false });
  check("...and never offers a control that implies more proof would help", unprovenOnT3.status.applyVisible === false);

  const loginStep = stepWith(guardedLocator, { type: "protectedLoginHandoff" } as Partial<FlowStep>);
  check("the protected-login fixture really is T3 to the autonomy policy", decideAiAction("locatorSemanticUpgrade", "locatorChange", { step: loginStep }, ENABLED).reason === "T3_PROTECTED_LOGIN");
  const login = proposalFor(loginStep, { proof: "capture-proven" });
  const protectedLogin = statusOf(login, { proofs: tallyFor(login, [{ outcome: "proven", rowKey: "row-a" }, { outcome: "proven", rowKey: "row-b" }, { outcome: "proven", rowKey: "row-c" }]) });
  check("a protected sign-in step is refused as protected login", protectedLogin.pending?.blockedReason === "T3_PROTECTED_LOGIN", String(protectedLogin.pending?.blockedReason));
  check("...with its own sentence, not the sensitive-action one", /protected sign-in surface/.test(protectedLogin.status.headline), protectedLogin.status.headline);
  check("...and no Apply control at all", protectedLogin.status.applyOffered === false && protectedLogin.status.applyVisible === false);
  check("...in the forbidden state", protectedLogin.status.state === "forbidden", protectedLogin.status.state);

  const needsReview: StepLocator = { ...guardedLocator, resolution: "needs-review", reviewReason: "identity unproven" };
  const unpromotable = proposalFor(stepWith(needsReview), { proof: "capture-proven" });
  const baseline = statusOf(unpromotable, { proofs: tallyFor(unpromotable, [{ outcome: "proven", rowKey: "row-a" }, { outcome: "proven", rowKey: "row-b" }, { outcome: "proven", rowKey: "row-c" }]) });
  check("a locator that still needs review cannot be replaced by an upgrade", baseline.pending?.blockedReason === "BASELINE_NOT_PROMOTABLE", String(baseline.pending?.blockedReason));
  expect("...and the badge says blocked, not applied", baseline.status, { badge: "ai-semantic", state: "blocked", applyOffered: false });
}

console.log("\n5. A stale proposal is refused, not silently carried over");
{
  const step = proposalFor(stepWith(guardedLocator), { proof: "capture-proven" });
  // Edit the step after the proposal: the binding no longer matches what was proposed for.
  const edited: FlowStep = { ...step, name: "Archive item (renamed)" };
  const stale = statusOf(edited);
  expect("a proposal for an earlier version of the step is rejected", stale.status, { badge: "rejected", state: "stale", applyOffered: false });
  check("...and says so rather than offering it", /no longer applies/.test(stale.status.headline), stale.status.headline);
}

console.log("\n6. Missing evidence reads as unavailable, never as a gate that passed");
{
  const bare = statusOf(proposalFor(stepWith(guardedLocator), { proof: "capture-proven" }));
  const match = row(bare.evidence, "match-count");
  const identity = row(bare.evidence, "identity");
  check("a candidate stored without a proof record reports no match count", match?.unavailable === true && /not recorded/i.test(match.value), JSON.stringify(match));
  check("...and no identity result", identity?.unavailable === true && /not recorded/i.test(identity.value), JSON.stringify(identity));
  check("...and never claims a gate passed", !/same element/i.test(identity?.value ?? ""), identity?.value);

  const withProof = statusOf(
    proposalFor(stepWith(guardedLocator), {
      proof: "capture-proven",
      evidence: { code: "PROVEN", candidateMatchCount: 1, baselineMatchCount: 1, sameElement: "pass", scope: "compatible" }
    })
  );
  const provenMatch = row(withProof.evidence, "match-count");
  check("a recorded proof reports the candidate's match count", provenMatch?.unavailable !== true && /matched 1 element/.test(provenMatch?.value ?? ""), provenMatch?.value);
  check("...and the baseline's beside it", /saved locator matched 1/.test(provenMatch?.value ?? ""), provenMatch?.value);
  check("...and the same-element identity result", /same element as the saved one/.test(row(withProof.evidence, "identity")?.value ?? ""));
  check("...and that the frame and shadow scope is unchanged", /same frame and shadow scope/.test(row(withProof.evidence, "scope-compat")?.value ?? ""));
  check("...with a proof location", row(withProof.evidence, "proof-location")?.value === "The main page", row(withProof.evidence, "proof-location")?.value);

  const failedIdentity = statusOf(
    proposalFor(stepWith(guardedLocator), {
      proof: "unprovable-now",
      evidence: { code: "BASELINE_IDENTITY_CHANGED", candidateMatchCount: 2, sameElement: "not-run", scope: "not-checked" }
    })
  );
  check("a candidate that matched 2 elements says 2, not 'unique'", /matched 2 elements/.test(row(failedIdentity.evidence, "match-count")?.value ?? ""), row(failedIdentity.evidence, "match-count")?.value);
  check("...an unrun identity gate is unavailable, not a pass", row(failedIdentity.evidence, "identity")?.unavailable === true);
  check("...and the browser proof row says it was NOT checked on the page", /not checked on the page/i.test(row(failedIdentity.evidence, "proof-outcome")?.value ?? ""), row(failedIdentity.evidence, "proof-outcome")?.value);
}

console.log("\n7. An applied upgrade describes the locator that is actually saved");
{
  const promoted: StepLocator = { strategy: "role", value: "button", name: "Archive", exact: true, resolution: "resolved", quality: { strategy: "role", isUnique: true, matchCount: 1, confidence: "high" } };
  const appliedStep: FlowStep = stepWith(promoted);
  const provenance: LocatorProvenance = {
    schemaVersion: 1,
    source: "ai-semantic-upgrade",
    tier: "T1",
    actionId: "ai-upgrade-fixture",
    modelId: "fixture-provider",
    proof: "replay-proven",
    appliedAt: "2026-09-20T11:00:00.000Z",
    binding: createLocatorApprovalBinding(appliedStep)!,
    previous: guardedLocator
  };
  const withProvenance: FlowStep = { ...appliedStep, locator: { ...promoted, locatorProvenance: provenance } };
  const applied = statusOf(withProvenance);
  expect("an applied upgrade is Auto-promoted, and offers no second apply", applied.status, { badge: "promoted", state: "applied", applyOffered: false });
  check("a user-approved apply is not described as automatic", applied.status.label === "AI upgrade applied" && /after your approval/.test(applied.status.headline), applied.status.headline);
  check("the retained previous locator is named as the revert target", row(applied.evidence, "previous")?.value.includes("#lu-archive-visible") === true, row(applied.evidence, "previous")?.value);
  check("...with the class it had", row(applied.evidence, "previous")?.value.includes("Review required") === true, row(applied.evidence, "previous")?.value);
  check("the provenance names the tier, the proof and the model", row(applied.evidence, "authorization")?.value.includes("T1") === true && /Proven on replays/.test(row(applied.evidence, "applied-proof")?.value ?? "") && row(applied.evidence, "model")?.value === "fixture-provider");
  check("a semantic upgrade is never described as a repair", row(applied.evidence, "source")?.value === "Local AI semantic upgrade.", row(applied.evidence, "source")?.value);
  check("revert is offered while the binding still matches", applied.applied?.revertable === true && /One click restores/.test(row(applied.evidence, "revertable")?.value ?? ""));

  const edited: FlowStep = { ...withProvenance, locator: { ...promoted, value: "link", locatorProvenance: provenance } };
  const conflicted = statusOf(edited);
  check("revert is withdrawn once the promoted locator was edited", conflicted.applied?.revertable === false);
  check("...and the evidence says why, marked unavailable", row(conflicted.evidence, "revertable")?.unavailable === true && /edited after this change/.test(row(conflicted.evidence, "revertable")?.value ?? ""));

  const auto: LocatorProvenance = { ...provenance, tier: "T2" };
  const automatic = statusOf({ ...appliedStep, locator: { ...promoted, locatorProvenance: auto } });
  check("a T2 apply IS described as automatic", automatic.status.label === "Auto-promoted" && /automatically/.test(automatic.status.headline), automatic.status.headline);
  check("...and its authorization row says so", /Automatically, on proof/.test(row(automatic.evidence, "authorization")?.value ?? ""));
}

console.log("\n8. Seeded thresholds authorize a reviewed apply, never an unattended one");
{
  const step = proposalFor(stepWith(guardedLocator), { proof: "capture-proven" });
  const proofs = tallyFor(step, [{ outcome: "proven", rowKey: "row-a" }, { outcome: "proven", rowKey: "row-b" }, { outcome: "proven", rowKey: "row-c" }]);
  check("the shipped replay thresholds are still uncommitted", LOCATOR_UPGRADE_REPLAY_POLICY.committed === false);
  const reviewed = statusOf(step, { proofs });
  check("a reviewed user-approved apply is still offered under them", reviewed.status.applyOffered === true && reviewed.status.state === "eligible");
  const committed = statusOf(step, { proofs, replayPolicy: COMMITTED });
  check("...and committing the thresholds does not change what the user is offered", committed.status.state === "eligible" && committed.status.applyOffered === true);
}

console.log("\n9. Nothing sensitive reaches a view or an evidence row");
{
  const step = proposalFor(stepWith(guardedLocator), { proof: "capture-proven", evidence: { code: "PROVEN", candidateMatchCount: 1, sameElement: "pass", scope: "compatible" } });
  const result = statusOf(step, { proofs: tallyFor(step, [{ outcome: "proven", rowKey: "row-a" }, { outcome: "proven", rowKey: "row-b" }, { outcome: "proven", rowKey: "row-c" }]) });
  const serialized = JSON.stringify({ view: result.view, status: result.status, evidence: result.evidence });
  check("the step's typed value never appears", !serialized.includes(TYPED_VALUE), serialized.slice(0, 300));
  check("the named secret never appears", !serialized.includes(SECRET_NAME));
  check("no prompt or instruction text leaks through", !/You propose one replacement locator/.test(serialized));
  check("no row carries a data-row key", !result.evidence.some((entry) => /row-a|row-b|row-c/.test(entry.value)), JSON.stringify(result.evidence.map((entry) => entry.value)).slice(0, 300));
  // The locator VALUES are shown on purpose (§10 compares the two locators); the check is that they
  // are the compiler-validated candidate and the user's own saved selector, nothing else.
  check("the two locators being compared are shown, as §10 requires", serialized.includes("#lu-archive-visible") && serialized.includes("button"));
}

console.log("\n10. Every badge and every state is reachable, and every refusal has its own sentence");
{
  // Cardinality, not coverage-by-assertion: a vocabulary with an unreachable term is a UI promising
  // something the product never shows, and one that collapses two states is a badge that lies.
  const seenBadges = new Set<LocatorBadgeId>();
  const seenStates = new Set<LocatorStatusStateId>();
  const record = (result: ReturnType<typeof statusOf>): void => {
    seenBadges.add(result.status.badge);
    seenStates.add(result.status.state);
  };
  const base = proposalFor(stepWith(guardedLocator), { proof: "capture-proven" });
  const full = tallyFor(base, [{ outcome: "proven", rowKey: "row-a" }, { outcome: "proven", rowKey: "row-b" }, { outcome: "proven", rowKey: "row-c" }]);
  record(statusOf(stepWith(semanticLocator)));
  record(statusOf(stepWith(guardedLocator)));
  record(statusOf(proposalFor(stepWith(guardedLocator), { proof: "unprovable-now" })));
  record(statusOf(base));
  record(statusOf(base, { proofs: tallyFor(base, [{ outcome: "proven", rowKey: "row-a" }]) }));
  record(statusOf(base, { proofs: tallyFor(base, [{ outcome: "rejected", rowKey: "row-a" }]) }));
  record(statusOf({ ...base, name: "renamed" }));
  record(statusOf(base, { proofs: full }));
  record(statusOf(base, { proofs: full, editorDirty: true }));
  record(statusOf(base, { proofs: full, policy: { enabled: false } }));
  record(statusOf(proposalFor(stepWith(guardedLocator, { safety: { sideEffectLevel: "dangerousMutation", retryable: false } } as Partial<FlowStep>), { proof: "capture-proven" })));
  {
    const promoted: StepLocator = { strategy: "role", value: "button", name: "Archive", resolution: "resolved" };
    const appliedStep = stepWith(promoted);
    record(
      statusOf({
        ...appliedStep,
        locator: {
          ...promoted,
          locatorProvenance: {
            schemaVersion: 1,
            source: "ai-semantic-upgrade",
            tier: "T2",
            actionId: "a",
            modelId: "m",
            proof: "replay-proven",
            appliedAt: "2026-09-20T11:00:00.000Z",
            binding: createLocatorApprovalBinding(appliedStep)!,
            previous: guardedLocator
          }
        }
      })
    );
  }
  const ALL_BADGES: LocatorBadgeId[] = ["semantic", "guarded", "pending-proof", "ai-semantic", "rejected", "promoted"];
  const ALL_STATES: LocatorStatusStateId[] = [
    "no-upgrade",
    "proposed-unproven",
    "capture-proven",
    "replay-partial",
    "replay-rejected",
    "stale",
    "eligible",
    "deferred-editor-dirty",
    "blocked",
    "applied",
    "forbidden"
  ];
  check(`all ${ALL_BADGES.length} §10 badges are reachable from real profiles`, seenBadges.size === ALL_BADGES.length && ALL_BADGES.every((badge) => seenBadges.has(badge)), [...seenBadges].join(","));
  check(`all ${ALL_STATES.length} lifecycle states are reachable`, seenStates.size === ALL_STATES.length && ALL_STATES.every((state) => seenStates.has(state)), [...seenStates].join(","));

  // Every refusal a user can actually hit must say something specific. A shared fallback sentence is
  // how "it cannot be applied right now" ends up standing in for a protected-login refusal.
  const REFUSALS: LocatorPromotionRefusal[] = [
    "EDITOR_DIRTY",
    "POLICY_REFUSED",
    "THRESHOLDS_PROVISIONAL",
    "BASELINE_NOT_PROMOTABLE",
    "SUPERSEDED",
    "STALE",
    "T3_SENSITIVE_STEP",
    "T3_PROTECTED_LOGIN",
    "T3_STEP_UNKNOWN"
  ];
  const sentences = REFUSALS.map((reason) => {
    const pending = { ...statusOf(base, { proofs: full }).pending!, promotable: false, blockedReason: reason };
    return resolveLocatorStatus({ quality: classifyLocatorQuality(base.locator), pending, applied: undefined, editorDirty: false }).headline;
  });
  check(`each of the ${REFUSALS.length} refusal codes has its own sentence`, new Set(sentences).size === REFUSALS.length, JSON.stringify(sentences));
  // "Reads as a success" means the sentence a user sees when the upgrade IS applicable. Matching a
  // bare substring is not that test: "…cannot be applied." contains "applied." and is plainly a
  // refusal. The honest comparison is against the two affirmative headlines themselves.
  const affirmative = statusOf(base, { proofs: full }).status.headline;
  check("the eligible case really does read as a success", /ready to apply/.test(affirmative), affirmative);
  check("no refusal sentence is the success sentence", !sentences.includes(affirmative), JSON.stringify(sentences));
  check("and none of them offers the upgrade as ready", !sentences.some((sentence) => /ready to apply|has been applied|was applied/i.test(sentence)), JSON.stringify(sentences));

  // An Apply control is shown-disabled for a "not yet" and hidden for a "never". Asserting both
  // directions is the point: a table that always hid it, or always showed it, would pass one alone.
  const visibility = (reason: LocatorPromotionRefusal): { offered: boolean; visible: boolean } => {
    const pending = { ...statusOf(base, { proofs: full }).pending!, promotable: false, blockedReason: reason };
    const resolved = resolveLocatorStatus({ quality: classifyLocatorQuality(base.locator), pending, applied: undefined, editorDirty: false });
    return { offered: resolved.applyOffered, visible: resolved.applyVisible };
  };
  const notYet: LocatorPromotionRefusal[] = ["EDITOR_DIRTY", "POLICY_REFUSED", "THRESHOLDS_PROVISIONAL", "BASELINE_NOT_PROMOTABLE"];
  const never: LocatorPromotionRefusal[] = ["T3_SENSITIVE_STEP", "T3_PROTECTED_LOGIN", "T3_STEP_UNKNOWN"];
  check(`all ${notYet.length} "not yet" refusals keep a disabled Apply control`, notYet.every((reason) => visibility(reason).visible && !visibility(reason).offered), JSON.stringify(notYet.map(visibility)));
  check(`all ${never.length} T3 refusals hide it entirely`, never.every((reason) => !visibility(reason).visible), JSON.stringify(never.map(visibility)));
  check("a rejected or stale suggestion hides it too", [statusOf(base, { proofs: tallyFor(base, [{ outcome: "rejected", rowKey: "row-a" }]) }).status, statusOf({ ...base, name: "renamed" }).status].every((entry) => !entry.applyVisible));
  check("and a step with no proposal has no Apply control at all", statusOf(stepWith(semanticLocator)).status.applyVisible === false);
  check("while the eligible case shows it enabled", statusOf(base, { proofs: full }).status.applyVisible === true && statusOf(base, { proofs: full }).status.applyOffered === true);
}

console.log(`\nverify:ai-locator-status — ${passed} passed, ${failed} failed`);
if (passed === 0) failed += 1;
process.exit(failed === 0 ? 0 : 1);
