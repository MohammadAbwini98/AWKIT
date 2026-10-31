/**
 * verify:visual-state-runtime — Phase N, N9 (awkit-vra.11): screenshot state recognition inside the REAL N5 adapter,
 * through the REAL `FlowExecutor` retry loop over a REAL `StepExecutor`, in real Chromium, against the Visual State Lab
 * (`/visual-intelligence/state`). Plan: docs/plans/ai-upgrade-v5/N9-screenshot-state-recognition.md § 2 and § 5.
 *
 *   A  flag off (S-7): no state code, at most one frame, and the N5 record identical to an adapter that never heard of
 *      N9 (all fields but the duration);
 *   B  flag on: loading, ready, empty and error fixtures give their one code; exactly two frames, both released;
 *   C  refusals with ZERO frames and no state code (S-6): the protected fixture, a handed-off page, a sensitive step;
 *   D  a password form injected AFTER the first frame: the second frame is refused and the state withdrawn (skipped);
 *   E  A/B neutrality: off and on give the same step status, error, attempt count and page interaction count;
 *   F  the deadline: a tight deadline settles once with every frame released and nothing left in flight;
 *   G  wiring: the runner adds the extra budget and the flag only with state on.
 *
 * Run: npm run verify:visual-state-runtime
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { ManualHandoffController } from "@src/runner/ManualHandoffController";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { StepExecutionResult } from "@src/runner/RunnerResult";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { VisualFailureDiagnosis, type VisualDiagnosisProbe } from "@src/runner/visualDiagnosis/VisualFailureDiagnosis";
import { VISUAL_DIAGNOSIS_DEADLINE_MS, VISUAL_STATE_EXTRA_MS, type VisualDiagnosisRecord, type VisualFailureDiagnoser } from "@src/runner/visualDiagnosis/visualDiagnosisContract";

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

const PORT = 4612;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence/state`;
const ROOT = await mkdtemp(join(tmpdir(), "awkit-visual-state-"));
const MAX_CUT_RUNS = 3;
let browser: Browser | undefined;
let seq = 0;

async function lab(fixture: string, variant = "b"): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(LAB);
  await page.waitForSelector("body[data-fixtures]");
  await page.evaluate(([id, v]) => (window as unknown as { __stateLab: { show(i: string, x: string): Promise<unknown> } }).__stateLab.show(id, v), [fixture, variant]);
  await page.waitForSelector(`#st-stage[data-shown="${fixture}:${variant}"]`);
  return page;
}

interface Harness {
  records: VisualDiagnosisRecord[];
  frames: { taken: number; released: number; late: number };
  diagnosis: VisualFailureDiagnosis;
  run: (step: FlowStep) => Promise<StepExecutionResult>;
}

function harness(page: Page, options: { state?: boolean; handedOff?: boolean; deadlineMs?: number; probe?: VisualDiagnosisProbe; enabled?: boolean } = {}): Harness {
  const context: InstanceExecutionContext = {
    executionId: `n9-${(seq += 1)}`,
    instanceId: "inst-1",
    scenarioId: "n9",
    flowId: "n9-flow",
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: ROOT, screenshots: join(ROOT, "evidence"), logs: ROOT, reports: ROOT }
  };
  const records: VisualDiagnosisRecord[] = [];
  const frames = { taken: 0, released: 0, late: 0 };
  const diagnosis = new VisualFailureDiagnosis({
    folder: join(ROOT, "visual-references"),
    handedOff: () => options.handedOff === true,
    reader: { get: async () => ({ status: "missing" }) as never },
    onRecord: (record) => records.push(record),
    ...(options.state ? { stateRecognition: true, deadlineMs: options.deadlineMs ?? VISUAL_DIAGNOSIS_DEADLINE_MS + VISUAL_STATE_EXTRA_MS } : options.deadlineMs ? { deadlineMs: options.deadlineMs } : {}),
    probe: {
      ...options.probe,
      onFrame: (event) => {
        if (event === "taken") frames.taken += 1;
        else if (event === "released") frames.released += 1;
        else frames.late += 1;
        options.probe?.onFrame?.(event);
      }
    }
  });
  const hook: VisualFailureDiagnoser = { diagnoseFinalFailure: (request) => diagnosis.diagnoseFinalFailure(request) };
  const stepExecutor = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(context), context, new ManualHandoffController());
  const flowExecutor = new FlowExecutor(stepExecutor, undefined, undefined, undefined, true, options.enabled === false ? undefined : hook);
  return {
    records,
    frames,
    diagnosis,
    run: (step) => (flowExecutor as unknown as { executeWithRetry(s: FlowStep, c: InstanceExecutionContext): Promise<StepExecutionResult> }).executeWithRetry(step, context)
  };
}

const missing = (id: string, extra: Record<string, unknown> = {}): FlowStep =>
  ({ id, name: `State ${id}`, type: "click", timeoutMs: 600, locator: { strategy: "testId", value: "st-missing-target" }, ...extra }) as unknown as FlowStep;
const stateCode = (record: VisualDiagnosisRecord | undefined): string | undefined => record?.observations.find((code) => code.startsWith("visual-state-"));
const strip = (record: VisualDiagnosisRecord | undefined) => (record ? { ...record, ms: 0, observations: record.observations.filter((code) => !code.startsWith("visual-state-")) } : undefined);

/** One failing step on a fresh fixture page; a run the deadline cut is repeated (bounded) and counted. */
async function diagnose(fixture: string, options: Parameters<typeof harness>[1] = {}, step = missing(`s-${fixture}`), before?: (page: Page) => Promise<void>) {
  let last: { h: Harness; result: StepExecutionResult; page: Page } | undefined;
  for (let run = 0; run < MAX_CUT_RUNS; run += 1) {
    const page = await lab(fixture);
    await before?.(page);
    const h = harness(page, options);
    const result = await h.run(step);
    last = { h, result, page };
    if (h.records[0]?.observations[0] !== "budget-exhausted") return last;
    console.log(`    (${fixture}: run ${run + 1} cut by the deadline, repeated)`);
    await page.close();
  }
  return last!;
}

