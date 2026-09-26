/**
 * verify:ai-authoring-review — L4b's explanation quality target (owner decision 1, adopted provisionally
 * 2026-09-22, thresholds as proposed in L4) over every captured run of the CURRENT request and a
 * person's verdicts (owner decision 3). The store and its privacy rules: scripts/ai-harness/authoringQualityReview.ts.
 *
 *   npm run verify:ai-authoring-review                 the target, criterion by criterion
 *   npm run verify:ai-authoring-review -- --pending    every captured explanation still awaiting a person
 *   npm run verify:ai-authoring-review -- --record <item id> --correct yes|no --actionable yes|no
 *       --grounded yes|no --unsupported yes|no [--misattributed yes|no] --reviewer <label> [--note <text>]
 *
 * A person records verdicts; an agent never does. Captures of an earlier request (other instructions)
 * are listed and ignored. Every captured explanation is judged by today's judge, in memory, and each one it
 * reads differently from its capture is listed; a capture file is never rewritten. Exit 0 only when the target is MET, or NOT RUN when nothing of the current
 * request is captured; PENDING, NOT MET and an unreadable store exit 1, because none of them is acceptance.
 *
 * L4b's delivered-experience acceptance (owner, 2026-09-25, option B; scripts/ai-harness/authoringDx.ts):
 *   npm run verify:ai-authoring-review -- --dx            DX-0 and DX-2 to DX-5; exit 0 MET, 1 NOT MET, 2 PENDING
 *   npm run verify:ai-authoring-review -- --dx --pending  every fresh text of the current revision with the automated
 *       DX-3 reading of it (owner, 2026-09-26: no person reads), displayed and withheld alike, in item-id order
 *   npm run verify:ai-authoring-review -- --held-out  check the held-out flows' structure and show their
 *       inventory; the first valid run writes inventory.json to commit beside them, later runs compare with it.
 *       Exit 0 valid, 1 invalid, 2 none yet
 * Named scripts, since the lease guard refuses arguments: verify:ai-authoring-dx, verify:ai-authoring-dx-pending,
 * verify:ai-authoring-held-out.
 */

import fs from "node:fs";
import path from "node:path";

import { buildAuthoringRequest } from "@src/ai/authoringExplanation";
import { AI_RUNTIME_PIN } from "@src/offline/AiModelManifest";
import { writeJsonFileAtomic } from "@src/session/atomicWrite";
import { validateFlowDefinition } from "@src/validation/FlowValidator";

import { DX0, HELD_OUT_DIR, currentDx0Problems, dxReadings, evaluateDx, heldOutCommitProblems, heldOutRequest, inventoryPath, readHeldOut } from "./ai-harness/authoringDx";
import { LABELLED_SET } from "./ai-harness/authoringQualitySet";
import { evaluateQualityTarget, instructionsSha256, isGenuineReviewer, loadReviewStore, recordVerdict, requiredReading, rereadCapture, reviewDir, QUALITY_TARGET, type ReviewItem } from "./ai-harness/authoringQualityReview";

const heldOutDir = path.resolve(HELD_OUT_DIR);
const heldOut = readHeldOut(heldOutDir);
const requestFor = (caseId: string) => {
  const labelled = LABELLED_SET.find((c) => c.id === caseId);
  if (labelled) return buildAuthoringRequest(validateFlowDefinition(labelled.flow, { referenceableFlowIds: new Set([labelled.flow.id]) }));
  const flow = heldOut.ok ? heldOut.flows.get(caseId) : undefined;
  return flow ? heldOutRequest(flow) : undefined;
};
const probe = requestFor(LABELLED_SET[0].id);
if (!probe) throw new Error("the labelled set builds no request");
const current = instructionsSha256(probe);
const dir = reviewDir();
const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

