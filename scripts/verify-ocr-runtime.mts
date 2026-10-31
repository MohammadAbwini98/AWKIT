/**
 * verify:ocr-runtime — Phase N, N7.5 (awkit-vra.9.6): the observe-only `assertImageText` step in real Chromium, through
 * the REAL `FlowExecutor` retry loop over a REAL `StepExecutor` and the REAL `OcrStep` adapter (N0 capture, N7.2
 * preprocessing and decision), against the mock-site Image Text Assertion Lab (`/visual-intelligence/ocr`).
 *
 * The recognizer is INJECTED here (the production one is the N7.4 `OcrUtilityHostManager`, proven by verify:ocr-host,
 * and the real engine end to end by verify:ocr-gui): it counts every request, sees the real preprocessed plane, and
 * can answer, hang, ignore the abort, or fail with each host reason. A probe counts every capture.
 *
 * Cases:
 *   A  disabled by default: off (or unwired) records `disabled` (or nothing), never loads the adapter, captures or
 *      asks the reader; only the exact value `observe` enables it;
 *   B  observe through the pipeline: matched, differs and near-miss from a real capture and a real preprocessed plane;
 *      the step always passes and is never retried;
 *   C  OC-8 refusals with ZERO captures and ZERO reader requests: a card number, a secret reference, an unverified
 *      source, a sensitive source name, an OTP context, the handoff, a protected surface, sensitive containers;
 *   D  an expected text that is sensitive only once resolved at run time, refused after resolution, before capture;
 *   E  the reader unavailable, missing or altered assets, an unsupported CPU, a crashed or busy host;
 *   F  missing, hidden, ambiguous, clipped, oversized and tiny targets: inconclusive, no reader request;
 *   G  the deadline, a run cancellation, a late result that changes nothing, a closed page, then a valid run;
 *   J  neutrality: non-OCR steps behave the same with OCR on, malformed configurations never fall through, the
 *      validator, the retry rule and the random Test Lab gate.
 * Every record is checked to be codes only: never the expected or the recognized text.
 *
 * Mutation contract (run 2026-10-26 by temporary source edits, all five at once, each observed red on its own checks,
 * then reverted; 68 passed / 7 failed, then 75/0 again): M1 the adapter ignores the handoff (C handoff red: N0 still
 * refused, but one capture was taken); M2 the executor skips the OC-8 check of the resolved value (D card red: the
 * adapter loaded; its own re-check still refused the value); M3 the executor evaluates with OCR off (A red, 2 checks);
 * M5 the sensitive-container walk ignored (C cvv and otp wrappers red: captured and read); M6 the retry rule removed
 * (J retry red). N7.5 closeout (same day): D1 the adapter's slot takes whichever callback runs first and D2 the executor
 * records the adapter's own duration without the late check — 81 passed / 3 failed (a matched verdict recorded at
 * 1634 ms behind a held main thread, a 251 ms duration for a 674 ms operation, the no-late-verdict invariant), then
 * 84/0 again.
 *
 * Run: npm run verify:ocr-runtime
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { ManualHandoffController } from "@src/runner/ManualHandoffController";
import { CancellationTokenSource } from "@src/runner/concurrency/CancellationToken";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { StepExecutionResult } from "@src/runner/RunnerResult";
import type { FlowStep, ValueSource } from "@src/profiles/FlowProfile";
import { OcrStep } from "@src/runner/ocr/OcrStep";
import { OCR_ASSERTION_DEADLINE_MS, ocrAssertionMode, type OcrAssertionRecord, type OcrRecognizer } from "@src/runner/ocr/ocrAssertionContract";
import type { OcrHostImage, OcrHostOutcome, OcrHostReason } from "@src/ocr/OcrHostProtocol";
import { RetryPolicy } from "@src/runner/runtime/RetryPolicy";
import { validateFlowDefinition } from "@src/validation/FlowValidator";
import { NODE_CATALOG } from "@src/testing/random/NodeCatalog";
import { actionNodeWeights, blockedNodeTypes, resolveConstraints } from "@src/testing/random/GenerationConstraints";
import { fromFlowStep, toFlowStep, type FlowDesignerNode } from "../app/renderer/components/workflow/flowProfileMapping";
import { imageTextDesignerMessages } from "../app/renderer/components/workflow/imageTextDesigner";

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

const PORT = 4627;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence/ocr`;
const FLOW_ID = "ocr-flow";
const EXPECTED = "Order 4521 shipped";
let browser: Browser | undefined;
let executionSeq = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const at = (testId: string) => ({ strategy: "testId", value: testId });
const label = (id: string, extra: Record<string, unknown> = {}): FlowStep =>
  ({ id, name: `Observe ${id}`, type: "assertImageText", locator: at("oc-label"), value: EXPECTED, ...extra }) as unknown as FlowStep;

/** The injected reader: counts requests and aborts, keeps the plane's size, answers per `behave`. */
class FakeReader implements OcrRecognizer {
  calls = 0;
  aborts = 0;
  /** `prepare()` calls: the engine start a refused assertion must never trigger. */
  prepares = 0;
  /** The order of prepare, capture and recognize, for the overlap check. */
  readonly events: string[] = [];
  prepare(): void {
    this.prepares += 1;
    this.events.push("prepare");
  }
  lastImage: { width: number; height: number; planeMatches: boolean } | null = null;
  /** The deadline the reader was given: it settles its own request at it. */
  lastDeadlineMs: number | null = null;
  constructor(public behave: (options: { deadlineMs: number; signal?: AbortSignal }) => Promise<OcrHostOutcome>) {}
  recognize(image: OcrHostImage, options: { deadlineMs: number; signal?: AbortSignal }): Promise<OcrHostOutcome> {
    this.calls += 1;
    this.events.push("recognize");
    this.lastImage = { width: image.width, height: image.height, planeMatches: image.gray instanceof Uint8Array && image.gray.length === image.width * image.height };
    this.lastDeadlineMs = options.deadlineMs;
    options.signal?.addEventListener("abort", () => (this.aborts += 1), { once: true });
    return this.behave(options);
  }
}
const reads = (text: string, confidence = 96) => async (): Promise<OcrHostOutcome> => ({ ok: true, words: text.split(" ").map((t) => ({ text: t, confidence })), recognizeMs: 5 });
const fails = (reason: OcrHostReason) => async (): Promise<OcrHostOutcome> => ({ ok: false, reason });
/** Never answers on its own: settles only when aborted (a run cancellation; the production manager kills the host). */
const hangsUntilAbort = async (options: { signal?: AbortSignal }): Promise<OcrHostOutcome> =>
  new Promise((resolve) => options.signal?.addEventListener("abort", () => resolve({ ok: false, reason: "cancelled" }), { once: true }));

