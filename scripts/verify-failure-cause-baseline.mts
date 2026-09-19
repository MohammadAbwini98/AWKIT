/**
 * verify:failure-cause-baseline — Phase L L5a: the run-lifetime evidence contract, its bounded and
 * masked buffer, and the deterministic failure-cause baseline, over the labelled cases this
 * milestone owns (docs/plans/ai-upgrade-v5/L5-failure-evidence-and-analysis.md).
 *
 * Pure and in-process: the real `EvidenceBuffer` with an injected clock, and the real
 * `deriveFailureCause`. The runtime collector that feeds them is `verify:ui-error-evidence`.
 *
 * Run: npm run verify:failure-cause-baseline
 */

import { registerSecretValues } from "../src/reports/SecretMasker";
import { SemanticRedactor } from "../src/semantic/SemanticRedactor";
import {
  DEFAULT_EVIDENCE_LIMITS,
  EVIDENCE_SCHEMA_VERSION,
  EvidenceBuffer,
  EvidenceRunBudget,
  urlPathTemplate,
  type EvidenceInput,
  type ExecutionEvidenceEvent
} from "../src/runner/evidence/ExecutionEvidence";
import { deriveFailureCause, type FailureCauseCode, type RunnerFailure } from "../src/runner/evidence/FailureCauseBaseline";

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
const section = (title: string) => console.log(`\n${title}`);

/** A buffer on a hand-driven clock, so offsets are exact. */
function buffer(options: { limits?: Partial<typeof DEFAULT_EVIDENCE_LIMITS>; budget?: EvidenceRunBudget } = {}) {
  let clock = 1_000;
  const buf = new EvidenceBuffer({ executionId: "exec-1", instanceId: "inst-1" }, options.budget ?? new EvidenceRunBudget(), {
    limits: options.limits,
    now: () => clock
  });
  return {
    buf,
    at(offsetMs: number, input: EvidenceInput): ExecutionEvidenceEvent {
      clock = 1_000 + offsetMs;
      const event = buf.add(input);
      if (!event) throw new Error(`event at ${offsetMs} was dropped`);
      return event;
    },
    setClock(offsetMs: number) {
      clock = 1_000 + offsetMs;
    }
  };
}

const http = (status: number, url = "https://shop.example/api/orders/48213"): EvidenceInput => ({
  source: "http.error",
  severity: "error",
  payload: { method: "POST", url, status, resourceType: "fetch", durationMs: 42 },
  dedupeFields: ["method", "url", "status"]
});
const toast = (text: string, severity: "error" | "info" = "error"): EvidenceInput => ({ source: "ui.toast", severity, payload: { role: "status", text } });
const fieldInvalid: EvidenceInput = { source: "ui.fieldInvalid", severity: "error", payload: { field: "email", validity: "typeMismatch", message: "Please enter an email address." } };
const consoleError = (text: string): EvidenceInput => ({ source: "console.error", severity: "warning", payload: { text } });
const runnerFailure = (kind: string): EvidenceInput => ({ source: "runner.failure", severity: "error", payload: { kind, message: `step failed: ${kind}` } });
const cause = (events: readonly ExecutionEvidenceEvent[], failure: RunnerFailure) => deriveFailureCause(events, failure);

// ── Buffer ───────────────────────────────────────────────────────────────────────────────────────

section("Contract and identity");
{
  const { buf, at } = buffer();
  buf.setStep({ flowId: "checkout", nodeId: "n-pay", stepIndex: 4 });
  const event = at(120, http(500));
  check("an event carries the schema version", event.schemaVersion === EVIDENCE_SCHEMA_VERSION && EVIDENCE_SCHEMA_VERSION === 1);
  check("ids are sequential and unique within the instance", event.id === "ev1" && at(130, http(502)).id === "ev2");
  check("the offset comes from the injected monotonic clock", event.offsetMs === 120 && event.lastOffsetMs === 120);
  check("the current step is stamped on the event", event.context.flowId === "checkout" && event.context.nodeId === "n-pay" && event.context.stepIndex === 4);
  check("execution and instance identity are stamped and cannot be overridden", event.context.executionId === "exec-1" && event.context.instanceId === "inst-1");
  const named = at(140, { ...runnerFailure("timeout"), context: { nodeId: "n-other" } });
  check("an event may name its own step", named.context.nodeId === "n-other" && named.context.flowId === "checkout");
}

