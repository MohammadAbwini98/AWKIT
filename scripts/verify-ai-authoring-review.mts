/**
 * verify:ai-authoring-review — L4b's explanation quality target (owner decision 1, adopted provisionally
 * 2026-09-22, thresholds as proposed in L4) over every captured run of the CURRENT request and a
 * person's verdicts (owner decision 3). The store and its privacy rules: scripts/ai-harness/authoringQualityReview.ts.
 *
 *   npm run verify:ai-authoring-review                 the target, criterion by criterion
 *   npm run verify:ai-authoring-review -- --pending    every captured explanation still awaiting a person
 *   npm run verify:ai-authoring-review -- --record <item id> --correct yes|no --actionable yes|no
 *       --grounded yes|no --unsupported yes|no --reviewer <label> [--note <text>]
 *
 * A person records verdicts; an agent never does. Captures of an earlier request (other instructions)
 * are listed and ignored. Every captured explanation is judged by today's judge, in memory, and each one it
 * reads differently from its capture is listed; a capture file is never rewritten. Exit 0 only when the target is MET, or NOT RUN when nothing of the current
 * request is captured; PENDING, NOT MET and an unreadable store exit 1, because none of them is acceptance.
 */

import { buildAuthoringRequest } from "@src/ai/authoringExplanation";
import { validateFlowDefinition } from "@src/validation/FlowValidator";

import { LABELLED_SET } from "./ai-harness/authoringQualitySet";
import { evaluateQualityTarget, instructionsSha256, loadReviewStore, recordVerdict, rereadCapture, reviewDir, QUALITY_TARGET, type ReviewItem } from "./ai-harness/authoringQualityReview";

const requestFor = (caseId: string) => {
  const labelled = LABELLED_SET.find((c) => c.id === caseId);
  return labelled ? buildAuthoringRequest(validateFlowDefinition(labelled.flow, { referenceableFlowIds: new Set([labelled.flow.id]) })) : undefined;
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
    reviewer: flag("--reviewer") ?? "",
    ...(flag("--note") !== undefined ? { note: flag("--note") } : {})
  });
  console.log(result.ok ? `recorded ${args[1]}` : `REFUSED: ${result.reason}`);
  process.exit(result.ok ? 0 : 1);
}

const store = loadReviewStore(dir);
// Every capture is judged by TODAY's judge, in memory; the files keep the reading they were taken with.
const rereads = store.captures.map((c) => rereadCapture(c, requestFor));
const captures = rereads.map((r) => r.capture).filter((c) => c.instructionsSha256 === current);
const verdictOf = new Map(store.verdicts.map((v) => [v.itemId, v]));
console.log(`L4b explanation quality target (adopted ${QUALITY_TARGET.adopted})`);
console.log(`  review store: ${dir}`);
console.log(`  captures: ${captures.length} of the current request, ${store.captures.length - captures.length} of an earlier one (ignored); verdicts: ${store.verdicts.length}`);
if (store.malformed.length > 0) console.error(`  ✗ unreadable: ${store.malformed.join(", ")}`);
const shown = store.captures.reduce((n, c) => n + c.items.filter((i) => i.text !== null).length, 0);
const changed = rereads.flatMap((r) => r.changed.map((c) => ({ ...c, retained: r.instructionsRetained })));
const reading = (j: ReviewItem["judged"]) => `${j.category}${j.unsupported.length > 0 ? ` [${j.unsupported.join(", ")}]` : ""}${j.actionable ? ", actionable" : ""}`;
console.log(`  re-read by today's judge: ${rereads.reduce((n, r) => n + r.reread, 0)} of ${shown} captured explanation(s) (the rest keep their captured reading: today's labelled set sends other codes under their ids); ${changed.length} read differently:`);
for (const c of changed) console.log(`    ${c.itemId} ${c.code}: ${reading(c.before)} → ${reading(c.after)}${c.retained ? "" : " (against its Issues lines; that request's instructions are not retained)"}`);

if (args[0] === "--pending") {
  const pending = captures.flatMap((c) => c.items).filter((i) => !verdictOf.has(i.id));
  console.log(`\n${pending.length} captured explanation(s) await a person (required ones are the target's criteria 1 and 4)\n`);
  for (const item of pending) {
    const why = item.judged.unsupported.length > 0 ? `required: screen hit ${item.judged.unsupported.join(", ")}` : item.judged.category === "unverified" ? "required: screen-clear" : "optional";
    console.log(`${item.id}  [${why}]`);
    console.log(`  case ${item.caseId}, ${item.issueId} ${item.code} (${item.blocking ? "blocks the run" : "does not block the run"}, ${item.fixable ? "fixable" : "no emitted fix"})`);
    console.log(`  evidence: ${item.evidence}`);
    console.log(`  answer:   ${item.text ?? "(withheld: something sensitive survived redaction)"}`);
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
    console.log(`  run ${r.run}: ${r.delivered}/${LABELLED_SET.length} delivered, ${r.onSubject}/${r.sent} on subject, ${r.actionable}/${r.sent} actionable, ${r.misattributed} misattributed, ${r.ranked} ranked, ${r.orderViolations} order violation(s), ${r.withheld} withheld`);
  }
  const rv = evaluation.review;
  console.log(`  review: ${rv.screenClearReviewed}/${rv.screenClear} screen-clear and ${rv.screenHitsReviewed}/${rv.screenHits} screen hits reviewed; ${rv.confirmedUnsupported} unsupported claim(s) confirmed by a person`);
  for (const c of evaluation.criteria) console.log(`  ${c.status === "MET" ? "✓" : c.status === "PENDING" ? "…" : "✗"} (${c.id}) ${c.label}: ${c.status} — ${c.detail}`);
  console.log(`  TARGET: ${evaluation.verdict}`);
  met &&= evaluation.verdict === "MET";
}
process.exit(met ? 0 : 1);
