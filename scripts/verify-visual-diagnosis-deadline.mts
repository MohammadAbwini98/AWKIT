/**
 * verify:visual-diagnosis-deadline — the N5 diagnosis deadline fix (2026-11-01), shared by N8 and N9. Real adapter
 * (`VisualFailureDiagnosis`), real N0 capture, real Chromium, the Visual Rows Lab with N8 and N9 both on.
 *
 * Synchronous pixel work blocks the event loop, so a deadline TIMER can fire late. The fix settles at a work budget a
 * margin before the hard deadline, checks the monotonic clock before publishing, and starts synchronous phases only
 * behind a yield-and-budget checkpoint. "Late" here is STRICT: the hook returned after the hard deadline, by any amount.
 *
 *   D1  reproduction: margin 0 and an 80 ms synchronous block that starts 20 ms before the deadline: the record comes
 *       back late (the original defect, shown on purpose);
 *   D2  remedy: the same block placed 20 ms before the (default) work budget: back by the hard deadline, budget-exhausted;
 *   D3  background main-thread contention (a 25 ms synchronous block every 40 ms) across whole N8+N9 diagnoses: none late;
 *   D4  abort during frame work (the frame held past the deadline): back by the deadline, one record, frame released,
 *       nothing in flight;
 *   D5  late frame delivery (the N9 second screenshot held 3 s): back by the deadline, the late frame released;
 *   D6  N8 and N9 together under the D2 block: back by the deadline, one record, at most one state and three row codes;
 *   D7  pins: the publish gate reads the monotonic clock, the checkpoint guards N5's own frame work (each member at its
 *       measured per-pixel cost, QC F1), and the work budget formula; the N9 code keeps a slot under the observation
 *       cap, tested on appendAdvisoryCodes itself (QC F6); 2026-11-01 QC: memberCropPixels behaviourally (a large DPR-2
 *       member, a viewport-edge-clipped one, an offscreen one) and no slot reserved for a state code already present;
 *       awkit-vra.18: the per-phase reserve, the host factor and the second capture's timeout;
 *   D8  awkit-vra.18: a host 3x slower than every reserved rate (the verifier-only `syncCost` probe busy-waits 2 x the
 *       phase's rate per pixel in every synchronous phase, decode included) across whole N8+N9 diagnoses started at
 *       eight offsets: none returns after the hard deadline, the host factor is learned and carried, and it decays
 *       once ordinary diagnoses follow;
 *   D9  awkit-vra.18: N9's second capture leaves the decode reserve. The `onCaptureTimeout` observer's timeout is
 *       checked against the verifier's own clock, then a DPR-2 frame on a host 3x slower in the fingerprint and decode
 *       phases has its second screenshot delivered 10 ms before that timeout: the decode still ends by the hard deadline.
 *
 * Run: npm run verify:visual-diagnosis-deadline
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import {
  VisualFailureDiagnosis,
  appendAdvisoryCodes,
  carriedVisualDiagnosisHostFactor,
  memberCropPixels,
  resetVisualDiagnosisHostFactors,
  type VisualDiagnosisProbe
} from "@src/runner/visualDiagnosis/VisualFailureDiagnosis";
import { VISUAL_DIAGNOSIS_RECORD_MAX_OBSERVATIONS } from "@src/runner/visualDiagnosis/visualDiagnosisRecord";
import {
  VISUAL_DIAGNOSIS_HOST_FACTOR_WINDOW,
  VISUAL_DIAGNOSIS_SETTLE_MARGIN_MS,
  VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL,
  VISUAL_DIAGNOSIS_SYNC_RESERVE_MS,
  visualDiagnosisHostFactor,
  visualDiagnosisSyncReserveMs,
  type VisualDiagnosisSyncPhase,
  visualDiagnosisWorkBudget,
  type VisualDiagnosisRecord
} from "@src/runner/visualDiagnosis/visualDiagnosisContract";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { visualStateAnalysisPixels } from "@src/visual";

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

const PORT = 4615;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence/rows`;
const ATTEMPTS = 3;
let browser: Browser | undefined;
let seq = 0;

/** A synchronous block of the event loop (the contention the defect needs). */
function block(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // busy
  }
}