section("Masking and minimization");
{
  registerSecretValues(["hunter2-registered"]);
  const { at } = buffer();
  const text = at(1, consoleError("login failed for jane.doe@example.com token=abcd1234efgh order 48213977 Bearer abcdefghijklmnop pw hunter2-registered")).payload.text as string;
  check("a registered run secret is masked", !text.includes("hunter2-registered"));
  check("an email is redacted", !text.includes("jane.doe@example.com"));
  check("a token key/value is redacted", !text.includes("abcd1234efgh"));
  check("a long numeric identifier is redacted", !text.includes("48213977"));
  check("an auth scheme is redacted", !text.includes("abcdefghijklmnop"));
  const redactor = new SemanticRedactor();
  check("a URL keeps origin and route with identifiers stripped", urlPathTemplate("https://user:pw@shop.example/orders/48213/items?id=7#frag", redactor) === "https://shop.example/orders/:id/items");
  check("uuid, hash and mixed-id segments are stripped", urlPathTemplate("https://a.example/u/0f8fad5b-d9cb-469f-a165-70867728950e/f/9f86d081884c7d65/abc123XYZ", redactor) === "https://a.example/u/:id/f/:id/:id");
  check("an email segment is stripped", urlPathTemplate("https://a.example/users/jane@example.com/profile", redactor) === "https://a.example/users/:id/profile");
  check("a secret-looking segment is replaced", urlPathTemplate("https://a.example/reset/token-abcdefgh", redactor) === "https://a.example/reset/:redacted");
  check("a non-http URL is never kept", urlPathTemplate("data:text/html;base64,PHNjcmlwdD4=", redactor) === "data:[non-http]");
  check("an unparseable URL is never kept", urlPathTemplate("not a url", redactor) === "[unparsed-url]");
  const httpEvent = at(2, http(404, "https://u:p@shop.example/api/orders/48213?session=abc"));
  check("a URL field is stored as its template, never raw", httpEvent.payload.url === "https://shop.example/api/orders/:id");
  const shaped = at(3, { source: "page.error", severity: "error", payload: { name: "TypeError", nested: { a: 1 }, list: [1], bad: Number.NaN, "not-a-key": "x", ok: true } });
  check("nested values, NaN and invalid field names are dropped", JSON.stringify(Object.keys(shaped.payload).sort()) === JSON.stringify(["name", "ok"]));
}

section("Bounds and truncation");
{
  const { at } = buffer();
  // Spaced words: an unbroken run of letters is itself redacted as an opaque blob.
  const long = at(1, consoleError("word ".repeat(200)));
  check("a field longer than the cap is cut and flagged", (long.payload.text as string).length === DEFAULT_EVIDENCE_LIMITS.maxFieldChars && long.truncated);
  const wide = at(2, { source: "page.error", severity: "error", payload: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, i])) });
  check("a payload with too many fields keeps the cap and is flagged", Object.keys(wide.payload).length === DEFAULT_EVIDENCE_LIMITS.maxPayloadFields && wide.truncated);

  const perSource = buffer({ limits: { maxEventsPerSource: 3 } });
  for (let i = 0; i < 5; i += 1) perSource.buf.add(consoleError(`distinct ${i}`));
  check("a source over its cap is dropped and counted", perSource.buf.list().length === 3 && perSource.buf.summary().dropped.perSource === 2);

  const perInstance = buffer({ limits: { maxEventsPerInstance: 4 } });
  for (let i = 0; i < 6; i += 1) perInstance.buf.add({ source: i % 2 ? "page.error" : "console.error", severity: "error", payload: { text: `e${i}` } });
  check("an instance over its event cap drops and counts", perInstance.buf.list().length === 4 && perInstance.buf.summary().dropped.perInstance === 2);

  const bytes = buffer({ limits: { maxBytesPerInstance: 200 } });
  for (let i = 0; i < 10; i += 1) bytes.buf.add(consoleError(`message number ${i} with some length`));
  check("an instance over its byte cap drops and counts", bytes.buf.summary().bytes <= 200 && bytes.buf.summary().dropped.instanceBytes > 0);

  const eventBytes = buffer({ limits: { maxEventBytes: 64 } });
  check("an event over its byte cap is dropped", eventBytes.buf.add(consoleError("word ".repeat(40))) === null && eventBytes.buf.summary().dropped.eventBytes === 1);

  const shared = new EvidenceRunBudget(200);
  const first = buffer({ budget: shared });
  const second = buffer({ budget: shared });
  for (let i = 0; i < 6; i += 1) first.buf.add(consoleError(`first instance ${i} padding padding`));
  // The first instance fills 172 of 200 bytes; this 49-byte event cannot fit in what is left.
  const secondAccepted = second.buf.add(consoleError("second instance with more padding"));
  check(
    "the per-run byte budget is shared by every instance",
    first.buf.list().length < 6 && shared.usedBytes() <= 200 && secondAccepted === null && second.buf.summary().dropped.runBytes === 1,
    { first: first.buf.list().length, used: shared.usedBytes() }
  );
}

