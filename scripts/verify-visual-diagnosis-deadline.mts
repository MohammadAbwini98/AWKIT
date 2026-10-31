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
 *   D7  pins: the publish gate reads the monotonic clock, the checkpoint guards N5's own frame work, the N9 code keeps a
 *       slot under the observation cap, and the work budget formula.
 *
 * Run: npm run verify:visual-diagnosis-deadline
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { VisualFailureDiagnosis, type VisualDiagnosisProbe } from "@src/runner/visualDiagnosis/VisualFailureDiagnosis";
import {
  VISUAL_DIAGNOSIS_SETTLE_MARGIN_MS,
  visualDiagnosisWorkBudget,
  type VisualDiagnosisRecord
} from "@src/runner/visualDiagnosis/visualDiagnosisContract";
import type { FlowStep } from "@src/profiles/FlowProfile";

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

async function lab(fixture = "table-uniform"): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
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
  }
): Promise<Run> {
  const frames = { taken: 0, released: 0, late: 0 };
  let placed = options.blockAt === undefined;
  let callStarted = 0;
  const probe: VisualDiagnosisProbe = {
    hold: async (stage) => {
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
    onFrame: (event) => {
      if (event === "taken") frames.taken += 1;
      else if (event === "released") frames.released += 1;
      else frames.late += 1;
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
      return fn();
    }
  });
  return { record, waited: performance.now() - callStarted, frames, diagnosis, placed };
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

    console.log("D7. Pins");
    const adapter = await readFile("src/runner/visualDiagnosis/VisualFailureDiagnosis.ts", "utf8");
    check("the publish gate reads the monotonic clock against the work budget", /settle\(performance\.now\(\) - started > deadlineMs \? this\.refusal\(request, "budget-exhausted", started\) : record\)/.test(adapter));
    check("the work budget, not the hard deadline, drives the timer and the work", /const deadlineMs = visualDiagnosisWorkBudget\(hardDeadlineMs, this\.options\.settleMarginMs\)/.test(adapter));
    check("N5's own frame work starts behind the checkpoint (frame start and every member)", (adapter.match(/await this\.checkpoint\(signal, started, deadlineMs/g) ?? []).length === 2);
    check("the whole-frame chunk's checkpoint reserves its measured per-pixel cost", /await this\.checkpoint\(signal, started, deadlineMs, visualDiagnosisSyncReserveMs\(framePixels\)\)/.test(adapter));
    check("an over-budget checkpoint is reported as budget-exhausted, not capture-failed", /error instanceof DiagnosisOverBudget \? "budget-exhausted" : "capture-failed"/.test(adapter));
    check("the N9 code keeps a slot under the observation cap", /VISUAL_DIAGNOSIS_RECORD_MAX_OBSERVATIONS - \(stateCode \? 1 : 0\)/.test(adapter));
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