async function lab(fixture = "table-uniform", deviceScaleFactor = 1): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor });
  await page.goto(LAB);
  await page.waitForSelector("body[data-fixtures]");
  await page.evaluate((id) => (window as unknown as { __rowsLab: { show(i: string, v: string): Promise<unknown> } }).__rowsLab.show(id, "b"), fixture);
  await page.waitForSelector(`#rw-stage[data-shown="${fixture}:b"]`);
  return page;
}

interface Run {
  record: VisualDiagnosisRecord | undefined;
  waited: number;
  frames: { taken: number; released: number; late: number };
  diagnosis: VisualFailureDiagnosis;
  /** The planned block started on time (the frame was ready before it). */
  placed: boolean;
  /** awkit-vra.18: N9's second capture as the observer saw it, with the work budget left on the verifier's own clock. */
  second?: { timeoutMs: number; leftMs: number; reserveMs: number; verifierLeftMs: number; firstPixels: number };
  /** The second screenshot was delivered within 15 ms of the end of its timeout (D9's precondition). */
  heldToTimeout: boolean;
  /** Every synchronous phase the adapter started, in order (from the syncCost probe). */
  phases: VisualDiagnosisSyncPhase[];
  /** D10: when the held first frame was let go, ms after the call began. */
  firstHeldTo?: number;
}

async function run(
  page: Page,
  options: {
    deadlineMs: number;
    marginMs?: number;
    rows?: boolean;
    state?: boolean;
    /** Block synchronously this long, starting this many ms after the call began (inside the after-frame hold). */
    blockAt?: number;
    blockMs?: number;
    /** Hold the frame (asynchronously) this long. */
    holdMs?: number;
    /** Delay the n-th screenshot by this long. */
    delayShot?: { index: number; ms: number };
    /** awkit-vra.18: a host this many times slower than the reserved rates in these synchronous phases (all by default). */
    slow?: number;
    slowPhases?: readonly VisualDiagnosisSyncPhase[];
    /** Wait this long (asynchronously) before the frame, so the synchronous phases start at another point of the budget. */
    preFrameMs?: number;
    /** awkit-vra.18: deliver the second screenshot 10 ms before its capture timeout ends. */
    holdSecondToTimeout?: boolean;
    /** Campaign-10 headed@2: hold the first frame until this many ms after the call began (a slow first capture). */
    firstFrameAt?: number;
  }
): Promise<Run> {
  const frames = { taken: 0, released: 0, late: 0 };
  const workBudget = visualDiagnosisWorkBudget(options.deadlineMs, options.marginMs);
  let second: Run["second"];
  let firstPixels = 0;
  let heldToTimeout = false;
  let placed = options.blockAt === undefined;
  let callStarted = 0;
  const phases: VisualDiagnosisSyncPhase[] = [];
  let firstHeldTo: number | undefined;
  const probe: VisualDiagnosisProbe = {
    hold: async (stage) => {
      if (stage === "before-frame" && options.preFrameMs) await new Promise((r) => setTimeout(r, options.preFrameMs));
      if (stage !== "after-frame") return;
      if (options.holdMs) await new Promise((r) => setTimeout(r, options.holdMs));
      if (options.blockAt !== undefined) {
        const wait = options.blockAt - (performance.now() - callStarted);
        if (wait > 0) {
          placed = true;
          await new Promise((r) => setTimeout(r, wait));
        }
        block(options.blockMs ?? 0);
      }
    },
    heldFrame: async (index) => {
      if (index !== 1 || options.firstFrameAt === undefined) return;
      const wait = options.firstFrameAt - (performance.now() - callStarted);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      firstHeldTo = performance.now() - callStarted;
    },
    onFrame: (event) => {
      if (event === "taken") frames.taken += 1;
      else if (event === "released") frames.released += 1;
      else frames.late += 1;
    },
    // The simulated slower host: each synchronous phase also busy-waits (slow - 1) x its reserved rate per pixel.
    syncCost: (phase, pixels) => {
      phases.push(phase);
      if (phase === "decode" && firstPixels === 0) firstPixels = pixels;
      if (options.slow && (!options.slowPhases || options.slowPhases.includes(phase))) block(((options.slow - 1) * VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL[phase] * pixels) / 1e6);
    },
    onCaptureTimeout: ({ timeoutMs, leftMs, reserveMs }) => {
      second = { timeoutMs, leftMs, reserveMs, verifierLeftMs: workBudget - (performance.now() - callStarted), firstPixels };
    }
  };
  const diagnosis = new VisualFailureDiagnosis({
    folder: join(process.cwd(), "build", "deadline-verify-no-references"),
    handedOff: () => false,
    reader: { get: async () => ({ status: "missing" }) as never },
    deadlineMs: options.deadlineMs,
    ...(options.marginMs !== undefined ? { settleMarginMs: options.marginMs } : {}),
    ...(options.rows ? { rowEvidence: true } : {}),
    ...(options.state ? { stateRecognition: true } : {}),
    probe
  });
  let shots = 0;
  const step = { id: "deadline", name: "Deadline", type: "click", timeoutMs: 800, locator: { strategy: "testId", value: "rw-target" } } as unknown as FlowStep;
  callStarted = performance.now();
  const record = await diagnosis.diagnoseFinalFailure({
    step,
    attempt: 0,
    errorClass: "locator",
    executionId: `deadline-${(seq += 1)}`,
    scenarioId: "deadline",
    flowId: "deadline-flow",
    page: async () => page,
    limitScreenshot: async (fn) => {
      shots += 1;
      if (options.delayShot && shots === options.delayShot.index) await new Promise((r) => setTimeout(r, options.delayShot!.ms));
      if (!(options.holdSecondToTimeout && shots === 2 && second)) return fn();
      const timeoutEnds = performance.now() + second.timeoutMs;
      const value = await fn();
      const wait = timeoutEnds - 10 - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      heldToTimeout = Math.abs(timeoutEnds - performance.now()) <= 15;
      return value;
    }
  });
  return {
    record,
    waited: performance.now() - callStarted,
    frames,
    diagnosis,
    placed,
    ...(second ? { second } : {}),
    heldToTimeout,
    phases,
    ...(firstHeldTo !== undefined ? { firstHeldTo } : {})
  };
}