section("De-duplication");
{
  const { buf, at } = buffer();
  const first = at(10, http(500));
  at(20, http(500));
  const again = at(35, { ...http(500), payload: { ...http(500).payload, durationMs: 999 } });
  check("a repeat is folded into the first event", again === first && buf.list().length === 1);
  check("the repeat count and last offset follow the repeats", first.repeatCount === 3 && first.lastOffsetMs === 35 && first.offsetMs === 10);
  check("timings do not break de-duplication", buf.summary().repeats === 2);
  at(40, http(502));
  check("a different status is a different event", buf.list().length === 2);
}

section("Protected-login retraction");
{
  const budget = new EvidenceRunBudget();
  const { buf, at } = buffer({ budget });
  const kept = at(10, { ...http(500), context: { pageId: "p1" } });
  const gone = at(20, { ...consoleError("login failed for canary"), context: { pageId: "p2" } });
  at(25, { ...consoleError("login failed for canary"), context: { pageId: "p2" } });
  const runner = at(30, { ...runnerFailure("assertion"), context: { pageId: "p2" } });
  const before = { bytes: buf.summary().bytes, run: budget.usedBytes() };
  const removed = buf.retract((event) => event.source !== "runner.failure" && event.context.pageId === "p2");
  const summary = buf.summary();
  check("only the protected page's events are retracted, the runner's own failure stays", removed === 1 && buf.list().includes(kept) && buf.list().includes(runner) && !buf.list().includes(gone));
  check("every retracted occurrence is counted, repeats included", summary.dropped.protected === 2 && summary.repeats === 0, summary);
  check("retracted bytes return to the instance and the run budget", summary.bytes < before.bytes && budget.usedBytes() === before.run - (before.bytes - summary.bytes), { before, after: summary.bytes, run: budget.usedBytes() });
  const again = at(40, { ...consoleError("login failed for canary"), context: { pageId: "p2" } });
  check("a retracted event no longer absorbs repeats (its dedupe key is released)", again !== gone && again.repeatCount === 1);
  buf.dropProtected();
  check("an occurrence withheld at the door is counted too", buf.summary().dropped.protected === 3);
}

// ── Baseline over the labelled cases ─────────────────────────────────────────────────────────────

