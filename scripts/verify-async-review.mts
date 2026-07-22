/**
 * Unit verification for the async completion review/classification (awkit-54t).
 * Pure — no browser. Run: npx tsx scripts/verify-async-review.mts
 */
import { reviewStepAsync, reviewWait, summarizeReviews, classLabel } from "@src/profiles/asyncCompletionReview";
import type { WaitCondition } from "@src/profiles/FlowProfile";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const response = (over: Partial<Extract<WaitCondition, { type: "response" }>> = {}): WaitCondition => ({
  type: "response", method: "POST", urlContains: "/api/orders", statusRange: [200, 299], armBeforeAction: true, ...over
});

console.log("Single-wait classification:");
check("no waits → null", reviewStepAsync({ id: "s", name: "s" }) === null);
check("well-formed response → reliable", reviewWait(response()).classification === "reliable");
{
  const r = reviewWait(response({ method: undefined, urlContains: undefined }));
  check("response without endpoint → unsafe", r.classification === "unsafe" && /no endpoint pattern/.test(r.warnings.join(" ")), JSON.stringify(r));
}
check("status [200,200] → needsReview", reviewWait(response({ statusRange: [200, 200] })).classification === "needsReview");
check("inverted status range → unsafe", reviewWait(response({ statusRange: [300, 200] })).classification === "unsafe");
{
  const r = reviewWait({ type: "loaderHidden", locator: { strategy: "css", value: "" } });
  check("loader with empty locator → incomplete", r.classification === "incomplete", JSON.stringify(r));
}
{
  const r = reviewWait({ type: "loaderHidden", locator: { strategy: "css", value: "div" } });
  check("loader with bare-tag css → needsReview (non-unique)", r.classification === "needsReview", JSON.stringify(r));
}
check("loader with specific css → reliable", reviewWait({ type: "loaderHidden", locator: { strategy: "css", value: ".order-spinner" } }).classification === "reliable");
check("fixedDelay → needsReview", reviewWait({ type: "fixedDelay", delayMs: 500 }).classification === "needsReview");
{
  const r = reviewWait(response({ method: undefined, urlContains: undefined, optional: true }));
  check("optional unsafe response downgrades to needsReview", r.classification === "needsReview", JSON.stringify(r));
}

console.log("Step-level policy checks:");
{
  const r = reviewStepAsync({ id: "s1", name: "Submit", afterWaits: [response(), { type: "textVisible", text: "Saved" }] });
  check("response + UI outcome → reliable", r?.classification === "reliable", JSON.stringify(r));
}
{
  const r = reviewStepAsync({ id: "s2", name: "OnlyDelay", afterWaits: [{ type: "fixedDelay", delayMs: 800 }] });
  check("only fixedDelay → incomplete (no required signal)", r?.classification === "incomplete" && r.warnings.some((w) => /No required completion signal/.test(w)), JSON.stringify(r));
}
{
  const r = reviewStepAsync({ id: "s3", name: "AllOptional", afterWaits: [response({ optional: true }), { type: "textVisible", text: "X", optional: true }] });
  check("all-optional afterWaits → incomplete", r?.classification === "incomplete", JSON.stringify(r));
}
{
  const r = reviewStepAsync({ id: "s4", name: "NetNoApi", completionMode: "networkThenUi", afterWaits: [{ type: "textVisible", text: "Done" }] });
  check("networkThenUi without API → needsReview", r?.classification === "needsReview" && r.warnings.some((w) => /no API condition/.test(w)), JSON.stringify(r));
}
{
  const r = reviewStepAsync({
    id: "s5", name: "RowsVsEmpty",
    afterWaits: [{ type: "tableHasRows", tableLocator: { strategy: "id", value: "t" }, minRows: 1 }, { type: "textVisible", text: "No results found" }]
  });
  check("required rows + empty-state outcome → unsafe conflict", r?.classification === "unsafe" && r.warnings.some((w) => /conflicts with an empty-result/.test(w)), JSON.stringify(r));
}
{
  const r = reviewStepAsync({ id: "s6", name: "AnyOne", completionMode: "anyRequired", afterWaits: [response()] });
  check("anyRequired with <2 required → needsReview", r?.classification === "needsReview", JSON.stringify(r));
}

console.log("Summary + labels:");
{
  const reviews = [
    reviewStepAsync({ id: "a", name: "a", afterWaits: [response(), { type: "textVisible", text: "ok" }] })!,
    reviewStepAsync({ id: "b", name: "b", afterWaits: [{ type: "fixedDelay", delayMs: 100 }] })!,
    reviewStepAsync({ id: "c", name: "c", afterWaits: [response({ method: undefined, urlContains: undefined })] })!
  ];
  const s = summarizeReviews(reviews);
  check("summary totals", s.total === 3, JSON.stringify(s));
  check("summary worst = unsafe", s.worst === "unsafe", JSON.stringify(s));
  check("summary counts reliable=1", s.counts.reliable === 1, JSON.stringify(s));
}
check("classLabel(unsafe) has a label + hint", classLabel("unsafe").label === "Unsafe" && classLabel("unsafe").hint.length > 0);
check("classLabel(reliable)", classLabel("reliable").label === "Reliable");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
