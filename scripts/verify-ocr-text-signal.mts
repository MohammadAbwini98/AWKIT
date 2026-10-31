/**
 * verify:ocr-text-signal — Phase N, N7.7 (awkit-vra.9.8): the advisory OCR-vs-accessible-name signal, shadow in N2 and
 * codes-only in N5, effect none (N7 plan § N7.7, design points confirmed by the owner 2026-10-31). Real Chromium; the
 * recognizer is a deterministic fake (the real engine and host are verify:ocr-host's), so every outcome is reproducible.
 *
 *  A. The signal itself (OcrStep.textSignal): similar, differs, uncertain (near miss), unreadable (low confidence), a
 *     late reply (budget-exhausted), a cold host, a busy host and a recognizer without readiness (never started, never
 *     prepared, never asked), a handed-off page, a protected page, a sensitive container, a non-unique target and a
 *     target without an accessible name (each refused before any capture or recognition), a budget too small to start.
 *  B. Codes only: a signal carries exactly outcome, code and duration, and never the name or the recognized text.
 *  C. N2 shadow (VisualFusionStage): the record gains only `textSignal`; outcome, reason and effect are identical to a
 *     run without it; a sensitive (shadow-only) winner is never asked; the signal never gets more than the budget.
 *     Negative control: an effectful sink that turns a differing signal into a veto is caught by the same parity check.
 *  D. N5 codes (VisualFailureDiagnosis): `differs` adds target-text-differs-from-name, `unreadable` adds
 *     target-text-unreadable, `similar`, `uncertain` and `skipped` add nothing; every other observation is identical to
 *     a run without the signal; no match or several matches never ask it.
 *  E. Persistence: the recovery provenance keeps the N2 signal only as fixed codes; free text is rewritten `invalid` or
 *     dropped. Negative control: a provenance carrying the name is caught by the leak check.
 *  F. Wiring at source level, each rule also failing on a mutated source: offered only with OCR in observe mode, after
 *     the N2 verdict is final, N5 adds only the two contract codes, the signal checks readiness before the page, and the
 *     renderer labels both N5 codes as unverified OCR evidence.
 *
 * Run: npm run verify:ocr-text-signal
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

import type { FlowStep } from "@src/profiles/FlowProfile";
import type { OcrHostImage, OcrHostOutcome } from "@src/ocr/OcrHostProtocol";
import { accessibleName, OcrStep, textSignalOutcome } from "@src/runner/ocr/OcrStep";
import { OCR_TEXT_SIGNAL_DIAGNOSIS_CODES, type OcrRecognizer, type OcrTextSignal, type OcrTextSignalSource } from "@src/runner/ocr/ocrAssertionContract";
import { VisualFusionStage, type VisualFusionVerdictRecord } from "@src/runner/visualFusion/VisualFusionStage";
import { VisualFailureDiagnosis } from "@src/runner/visualDiagnosis/VisualFailureDiagnosis";
import { toRecoveryProvenance } from "@src/runner/domIntelligence/recoveryProvenance";
import type { LocatorRecoveryTrace } from "@src/runner/LocatorFactory";

const root = join(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const NAME = "Order 4521 shipped";
const words = (text: string, confidence = 99) => text.split(" ").map((w) => ({ text: w, confidence }));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeRecognizer implements OcrRecognizer {
  calls = 0;
  prepares = 0;
  constructor(
    public state: "ready" | "cold" | "busy",
    private readonly answer: (image: OcrHostImage) => Promise<OcrHostOutcome>
  ) {}
  readiness(): "ready" | "cold" | "busy" {
    return this.state;
  }
  prepare(): void {
    this.prepares += 1;
  }
  recognize(image: OcrHostImage): Promise<OcrHostOutcome> {
    this.calls += 1;
    return this.answer(image);
  }
}
const reads = (text: string, confidence = 99) => async (): Promise<OcrHostOutcome> => ({ ok: true, words: words(text, confidence), recognizeMs: 5 });

const PAGE = `<!doctype html><html><body style="margin:20px;font-family:Arial">
<button data-testid="t-named" style="font-size:24px;padding:8px 12px">${NAME}</button>
<p data-testid="t-noname" style="font-size:24px">${NAME}</p>
<button data-testid="t-dupe">Same</button><button data-testid="t-dupe">Same</button>
<div data-testid="t-cvv" role="group" aria-label="Card check" style="font-size:20px">Security code <input name="cvv" aria-label="Security code" value="123"></div>
</body></html>`;
const PROTECTED = `<!doctype html><html><body><button data-testid="t-named" style="font-size:24px">${NAME}</button>
<form><label>Password <input type="password" name="password" autocomplete="current-password"></label></form></body></html>`;

let browser: Browser | undefined;
const fresh = async (html = PAGE): Promise<Page> => {
  const page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(html);
  return page;
};

async function signal(page: Page, testId: string, recognizer: OcrRecognizer, extra: { handedOff?: boolean; deadlineMs?: number } = {}): Promise<OcrTextSignal> {
  return new OcrStep({ recognizer }).textSignal({ page, target: page.getByTestId(testId), handedOff: extra.handedOff ?? false, deadlineMs: extra.deadlineMs ?? 1500 });
}

const step = (testId: string): FlowStep => ({ id: `s-${testId}`, type: "click", locator: { strategy: "testId", value: testId } }) as unknown as FlowStep;

try {
  browser = await chromium.launch();

  // ── A. The signal ────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("A. The signal (OcrStep.textSignal)");
  {
    const page = await fresh();
    check("the accessible name is read from the element's own ARIA line", accessibleName(await page.getByTestId("t-named").ariaSnapshot()) === NAME);
    check("an element without a quoted name has none", accessibleName(await page.getByTestId("t-noname").ariaSnapshot()) === null);
    const outcomes: Array<[string, () => Promise<OcrHostOutcome>, string, string]> = [
      ["the same text is similar", reads(NAME), "similar", "text-matched"],
      ["different text differs", reads("Payment declined today"), "differs", "text-differs"],
      ["a one-character difference is uncertain (near miss)", reads("Order 4527 shipped"), "uncertain", "near-miss"],
      ["a low-confidence read is unreadable", reads(NAME, 40), "unreadable", "low-confidence"]
    ];
    for (const [label, answer, outcome, code] of outcomes) {
      const fake = new FakeRecognizer("ready", answer);
      const got = await signal(page, "t-named", fake);
      check(`${label}: ${outcome}/${code}`, got.outcome === outcome && got.code === code && fake.calls === 1 && fake.prepares === 0, JSON.stringify(got));
    }
    const late = new FakeRecognizer("ready", async () => {
      await sleep(1200);
      return { ok: true, words: words(NAME), recognizeMs: 1200 };
    });
    const lateGot = await signal(page, "t-named", late, { deadlineMs: 600 });
    check("a late reply is skipped/budget-exhausted, never similar", lateGot.outcome === "skipped" && lateGot.code === "budget-exhausted" && lateGot.durationMs < 700, JSON.stringify(lateGot));
    for (const [state, code] of [["cold", "ocr-unavailable"], ["busy", "ocr-busy"]] as const) {
      const fake = new FakeRecognizer(state, reads(NAME));
      const got = await signal(page, "t-named", fake);
      check(`a ${state} host: skipped/${code}, never started, prepared or asked`, got.outcome === "skipped" && got.code === code && fake.calls === 0 && fake.prepares === 0, JSON.stringify(got));
    }
    let asked = 0;
    const noReadiness: OcrRecognizer = { recognize: async () => ((asked += 1), { ok: true, words: words(NAME), recognizeMs: 1 }) };
    const none = await signal(page, "t-named", noReadiness);
    check("a recognizer without readiness counts as cold: skipped/ocr-unavailable, never asked", none.code === "ocr-unavailable" && asked === 0);
    const refusals: Array<[string, Promise<OcrTextSignal>, string]> = [];
    const ready = () => new FakeRecognizer("ready", reads(NAME));
    const handed = ready();
    refusals.push(["a handed-off page", signal(page, "t-named", handed, { handedOff: true }), "handoff-active"]);
    const dupe = ready();
    refusals.push(["a non-unique target", signal(page, "t-dupe", dupe), "target-not-unique"]);
    const cvv = ready();
    refusals.push(["a sensitive container (cvv)", signal(page, "t-cvv", cvv), "sensitive-step"]);
    const noname = ready();
    refusals.push(["a target with no accessible name", signal(page, "t-noname", noname), "no-accessible-name"]);
    const tiny = ready();
    refusals.push(["a budget too small to start", signal(page, "t-named", tiny, { deadlineMs: 150 }), "budget-exhausted"]);
    for (const [index, [label, pending, code]] of refusals.entries()) {
      const got = await pending;
      const fake = [handed, dupe, cvv, noname, tiny][index];
      check(`${label}: skipped/${code}, nothing captured or recognized`, got.outcome === "skipped" && got.code === code && fake.calls === 0, JSON.stringify(got));
    }
    const prot = await fresh(PROTECTED);
    const protFake = ready();
    const protGot = await signal(prot, "t-named", protFake);
    check("a protected sign-in page: skipped/protected-surface, nothing captured or recognized", protGot.outcome === "skipped" && protGot.code === "protected-surface" && protFake.calls === 0, JSON.stringify(protGot));
    await prot.close();

    // ── B. Codes only ──────────────────────────────────────────────────────────────────────────────────────────────
    console.log("\nB. Codes only");
    const sample = await signal(page, "t-named", new FakeRecognizer("ready", reads("Payment declined today")));
    check("a signal carries exactly outcome, code and duration", JSON.stringify(Object.keys(sample).sort()) === JSON.stringify(["code", "durationMs", "outcome"]));
    check("it never holds the accessible name or the recognized text", !/Order|4521|shipped|Payment|declined/.test(JSON.stringify(sample)));
    check("the outcome map is closed: an unknown or refusal code is skipped", textSignalOutcome("protected-surface") === "skipped" && textSignalOutcome("anything") === "skipped");
    await page.close();
  }

  // ── C. N2 shadow ───────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\nC. N2 shadow (VisualFusionStage)");
  {
    const observe = async (textSignal: OcrTextSignalSource | undefined, sensitive = false, onVerdict?: (r: VisualFusionVerdictRecord) => void) => {
      const folder = mkdtempSync(join(tmpdir(), "awkit-n77-n2-"));
      const page = await fresh();
      try {
        const stage = new VisualFusionStage({ folder, handedOff: () => false, ...(textSignal ? { textSignal } : {}), ...(onVerdict ? { onVerdict } : {}) });
        return await stage.observeRecovery({ page, step: step("t-named"), scopeKey: "k", locator: page.getByTestId("t-named"), sensitive, signal: new AbortController().signal, score: 0.95, layer: "local", competitors: [], margin: 0.5 });
      } finally {
        await page.close();
        rmSync(folder, { recursive: true, force: true });
      }
    };
    const strip = (r: VisualFusionVerdictRecord | undefined) => (r ? { outcome: r.outcome, reason: r.reason, effect: r.effect, eligibility: r.eligibility } : null);
    let budgetSeen = -1;
    const differs: OcrTextSignalSource = async (request) => ((budgetSeen = request.deadlineMs), { outcome: "differs", code: "text-differs", durationMs: 1 });
    const base = await observe(undefined);
    const withSignal = await observe(differs);
    check("without the signal the record has no textSignal", base !== undefined && base.textSignal === undefined);
    check("with it the record gains only textSignal { differs, text-differs }", withSignal?.textSignal?.outcome === "differs" && withSignal.textSignal.code === "text-differs");
    check("outcome, reason, effect and eligibility are identical with and without the signal", JSON.stringify(strip(base)) === JSON.stringify(strip(withSignal)), `${JSON.stringify(strip(base))} vs ${JSON.stringify(strip(withSignal))}`);
    check("the signal is given at most the observation's 400 ms budget", budgetSeen > 0 && budgetSeen <= 400, String(budgetSeen));
    let askedSensitive = 0;
    await observe(async () => ((askedSensitive += 1), { outcome: "similar", code: "text-matched", durationMs: 1 }), true);
    check("a sensitive (shadow-only) winner is never asked", askedSensitive === 0);
    // Negative control: an effectful mutation (a sink that vetoes on a differing signal) is caught by the parity check.
    const mutant = await observe(differs, false, (r) => {
      if (r.textSignal?.outcome === "differs") (r as { effect: string }).effect = "veto";
    });
    check("negative control: an effectful mutation is caught by the same parity check", JSON.stringify(strip(base)) !== JSON.stringify(strip(mutant)));
  }

  // ── D. N5 codes ────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\nD. N5 codes (VisualFailureDiagnosis)");
  {
    let execution = 0;
    const diagnose = async (testId: string, textSignal?: OcrTextSignalSource) => {
      const page = await fresh();
      try {
        const diagnosis = new VisualFailureDiagnosis({ folder: tmpdir(), handedOff: () => false, reader: { get: async () => ({ status: "missing" as const }) }, ...(textSignal ? { textSignal } : {}) });
        execution += 1;
        return await diagnosis.diagnoseFinalFailure({
          step: step(testId),
          attempt: 0,
          errorClass: "business-rule" as never,
          executionId: `e-${execution}`,
          scenarioId: "s",
          flowId: "f",
          page: async () => page,
          limitScreenshot: (fn) => fn()
        });
      } finally {
        await page.close();
      }
    };
    const stub = (outcome: OcrTextSignal["outcome"]): { source: OcrTextSignalSource; asked: () => number } => {
      let asked = 0;
      return { source: async () => ((asked += 1), { outcome, code: "x", durationMs: 1 }), asked: () => asked };
    };
    const base = await diagnose("t-named");
    check("the baseline diagnosis is observed with no OCR code", base?.outcome === "observed" && !base.observations.some((c) => c.startsWith("target-text-")), JSON.stringify(base?.observations));
    for (const outcome of ["differs", "unreadable", "similar", "uncertain", "skipped"] as const) {
      const s = stub(outcome);
      const record = await diagnose("t-named", s.source);
      const expected = OCR_TEXT_SIGNAL_DIAGNOSIS_CODES[outcome];
      const extra = (record?.observations ?? []).filter((c) => !(base?.observations ?? []).includes(c));
      check(
        `${outcome}: ${expected ? `adds ${expected}` : "adds nothing"}; every other observation unchanged`,
        s.asked() === 1 && JSON.stringify(extra) === JSON.stringify(expected ? [expected] : []) && (base?.observations ?? []).every((c) => record?.observations.includes(c)),
        JSON.stringify(record?.observations)
      );
    }
    for (const [label, testId] of [["no match", "t-missing"], ["several matches", "t-dupe"]] as const) {
      const s = stub("differs");
      await diagnose(testId, s.source);
      check(`${label}: the signal is never asked`, s.asked() === 0);
    }
  }

  // ── E. Persistence ─────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\nE. Persistence (recovery provenance)");
  {
    const trace = (ocrText: unknown) =>
      ({
        engine: "snapshot",
        result: "recovered",
        candidatesTried: 1,
        stages: [],
        context: { page: "p1", frame: "main", frameDepth: 0, route: "match" },
        totalMs: 5,
        visual: { mode: "shadow", outcome: "dom-only", reason: "no-reference", effect: "none", ms: 3, ocrText }
      }) as unknown as LocatorRecoveryTrace;
    const leaks = (value: unknown) => /Order|4521|shipped/.test(JSON.stringify(value));
    const kept = toRecoveryProvenance(trace({ outcome: "differs", code: "text-differs" }));
    check("a valid signal is kept as two fixed codes", kept.visual?.ocrText?.outcome === "differs" && kept.visual.ocrText.code === "text-differs");
    const hostile = toRecoveryProvenance(trace({ outcome: "differs", code: NAME }));
    check("free text in the code is rewritten invalid", hostile.visual?.ocrText?.code === "invalid" && !leaks(hostile));
    const unknown = toRecoveryProvenance(trace({ outcome: NAME, code: "text-differs" }));
    check("an unknown outcome drops the signal", unknown.visual?.ocrText === undefined && !leaks(unknown));
    check("negative control: a provenance that carries the name is caught by the leak check", leaks({ ...kept, visual: { ...kept.visual, ocrText: { outcome: "differs", code: NAME } } }));
  }
} finally {
  await browser?.close();
}

// ── F. Wiring at source level ────────────────────────────────────────────────────────────────────────────────────────
console.log("\nF. Wiring (each rule also fails on a mutated source)");
type Rule = [string, string, (s: string) => boolean, (s: string) => string];
const runner = read("src/runner/PlaywrightRunner.ts");
const fusion = read("src/runner/visualFusion/VisualFusionStage.ts");
const diagnosis = read("src/runner/visualDiagnosis/VisualFailureDiagnosis.ts");
const adapter = read("src/runner/ocr/OcrStep.ts");
const section = read("app/renderer/components/reports/VisualDiagnosisSection.tsx");
const rules: Rule[] = [
  ["the signal is offered only with OCR in observe mode", runner, (s) => s.includes('if (!options || options.mode !== "observe") return {};'), (s) => s.replace('if (!options || options.mode !== "observe") return {};', "if (!options) return {};")],
  ["N2 asks only after the verdict is final, and assigns only textSignal", fusion, (s) => /const verdictRecord = record\([^)]*\);\s*\/\/ N7\.7[^\n]*\n\s*if \(this\.options\.textSignal && eligibility === "eligible"/.test(s) && /if \(text\) verdictRecord\.textSignal = \{ outcome: text\.outcome, code: text\.code \};\s*\}/.test(s) && !/verdictRecord\.(outcome|reason|effect|evidence|eligibility|layer)\s*=/.test(s), (s) => s.replace("verdictRecord.textSignal = { outcome: text.outcome, code: text.code };", 'verdictRecord.textSignal = { outcome: text.outcome, code: text.code }; verdictRecord.effect = "veto";')],
  ["N5 adds only the contract codes, for exactly one visible match", diagnosis, (s) => s.includes("matches === 1 && target?.inViewport && !target.zeroSize") && s.includes("OCR_TEXT_SIGNAL_DIAGNOSIS_CODES[text.outcome]"), (s) => s.replace("OCR_TEXT_SIGNAL_DIAGNOSIS_CODES[text.outcome]", "text.code")],
  ["the signal checks readiness before it touches the page", adapter, (s) => s.indexOf('if (readiness !== "ready")') > -1 && s.indexOf('if (readiness !== "ready")') < s.indexOf("checkProtectedSurface(request.page)"), (s) => s.replace('if (readiness !== "ready") return skipped(readiness === "busy" ? "ocr-busy" : "ocr-unavailable");', "")],
  ["the signal uses a recognizer that never starts or waits for a host", adapter, (s) => s.includes("new OcrStep({ recognizer: warmOnly(this.options.recognizer) })"), (s) => s.replace("warmOnly(this.options.recognizer)", "this.options.recognizer")],
  ["the renderer labels both N5 codes as unverified OCR evidence", section, (s) => /"target-text-differs-from-name":\s*"Unverified OCR evidence:/.test(s) && /"target-text-unreadable": "Unverified OCR evidence:/.test(s), (s) => s.replace('"target-text-unreadable": "Unverified OCR evidence:', '"target-text-unreadable": "The target text')]
];
for (const [label, source, rule, mutate] of rules) {
  check(label, rule(source));
  check("  …and fails on a mutated source", !rule(mutate(source)));
}

console.log(`\nverify:ocr-text-signal: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