if (args[0] === "--record") {
  const yesNo = (name: string) => (flag(name) === "yes" ? true : flag(name) === "no" ? false : undefined);
  const result = await recordVerdict(dir, {
    itemId: args[1] ?? "",
    correct: yesNo("--correct") as boolean,
    actionable: yesNo("--actionable") as boolean,
    grounded: yesNo("--grounded") as boolean,
    unsupportedClaim: yesNo("--unsupported") as boolean,
    // Anything but yes or no reaches recordVerdict as a non-boolean, which it refuses.
    ...(flag("--misattributed") !== undefined ? { misattributed: (yesNo("--misattributed") ?? null) as unknown as boolean } : {}),
    reviewer: flag("--reviewer") ?? "",
    ...(flag("--note") !== undefined ? { note: flag("--note") } : {})
  });
  console.log(result.ok ? `recorded ${args[1]}` : `REFUSED: ${result.reason}`);
  process.exit(result.ok ? 0 : 1);
}

// The held-out set's structure and inventory. No model, no display gate: nothing here previews a case's answer.
if (args[0] === "--held-out") {
  const where = path.relative(process.cwd(), heldOutDir);
  if (!heldOut.ok) {
    console.log(`L4b held-out set in ${where}: ${heldOut.notProvided ? "NOT PROVIDED" : "INVALID"}`);
    for (const p of heldOut.problems) console.log(`  ✗ ${p}`);
    process.exit(heldOut.notProvided ? 2 : 1);
  }
  const inv = heldOut.inventory;
  console.log(`L4b held-out set in ${where}: ${inv.cases.length} flow(s), ${inv.issues} issue(s) sent, corpus sha256 ${inv.corpusSha256}`);
  for (const c of inv.cases) console.log(`  ${c.id}  ${c.file}  sends ${c.sent.map((s) => `${s.code}${s.fixable ? "+fix" : ""}${s.blocking ? "+blocks" : ""}`).join(", ")}${c.truncated > 0 ? `; ${c.truncated} more not sent` : ""}`);
  // Written once: a later change to the flows shows as a mismatch, never as a quietly rewritten inventory.
  if (!fs.existsSync(inventoryPath(heldOutDir))) {
    await writeJsonFileAtomic(inventoryPath(heldOutDir), inv);
    console.log(`wrote ${path.relative(process.cwd(), inventoryPath(heldOutDir))}: commit it with the flows before any fresh run`);
    process.exit(0);
  }
  const problems = heldOutCommitProblems(heldOutDir, inv);
  console.log(problems.length === 0 ? "committed: inventory.json matches the flows, and both are committed" : `not committed yet: ${problems.join("; ")}`);
  process.exit(0);
}

const store = loadReviewStore(dir);
// Every capture is judged by TODAY's judge, in memory; the files keep the reading they were taken with.
// Today's display gate (R4) too, so the target counts what the designer shows now.
const rereads = store.captures.map((c) => rereadCapture(c, requestFor));
const captures = rereads.map((r) => r.capture).filter((c) => c.instructionsSha256 === current);
const byPerson = store.verdicts.filter((v) => isGenuineReviewer(v.reviewer));
const notCounted = store.verdicts.filter((v) => !isGenuineReviewer(v.reviewer));
const verdictOf = new Map(byPerson.map((v) => [v.itemId, v]));
console.log(`L4b explanation quality target (adopted ${QUALITY_TARGET.adopted})`);
console.log(`  review store: ${dir}`);
console.log(`  current request: instructions sha256 ${current}`);
console.log(`  captures: ${captures.length} of the current request, ${store.captures.length - captures.length} of an earlier one (ignored); verdicts: ${byPerson.length} by a person, ${notCounted.length} kept for audit and never counted`);
for (const v of notCounted) console.log(`    not counted: ${v.itemId} under reviewer "${v.reviewer}" (a placeholder or an agent), recorded ${v.reviewedAt}`);
if (store.malformed.length > 0) console.error(`  ✗ unreadable: ${store.malformed.join(", ")}`);
const shown = store.captures.reduce((n, c) => n + c.items.filter((i) => i.text !== null).length, 0);
const changed = rereads.flatMap((r) => r.changed.map((c) => ({ ...c, retained: r.instructionsRetained })));
const reading = (j: ReviewItem["judged"]) => `${j.category}${j.unsupported.length > 0 ? ` [${j.unsupported.join(", ")}]` : ""}${j.actionable ? ", actionable" : ""}`;
console.log(`  re-read by today's judge: ${rereads.reduce((n, r) => n + r.reread, 0)} of ${shown} captured explanation(s) (the rest keep their captured reading: today's labelled set sends other codes under their ids); ${changed.length} read differently:`);
for (const c of changed) console.log(`    ${c.itemId} ${c.code}: ${reading(c.before)} → ${reading(c.after)}${c.retained ? "" : " (against its Issues lines; that request's instructions are not retained)"}`);