section("Deterministic cause baseline: labelled cases");
function expectCause(label: string, got: { cause: FailureCauseCode; evidenceIds: string[] }, want: FailureCauseCode, primaryId?: string): void {
  check(`${label} → ${want}`, got.cause === want && (primaryId === undefined || got.evidenceIds[0] === primaryId), got);
}
{
  const { at, buf } = buffer();
  const t = at(2_000, toast("Could not save: the order is locked."));
  const r = at(9_800, runnerFailure("timeout"));
  expectCause("transient toast before a timeout", cause(buf.list(), { kind: "timeout", stepStartOffsetMs: 1_500, failedAtOffsetMs: 9_800, evidenceId: r.id }), "uiErrorMessage", t.id);
}
{
  const { at, buf } = buffer();
  const v = at(1_100, fieldInvalid);
  expectCause("native validation", cause(buf.list(), { kind: "assertion", stepStartOffsetMs: 1_000, failedAtOffsetMs: 2_000 }), "uiValidation", v.id);
}
{
  const { at, buf } = buffer();
  const h = at(1_200, http(409));
  const t = at(1_260, toast("Conflict: this record was changed by someone else."));
  const got = cause(buf.list(), { kind: "timeout", stepStartOffsetMs: 1_000, failedAtOffsetMs: 6_000 });
  expectCause("409 then a message", got, "httpError", h.id);
  check("...the message supports it", got.evidenceIds.includes(t.id));
}
{
  const { at, buf } = buffer();
  const h = at(1_200, http(422));
  const v = at(1_240, fieldInvalid);
  const got = cause(buf.list(), { kind: "assertion", stepStartOffsetMs: 1_000, failedAtOffsetMs: 3_000 });
  expectCause("422 then field validation", got, "httpError", h.id);
  check("...the field validation supports it", got.evidenceIds.includes(v.id));
}
{
  const { at, buf } = buffer();
  const d = at(1_300, { source: "page.errorDocument", severity: "error", payload: { status: 500, title: "Internal Server Error" } });
  expectCause("500 error page", cause(buf.list(), { kind: "navigation", stepStartOffsetMs: 1_000, failedAtOffsetMs: 1_400 }), "errorPage", d.id);
}
{
  const { at, buf } = buffer();
  const n = at(1_050, { source: "network.failed", severity: "error", payload: { method: "GET", url: "https://shop.example/api/cart", failure: "net::ERR_CONNECTION_REFUSED" } });
  expectCause("transport failure", cause(buf.list(), { kind: "timeout", stepStartOffsetMs: 1_000, failedAtOffsetMs: 11_000 }), "transportFailure", n.id);
}
{
  const { at, buf } = buffer();
  const p = at(1_500, { source: "page.error", severity: "error", payload: { name: "TypeError", message: "Cannot read properties of undefined (reading 'total')" } });
  expectCause("page error before a timeout", cause(buf.list(), { kind: "timeout", stepStartOffsetMs: 1_000, failedAtOffsetMs: 11_000 }), "scriptError", p.id);
}
{
  const { at, buf } = buffer();
  const c = at(1_100, consoleError("Failed to load analytics widget"));
  const r = at(1_900, runnerFailure("assertion"));
  const got = cause(buf.list(), { kind: "assertion", stepStartOffsetMs: 1_000, failedAtOffsetMs: 1_900, evidenceId: r.id });
  expectCause("an unrelated console error never outranks the runner", got, "assertionFailed", r.id);
  check("...it is kept as supporting evidence, after the runner event the cause rests on", got.evidenceIds.includes(c.id) && got.evidenceIds[0] === r.id);
}
{
  const { at, buf } = buffer();
  const c = at(800, consoleError("Checkout widget failed to render"));
  const r = at(1_900, runnerFailure("assertion"));
  const got = cause(buf.list(), { kind: "assertion", stepStartOffsetMs: 1_000, failedAtOffsetMs: 1_900, evidenceId: r.id });
  expectCause("a console error just before the failing step", got, "assertionFailed", r.id);
  check("...is its context (preceding window), never its cause", got.evidenceIds.length === 2 && got.evidenceIds[1] === c.id, got);
}
{
  const { at, buf } = buffer();
  at(1_100, { source: "ui.status", severity: "info", payload: { role: "status", text: "Autosave is on" } });
  at(1_150, toast("Saved successfully", "info"));
  expectCause("neutral status and success toasts are never a cause", cause(buf.list(), { kind: "locator", stepStartOffsetMs: 1_000, failedAtOffsetMs: 5_000 }), "locatorNotFound");
}
{
  const { buf } = buffer();
  const got = cause(buf.list(), { kind: "other", failedAtOffsetMs: 5_000 });
  check("insufficient evidence → insufficient, citing nothing", got.cause === "insufficient" && got.evidenceIds.length === 0 && got.window === "none", got);
}
{
  const { at, buf } = buffer();
  const c = at(4_000, consoleError("Uncaught promise in widget"));
  expectCause("a console error alone, with no runner diagnosis", cause(buf.list(), { kind: "other", stepStartOffsetMs: 3_000, failedAtOffsetMs: 5_000 }), "consoleError", c.id);
}
{
  const { at, buf } = buffer();
  at(1_100, http(500));
  expectCause("a cancelled run is cancelled, whatever else happened", cause(buf.list(), { kind: "cancelled", stepStartOffsetMs: 1_000, failedAtOffsetMs: 2_000 }), "cancelled");
}