async function main(): Promise<void> {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  try {
    for (let attempt = 0; attempt < 80 && !(await fetch(LAB).then((r) => r.ok, () => false)); attempt += 1) await new Promise((r) => setTimeout(r, 100));
    browser = await chromium.launch();

    console.log("A. Flag off (S-7)");
    {
      const off = await diagnose("spinner");
      const on = await diagnose("spinner", { state: true });
      check("off: a record with no state code", !!off.h.records[0] && stateCode(off.h.records[0]) === undefined, JSON.stringify(off.h.records[0]));
      check("off: at most one frame, every frame released", off.h.frames.taken <= 1 && off.h.frames.taken === off.h.frames.released);
      check("off and on: the N5 part of the record is identical (only the state code and duration differ)", JSON.stringify(strip(off.h.records[0])) === JSON.stringify(strip(on.h.records[0])), `${JSON.stringify(strip(off.h.records[0]))} vs ${JSON.stringify(strip(on.h.records[0]))}`);
      await off.page.close();
      await on.page.close();
    }

    console.log("B. Flag on: one code from two frames");
    for (const [fixture, expected] of [["spinner", "visual-state-loading"], ["ready-table", "visual-state-ready"], ["empty-text", "visual-state-empty"], ["error-banner", "visual-state-error"], ["blank", "visual-state-unknown"]] as const) {
      const d = await diagnose(fixture, { state: true });
      const record = d.h.records[0];
      check(`${fixture}: ${expected}`, stateCode(record) === expected, JSON.stringify(record?.observations));
      check(`${fixture}: exactly one state code, two frames taken and both released`, record?.observations.filter((c) => c.startsWith("visual-state-")).length === 1 && d.h.frames.taken === 2 && d.h.frames.released === 2, JSON.stringify(d.h.frames));
      await d.page.close();
    }

    console.log("C. Refusals with zero frames (S-6)");
    {
      const prot = await diagnose("protected", { state: true });
      check("protected fixture: protected-surface, zero frames, no state code", prot.h.records[0]?.observations.includes("protected-surface") && prot.h.frames.taken === 0 && stateCode(prot.h.records[0]) === undefined, JSON.stringify(prot.h.records[0]));
      await prot.page.close();
      const handed = await diagnose("ready-table", { state: true, handedOff: true });
      check("handed-off page: zero frames, no state code", handed.h.frames.taken === 0 && stateCode(handed.h.records[0]) === undefined, JSON.stringify(handed.h.records[0]));
      await handed.page.close();
      const sensitive = await diagnose("ready-table", { state: true }, missing("s-sensitive", { type: "fill", value: "x", locator: { strategy: "css", value: "input[type=password]" } }), async (page) => {
        await page.evaluate(() => {
          const input = document.createElement("input");
          input.type = "password";
          input.setAttribute("autocomplete", "new-password");
          input.style.cssText = "position:absolute;left:600px;top:500px;width:120px";
          document.getElementById("st-stage")!.append(input);
        });
      });
      check("a step on a password field: zero frames, no state code", sensitive.h.frames.taken === 0 && stateCode(sensitive.h.records[0]) === undefined, JSON.stringify(sensitive.h.records[0]));
      await sensitive.page.close();
    }

    console.log("D. A protected surface appears between the two frames");
    {
      let pageRef: Page | undefined;
      const d = await diagnose(
        "ready-table",
        {
          state: true,
          probe: {
            hold: async (stage) => {
              if (stage !== "after-frame" || !pageRef) return;
              await pageRef.evaluate(() => {
                const form = document.createElement("form");
                form.id = "st-late-protected";
                const pass = document.createElement("input");
                pass.type = "password";
                form.append(pass);
                document.getElementById("st-stage")!.append(form);
              });
            }
          }
        },
        missing("s-late"),
        async (page) => {
          pageRef = page;
        }
      );
      check("the second frame is refused and the state withdrawn (visual-state-skipped)", stateCode(d.h.records[0]) === "visual-state-skipped", JSON.stringify(d.h.records[0]?.observations));
      check("only the first (clean) frame was taken, and it was released", d.h.frames.taken === 1 && d.h.frames.released === 1, JSON.stringify(d.h.frames));
      await d.page.close();
    }

    console.log("E. A/B neutrality");
    for (const fixture of ["spinner", "ready-table"]) {
      const results: Array<{ status: string; error: string | undefined; attempts: number; interactions: number }> = [];
      for (const options of [{ enabled: false }, {}, { state: true }]) {
        const d = await diagnose(fixture, options);
        results.push({
          status: d.result.status,
          error: (d.result as { error?: { message?: string } }).error?.message?.replace(/\d+ms/g, "Nms"),
          attempts: (d.result as { attempts?: number }).attempts ?? -1,
          interactions: await d.page.evaluate(() => (window as unknown as { __stateLab: { interactions: number } }).__stateLab.interactions)
        });
        await d.page.close();
      }
      check(
        `${fixture}: no hook, N5 only and N5 + N9 give the same status, error, attempts and page interactions (0)`,
        JSON.stringify(results[0]) === JSON.stringify(results[1]) && JSON.stringify(results[1]) === JSON.stringify(results[2]) && results[2].interactions === 0 && results[2].status === "failed",
        JSON.stringify(results)
      );
    }

    console.log("F. Deadline");
    {
      const page = await lab("skeleton-shimmer");
      const h = harness(page, { state: true, deadlineMs: 250 });
      const started = Date.now();
      await h.run(missing("s-tight"));
      const waitedOk = h.records.length === 1;
      await new Promise((r) => setTimeout(r, 1500));
      check("a 250 ms deadline settles exactly one record", waitedOk && h.records.length === 1, JSON.stringify(h.records));
      check("every frame taken is released (in time or late), and nothing is left in flight", h.frames.taken === h.frames.released && h.diagnosis.inFlight() === 0, JSON.stringify(h.frames));
      check("the record is either the deadline cut or carries at most one state code", h.records[0]?.observations[0] === "budget-exhausted" || (h.records[0]?.observations.filter((c) => c.startsWith("visual-state-")).length ?? 0) <= 1);
      void started;
      await page.close();
    }

    console.log("G. Wiring");
    const runner = await readFile("src/runner/PlaywrightRunner.ts", "utf8");
    check(
      "the runner adds stateRecognition and the extra budget only when visualStateRecognition is true",
      /this\.options\.visualStateRecognition === true\s*\?\s*\{ stateRecognition: true, deadlineMs: VISUAL_DIAGNOSIS_DEADLINE_MS \+ VISUAL_STATE_EXTRA_MS \}\s*:\s*\{\}/.test(runner)
    );
    const adapter = await readFile("src/runner/visualDiagnosis/VisualFailureDiagnosis.ts", "utf8");
    // Three gates since the 2026-11-01 deadline fix: the frame-1 yield, the frame-1 measurement and the state step.
    check("the adapter measures state only under stateRecognition === true", (adapter.match(/stateRecognition === true/g) ?? []).length === 3);
    check("the adapter never calls the OCR text signal from the state step (NS-4)", !/textSignal/.test(adapter.slice(adapter.indexOf("private async state("), adapter.indexOf("private get statePolicy"))));
  } finally {
    await browser?.close();
    server.kill();
    await rm(ROOT, { recursive: true, force: true }).catch(() => undefined);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