class CountingResolver extends ValueResolver {
  resolves = 0;
  /** A slow data source: resolution takes this long (the duration must still cover it). */
  delayMs = 0;
  override async resolve(valueSource?: ValueSource): Promise<string> {
    this.resolves += 1;
    if (this.delayMs > 0) await sleep(this.delayMs);
    return super.resolve(valueSource);
  }
}

/** Holds the thread synchronously, as decoding a large screenshot on the main thread does. */
function holdMainThread(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // Busy: no timer or I/O callback can run meanwhile.
  }
}

interface HarnessOptions {
  mode?: "off" | "observe";
  unwired?: boolean;
  reader?: FakeReader;
  /** The loader yields no adapter (OCR not included in this build). */
  noAdapter?: boolean;
  /** Runs inside the adapter's capture probe, right before the guarded capture. */
  onCapture?: (page: Page) => void;
  /** Expectation resolution delay (a slow data source). */
  resolveDelayMs?: number;
  handedOff?: boolean;
  runtimeInputs?: Record<string, string>;
}

interface Harness {
  records: OcrAssertionRecord[];
  loads: { count: number };
  captures: { count: number };
  reader: FakeReader;
  resolver: CountingResolver;
  cancel: CancellationTokenSource;
  run: (step: FlowStep) => Promise<StepExecutionResult>;
}

function harness(page: Page, options: HarnessOptions = {}): Harness {
  const context: InstanceExecutionContext = {
    executionId: `exec-${(executionSeq += 1)}`,
    instanceId: "inst-1",
    scenarioId: "n7-5",
    flowId: FLOW_ID,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: options.runtimeInputs ?? {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: ".", screenshots: ".", logs: ".", reports: "." }
  } as InstanceExecutionContext;
  const records: OcrAssertionRecord[] = [];
  const loads = { count: 0 };
  const captures = { count: 0 };
  const reader = options.reader ?? new FakeReader(reads(EXPECTED));
  const resolver = new CountingResolver(context);
  resolver.delayMs = options.resolveDelayMs ?? 0;
  const cancel = new CancellationTokenSource();
  const adapter = new OcrStep({
    recognizer: reader,
    probe: {
      onCapture: () => {
        captures.count += 1;
        reader.events.push("capture");
        options.onCapture?.(page);
      }
    }
  });
  const stepExecutor = new StepExecutor(
    page,
    new LocatorFactory(page),
    resolver,
    context,
    new ManualHandoffController(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    cancel.token
  );
  if (!options.unwired) {
    stepExecutor.setOcrAssertion({
      mode: options.mode ?? "observe",
      assessor: async () => {
        loads.count += 1;
        return options.noAdapter ? undefined : adapter;
      },
      handedOff: () => options.handedOff === true,
      onRecord: (record) => records.push(record)
    });
  }
  const flowExecutor = new FlowExecutor(stepExecutor, undefined, undefined, undefined, false);
  return {
    records,
    loads,
    captures,
    reader,
    resolver,
    cancel,
    run: (step) => (flowExecutor as unknown as { executeWithRetry(s: FlowStep, c: InstanceExecutionContext): Promise<StepExecutionResult> }).executeWithRetry(step, context)
  };
}

async function freshLab(variant = "baseline"): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(LAB);
  await page.getByTestId("oc-label").waitFor();
  if (variant !== "baseline") await page.evaluate((v) => (window as unknown as { __ocrLab: { setVariant(n: string): void } }).__ocrLab.setVariant(v), variant);
  return page;
}

interface Outcome {
  result: StepExecutionResult;
  record: OcrAssertionRecord | undefined;
  h: Harness;
  elapsedMs: number;
}

async function observe(step: FlowStep, options: HarnessOptions & { variant?: string; setup?: (page: Page) => Promise<void>; during?: (h: Harness, page: Page) => void } = {}): Promise<Outcome> {
  const page = await freshLab(options.variant);
  await options.setup?.(page);
  const h = harness(page, options);
  options.during?.(h, page);
  const started = performance.now();
  const result = await h.run(step);
  const elapsedMs = Math.round(performance.now() - started);
  if (!page.isClosed()) await page.close();
  return { result, record: h.records[0], h, elapsedMs };
}

const describe = (o: Outcome): string =>
  `${o.result.status} attempts=${o.result.attemptCount} ${o.record ? `${o.record.verdict ?? "-"}/${o.record.code} ${o.record.distanceBucket ?? ""} ${o.record.confidenceBucket ?? ""} chars=${o.record.charCount ?? "-"} ${o.record.durationMs}ms` : "no record"} loads=${o.h.loads.count} captures=${o.h.captures.count} reads=${o.h.reader.calls} ${o.result.error ?? ""}`;