if (args[0] === "--dx") {
  const commitProblems = heldOut.ok ? heldOutCommitProblems(heldOutDir, heldOut.inventory) : heldOut.problems;
  const committed = heldOut.ok && commitProblems.length === 0 ? heldOut.inventory : null;
  const read = rereads.map((r) => r.capture);
  if (args.includes("--pending")) {
    const readings = dxReadings(read, committed);
    console.log(`\n${readings.length} fresh text(s) of revision ${DX0.revision}, each with the automated DX-3 reading (owner, 2026-09-26: no person reads), in item-id order.\n`);
    for (const { item, reading } of readings) {
      console.log(item.id);
      console.log(`  ${item.caseId.startsWith("ho-") ? "held-out" : "labelled"} case ${item.caseId}, ${item.issueId} ${item.code} (${item.blocking ? "blocks the run" : "does not block the run"}, ${item.fixable ? "fixable" : "no emitted fix"})`);
      console.log(`  evidence: ${item.evidence}`);
      console.log(`  AI text:  ${item.text ?? "(not kept: something sensitive survived redaction)"}`);
      console.log(`  display:  ${item.displayWithheld ? `withheld by the gate (${item.displayWithheld.join(", ")})` : "shown"}`);
      console.log(`  DX-3:     ${reading.correct ? "correct" : "not correct"}, ${reading.actionable ? "actionable" : "not actionable"}${reading.onSubject ? "" : ", off subject"}${reading.judgeable ? "" : ", no judge rule"}${reading.defects.length > 0 ? `; defects ${reading.defects.join(", ")}` : ""}\n`);
    }
    process.exit(0);
  }
  const dx = evaluateDx(read, committed, currentDx0Problems(current, AI_RUNTIME_PIN.build));
  const adopted = captures.some((c) => c.modelId === DX0.modelId) ? evaluateQualityTarget(captures.filter((c) => c.modelId === DX0.modelId), store.verdicts, LABELLED_SET.map((c) => c.id)).verdict : "NOT MET (nothing captured)";
  console.log(`\nL4b delivered experience (DX): owner decisions 2026-09-25 (option B, cap 25 % per run, held-out set) and 2026-09-26 (DX-3 automated)`);
  console.log(`  DX-0 revision ${DX0.revision}, frozen at ${DX0.commit}: pack ${DX0.modelSha256.slice(0, 8)}, runtime ${DX0.runtimeBuild}, request ${DX0.instructionsSha256.slice(0, 8)}, ${Object.keys(DX0.blobs).length} source blobs`);
  console.log(`  held-out set: ${committed ? `committed, ${committed.cases.length} flow(s), ${committed.issues} issue(s), corpus sha256 ${committed.corpusSha256}` : heldOut.ok ? `NOT committed (${commitProblems.join("; ")})` : heldOut.notProvided ? "not provided yet" : `invalid (${commitProblems.join("; ")})`}`);
  console.log(`  the adopted quality target, unchanged and never passed by DX: ${adopted}`);
  console.log("  DX-1 deterministic guidance: proven by verify:ai-authoring §14 and verify:ai-assist-gui on the accepted build, run separately; not computed here");
  for (const r of dx.runs) console.log(`  ${r.corpus} run ${r.run}: ${r.displayed}/${r.sent} displayed; not displayed: ${r.gateWithheld} by the gate, ${r.secretWithheld} for a residual secret, ${r.undelivered} undelivered`);
  for (const c of dx.criteria) console.log(`  ${c.status === "MET" ? "✓" : c.status === "PENDING" ? "…" : "✗"} ${c.id} ${c.label}: ${c.status} — ${c.detail}`);
  if (store.malformed.length > 0) console.error(`  ✗ unreadable store file(s), which may hide a capture: ${store.malformed.join(", ")}`);
  console.log(`  DX (DX-0, DX-2 to DX-5): ${dx.verdict}${dx.verdict === "MET" ? "; L4b closes only with DX-1's two gates PASS on the accepted build as well" : ""}`);
  process.exit(dx.verdict === "MET" && store.malformed.length === 0 ? 0 : dx.verdict === "PENDING" && store.malformed.length === 0 ? 2 : 1);
}