section("Deterministic cause baseline: windows and ordering");
{
  const { at, buf } = buffer();
  const h = at(4_000, http(500));
  const got = cause(buf.list(), { kind: "timeout", stepStartOffsetMs: 6_000, failedAtOffsetMs: 16_000 });
  check("direct evidence shortly before the step is used from the preceding window", got.cause === "httpError" && got.window === "preceding" && got.evidenceIds[0] === h.id, got);
}
{
  const { at, buf } = buffer();
  at(1_000, http(500));
  const got = cause(buf.list(), { kind: "timeout", stepStartOffsetMs: 20_000, failedAtOffsetMs: 30_000 });
  check("evidence older than the preceding window is ignored", got.cause === "timeout", got);
}
{
  const { at, buf } = buffer();
  at(9_000, http(500));
  const got = cause(buf.list(), { kind: "assertion", stepStartOffsetMs: 1_000, failedAtOffsetMs: 2_000 });
  check("evidence well after the failure is ignored", got.cause === "assertionFailed", got);
}
{
  const { at, buf } = buffer();
  const late = at(2_300, http(500));
  const got = cause(buf.list(), { kind: "timeout", stepStartOffsetMs: 1_000, failedAtOffsetMs: 2_000 });
  check("a response landing within the grace period still counts", got.cause === "httpError" && got.evidenceIds[0] === late.id, got);
}
{
  const { at, buf } = buffer();
  const t = at(1_100, toast("Payment declined"));
  at(1_900, http(402));
  expectCause("the earliest direct event wins (root cause before consequence)", cause(buf.list(), { kind: "timeout", stepStartOffsetMs: 1_000, failedAtOffsetMs: 5_000 }), "uiErrorMessage", t.id);
}
{
  const { at, buf } = buffer();
  const t = at(1_500, toast("Server error"));
  const h = at(1_500, http(500));
  const got = cause(buf.list(), { kind: "timeout", stepStartOffsetMs: 1_000, failedAtOffsetMs: 5_000 });
  check("at the same instant the higher-confidence class wins", got.evidenceIds[0] === h.id && got.evidenceIds.includes(t.id), got);
}
{
  const { at, buf } = buffer();
  const ids = Array.from({ length: 8 }, (_, i) => at(1_100 + i * 10, http(500, `https://shop.example/api/r${i}x`)).id);
  const got = cause(buf.list(), { kind: "timeout", stepStartOffsetMs: 1_000, failedAtOffsetMs: 5_000 });
  check("supporting evidence is bounded", got.evidenceIds.length === 5 && got.evidenceIds[0] === ids[0], got.evidenceIds);
}
{
  const { at, buf } = buffer();
  at(1_100, http(500));
  const events = buf.list();
  const a = JSON.stringify(cause(events, { kind: "timeout", stepStartOffsetMs: 1_000, failedAtOffsetMs: 5_000 }));
  const b = JSON.stringify(cause([...events].reverse(), { kind: "timeout", stepStartOffsetMs: 1_000, failedAtOffsetMs: 5_000 }));
  check("the baseline is deterministic and independent of input order", a === b);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