/** Codes only: the record never carries the expected or the recognized text, or any other text. */
const allRecords: OcrAssertionRecord[] = [];
const track = (o: Outcome): Outcome => {
  allRecords.push(...o.h.records);
  return o;
};
/** Nothing captured, nothing read, and no engine started. */
const zeroTouch = (o: Outcome) => o.h.captures.count === 0 && o.h.reader.calls === 0 && o.h.reader.prepares === 0;

async function main(): Promise<void> {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  try {
    for (let attempt = 0; attempt < 80 && !(await fetch(LAB).then((r) => r.ok, () => false)); attempt += 1) await sleep(100);
    browser = await chromium.launch();

    // ── A. Disabled by default ─────────────────────────────────────────────────────────────────
    console.log("A. Disabled by default");
    check(
      "OC-6: only the exact value observe turns OCR on (absent, off, enforce, OBSERVE and on stay off)",
      ocrAssertionMode({}) === "off" &&
        ocrAssertionMode({ AWKIT_VISUAL_OCR: "off" }) === "off" &&
        ocrAssertionMode({ AWKIT_VISUAL_OCR: "enforce" }) === "off" &&
        ocrAssertionMode({ AWKIT_VISUAL_OCR: "OBSERVE" }) === "off" &&
        ocrAssertionMode({ AWKIT_VISUAL_OCR: "on" }) === "off" &&
        ocrAssertionMode({ AWKIT_VISUAL_OCR: "observe" }) === "observe"
    );
    {
      const off = track(await observe(label("a-off"), { mode: "off" }));
      check(
        "off: the step passes, records disabled, and nothing is resolved, loaded, captured or read",
        off.result.status === "passed" && off.record?.code === "disabled" && !off.record.verdict && off.h.loads.count === 0 && zeroTouch(off) && off.h.resolver.resolves === 0,
        describe(off)
      );
      const offSecret = track(await observe(label("a-off-secret", { valueSource: { type: "secret", secretName: "vault-entry" } }), { mode: "off" }));
      check("off: even a refused expectation is only recorded disabled (nothing resolved)", offSecret.record?.code === "disabled" && offSecret.h.resolver.resolves === 0 && zeroTouch(offSecret), describe(offSecret));
      const unwired = track(await observe(label("a-unwired"), { unwired: true }));
      check("an executor with no OCR runtime passes the step and records nothing", unwired.result.status === "passed" && unwired.h.records.length === 0 && zeroTouch(unwired), describe(unwired));
    }

    // ── B. Observe through the pipeline ────────────────────────────────────────────────────────
    console.log("\nB. Observe: a real capture and a real preprocessed plane, verdicts from the N7.2 decision");
    {
      const matched = track(await observe(label("b-matched")));
      check(
        "the expected label is matched (text-matched, exact distance) and the step passes once",
        matched.result.status === "passed" && matched.result.attemptCount === 1 && matched.record?.verdict === "matched" && matched.record.code === "text-matched" && matched.record.distanceBucket === "exact" && matched.record.confidenceBucket === "ge-95",
        describe(matched)
      );
      check(
        "exactly one capture and one reader request, the adapter loaded once, with a real preprocessed grayscale plane",
        matched.h.loads.count === 1 && matched.h.captures.count === 1 && matched.h.reader.calls === 1 && !!matched.h.reader.lastImage?.planeMatches && (matched.h.reader.lastImage?.width ?? 0) > 100,
        `${describe(matched)} image=${JSON.stringify(matched.h.reader.lastImage)}`
      );
      check(
        "the engine is prepared once, after every refusal and before the capture, so its start-up overlaps the capture",
        JSON.stringify(matched.h.reader.events) === JSON.stringify(["prepare", "capture", "recognize"]),
        matched.h.reader.events.join(" > ")
      );
      check("the record counts the characters read and never holds them", matched.record?.charCount === EXPECTED.length && !JSON.stringify(matched.record).includes("Order"), JSON.stringify(matched.record));
      const differs = track(await observe(label("b-differs"), { variant: "different", reader: new FakeReader(reads("Payment declined today")) }));
      check("different text is differs (text-differs) and the step still passes", differs.result.status === "passed" && differs.record?.verdict === "differs" && differs.record.code === "text-differs", describe(differs));
      const near = track(await observe(label("b-near"), { variant: "near", reader: new FakeReader(reads("Order 4527 shipped")) }));
      check("a one-digit difference is inconclusive (near-miss), never differs or matched", near.result.status === "passed" && near.record?.verdict === "inconclusive" && near.record.code === "near-miss", describe(near));
      const low = track(await observe(label("b-low"), { reader: new FakeReader(reads(EXPECTED, 40)) }));
      check("a low-confidence read is inconclusive, never matched", low.record?.verdict === "inconclusive" && low.record.code === "low-confidence", describe(low));
      const contains = track(await observe(label("b-contains", { value: "4521", config: { ocrMatch: "contains" } })));
      check("contains matches an expected part of the label", contains.record?.verdict === "matched", describe(contains));
      const caseSensitive = track(await observe(label("b-case", { value: "ORDER 4521 SHIPPED", config: { ocrMatch: "normalized", ocrCaseSensitive: true } })));
      check("case sensitivity is honoured (ORDER vs Order is not matched)", caseSensitive.record?.verdict !== "matched", describe(caseSensitive));
      const retried = track(await observe(label("b-retry", { retry: { count: 2, delayMs: 1 }, safety: { sideEffectLevel: "read", retryable: true } }), { variant: "different", reader: new FakeReader(reads("Payment declined today")) }));
      check("a differs verdict is never retried and never fails the step, even with retries authored", retried.result.status === "passed" && retried.result.attemptCount === 1 && retried.h.records.length === 1, describe(retried));
      const dynamic = track(await observe(label("b-runtime", { value: undefined, valueSource: { type: "runtimeInput", key: "expectedLabel" } }), { runtimeInputs: { expectedLabel: EXPECTED } }));
      check("an expected text resolved from a runtime input is compared like a literal", dynamic.record?.verdict === "matched" && dynamic.h.resolver.resolves === 1, describe(dynamic));
    }

    // ── C. OC-8 refusals: zero captures, zero reader requests ──────────────────────────────────
    console.log("\nC. OC-8 refusals: nothing captured, nothing read");
    {
      const cases: Array<[string, FlowStep, HarnessOptions & { setup?: (page: Page) => Promise<void> }, string]> = [
        ["a literal card number shown on the page", label("c-card", { locator: at("oc-card-text"), value: "4111 1111 1111 1111" }), {}, "sensitive-input"],
        ["a secret reference (never resolved)", label("c-secret", { value: undefined, valueSource: { type: "secret", secretName: "vault-entry" } }), {}, "sensitive-input"],
        ["an environment variable (unverified source, never resolved)", label("c-env", { value: undefined, valueSource: { type: "env", envKey: "PATH" } }), {}, "sensitive-input"],
        ["a dynamic binding to a key named password", label("c-password-key", { value: undefined, valueSource: { type: "dynamic", dataSourceScope: "workflow", keyName: "password" } }), {}, "sensitive-input"],
        ["a runtime input named otpCode", label("c-otp-key", { value: undefined, valueSource: { type: "runtimeInput", key: "otpCode" } }), { runtimeInputs: { otpCode: "Order 4521 shipped" } }, "sensitive-input"],
        ["a six-digit literal in a step named for a verification code", label("c-otp-context", { name: "Check verification code", value: "482913" }), {}, "sensitive-input"],
        ["an IBAN literal", label("c-iban", { value: "GB82 WEST 1234 5698 7654 32" }), {}, "sensitive-input"],
        ["an active handoff", label("c-handoff"), { handedOff: true }, "handoff-active"],
        ["a protected sign-in surface on the page", label("c-protected"), { setup: (page) => page.evaluate(() => (window as unknown as { __ocrLab: { injectProtected(): void } }).__ocrLab.injectProtected()) }, "protected-surface"],
        ["a wrapper around a cvv field", label("c-cvv", { locator: at("oc-payment"), value: "Security code" }), {}, "sensitive-step"],
        ["a wrapper whose shadow root holds an otp field", label("c-otp-shadow", { locator: at("oc-otp"), value: "Code" }), {}, "sensitive-step"]
      ];
      for (const [name, step, options, code] of cases) {
        const o = track(await observe(step, options));
        check(`${name}: inconclusive/${code}, the step passes, zero captures, zero reader requests and no engine started`, o.result.status === "passed" && o.record?.verdict === "inconclusive" && o.record.code === code && zeroTouch(o), describe(o));
      }
      const secret = track(await observe(label("c-secret-resolve", { value: undefined, valueSource: { type: "secret", secretName: "vault-entry" } })));
      check("a secret is refused before anything is resolved or the adapter loaded", secret.h.resolver.resolves === 0 && secret.h.loads.count === 0, describe(secret));
    }

    // ── D. Sensitive only at run time ──────────────────────────────────────────────────────────
    console.log("\nD. An expected text that is sensitive only once resolved");
    {
      const runtimeCard = track(await observe(label("d-card", { value: undefined, valueSource: { type: "runtimeInput", key: "expectedLabel" } }), { runtimeInputs: { expectedLabel: "4111 1111 1111 1111" } }));
      check(
        "a neutrally named runtime input that resolves to a card number is refused after resolution: sensitive-input, zero captures, zero reads, adapter not loaded",
        runtimeCard.result.status === "passed" && runtimeCard.record?.code === "sensitive-input" && runtimeCard.h.resolver.resolves === 1 && zeroTouch(runtimeCard) && runtimeCard.h.loads.count === 0,
        describe(runtimeCard)
      );
      const runtimeSsn = track(await observe(label("d-ssn", { value: undefined, valueSource: { type: "runtimeInput", key: "expectedLabel" } }), { runtimeInputs: { expectedLabel: "123-45-6789" } }));
      check("a runtime value shaped like a social security number is refused the same way", runtimeSsn.record?.code === "sensitive-input" && zeroTouch(runtimeSsn), describe(runtimeSsn));
      const runtimeLong = track(await observe(label("d-long", { value: undefined, valueSource: { type: "runtimeInput", key: "expectedLabel" } }), { runtimeInputs: { expectedLabel: "x".repeat(257) } }));
      check("a runtime value longer than 256 characters is expected-invalid, nothing captured", runtimeLong.record?.code === "expected-invalid" && zeroTouch(runtimeLong), describe(runtimeLong));
      const runtimeUnsupported = track(await observe(label("d-unsupported", { value: undefined, valueSource: { type: "runtimeInput", key: "expectedLabel" } }), { runtimeInputs: { expectedLabel: "Bestellung über 4521" } }));
      check("a runtime value outside the supported English set is unsupported-text, nothing captured", runtimeUnsupported.record?.code === "unsupported-text" && zeroTouch(runtimeUnsupported), describe(runtimeUnsupported));
    }

    // ── E. The reader unavailable ──────────────────────────────────────────────────────────────
    console.log("\nE. The reader unavailable, its assets missing or altered, the CPU unsupported, the host crashed or busy");
    {
      const none = track(await observe(label("e-none"), { noAdapter: true }));
      check("no reader in this build: inconclusive/ocr-unavailable, nothing captured", none.result.status === "passed" && none.record?.code === "ocr-unavailable" && zeroTouch(none), describe(none));
      for (const [reason, code] of [
        ["assets-missing", "assets-missing"],
        ["checksum-mismatch", "checksum-mismatch"],
        ["unsupported-cpu", "unsupported-cpu"],
        ["host-failed", "ocr-unavailable"],
        ["ocr-unavailable", "ocr-unavailable"],
        ["ocr-busy", "ocr-busy"],
        ["output-invalid", "ocr-unavailable"]
      ] as const) {
        const o = track(await observe(label(`e-${reason}`), { reader: new FakeReader(fails(reason)) }));
        check(`the host answering ${reason}: inconclusive/${code}, the step passes`, o.result.status === "passed" && o.record?.verdict === "inconclusive" && o.record.code === code && o.h.reader.calls === 1, describe(o));
      }
      const thrown = track(await observe(label("e-throws"), { reader: new FakeReader(async () => Promise.reject(new Error("broken"))) }));
      check("a reader that throws is inconclusive, never a step failure", thrown.result.status === "passed" && thrown.record?.verdict === "inconclusive", describe(thrown));
    }

    // ── F. Targets ─────────────────────────────────────────────────────────────────────────────
    console.log("\nF. Missing, hidden, ambiguous, clipped, oversized and tiny targets");
    {
      const cases: Array<[string, string, readonly string[], boolean]> = [
        ["a missing target", "oc-nowhere", ["target-not-found"], false],
        ["a hidden target", "oc-hidden", ["target-hidden"], false],
        ["duplicates", "oc-dupe", ["target-not-unique"], false],
        ["a target across the fold", "oc-clipped", ["region-clipped", "target-offscreen"], true],
        ["an oversized panel", "oc-oversized", ["region-too-large"], true],
        ["6 px text", "oc-tiny", ["region-too-small"], true]
      ];
      for (const [name, testId, codes, captured] of cases) {
        const o = track(await observe(label(`f-${testId}`, { locator: at(testId) })));
        check(
          `${name}: inconclusive/${codes.join(" or ")}, the step passes, no reader request${captured ? "" : ", nothing captured and no engine started"}`,
          o.result.status === "passed" && o.record?.verdict === "inconclusive" && codes.includes(o.record.code) && o.h.reader.calls === 0 && (captured || (o.h.captures.count === 0 && o.h.reader.prepares === 0)),
          describe(o)
        );
      }
      const noLocator = track(await observe(label("f-no-locator", { locator: undefined })));
      check("a step without a locator is inconclusive and passes (the validator blocks it before a run)", noLocator.result.status === "passed" && noLocator.record?.verdict === "inconclusive" && zeroTouch(noLocator), describe(noLocator));
    }

    // ── G. Deadline, cancellation, late result, closed page ────────────────────────────────────
    console.log("\nG. The deadline, cancellation, a late result and a closed page, then a valid run");
    {
      const slow = new FakeReader(hangsUntilAbort);
      const deadline = track(await observe(label("g-deadline"), { reader: slow }));
      check(
        `a reader that never answers is budget-exhausted within the ${OCR_ASSERTION_DEADLINE_MS} ms deadline (plus the settle margin)`,
        deadline.result.status === "passed" && deadline.record?.code === "budget-exhausted" && deadline.elapsedMs < OCR_ASSERTION_DEADLINE_MS + 600,
        `${describe(deadline)} elapsed=${deadline.elapsedMs}ms`
      );
      check(
        "the reader was given only what remained of the deadline, and a deadline is not a cancellation (its warm engine is not aborted)",
        slow.lastDeadlineMs !== null && slow.lastDeadlineMs > 0 && slow.lastDeadlineMs < OCR_ASSERTION_DEADLINE_MS && slow.aborts === 0,
        `deadlineMs=${slow.lastDeadlineMs} aborts=${slow.aborts}`
      );

      // N7 plan § A5 (owner-approved 2026-10-31): the check waits for the late reply's own delivery signal, bounded, instead
      // of a fixed 1200 ms sleep that assumed the reader was called within about 510 ms of the step start (it failed
      // on 2026-10-27 under host load; that run stays recorded as FAIL). It then drains one macrotask, so anything a
      // defective step chained onto the late promise has run, and asserts exactly as before.
      const LATE_DELIVERY_BOUND_MS = 5_000;
      const lateReader = (onDelivered: () => void) =>
        new FakeReader(async () => {
          await sleep(OCR_ASSERTION_DEADLINE_MS + 700);
          onDelivered();
          return { ok: true, words: [{ text: "Order", confidence: 99 }, { text: "4521", confidence: 99 }, { text: "shipped", confidence: 99 }], recognizeMs: 2200 };
        });
      const awaitDelivery = async (delivered: Promise<void>, boundMs: number): Promise<boolean> => {
        let timer: NodeJS.Timeout | undefined;
        const arrived = await Promise.race([delivered.then(() => true), new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), boundMs)))]);
        clearTimeout(timer);
        await new Promise((resolve) => setImmediate(resolve));
        return arrived;
      };
      const lateChangesNothing = (o: Outcome, arrived: boolean) =>
        arrived && o.h.records.length === 1 && o.h.records[0].code === "budget-exhausted" && o.h.records[0].verdict !== "matched" && o.result.status === "passed";

      let signalLate: () => void = () => undefined;
      const lateDelivery = new Promise<void>((resolve) => (signalLate = resolve));
      const lateRun = await observe(label("g-late"), { reader: lateReader(() => signalLate()) });
      track(lateRun);
      const lateArrived = await awaitDelivery(lateDelivery, LATE_DELIVERY_BOUND_MS);
      check(
        "a reader that ignores the abort and answers late changes nothing: one record, budget-exhausted, never matched",
        lateChangesNothing(lateRun, lateArrived),
        `${describe(lateRun)} delivered=${lateArrived} records=${lateRun.h.records.length}`
      );

      // Negative control: a defective step that records the late reply into its own record sink must be caught. Not
      // tracked, so its planted record never reaches the codes-only and deadline checks below.
      let signalMutant: () => void = () => undefined;
      const mutantDelivery = new Promise<void>((resolve) => (signalMutant = resolve));
      let mutantHarness: Harness | undefined;
      const mutantRun = await observe(label("g-late-mutant"), {
        during: (h) => (mutantHarness = h),
        reader: lateReader(() => {
          const first = mutantHarness?.records[0];
          if (first) mutantHarness?.records.push({ ...first, verdict: "matched", code: "text-matched" } as OcrAssertionRecord);
          signalMutant();
        })
      });
      const mutantArrived = await awaitDelivery(mutantDelivery, LATE_DELIVERY_BOUND_MS);
      check(
        "negative control: a step that records the late reply as matched is caught by the same check",
        mutantArrived && mutantRun.h.records.length === 2 && !lateChangesNothing(mutantRun, mutantArrived),
        `delivered=${mutantArrived} records=${mutantRun.h.records.map((r) => r.code).join(",")}`
      );
      const neverArrived = await awaitDelivery(new Promise<void>(() => undefined), 50);
      check(
        "negative control: a late reply that never arrives within its bound fails the check, it never skips",
        neverArrived === false && !lateChangesNothing(lateRun, neverArrived)
      );

      const cancelling = new FakeReader(hangsUntilAbort);
      const cancelled = track(
        await observe(label("g-cancel"), {
          reader: cancelling,
          during: (h) => {
            void (async () => {
              for (let i = 0; i < 100 && cancelling.calls === 0; i += 1) await sleep(10);
              await h.cancel.cancel("verifier");
            })();
          }
        })
      );
      check(
        "a run cancelled during recognition is inconclusive/cancelled, the reader aborted, no failure recorded by the assertion",
        cancelled.record?.code === "cancelled" && cancelling.aborts === 1 && cancelled.h.records.length === 1,
        `${describe(cancelled)} aborts=${cancelling.aborts}`
      );

      const closed = track(await observe(label("g-closed"), { onCapture: (page) => void page.close() }));
      check(
        // N0 fails closed: a page it can no longer inspect is treated as a protected surface.
        "a page that closes as the capture starts is inconclusive (page-closed, capture-unavailable or N0's fail-closed protected-surface), the step passes, nothing read",
        closed.result.status === "passed" && closed.record?.verdict === "inconclusive" && ["page-closed", "capture-unavailable", "capture-stale", "protected-surface"].includes(closed.record.code) && closed.h.reader.calls === 0,
        describe(closed)
      );
      // A page already gone BEFORE the step is the runner's generic liveness guard, the same for every step type
      // (unchanged by N7.5): OCR is never reached, so it neither hides nor causes that failure.
      const deadBefore = await observe(label("g-dead-before"), { setup: async (page) => page.close() });
      const deadClick = await observe({ id: "g-dead-click", name: "Click", type: "click", locator: at("oc-label") } as unknown as FlowStep, { setup: async (page) => page.close() });
      check(
        "a page closed before the step meets the runner's generic liveness guard exactly as a click does; OCR is never reached",
        deadBefore.result.status === deadClick.result.status && deadBefore.h.records.length === 0 && deadBefore.h.loads.count === 0 && zeroTouch(deadBefore),
        `${describe(deadBefore)} | click ${deadClick.result.status}`
      );
      // A reply that lands while the main thread is held past the deadline (the timer cannot fire meanwhile) must be
      // late, never a verdict: lateness is judged by the clock when it lands, not by which callback runs first.
      const blocking = new FakeReader(async (options) => {
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, options.deadlineMs - 40)));
        holdMainThread(160);
        return { ok: true, words: EXPECTED.split(" ").map((text) => ({ text, confidence: 99 })), recognizeMs: 5 };
      });
      const blocked = track(await observe(label("g-blocked"), { reader: blocking }));
      check(
        "a matching reply that lands while the main thread is held past the deadline is budget-exhausted, never matched",
        blocked.result.status === "passed" && blocked.record?.verdict === "inconclusive" && blocked.record.code === "budget-exhausted" && blocking.calls === 1,
        describe(blocked)
      );
      const slowSource = track(await observe(label("g-slow-source", { value: undefined, valueSource: { type: "runtimeInput", key: "expectedLabel" } }), { runtimeInputs: { expectedLabel: EXPECTED }, resolveDelayMs: 400 }));
      check(
        "the recorded duration covers the whole assertion: a 400 ms expectation resolution is inside it",
        slowSource.record?.verdict === "matched" && slowSource.record.durationMs >= 400 && slowSource.record.durationMs <= slowSource.elapsedMs + 5,
        `${describe(slowSource)} elapsed=${slowSource.elapsedMs}ms`
      );
      const after = track(await observe(label("g-after")));
      check("a valid run afterwards is matched", after.record?.verdict === "matched", describe(after));
      check("every observation stayed within its deadline: no record above 1.5 s plus the margin", allRecords.every((r) => r.durationMs <= OCR_ASSERTION_DEADLINE_MS + 600), allRecords.map((r) => `${r.stepId}:${r.durationMs}`).join(" "));
      check(
        "no verdict is ever recorded after the 1500 ms deadline (matched and differs only within it)",
        allRecords.every((r) => (r.verdict !== "matched" && r.verdict !== "differs") || r.durationMs <= OCR_ASSERTION_DEADLINE_MS),
        allRecords.filter((r) => r.verdict === "matched" || r.verdict === "differs").map((r) => `${r.stepId}:${r.durationMs}`).join(" ")
      );
    }

    // ── J. Neutrality, malformed configurations, the validator and the gates ───────────────────
    console.log("\nJ. Neutrality, malformed configurations, the validator, the retry rule and the generator gate");
    {
      const page = await freshLab();
      const h = harness(page);
      const click = await h.run({ id: "j-click", name: "Click label", type: "click", locator: at("oc-label") } as unknown as FlowStep);
      const assertText = await h.run({ id: "j-text", name: "Assert label", type: "assertText", locator: at("oc-label"), config: { assertionType: "text", comparisonOperator: "equals", expectedValue: EXPECTED } } as unknown as FlowStep);
      const wrongText = await h.run({ id: "j-text-wrong", name: "Assert wrong", type: "assertText", locator: at("oc-label"), timeoutMs: 500, config: { assertionType: "text", comparisonOperator: "equals", expectedValue: "Something else" } } as unknown as FlowStep);
      await page.close();
      check(
        "with OCR on, non-OCR steps behave as before (click and assertText pass, a wrong assertText still fails) and OCR is never loaded",
        click.status === "passed" && assertText.status === "passed" && wrongText.status === "failed" && h.loads.count === 0 && h.reader.calls === 0 && h.records.length === 0,
        `${click.status} ${assertText.status} ${wrongText.status} loads=${h.loads.count}`
      );

      for (const [name, extra] of [
        ["an unknown match mode", { config: { ocrMatch: "regex" } }],
        ["a non-boolean case flag", { config: { ocrCaseSensitive: "yes" } }],
        ["an enforce mode", { mode: "enforce" }],
        ["a 257-character literal", { value: "a".repeat(257) }],
        ["a whitespace-only literal", { value: "   " }]
      ] as const) {
        const o = track(await observe(label(`j-${name.replace(/\W+/g, "-")}`, extra as Record<string, unknown>)));
        check(`${name}: inconclusive/expected-invalid, passes, nothing loaded, captured or read (never another assertion)`, o.result.status === "passed" && o.record?.code === "expected-invalid" && o.h.loads.count === 0 && zeroTouch(o), describe(o));
      }

      const flowWith = (node: Record<string, unknown>) =>
        ({
          id: "v",
          name: "V",
          version: 1,
          nodes: [
            { id: "start", type: "start", name: "Start" },
            { id: "a", name: "A", locator: at("oc-label"), ...node },
            { id: "end", type: "end", name: "End" }
          ],
          edges: [
            { id: "e1", source: "start", target: "a" },
            { id: "e2", source: "a", target: "end" }
          ]
        }) as never;
      const issues = (node: Record<string, unknown>) => validateFlowDefinition(flowWith(node)).issues.filter((i) => i.nodeId === "a");
      const codes = (node: Record<string, unknown>) => issues(node).map((i) => i.code);
      const base = { type: "assertImageText", value: EXPECTED };
      const accepted = [base, { ...base, mode: "observe" }, { ...base, config: { ocrMatch: "exact" } }, { ...base, config: { ocrMatch: "contains", ocrCaseSensitive: true } }, { type: "assertImageText", valueSource: { type: "dynamic", dataSourceScope: "workflow", idMode: "instanceOrder", keyName: "orderLabel" } }];
      check(
        "the validator accepts a literal, observe, each match mode, a case flag and a dynamic binding",
        accepted.every((node) => codes(node).length === 0),
        JSON.stringify(accepted.map((node) => issues(node).map((i) => `${i.code}: ${i.message}`)))
      );
      for (const [name, node, code] of [
        ["no locator", { ...base, locator: undefined }, "missingRequiredLocator"],
        ["no expected text", { type: "assertImageText" }, "missingRequiredValue"],
        ["mode enforce", { ...base, mode: "enforce" }, "unsupportedConfiguration"],
        ["an unknown match mode", { ...base, config: { ocrMatch: "fuzzy" } }, "unsupportedConfiguration"],
        ["a 257-character literal", { ...base, value: "b".repeat(257) }, "unsupportedConfiguration"],
        ["a secret source", { type: "assertImageText", valueSource: { type: "secret", secretName: "vault-entry" } }, "unsupportedConfiguration"],
        ["a card-number literal", { ...base, value: "4111 1111 1111 1111" }, "unsupportedConfiguration"],
        ["an environment source", { type: "assertImageText", valueSource: { type: "env", envKey: "LABEL" } }, "unsupportedConfiguration"]
      ] as const) {
        check(`the validator refuses ${name} (${code})`, codes(node as Record<string, unknown>).includes(code), JSON.stringify(issues(node as Record<string, unknown>)));
      }
      const cardMessages = issues({ ...base, value: "4111 1111 1111 1111" }).map((i) => i.message).join(" ");
      check("validator messages never quote the expected text", cardMessages.length > 0 && !cardMessages.includes("4111"), cardMessages);
      const retryStep = { id: "r", name: "r", type: "assertImageText", retry: { count: 3, delayMs: 1 }, safety: { sideEffectLevel: "read", retryable: true } };
      const retryDecision = new RetryPolicy().decide({ step: retryStep as never, error: "Element is not visible.", attempt: 0 });
      const retryControl = new RetryPolicy().decide({ step: { ...retryStep, type: "assertVisible" } as never, error: "Element is not visible.", attempt: 0 });
      check("RetryPolicy never retries assertImageText, while the same retryable step as assertVisible is retried (control)", !retryDecision.retry && retryControl.retry, `${JSON.stringify(retryDecision)} | ${JSON.stringify(retryControl)}`);
      const campaign = resolveConstraints({ seed: "n7-5", nodeTypeWeights: { assertImageText: 50 }, allowedGates: ["neverGenerated"] });
      check(
        "the random Test Lab never generates assertImageText, even weighted and gate-opted, and reports it blocked",
        NODE_CATALOG.assertImageText.gate === "neverGenerated" && !actionNodeWeights(campaign).some((w) => w.value === "assertImageText") && blockedNodeTypes(campaign).some((b) => b.type === "assertImageText")
      );
      // The Designer's real converters: what a save writes back, and what the section and run gate say.
      const designerCycle = (step: Record<string, unknown>) =>
        toFlowStep({ id: String(step.id), type: "action", position: { x: 0, y: 0 }, data: fromFlowStep(step as unknown as FlowStep) } as FlowDesignerNode, []);
      const saved = designerCycle({ id: "m1", type: "assertImageText", name: "M", locator: at("oc-label"), value: EXPECTED, config: { ocrMatch: "exact", ocrCaseSensitive: false, futureOcrSetting: 7 } });
      check(
        "a Designer save keeps the match mode, the case flag, the expected text and an unknown config key, and writes no mode",
        saved.config?.ocrMatch === "exact" && saved.config.ocrCaseSensitive === false && (saved.config as Record<string, unknown>).futureOcrSetting === 7 && saved.value === EXPECTED && saved.mode === undefined,
        JSON.stringify(saved)
      );
      const unsupported = designerCycle({ id: "m2", type: "assertImageText", name: "M", locator: at("oc-label"), value: EXPECTED, mode: "enforce", config: { ocrMatch: "regex", ocrCaseSensitive: "yes" } });
      // Validated as the fixture's node "a" (its own id would hide it from the per-node filter).
      const { id: _savedId, position: _savedPosition, ...savedNode } = unsupported;
      const savedIssues = issues(savedNode as unknown as Record<string, unknown>).filter((i) => i.code === "unsupportedConfiguration");
      check(
        "a Designer save keeps an unsupported match mode, case flag and mode as saved, so the validator still refuses each of them (never turned into defaults)",
        unsupported.config?.ocrMatch === ("regex" as never) && (unsupported.config as Record<string, unknown>).ocrCaseSensitive === "yes" && unsupported.mode === "enforce" && savedIssues.length >= 3,
        `${JSON.stringify(unsupported)} issues=${savedIssues.length}`
      );
      const retyped = toFlowStep({ id: "m3", type: "action", position: { x: 0, y: 0 }, data: { ...fromFlowStep({ id: "m3", type: "assertImageText", name: "M", locator: at("oc-label") as never, value: EXPECTED, config: { ocrMatch: "contains", ocrCaseSensitive: true } }), stepType: "assertText" } } as FlowDesignerNode, []);
      check("a node changed to another type drops the OCR match settings", retyped.config?.ocrMatch === undefined && retyped.config?.ocrCaseSensitive === undefined, JSON.stringify(retyped.config));
      const designerSays = (step: Record<string, unknown>) => imageTextDesignerMessages(fromFlowStep(step as unknown as FlowStep));
      const cardSays = designerSays({ id: "d1", type: "assertImageText", name: "M", locator: at("oc-label"), value: "4111 1111 1111 1111" });
      const secretSays = designerSays({ id: "d2", type: "assertImageText", name: "M", locator: at("oc-label"), valueSource: { type: "secret", secretName: "vault-entry" } });
      check(
        "the Designer section refuses a card number and a secret source with the engine's OC-8 words, never quoting the value, and accepts a plain label",
        cardSays.some((m) => /card number/.test(m)) && !cardSays.join(" ").includes("4111") && secretSays.some((m) => /bound to a secret/.test(m)) &&
          designerSays({ id: "d3", type: "assertImageText", name: "M", locator: at("oc-label"), value: EXPECTED }).length === 0 &&
          designerSays({ id: "d4", type: "assertImageText", name: "M", locator: at("oc-label") }).some((m) => /requires an expected text/.test(m)),
        JSON.stringify({ cardSays, secretSays })
      );
      const runnerText = readFileSync("src/runner/PlaywrightRunner.ts", "utf8");
      check("the runner loads the adapter only through a lazy dynamic import", /import\("\.\/ocr\/OcrStep"\)/.test(runnerText) && !/^import\s+\{[^}]*\bOcrStep\b[^}]*\}\s+from/m.test(runnerText));
    }

    // ── Codes only ─────────────────────────────────────────────────────────────────────────────
    console.log("\nEvery record is codes only");
    const serialized = JSON.stringify(allRecords);
    check(`${allRecords.length} records carry only the allowlisted fields`, allRecords.length >= 40 && allRecords.every((r) => Object.keys(r).every((k) => ["stepId", "flowId", "mode", "status", "verdict", "code", "distanceBucket", "confidenceBucket", "charCount", "durationMs"].includes(k))));
    check("no record holds an expected or a recognized text", !/Order|4521|shipped|Payment|declined|4111|Security|vault|482913|GB82/.test(serialized.replace(/"stepId":"[^"]*"/g, "")), serialized.slice(0, 300));
    check("every record passed its step (observe never fails)", allRecords.every((r) => r.status === "passed" && r.mode === "observe"));
  } finally {
    await browser?.close().catch(() => undefined);
    server.kill();
  }
}

await main();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