if (args[0] === "--pending") {
  const pending = captures.flatMap((c) => c.items).filter((i) => !verdictOf.has(i.id));
  console.log(`\n${pending.length} captured explanation(s) await a person (required ones are the target's criteria 1 and 4)\n`);
  for (const item of pending) {
    const required = requiredReading(item);
    const why = required === null ? "optional" : `required: ${required}${required === "screen hit" ? ` ${item.judged.unsupported.join(", ")}` : ""}`;
    console.log(`${item.id}  [${why}]`);
    console.log(`  case ${item.caseId}, ${item.issueId} ${item.code} (${item.blocking ? "blocks the run" : "does not block the run"}, ${item.fixable ? "fixable" : "no emitted fix"})`);
    console.log(`  evidence: ${item.evidence}`);
    console.log(`  answer:   ${item.text ?? "(withheld: something sensitive survived redaction)"}`);
    if (item.displayWithheld) console.log(`  not shown to the person: the product's display gate withheld it (${item.displayWithheld.join(", ")})`);
    if (item.step) console.log(`  shown beside it, the rule step: ${item.step}`);
    console.log(`  proxy:    on subject ${item.judged.onSubject ? "yes" : "no"}, actionable ${item.judged.actionable ? "yes" : "no"}, ${item.judged.category}\n`);
  }
  process.exit(0);
}

if (captures.length === 0) {
  console.log("\nNOT RUN: nothing of the current request is captured; run verify:ai-authoring-quality-live-part1 and -part2 (twice for criterion 6).");
  process.exit(store.malformed.length > 0 ? 1 : 0);
}

let met = store.malformed.length === 0;
for (const modelId of [...new Set(captures.map((c) => c.modelId))]) {
  const evaluation = evaluateQualityTarget(
    captures.filter((c) => c.modelId === modelId),
    store.verdicts,
    LABELLED_SET.map((c) => c.id)
  );
  console.log(`\n${modelId}: ${evaluation.completeRuns} complete run(s)`);
  for (const r of evaluation.runs) {
    console.log(`  run ${r.run}: ${r.delivered}/${LABELLED_SET.length} delivered, ${r.onSubject}/${r.sent} on subject, ${r.visibleActionable}/${r.sent} with a corrective action a person sees, ${r.actionable}/${r.sent} actionable in the model's own text (${r.repeatsProductAction} repeating the product's action), ${r.misattributed} misattributed, ${r.ranked} ranked, ${r.orderViolations} order violation(s), ${r.withheld} withheld; ${r.answersWithheld} explanation(s) withheld from display by the product's gate (R4)`);
  }
  const rv = evaluation.review;
  console.log(`  review: ${rv.screenClearReviewed}/${rv.screenClear} screen-clear, ${rv.screenHitsReviewed}/${rv.screenHits} screen hits and ${rv.causalClaimsReviewed}/${rv.causalClaims} other causal claims reviewed; ${rv.confirmedUnsupported} unsupported claim(s) confirmed by a person`);
  for (const c of evaluation.criteria) console.log(`  ${c.status === "MET" ? "✓" : c.status === "PENDING" ? "…" : "✗"} (${c.id}) ${c.label}: ${c.status} — ${c.detail}`);
  console.log(`  TARGET: ${evaluation.verdict}`);
  met &&= evaluation.verdict === "MET";
}
process.exit(met ? 0 : 1);