/** A placed run, repeated (bounded) when the frame was not ready before the planned block. */
async function placedRun(options: Parameters<typeof run>[1]): Promise<Run> {
  let last: Run | undefined;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const page = await lab();
    last = await run(page, options);
    await new Promise((r) => setTimeout(r, 300));
    await page.close();
    if (last.placed) return last;
  }
  console.log("    (the frame was never ready before the planned block)");
  return last!;
}

async function main(): Promise<void> {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  try {
    for (let attempt = 0; attempt < 80 && !(await fetch(LAB).then((r) => r.ok, () => false)); attempt += 1) await new Promise((r) => setTimeout(r, 100));
    browser = await chromium.launch();
    const DEADLINE = 1400;

    console.log("D1. Reproduction (margin 0): a synchronous block across the deadline makes the record late");
    const repro = await placedRun({ deadlineMs: DEADLINE, marginMs: 0, blockAt: DEADLINE - 20, blockMs: 80 });
    check("precondition: the block started on time", repro.placed);
    check(`with no margin the hook returned after the hard deadline (${Math.round(repro.waited)} ms > ${DEADLINE} ms)`, repro.waited > DEADLINE, `${repro.waited}`);
    check("...and still published no observation computed past it (budget-exhausted)", repro.record?.observations[0] === "budget-exhausted", JSON.stringify(repro.record?.observations));

    console.log("D2. Remedy (default margin): the same block before the work budget");
    const budget = visualDiagnosisWorkBudget(DEADLINE);
    const fixed = await placedRun({ deadlineMs: DEADLINE, blockAt: budget - 20, blockMs: 80 });
    check("precondition: the block started on time", fixed.placed);
    check(`the hook returned by the hard deadline (${Math.round(fixed.waited)} ms <= ${DEADLINE} ms)`, fixed.waited <= DEADLINE, `${fixed.waited}`);
    check("the record is budget-exhausted (nothing computed past the budget is published)", fixed.record?.observations[0] === "budget-exhausted", JSON.stringify(fixed.record?.observations));
    check("the frame was released and nothing is left in flight", fixed.frames.taken === fixed.frames.released + fixed.frames.late && fixed.diagnosis.inFlight() === 0, JSON.stringify(fixed.frames));

    console.log("D3. Background main-thread contention across whole N8+N9 diagnoses");
    {
      const interval = setInterval(() => block(25), 40);
      const waits: number[] = [];
      const observed: number[] = [];
      try {
        for (let i = 0; i < 8; i += 1) {
          const page = await lab(i % 2 ? "list-cards" : "table-uniform");
          const r = await run(page, { deadlineMs: 1600, rows: true, state: true });
          waits.push(r.waited);
          if (r.record && r.record.observations[0] !== "budget-exhausted") observed.push(r.waited);
          await page.close();
        }
      } finally {
        clearInterval(interval);
      }
      const late = waits.filter((w) => w > 1600);
      check(`none of 8 contended diagnoses returned after the 1600 ms deadline (max ${Math.round(Math.max(...waits))} ms)`, late.length === 0, waits.map(Math.round).join(","));
      console.log(`    (${observed.length} of 8 completed with observations; the rest were budget-exhausted)`);
    }

    console.log("D4. Abort during frame work");
    {
      const page = await lab();
      const r = await run(page, { deadlineMs: 1000, rows: true, state: true, holdMs: 2500 });
      check("held frame: one budget-exhausted record by the deadline", r.record?.observations[0] === "budget-exhausted" && r.waited <= 1000, `${r.waited} ${JSON.stringify(r.record?.observations)}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      check("after the hold ends, the frame is released and nothing is in flight", r.frames.taken === r.frames.released + r.frames.late && r.diagnosis.inFlight() === 0, JSON.stringify(r.frames));
      await page.close();
    }

    console.log("D5. Late frame delivery (the N9 second screenshot held 3 s)");
    {
      const page = await lab();
      const r = await run(page, { deadlineMs: 1600, state: true, delayShot: { index: 2, ms: 3000 } });
      check("back by the deadline with one record", !!r.record && r.waited <= 1600, `${r.waited}`);
      await new Promise((resolve) => setTimeout(resolve, 3500));
      check("the late frame was released once it arrived, nothing in flight", r.frames.late <= 1 && r.frames.taken === r.frames.released + r.frames.late && r.diagnosis.inFlight() === 0, JSON.stringify(r.frames));
      await page.close();
    }

    console.log("D6. N8 and N9 together under the D2 block");
    {
      const budget1600 = visualDiagnosisWorkBudget(1600);
      const r = await placedRun({ deadlineMs: 1600, rows: true, state: true, blockAt: budget1600 - 20, blockMs: 80 });
      const codes = r.record?.observations ?? [];
      check("precondition: the block started on time", r.placed);
      check(`back by the 1600 ms deadline (${Math.round(r.waited)} ms)`, r.waited <= 1600, `${r.waited}`);
      check("one record, at most one state code and three row codes", codes.filter((c) => c.startsWith("visual-state-")).length <= 1 && codes.filter((c) => c.startsWith("rows-") || c.startsWith("row-association-")).length <= 3, JSON.stringify(codes));
      check("every frame released", r.frames.taken === r.frames.released + r.frames.late, JSON.stringify(r.frames));
    }

    console.log("D8. awkit-vra.18: a host 3x slower than every reserved rate, across whole N8+N9 diagnoses");
    {
      resetVisualDiagnosisHostFactors();
      const waits: number[] = [];
      const outcomes: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        const page = await lab(i % 2 ? "list-cards" : "table-uniform");
        // Eight start offsets sweep the synchronous phases across the whole budget.
        const r = await run(page, { deadlineMs: 1600, rows: true, state: true, slow: 3, preFrameMs: i * 100 });
        waits.push(r.waited);
        outcomes.push(r.record?.observations[0] ?? "none");
        await new Promise((resolve) => setTimeout(resolve, 300));
        await page.close();
      }
      check(`none of 8 slow-host diagnoses returned after the 1600 ms hard deadline (max ${Math.round(Math.max(...waits))} ms)`, waits.every((w) => w <= 1600), waits.map(Math.round).join(","));
      console.log(`    (first observations: ${outcomes.join(", ")})`);
      const learned = carriedVisualDiagnosisHostFactor();
      check(`the host factor was learned from the whole-frame chunk and is carried (${learned.toFixed(2)} >= 2)`, learned >= 2, learned.toFixed(2));
      for (let i = 0; i < VISUAL_DIAGNOSIS_HOST_FACTOR_WINDOW; i += 1) {
        const page = await lab();
        await run(page, { deadlineMs: 1600 });
        await page.close();
      }
      const decayed = carriedVisualDiagnosisHostFactor();
      check(`after ${VISUAL_DIAGNOSIS_HOST_FACTOR_WINDOW} ordinary diagnoses the carried factor decays (${decayed.toFixed(2)} < ${learned.toFixed(2)})`, decayed < learned, decayed.toFixed(2));
    }

    console.log("D9. awkit-vra.18: N9's second capture leaves the decode reserve");
    {
      resetVisualDiagnosisHostFactors();
      const page = await lab("table-uniform");
      const plain = await run(page, { deadlineMs: 1600, state: true });
      await page.close();
      const s = plain.second;
      const reserve = s ? visualDiagnosisSyncReserveMs("decode", s.firstPixels, carriedVisualDiagnosisHostFactor()) : Number.NaN;
      check("precondition: the second capture was attempted (observer called, frame 1's pixels seen)", !!s && s.firstPixels > 0, JSON.stringify(s));
      check(
        `its timeout leaves the decode reserve on the verifier's clock (${s?.timeoutMs} ms <= ${Math.round(s?.verifierLeftMs ?? 0)} - ${reserve} ms, 2 ms rounding)`,
        !!s && s.timeoutMs <= s.verifierLeftMs - reserve + 2,
        JSON.stringify(s)
      );
    }
    {
      // Long enough that the slow host still runs the state features (about 1.9 s reserved at DPR 2) and takes frame 2.
      const DEADLINE_D9 = 6000;
      let held: Run | undefined;
      for (let attempt = 0; attempt < ATTEMPTS && !held?.heldToTimeout; attempt += 1) {
        resetVisualDiagnosisHostFactors();
        const page = await lab("table-uniform", 2);
        held = await run(page, { deadlineMs: DEADLINE_D9, state: true, slow: 3, slowPhases: ["fingerprint", "decode"], holdSecondToTimeout: true });
        await new Promise((resolve) => setTimeout(resolve, 300));
        await page.close();
      }
      const s = held!.second;
      const reserve = s ? visualDiagnosisSyncReserveMs("decode", s.firstPixels, carriedVisualDiagnosisHostFactor()) : Number.NaN;
      check("precondition: the DPR-2 second screenshot was delivered 10 ms before its timeout ended", held!.heldToTimeout && held!.frames.taken === 2, JSON.stringify({ frames: held!.frames, second: s }));
      check(
        `the slow host's learned factor sized the decode reserve (${reserve} ms; timeout ${s?.timeoutMs} ms <= ${Math.round(s?.verifierLeftMs ?? 0)} ms left - reserve)`,
        !!s && reserve > VISUAL_DIAGNOSIS_SYNC_RESERVE_MS && s.timeoutMs <= s.verifierLeftMs - reserve + 2,
        JSON.stringify(s)
      );
      check(`the slow decode after the late delivery still ended by the ${DEADLINE_D9} ms hard deadline (${Math.round(held!.waited)} ms)`, held!.waited <= DEADLINE_D9, `${held!.waited}`);
      check("every frame released", held!.frames.taken === held!.frames.released + held!.frames.late, JSON.stringify(held!.frames));
    }

    console.log("D10. awkit-vra.18 (campaign 10 headed@2): a slow DPR-2 first capture still leaves N9 its state features");
    {
      // The first frame is held until 700 ms into the 1600 ms call (work budget 1500 ms), as c10's slow headed@2 first
      // capture did: 800 ms is left, enough for the fingerprint's reserve. The state features run on the analysis image
      // (every second pixel at DPR 2), so they must reserve those pixels, not all the device pixels, or N9 is skipped.
      const FIRST_AT = 700;
      let r: Run | undefined;
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        resetVisualDiagnosisHostFactors();
        const page = await lab("table-uniform", 2);
        r = await run(page, { deadlineMs: 1600, state: true, firstFrameAt: FIRST_AT });
        await new Promise((resolve) => setTimeout(resolve, 300));
        await page.close();
        // Precondition retried only: the frame must reach the hold before 700 ms, and the fingerprint must have run.
        if ((r.firstHeldTo ?? 0) >= FIRST_AT && (r.firstHeldTo ?? 0) < FIRST_AT + 50 && r.phases.includes("fingerprint")) break;
      }
      const stateCode = r!.record?.observations.find((c) => c.startsWith("visual-state-"));
      check(
        `precondition: the DPR-2 first frame was held to ${FIRST_AT} ms (${Math.round(r!.firstHeldTo ?? 0)} ms) and the fingerprint still ran`,
        (r!.firstHeldTo ?? 0) >= FIRST_AT && (r!.firstHeldTo ?? 0) < FIRST_AT + 50 && r!.phases.includes("fingerprint"),
        JSON.stringify({ firstHeldTo: r!.firstHeldTo, phases: r!.phases })
      );
      check(
        `N9 measured the state features and decided (${stateCode ?? "no state code"}), never visual-state-skipped`,
        r!.phases.includes("stateFeatures") && !!stateCode && stateCode !== "visual-state-skipped",
        JSON.stringify({ observations: r!.record?.observations, phases: r!.phases })
      );
      check(`back by the 1600 ms hard deadline (${Math.round(r!.waited)} ms), every frame released`, r!.waited <= 1600 && r!.frames.taken === r!.frames.released + r!.frames.late, JSON.stringify({ waited: r!.waited, frames: r!.frames }));
    }

    console.log("D7. Pins");
    const adapter = await readFile("src/runner/visualDiagnosis/VisualFailureDiagnosis.ts", "utf8");
    check("the publish gate reads the monotonic clock against the work budget", /settle\(performance\.now\(\) - started > deadlineMs \? this\.refusal\(request, "budget-exhausted", started\) : record\)/.test(adapter));
    check("the work budget, not the hard deadline, drives the timer and the work", /const deadlineMs = visualDiagnosisWorkBudget\(hardDeadlineMs, this\.options\.settleMarginMs\)/.test(adapter));
    check("N5's own frame work starts behind the checkpoint (frame start and every member)", (adapter.match(/await this\.checkpoint\(signal, started, deadlineMs/g) ?? []).length === 2);
    check("the whole-frame chunk's checkpoint reserves the fingerprint rate times the host factor", /await this\.checkpoint\(signal, started, deadlineMs, reserveMs\("fingerprint", framePixels\)\)/.test(adapter));
    check(
      "awkit-vra.18 (c10): the state-features gate reserves the analysed pixels, never every device pixel",
      /const statePixels = visualStateAnalysisPixels\(frame\.viewport\.imageWidth, frame\.viewport\.imageHeight, frame\.viewport\.scaleX\)/.test(adapter) &&
        /reserveMs\("stateFeatures", statePixels\)/.test(adapter) &&
        /syncCost\?\.\("stateFeatures", statePixels\)/.test(adapter) &&
        !/reserveMs\("stateFeatures", framePixels\)/.test(adapter) &&
        !/syncCost\?\.\("stateFeatures", framePixels\)/.test(adapter)
    );
    check(
      "awkit-vra.18 (c10): the analysed pixels are the device pixels below DPR 1.75 and every second pixel from 1.75 (800x600 CSS)",
      visualStateAnalysisPixels(800, 600, 1) === 480_000 &&
        visualStateAnalysisPixels(1000, 750, 1.25) === 750_000 &&
        visualStateAnalysisPixels(1400, 1050, 1.75) === 700 * 525 &&
        visualStateAnalysisPixels(1600, 1200, 2) === 480_000 &&
        visualStateAnalysisPixels(1601, 1201, 2) === 480_000 &&
        visualStateAnalysisPixels(0, 600, 2) === 0 &&
        visualStateAnalysisPixels(800, 600, Number.NaN) === 480_000
    );
    check(
      "awkit-vra.18 (c10): at DPR 2 the state-features reserve falls from 836 ms (device pixels) to 209 ms (analysed), the 435 ns/px rate unchanged",
      visualDiagnosisSyncReserveMs("stateFeatures", 1600 * 1200) === 836 && visualDiagnosisSyncReserveMs("stateFeatures", visualStateAnalysisPixels(1600, 1200, 2)) === 209
    );
    check(
      "awkit-vra.18: every reserve goes through the per-phase rate and the diagnosis's host factor",
      /const reserveMs = \(phase: VisualDiagnosisSyncPhase, pixels: number\): number => visualDiagnosisSyncReserveMs\(phase, pixels, hostFactor\)/.test(adapter) &&
        (adapter.match(/visualDiagnosisSyncReserveMs\(/g) ?? []).length === 1
    );
    check(
      "awkit-vra.18: the second capture's timeout leaves the decode reserve of frame 1's pixels",
      /const decodeReserveMs = reserveMs\("decode", firstPixels\)/.test(adapter) && /const timeoutMs = Math\.max\(1, this\.remaining\(started, deadlineMs\) - decodeReserveMs\)/.test(adapter)
    );
    check("an over-budget checkpoint is reported as budget-exhausted, not capture-failed", /error instanceof DiagnosisOverBudget \? "budget-exhausted" : "capture-failed"/.test(adapter));
    check(
      "QC F1: every member's crop and evidence reserve their measured per-pixel cost",
      /const memberPixels = memberCropPixels\(frame\.viewport, slot\.box\);\s+await this\.checkpoint\(signal, started, deadlineMs, reserveMs\("memberCrop", memberPixels\)\)/.test(adapter)
    );
    check("the record's advisory codes go through appendAdvisoryCodes", /appendAdvisoryCodes\(record\.observations, \[\.\.\.textCodes, \.\.\.rowCodes\], stateCode\)/.test(adapter));
    // QC F6 (finding 5), behavioural: four N5 observations, a text code, three row codes in keep order, and a state code.
    const n5 = ["target-not-found", "reference-none", "viewport-changed", "target-multiple-matches"];
    const extras = ["target-text-differs-from-name", "row-association-consistent", "rows-partly-examined", "rows-look-alike"];
    const withState = [...n5];
    appendAdvisoryCodes(withState, extras, "visual-state-ready");
    check(
      "QC F6 (finding 5): with N9 on, its code keeps the last slot and the row structure code is trimmed first",
      JSON.stringify(withState) === JSON.stringify([...n5, ...extras.slice(0, 3), "visual-state-ready"]),
      JSON.stringify(withState)
    );
    const withoutState = [...n5];
    appendAdvisoryCodes(withoutState, extras, undefined);
    check("QC F6 (finding 5): with N9 off, the N7.7 and N8 codes fill all eight slots", JSON.stringify(withoutState) === JSON.stringify([...n5, ...extras]), JSON.stringify(withoutState));
    const full = Array.from({ length: VISUAL_DIAGNOSIS_RECORD_MAX_OBSERVATIONS }, (_, at) => `n5-${at}`);
    appendAdvisoryCodes(full, extras, "visual-state-ready");
    const repeated = [...n5, "rows-look-alike"];
    appendAdvisoryCodes(repeated, ["rows-look-alike"], "visual-state-loading");
    check(
      "QC F6 (finding 5): never past the cap, never a repeated code",
      full.length === VISUAL_DIAGNOSIS_RECORD_MAX_OBSERVATIONS && !full.includes("visual-state-ready") && JSON.stringify(repeated) === JSON.stringify([...n5, "rows-look-alike", "visual-state-loading"]),
      JSON.stringify({ full, repeated })
    );
    // QC (2026-11-01): a state code already in the record keeps no second slot, so the eighth slot is not wasted.
    const present = ["target-not-found", "reference-none", "viewport-changed", "target-multiple-matches", "visual-state-ready", "target-text-differs-from-name", "rows-partly-examined"];
    appendAdvisoryCodes(present, ["rows-look-alike"], "visual-state-ready");
    check(
      "QC: no slot is reserved for a state code the record already has",
      JSON.stringify(present) === JSON.stringify(["target-not-found", "reference-none", "viewport-changed", "target-multiple-matches", "visual-state-ready", "target-text-differs-from-name", "rows-partly-examined", "rows-look-alike"]),
      JSON.stringify(present)
    );
    // QC (2026-11-01), behavioural: memberCropPixels is the element crop plus the 24-CSS-px padded context crop, each
    // clipped to the viewport, in device pixels.
    const dpr2 = memberCropPixels({ cssWidth: 1280, cssHeight: 720, scaleX: 2, scaleY: 2 }, { x: 100, y: 100, width: 800, height: 400 });
    check(
      "QC: a large DPR-2 member counts (800x400 + 848x448) x 4 device pixels and reserves more than the fixed floor",
      dpr2 === (800 * 400 + 848 * 448) * 4 && visualDiagnosisSyncReserveMs("memberCrop", dpr2) > VISUAL_DIAGNOSIS_SYNC_RESERVE_MS,
      `${dpr2} px, ${visualDiagnosisSyncReserveMs("memberCrop", dpr2)} ms`
    );
    const clipped = memberCropPixels({ cssWidth: 1280, cssHeight: 720, scaleX: 1.5, scaleY: 1.5 }, { x: -50, y: 680, width: 200, height: 100 });
    check("QC: a member clipped by the viewport's left and bottom edges counts only its visible part", clipped === (150 * 40 + 174 * 64) * 2.25, String(clipped));
    check("QC: a member wholly outside the viewport counts no pixels", memberCropPixels({ cssWidth: 1280, cssHeight: 720, scaleX: 1, scaleY: 1 }, { x: 1400, y: 10, width: 50, height: 20 }) === 0);
    // awkit-vra.18: the per-phase reserve and the host factor, behaviourally.
    check(
      "awkit-vra.18: a reserve is pixels x the phase's rate x the host factor, never below the floor; an unreadable or sub-1 factor is 1",
      visualDiagnosisSyncReserveMs("stateFeatures", 1_000_000) === VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL.stateFeatures &&
        visualDiagnosisSyncReserveMs("stateFeatures", 1_000_000, 2.5) === Math.ceil(VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL.stateFeatures * 2.5) &&
        visualDiagnosisSyncReserveMs("decode", 1000, 3) === VISUAL_DIAGNOSIS_SYNC_RESERVE_MS &&
        visualDiagnosisSyncReserveMs("decode", 1_000_000, 0.5) === visualDiagnosisSyncReserveMs("decode", 1_000_000) &&
        visualDiagnosisSyncReserveMs("decode", 1_000_000, Number.NaN) === visualDiagnosisSyncReserveMs("decode", 1_000_000)
    );
    check(
      "awkit-vra.18: each rate is at least 1.25 x the benchmark's maximum (fingerprint 290, state features 345, motion 142, member crop 414, decode 92 ns/px)",
      VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL.fingerprint >= 290 * 1.25 &&
        VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL.stateFeatures >= 345 * 1.25 &&
        VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL.motionPlane >= 142 * 1.25 &&
        VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL.memberCrop >= 414 * 1.25 &&
        VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL.decode >= 92 * 1.25
    );
    check(
      "awkit-vra.18: the host factor is observed / rate, never below 1, and 1 for an unreadable observation",
      visualDiagnosisHostFactor("fingerprint", VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL.fingerprint * 3) === 3 &&
        visualDiagnosisHostFactor("fingerprint", 10) === 1 &&
        visualDiagnosisHostFactor("fingerprint", Number.NaN) === 1 &&
        visualDiagnosisHostFactor("fingerprint", Number.POSITIVE_INFINITY) === 1
    );
    check(
      "the work budget is the deadline minus min(margin, a quarter)",
      visualDiagnosisWorkBudget(1000) === 1000 - VISUAL_DIAGNOSIS_SETTLE_MARGIN_MS && visualDiagnosisWorkBudget(300) === 225 && visualDiagnosisWorkBudget(1000, 0) === 1000
    );
  } finally {
    await browser?.close();
    server.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
