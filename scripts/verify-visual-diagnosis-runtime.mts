/**
 * verify:visual-diagnosis-runtime — Phase N, N5.3 (awkit-vra.14.3): the runner's Visual Failure Diagnosis adapter in real
 * Chromium, through the REAL `FlowExecutor` retry loop over a REAL `StepExecutor`, against the mock-site Visual Fusion
 * Calibration Lab (`/visual-intelligence/fusion`, `setFailure`) and the secure-login fixture.
 *
 * Cases:
 *   A  identity: a byte-identical target under `unproven`; no reference; a recorded reference only under the N4 flag;
 *      a provable condition that differs;
 *   B  DOM facts and the frame policy: detached (targetless frame), overlay (occluded), zero-size, blank (targetless
 *      `viewport-uniform`), offscreen;
 *   C  examined scope: several matches with an identical other; over the cap (`truncated`, the identical element past
 *      the cap never counted, one inside it counted); an omitted contender never counted;
 *   D  refusals with ZERO frames: protected injection, a handed-off page, the secure-login fixture (the B2 P1 and P3
 *      paths), a sensitive field, a non-eligible step; R1b, a password field shown and hidden again inside N0's real
 *      screenshot call (both guard checks see a clean page), leaves zero frames (N0's strict capture window);
 *   E  when it runs: never on a passing step, once after the final of two attempts, and the per-signature cap;
 *   F  A/B neutrality: off and on give the same step result, error, attempts, B2 evidence kinds, page DOM, scroll and
 *      interaction count; the reference store's bytes never change;
 *   G  the deadline: held before the frame (no frame, one settlement), held after the frame (frame released after the
 *      deadline), the page closed mid-diagnosis, late work never re-settles, nothing left in flight, no page listener
 *      left behind;
 *   H  enablement and wiring pins.
 *
 * The production deadline (VISUAL_DIAGNOSIS_DEADLINE_MS) is not relaxed for functional cases: a case the deadline cut is
 * repeated a bounded number of times (the count is printed); a case whose every run is cut FAILS.
 *
 * Mutation contract (run 2026-10-19 by temporary source edits, each observed red and reverted; results in the N5 plan):
 * R1 the hook diagnoses every failed attempt (before the retry decision); R2 the adapter ignores `handedOff`; R3 the
 * slot does not close, so late work re-settles; R4 the frame is not released; R5 the adapter refreshes the reference;
 * R6 the examined set ignores the cap.
 * N5.7 review fixes (QC and security findings), also by temporary source edits: R7 occlusion asked of the document at
 * the box centre again; R8 the handles are never disposed; R9 the early protected-surface check removed; R10 a null box
 * reported offscreen again; R11 a frame handed back after the deadline is never released.
 *
 * Run: npm run verify:visual-diagnosis-runtime
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { ManualHandoffController } from "@src/runner/ManualHandoffController";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { StepExecutionResult } from "@src/runner/RunnerResult";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { stepCandidatesDigest } from "@src/runner/LocatorRecoveryStore";
import { recordedVisualReferenceKey } from "@src/runner/visualFusion/recordedVisualReferenceKey";
import { VisualFailureDiagnosis, type VisualDiagnosisProbe } from "@src/runner/visualDiagnosis/VisualFailureDiagnosis";
import {
  VISUAL_DIAGNOSIS_DEADLINE_MS,
  VISUAL_DIAGNOSIS_SIGNATURE_CAP,
  visualDiagnosisMode,
  type VisualDiagnosisRecord,
  type VisualFailureDiagnoser
} from "@src/runner/visualDiagnosis/visualDiagnosisContract";
import { buildVisualEvidence, captureElement, checkProtectedSurface, type VisualEvidence } from "@src/visual";

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

const PORT = 4597;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence/fusion`;
const SCENARIO_ID = "n5-3";
const FLOW_ID = "diagnosis-flow";
const ROOT = await mkdtemp(join(tmpdir(), "awkit-visual-diagnosis-"));
const STORE = join(ROOT, "visual-references");
const MAX_CUT_RUNS = 3;
let cutRuns = 0;
let executionSeq = 0;
let browser: Browser | undefined;

const fileFor = (scopeKey: string): string => join(STORE, `${createHash("sha256").update(scopeKey).digest("hex")}.json`);
const runtimeKey = (stepId: string): string => `${SCENARIO_ID}\u0000${FLOW_ID}\u0000${stepId}`;

async function clearStore(): Promise<void> {
  await rm(STORE, { recursive: true, force: true });
  await mkdir(STORE, { recursive: true });
}

/** Every file the verifier itself wrote, with its bytes' digest: the store must end holding exactly these. */
const seeded = new Map<string, string>();
const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/** Write a reference record exactly as the N2 store does (verifier-owned folder). */
async function seed(scopeKey: string, evidence: VisualEvidence): Promise<void> {
  const record = { version: 1, scopeKey, evidenceVersion: 1, contentDigest: evidence.fingerprint.contentDigest, evidence, updatedAt: "2026-10-19T00:00:00.000Z" };
  const text = JSON.stringify(record);
  await writeFile(fileFor(scopeKey), text, "utf8");
  seeded.set(fileFor(scopeKey).split(/[\\/]/).pop()!, sha(text));
}

async function evidenceOf(page: Page, target: Locator): Promise<VisualEvidence> {
  const captured = await captureElement(page, target, { timeoutMs: 5000 });
  if (!captured.ok) throw new Error(`reference capture failed: ${captured.code}`);
  const built = buildVisualEvidence(captured.value);
  if (!built.ok) throw new Error(`reference evidence failed: ${built.code}`);
  return built.value;
}

async function storeDigest(): Promise<string> {
  const names = (await readdir(STORE).catch(() => [] as string[])).sort();
  const hash = createHash("sha256");
  for (const name of names) hash.update(name).update(await readFile(join(STORE, name)));
  return `${names.length}:${hash.digest("hex")}`;
}

async function freshLab(failure = "none", setup?: (page: Page) => Promise<void>): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(LAB);
  await page.getByTestId("vf-tool-0").waitFor();
  await setup?.(page);
  if (failure !== "none") await page.evaluate((kind) => (window as unknown as { __fusionLab: { setFailure(k: string): void } }).__fusionLab.setFailure(kind), failure);
  return page;
}

interface Harness {
  records: VisualDiagnosisRecord[];
  /** Each hook call and how long the hook waited for it. */
  calls: { attempt: number; ms: number }[];
  frames: { taken: number; released: number };
  /** N5.7: element handles resolved and disposed, and how often the page was inspected. */
  handles: { resolved: number; disposed: number };
  inspected: { count: number };
  diagnosis: VisualFailureDiagnosis;
  run: (step: FlowStep) => Promise<StepExecutionResult>;
}

interface HarnessOptions {
  enabled?: boolean;
  recordedFallback?: boolean;
  handedOff?: boolean;
  deadlineMs?: number;
  probe?: VisualDiagnosisProbe;
  executionId?: string;
  controller?: ManualHandoffController;
}

function harness(page: Page, options: HarnessOptions = {}): Harness {
  const executionId = options.executionId ?? `exec-${(executionSeq += 1)}`;
  const context: InstanceExecutionContext = {
    executionId,
    instanceId: "inst-1",
    scenarioId: SCENARIO_ID,
    flowId: FLOW_ID,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: ROOT, screenshots: join(ROOT, "evidence"), logs: ROOT, reports: ROOT }
  };
  const records: VisualDiagnosisRecord[] = [];
  const calls: { attempt: number; ms: number }[] = [];
  const frames = { taken: 0, released: 0 };
  const handles = { resolved: 0, disposed: 0 };
  const inspected = { count: 0 };
  const diagnosis = new VisualFailureDiagnosis({
    folder: STORE,
    handedOff: () => options.handedOff === true,
    ...(options.recordedFallback ? { recordedFallback: true } : {}),
    ...(options.deadlineMs ? { deadlineMs: options.deadlineMs } : {}),
    onRecord: (record) => records.push(record),
    probe: {
      ...options.probe,
      onFrame: (event) => {
        if (event === "taken") frames.taken += 1;
        else if (event === "released") frames.released += 1;
        options.probe?.onFrame?.(event);
      },
      onHandles: (event, count) => {
        handles[event] += count;
      },
      onInspect: () => {
        inspected.count += 1;
      }
    }
  });
  const spy: VisualFailureDiagnoser = {
    diagnoseFinalFailure: async (request) => {
      const call = { attempt: request.attempt, ms: -1 };
      calls.push(call);
      const started = Date.now();
      try {
        return await diagnosis.diagnoseFinalFailure(request);
      } finally {
        call.ms = Date.now() - started;
      }
    }
  };
  const stepExecutor = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(context), context, options.controller ?? new ManualHandoffController());
  const flowExecutor = new FlowExecutor(stepExecutor, undefined, undefined, undefined, true, options.enabled === false ? undefined : spy);
  return {
    records,
    calls,
    frames,
    handles,
    inspected,
    diagnosis,
    run: (step) => (flowExecutor as unknown as { executeWithRetry(s: FlowStep, c: InstanceExecutionContext): Promise<StepExecutionResult> }).executeWithRetry(step, context)
  };
}

const fillStep = (id: string, locator: Record<string, unknown>): FlowStep =>
  ({ id, name: `Diagnose ${id}`, type: "fill", value: "x", timeoutMs: 800, locator }) as unknown as FlowStep;
const clickStep = (id: string, locator: Record<string, unknown>, extra: Record<string, unknown> = {}): FlowStep =>
  ({ id, name: `Diagnose ${id}`, type: "click", timeoutMs: 800, locator, ...extra }) as unknown as FlowStep;
const tool = (i: number) => ({ strategy: "testId", value: `vf-tool-${i}` });

/** Run one failing step on a fresh page and return its single record; a deadline-cut run is repeated (bounded). */
async function diagnose(
  name: string,
  build: () => Promise<{ page: Page; step: FlowStep; options?: HarnessOptions }>
): Promise<{ record: VisualDiagnosisRecord | undefined; h: Harness; result: StepExecutionResult; page: Page }> {
  let last: { record: VisualDiagnosisRecord | undefined; h: Harness; result: StepExecutionResult; page: Page } | undefined;
  for (let run = 0; run < MAX_CUT_RUNS; run += 1) {
    const { page, step, options } = await build();
    const h = harness(page, options);
    const result = await h.run(step);
    last = { record: h.records[0], h, result, page };
    if (last.record?.observations[0] !== "budget-exhausted") return last;
    cutRuns += 1;
    await page.close();
  }
  console.log(`    (${name}: every run was cut by the deadline)`);
  return last!;
}

const has = (record: VisualDiagnosisRecord | undefined, ...codes: string[]): boolean => !!record && codes.every((code) => record.observations.includes(code));
const hasNot = (record: VisualDiagnosisRecord | undefined, ...codes: string[]): boolean => !!record && codes.every((code) => !record.observations.includes(code));
const show = (record: VisualDiagnosisRecord | undefined): string => (record ? JSON.stringify({ ...record, ms: undefined }) : "no record");
const NO_IDENTITY_UNDER_V1 = ["target-differs-from-reference", "no-examined-identical"];
const allRecords: VisualDiagnosisRecord[] = [];

async function main(): Promise<void> {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  try {
    for (let attempt = 0; attempt < 80 && !(await fetch(LAB).then((r) => r.ok, () => false)); attempt += 1) await new Promise((r) => setTimeout(r, 100));
    browser = await chromium.launch();
    await clearStore();

    // ── A. Identity ────────────────────────────────────────────────────────────────────────────
    console.log("A. Identity: byte identity under unproven conditions, references read only");
    {
      const seedPage = await freshLab();
      await seed(runtimeKey("a1"), await evidenceOf(seedPage, seedPage.getByTestId("vf-tool-0")));
      await seedPage.close();
      const a1 = await diagnose("a1", async () => ({ page: await freshLab(), step: fillStep("a1", tool(0)) }));
      allRecords.push(a1.record!);
      check("precondition: the fill on a button fails", a1.result.status === "failed", a1.result.status);
      check(
        "an unchanged target is target-identical-to-reference under unproven, with a runtime reference",
        a1.record?.outcome === "observed" && a1.record.conditions === "unproven" && has(a1.record, "conditions-unproven", "target-identical-to-reference") && a1.record.referenceSource === "runtime" && a1.record.examined === 1 && a1.record.domNamed === 1 && a1.record.truncated === false,
        show(a1.record)
      );
      check("exactly one frame was taken and released", a1.h.frames.taken === 1 && a1.h.frames.released === 1, JSON.stringify(a1.h.frames));
      await a1.page.close();

      const a2 = await diagnose("a2", async () => ({ page: await freshLab(), step: fillStep("a2", tool(0)) }));
      allRecords.push(a2.record!);
      check("no reference gives reference-unavailable and no identity", has(a2.record, "reference-unavailable") && a2.record?.referenceSource === "none" && a2.record.conditions === "none", show(a2.record));
      await a2.page.close();

      const recordedPage = await freshLab();
      const a3Step = fillStep("a3", tool(0));
      await seed(recordedVisualReferenceKey(FLOW_ID, "a3", stepCandidatesDigest(a3Step.locator!)), await evidenceOf(recordedPage, recordedPage.getByTestId("vf-tool-0")));
      await recordedPage.close();
      const a3off = await diagnose("a3-off", async () => ({ page: await freshLab(), step: a3Step }));
      const a3on = await diagnose("a3-on", async () => ({ page: await freshLab(), step: a3Step, options: { recordedFallback: true } }));
      allRecords.push(a3off.record!, a3on.record!);
      check("a recorded reference is not read without the N4 flag", a3off.record?.referenceSource === "none" && has(a3off.record, "reference-unavailable"), show(a3off.record));
      check(
        "with the flag it is read as recorded and still only unproven",
        a3on.record?.referenceSource === "recorded" && a3on.record.conditions === "unproven" && has(a3on.record, "target-identical-to-reference"),
        show(a3on.record)
      );
      await a3off.page.close();
      await a3on.page.close();

      const widePage = await browser!.newPage({ viewport: { width: 900, height: 600 } });
      await widePage.goto(LAB);
      await seed(runtimeKey("a4"), await evidenceOf(widePage, widePage.getByTestId("vf-tool-0")));
      await widePage.close();
      const a4 = await diagnose("a4", async () => ({ page: await freshLab(), step: fillStep("a4", tool(0)) }));
      allRecords.push(a4.record!);
      check("a reference taken at another viewport width is conditions-changed, with no identity code", a4.record?.conditions === "different" && has(a4.record, "conditions-changed") && hasNot(a4.record, "target-identical-to-reference", "inconclusive"), show(a4.record));
      await a4.page.close();
    }

    // ── B. DOM facts and the frame policy ───────────────────────────────────────────────────────
    console.log("B. DOM facts and one frame, target or not");
    {
      const b1 = await diagnose("b1", async () => ({ page: await freshLab("detach"), step: clickStep("b1", tool(0)) }));
      allRecords.push(b1.record!);
      check("a detached target is target-not-in-dom, and the one frame is still taken (targetless)", has(b1.record, "target-not-in-dom") && b1.record?.examined === 0 && b1.h.frames.taken === 1 && b1.h.frames.released === 1, `${show(b1.record)} ${JSON.stringify(b1.h.frames)}`);
      await b1.page.close();
      const b2 = await diagnose("b2", async () => ({ page: await freshLab("overlay"), step: clickStep("b2", tool(0)) }));
      allRecords.push(b2.record!);
      check("an overlaid target is target-occluded and not offscreen", has(b2.record, "target-occluded") && hasNot(b2.record, "target-offscreen", "target-not-in-dom"), show(b2.record));
      await b2.page.close();
      const b3 = await diagnose("b3", async () => ({ page: await freshLab("zero"), step: clickStep("b3", tool(0)) }));
      allRecords.push(b3.record!);
      check("a zero-size target is target-zero-size, never offscreen, and not examined", has(b3.record, "target-zero-size") && hasNot(b3.record, "target-offscreen") && b3.record?.examined === 0, show(b3.record));
      await b3.page.close();
      const b4 = await diagnose("b4", async () => ({ page: await freshLab("blank"), step: clickStep("b4", tool(0)) }));
      allRecords.push(b4.record!);
      check("a blank page with no target is target-not-in-dom and viewport-uniform from the one frame", has(b4.record, "target-not-in-dom", "viewport-uniform") && b4.h.frames.taken === 1, `${show(b4.record)} ${JSON.stringify(b4.h.frames)}`);
      await b4.page.close();
      const b5 = await diagnose("b5", async () => ({ page: await freshLab(), step: fillStep("b5", { strategy: "testId", value: "vf-offscreen-tool" }) }));
      allRecords.push(b5.record!);
      check("a target below the fold is target-offscreen and not examined", has(b5.record, "target-offscreen") && b5.record?.examined === 0, show(b5.record));
      const busy = await diagnose("b6", async () => ({ page: await freshLab("detach"), step: clickStep("b6", tool(0)) }));
      check("a busy page is never viewport-uniform", hasNot(busy.record, "viewport-uniform"), show(busy.record));
      await b5.page.close();
      await busy.page.close();
      // N5.7 (QC finding 1): occlusion is asked of the target's own root, at the centre of its visible part.
      // A fill on a button fails, so these uncovered targets still reach a final failure to diagnose.
      const b7 = await diagnose("b7", async () => ({ page: await freshLab("shadow"), step: fillStep("b7", { strategy: "testId", value: "vf-shadow-tool" }) }));
      allRecords.push(b7.record!);
      check("a target in an open shadow root, with nothing over it, is not target-occluded (its host is not a cover)", b7.record?.outcome === "observed" && hasNot(b7.record, "target-occluded", "target-offscreen", "target-not-in-dom") && b7.record?.examined === 1, show(b7.record));
      await b7.page.close();
      const b8 = await diagnose("b8", async () => ({ page: await freshLab("partial"), step: fillStep("b8", { strategy: "testId", value: "vf-partial-tool" }) }));
      allRecords.push(b8.record!);
      check("a target half below the fold, its centre off screen, is neither target-occluded nor target-offscreen", b8.record?.outcome === "observed" && hasNot(b8.record, "target-occluded", "target-offscreen") && b8.record?.examined === 1, show(b8.record));
      await b8.page.close();
      // N5.7 (QC finding 2): no box means no position, so display:none is a size fact only.
      const b9 = await diagnose("b9", async () => ({ page: await freshLab("hidden"), step: clickStep("b9", tool(0)) }));
      allRecords.push(b9.record!);
      check("a display:none target is target-zero-size only, never offscreen, and not examined", has(b9.record, "target-zero-size") && hasNot(b9.record, "target-offscreen", "target-occluded") && b9.record?.examined === 0, show(b9.record));
      await b9.page.close();
      // Disposal runs after the work settles; give it a moment before counting.
      await new Promise((r) => setTimeout(r, 300));
      check("every diagnosis above released every element handle it resolved", [b7, b8, b9].every((d) => d.h.handles.resolved >= 1 && d.h.handles.disposed === d.h.handles.resolved), [b7, b8, b9].map((d) => JSON.stringify(d.h.handles)).join(" "));
    }

    // ── C. Examined scope ──────────────────────────────────────────────────────────────────────
    console.log("C. Examined scope: counts over examined candidates, truncation, omitted contenders");
    {
      const s = await freshLab();
      await seed(runtimeKey("c1"), await evidenceOf(s, s.getByTestId("vf-tool-2")));
      await seed(runtimeKey("c4"), await evidenceOf(s, s.getByTestId("vf-tool-1")));
      await s.close();
      const c1 = await diagnose("c1", async () => ({ page: await freshLab(), step: fillStep("c1", { strategy: "css", value: '[data-testid^="vf-tool-"]' }) }));
      allRecords.push(c1.record!);
      check(
        "several matches: target-multiple-matches and an identical other counted over the 4 examined",
        has(c1.record, "target-multiple-matches", "other-examined-identical") && c1.record?.examined === 4 && c1.record.domNamed === 4 && !!c1.record.identicalOthers && hasNot(c1.record, "target-identical-to-reference"),
        show(c1.record)
      );
      await c1.page.close();

      const m = await freshLab("many");
      const many = m.getByTestId("vf-many-tool");
      await seed(runtimeKey("c2"), await evidenceOf(m, many.nth(36)));
      await seed(runtimeKey("c3"), await evidenceOf(m, many.nth(5)));
      await m.close();
      const c2 = await diagnose("c2", async () => ({ page: await freshLab("many"), step: fillStep("c2", { strategy: "testId", value: "vf-many-tool" }) }));
      allRecords.push(c2.record!);
      check(
        "over the cap: truncated, 32 of 40 examined, and the identical element past the cap is never counted",
        c2.record?.truncated === true && c2.record.examined === 32 && c2.record.domNamed === 40 && hasNot(c2.record, "other-examined-identical") && has(c2.record, "inconclusive"),
        show(c2.record)
      );
      await c2.page.close();
      const c3 = await diagnose("c3", async () => ({ page: await freshLab("many"), step: fillStep("c3", { strategy: "testId", value: "vf-many-tool" }) }));
      allRecords.push(c3.record!);
      check("over the cap, an identical element inside it is counted (positive control), still truncated", has(c3.record, "other-examined-identical") && c3.record?.truncated === true, show(c3.record));
      await c3.page.close();
      const c4 = await diagnose("c4", async () => ({ page: await freshLab(), step: fillStep("c4", tool(0)) }));
      allRecords.push(c4.record!);
      check(
        "an identical element the step never names (omitted contender) is never counted",
        c4.record?.examined === 1 && hasNot(c4.record, "other-examined-identical", "target-identical-to-reference") && has(c4.record, "inconclusive"),
        show(c4.record)
      );
      await c4.page.close();
      const alt = await diagnose("c5", async () => ({ page: await freshLab(), step: fillStep("c5", { ...tool(0), alternatives: [tool(1)] }) }));
      check("a step with alternatives is marked truncated (only the primary's matches are examined)", alt.record?.truncated === true, show(alt.record));
      await alt.page.close();
    }

    // ── D. Refusals with zero frames ───────────────────────────────────────────────────────────
    console.log("D. Refusals: nothing captured on protected, handed-off, sensitive or ineligible steps");
    {
      const d1 = await diagnose("d1", async () => ({ page: await freshLab("none", (p) => p.evaluate(() => (window as unknown as { __fusionLab: { injectProtected(k: string): void } }).__fusionLab.injectProtected("captcha"))), step: fillStep("d1", tool(0)) }));
      check("an injected protected surface refuses as protected-surface with no frame kept", d1.record?.outcome === "refused" && has(d1.record, "protected-surface") && d1.h.frames.taken === 0, `${show(d1.record)} ${JSON.stringify(d1.h.frames)}`);
      check("N5.7: the protected page is refused before anything inspects it (no handle, no masked check, no box)", d1.h.inspected.count === 0 && d1.h.handles.resolved === 0, `inspected ${d1.h.inspected.count}, ${JSON.stringify(d1.h.handles)}`);
      await d1.page.close();
      const d2 = await diagnose("d2", async () => ({ page: await freshLab(), step: fillStep("d2", tool(0)), options: { handedOff: true } }));
      check("a handed-off page refuses as protected-surface with zero frames", has(d2.record, "protected-surface") && d2.h.frames.taken === 0, `${show(d2.record)} ${JSON.stringify(d2.h.frames)}`);
      await d2.page.close();
      const SECURE_LOGIN = `${BASE}/mock/protected-login`;
      const p3 = await diagnose("p3", async () => {
        const page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
        await page.goto(SECURE_LOGIN);
        return { page, step: clickStep("p3", { strategy: "testId", value: "does-not-exist" }) };
      });
      check(
        "precondition: the secure-login fixture is served and carries its password and one-time-code fields",
        (await p3.page.getByTestId("protected-login-page").count()) === 1 && (await p3.page.locator('input[type="password"]').count()) === 1 && (await p3.page.locator('input[autocomplete="one-time-code"]').count()) === 1
      );
      check("B2 P3 path: a failure on the secure-login page refuses as protected-surface with zero frames", has(p3.record, "protected-surface") && p3.h.frames.taken === 0, `${show(p3.record)} ${JSON.stringify(p3.h.frames)}`);
      check("N5.7: ...and nothing inspected the secure-login page", p3.h.inspected.count === 0, `inspected ${p3.h.inspected.count}`);
      // N5.7 (security finding 5): a protected surface that appears after the inspection, just before the frame.
      const d5 = await diagnose("d5", async () => {
        const page = await freshLab();
        return {
          page,
          step: fillStep("d5", tool(0)),
          options: {
            probe: {
              hold: async (stage: "before-frame" | "after-frame") => {
                if (stage === "before-frame") await page.evaluate(() => (window as unknown as { __fusionLab: { injectProtected(k: string): void } }).__fusionLab.injectProtected("otp"));
              }
            }
          }
        };
      });
      await new Promise((r) => setTimeout(r, 300));
      check(
        "a protected surface that appears just before the frame is refused as protected-surface, with no frame taken and every handle released",
        has(d5.record, "protected-surface") && d5.h.frames.taken === 0 && d5.h.frames.released === 0 && d5.h.inspected.count === 1 && d5.h.handles.disposed === d5.h.handles.resolved,
        `${show(d5.record)} ${JSON.stringify(d5.h.frames)} ${JSON.stringify(d5.h.handles)}`
      );
      await d5.page.close();
      await p3.page.close();
      {
        const page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
        await page.goto(SECURE_LOGIN);
        const controller = new ManualHandoffController();
        const h = harness(page, { controller, executionId: "exec-p1" });
        const watcher = (async () => {
          for (let i = 0; i < 400; i += 1) {
            if (controller.getPending("exec-p1", "inst-1")) return controller.cancel("exec-p1", "inst-1");
            await new Promise((r) => setTimeout(r, 25));
          }
        })();
        const result = await h.run({ id: "p1", name: "Protected login", type: "protectedLoginHandoff", config: { handoffMode: "pauseAndAsk" } } as unknown as FlowStep);
        await watcher;
        check("B2 P1 path: a cancelled protectedLoginHandoff refuses as handoff-active with zero frames", result.status === "failed" && has(h.records[0], "handoff-active") && h.frames.taken === 0, `${result.status} ${show(h.records[0])}`);
        await page.close();
      }
      const d3 = await diagnose("d3", async () => ({
        page: await freshLab("none", (p) => p.evaluate(() => (window as unknown as { __fusionLab: { injectProtected(k: string): void } }).__fusionLab.injectProtected("otp"))),
        step: clickStep("d3", { strategy: "css", value: '[data-testid="vf-protected-otp"] input' }, { type: "check" })
      }));
      // N5.7: N0's protected scan now runs first, so a one-time-code page is refused as a protected surface before the
      // masked-field check is reached, and nothing inspects it.
      check(
        "a one-time-code field refuses (protected-surface first since N5.7) with zero frames and no inspection",
        d3.record?.outcome === "refused" && (has(d3.record, "protected-surface") || has(d3.record, "sensitive")) && d3.h.frames.taken === 0 && d3.h.inspected.count === 0,
        `${show(d3.record)} ${JSON.stringify(d3.h.frames)} inspected ${d3.h.inspected.count}`
      );
      await d3.page.close();
      // The masked-field check on the measured handles, on a page N0 does not treat as protected.
      const d6 = await diagnose("d6", async () => ({
        page: await freshLab("none", (p) =>
          p.evaluate(() => {
            const field = document.createElement("input");
            field.setAttribute("data-testid", "vf-card");
            field.setAttribute("name", "cardnumber");
            field.style.cssText = "position: absolute; left: 420px; top: 240px; width: 160px; height: 28px";
            document.body.appendChild(field);
          })
        ),
        step: clickStep("d6", { strategy: "testId", value: "vf-card" }, { type: "check" })
      }));
      check(
        "a masked card-number field on an ordinary page refuses as sensitive, with zero frames and every handle released",
        has(d6.record, "sensitive") && d6.h.frames.taken === 0 && d6.h.inspected.count === 1,
        `${show(d6.record)} ${JSON.stringify(d6.h.frames)} inspected ${d6.h.inspected.count}`
      );
      await d6.page.close();
      const d4 = await diagnose("d4", async () => ({ page: await freshLab(), step: { id: "d4", name: "Wait", type: "assertVisible", timeoutMs: 500, locator: { strategy: "testId", value: "nope" } } as unknown as FlowStep }));
      check("a non-element step refuses as not-eligible with zero frames", has(d4.record, "not-eligible") && d4.h.frames.taken === 0, `${show(d4.record)} ${JSON.stringify(d4.h.frames)}`);
      await d4.page.close();
      // Capture window (R1b through the adapter): a password field is shown and hidden again inside N0's screenshot, so
      // both of N0's guard checks see a clean page. The real screenshot is wrapped only once the diagnosis reaches its frame.
      let windowShots = 0;
      let windowShown = false;
      const d7 = await diagnose("d7", async () => {
        windowShots = 0;
        windowShown = false;
        const page = await freshLab();
        const hold = async (stage: "before-frame" | "after-frame"): Promise<void> => {
          if (stage !== "before-frame") return;
          const original = page.screenshot.bind(page);
          page.screenshot = (async (options?: Parameters<Page["screenshot"]>[0]) => {
            windowShots += 1;
            await page.evaluate(() => {
              const field = document.createElement("input");
              field.type = "password";
              field.id = "window-pw";
              document.body.appendChild(field);
            });
            windowShown = (await checkProtectedSurface(page)).protected;
            try {
              return await original(options);
            } finally {
              await page.evaluate(() => document.getElementById("window-pw")?.remove());
            }
          }) as Page["screenshot"];
        };
        return { page, step: fillStep("d7", tool(0)), options: { probe: { hold } } };
      });
      const d7Gone = (await d7.page.locator("#window-pw").count()) === 0;
      check(
        "R1b precondition: the diagnosis screenshot ran with a password field shown, which is gone afterwards",
        windowShots === 1 && windowShown && d7Gone && !!d7.record && hasNot(d7.record, "budget-exhausted"),
        `shots ${windowShots} protected ${windowShown} gone ${d7Gone} ${show(d7.record)}`
      );
      check("R1b: a protected field shown only inside the capture window leaves the diagnosis with zero frames", d7.h.frames.taken === 0, `${show(d7.record)} ${JSON.stringify(d7.h.frames)}`);
      await d7.page.close();
    }

    // ── E. When it runs ────────────────────────────────────────────────────────────────────────
    console.log("E. When it runs: final failure only, once, within the per-signature cap");
    {
      const page = await freshLab();
      const pass = harness(page);
      const passed1 = await pass.run(clickStep("e1", tool(1)));
      check("a passing step is never diagnosed and takes no frame", passed1.status === "passed" && pass.calls.length === 0 && pass.frames.taken === 0, `${passed1.status} calls ${pass.calls.length}`);
      await page.close();
      const retryPage = await freshLab("detach");
      const retry = harness(retryPage);
      const retried = await retry.run(clickStep("e2", tool(0), { timeoutMs: 400, retry: { count: 1, delayMs: 0 } }));
      check(
        "a step that failed twice is diagnosed once, after its final attempt",
        retried.status === "failed" && retry.calls.length === 1 && retry.calls[0].attempt === 1 && retry.records.length === 1,
        `${retried.status} calls ${JSON.stringify(retry.calls)}`
      );
      await retryPage.close();
      const capPage = await freshLab();
      const capRecords: VisualDiagnosisRecord[] = [];
      for (let i = 0; i <= VISUAL_DIAGNOSIS_SIGNATURE_CAP; i += 1) {
        const h = harness(capPage, { executionId: "exec-cap" });
        await h.run(fillStep("e3", tool(0)));
        if (h.records[0]) capRecords.push(h.records[0]);
      }
      check(
        `the same signature is diagnosed at most ${VISUAL_DIAGNOSIS_SIGNATURE_CAP} times per execution, then coalesced`,
        capRecords.length === VISUAL_DIAGNOSIS_SIGNATURE_CAP + 1 && capRecords.slice(0, -1).every((r) => !r.observations.includes("coalesced")) && has(capRecords.at(-1), "coalesced"),
        capRecords.map((r) => r.observations[0]).join(",")
      );
      await capPage.close();
    }

    // ── F. A/B neutrality and the store ─────────────────────────────────────────────────────────
    console.log("F. A/B: off and on change nothing about the step, the page or the store");
    {
      // N5.7 (QC finding 6): attempts are compared too, and one case retries before its final failure.
      const stable = (result: StepExecutionResult) =>
        JSON.stringify({ status: result.status, error: result.error, next: result.nextStepId, outcome: result.outcome, attempts: result.attemptCount, kinds: (result.evidence ?? []).map((e) => `${e.kind}:${e.attempt}:${!!e.path}`) });
      const pageState = (page: Page) =>
        page.evaluate(() => ({
          dom: document.documentElement.outerHTML.length + ":" + document.documentElement.outerHTML.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0),
          scroll: `${window.scrollX},${window.scrollY}`,
          interactions: (window as unknown as { __fusionLab: { interactions: number } }).__fusionLab.interactions
        }));
      const before = await storeDigest();
      for (const [label, failure, step] of [
        ["a failed fill", "none", fillStep("f1", tool(0))],
        ["an occluded click", "overlay", clickStep("f2", tool(0))],
        ["a click that fails twice under retry", "detach", clickStep("f3", tool(0), { timeoutMs: 400, retry: { count: 1, delayMs: 0 } })]
      ] as const) {
        const offPage = await freshLab(failure);
        const off = await harness(offPage, { enabled: false }).run(step);
        const offState = await pageState(offPage);
        const onPage = await freshLab(failure);
        const onH = harness(onPage);
        const on = await onH.run(step);
        const onState = await pageState(onPage);
        check(`A/B (${label}): same status, error, next step, outcome and B2 evidence kinds`, stable(off) === stable(on), `${stable(off)} vs ${stable(on)}`);
        check(`A/B (${label}): same DOM, scroll and interaction count after the diagnosis`, JSON.stringify(offState) === JSON.stringify(onState) && onH.records.length === 1, `${JSON.stringify(offState)} vs ${JSON.stringify(onState)}`);
        await offPage.close();
        await onPage.close();
      }
      check("the reference store's files are byte-identical before and after diagnoses", before === (await storeDigest()), `${before} vs ${await storeDigest()}`);
    }

    // ── G. The deadline ────────────────────────────────────────────────────────────────────────
    console.log("G. Deadline: one settlement, late work dropped, everything released");
    {
      // Playwright's Page is an EventEmitter at runtime; its typings omit listenerCount.
      const listeners = (page: Page) =>
        ["close", "framenavigated", "popup", "crash", "load"].map((event) => (page as unknown as { listenerCount(name: string): number }).listenerCount(event)).join(",");
      const page1 = await freshLab();
      const h1 = harness(page1, { deadlineMs: 300, probe: { hold: (stage) => (stage === "before-frame" ? new Promise((r) => setTimeout(r, 1200)) : Promise.resolve()) } });
      await h1.run(fillStep("g1", tool(0)));
      const snapshot = JSON.stringify(h1.records);
      check(
        "held before the frame: budget-exhausted, and the hook got it back at the deadline, not after the 1200 ms hold",
        h1.records.length === 1 && has(h1.records[0], "budget-exhausted") && h1.records[0].ms >= 300 && h1.calls.length === 1 && h1.calls[0].ms < 1200,
        show(h1.records[0]) + ` record ms ${h1.records[0]?.ms}, hook waited ${h1.calls[0]?.ms} ms`
      );
      await new Promise((r) => setTimeout(r, 1600));
      check("after the hold ends, the late work never re-settles, changes nothing and takes no frame", h1.records.length === 1 && JSON.stringify(h1.records) === snapshot && h1.frames.taken === 0, `${h1.records.length} records, frames ${JSON.stringify(h1.frames)}`);
      check("nothing is left in flight", h1.diagnosis.inFlight() === 0, `in flight ${h1.diagnosis.inFlight()}`);
      await page1.close();

      const page2 = await freshLab();
      let listenersAtStart = "";
      const h2 = harness(page2, {
        deadlineMs: 2500,
        probe: {
          hold: async (stage) => {
            if (stage === "before-frame") listenersAtStart = listeners(page2);
            else await new Promise((r) => setTimeout(r, 4000));
          }
        }
      });
      await h2.run(fillStep("g2", tool(0)));
      check("held after the frame: budget-exhausted while the frame is still held", has(h2.records[0], "budget-exhausted") && h2.frames.taken === 1 && h2.frames.released === 0, `${show(h2.records[0])} ${JSON.stringify(h2.frames)}`);
      await new Promise((r) => setTimeout(r, 4500));
      check("the held frame is released once the late work unwinds, still one record, nothing in flight", h2.frames.released === 1 && h2.records.length === 1 && h2.diagnosis.inFlight() === 0, `${JSON.stringify(h2.frames)} records ${h2.records.length}`);
      // N5.7 (QC finding 3 / security finding 5): the handles are released after a deadline cut as well.
      check("after the cut, every element handle the late work resolved was disposed", h2.handles.resolved >= 1 && h2.handles.disposed === h2.handles.resolved, JSON.stringify(h2.handles));
      check("no page listener the frame attached is left behind", listenersAtStart !== "" && listeners(page2) === listenersAtStart, `${listeners(page2)} vs ${listenersAtStart}`);
      await page2.close();

      const page3 = await freshLab();
      const h3 = harness(page3, { deadlineMs: 5000, probe: { hold: async (stage) => { if (stage === "before-frame") await page3.close(); } } });
      let threw = false;
      try {
        await h3.run(fillStep("g3", tool(0)));
      } catch {
        threw = true;
      }
      check("a page closed mid-diagnosis settles as page-closed, takes no frame and throws nothing", !threw && has(h3.records[0], "page-closed") && h3.frames.taken === 0, `${show(h3.records[0])} threw ${threw}`);

      // N5.7 (QC re-review nit): the screenshot limiter hands the frame back after the deadline. The work has given up,
      // so the frame is never used, and it is still released.
      const page4 = await freshLab();
      const late = { taken: 0, released: 0, lateReleased: 0 };
      const d4 = new VisualFailureDiagnosis({
        folder: STORE,
        handedOff: () => false,
        deadlineMs: 600,
        probe: {
          onFrame: (event) => {
            if (event === "taken") late.taken += 1;
            else if (event === "released") late.released += 1;
            else late.lateReleased += 1;
          }
        }
      });
      const lateRecord = await d4.diagnoseFinalFailure({
        step: fillStep("g4", tool(0)),
        attempt: 0,
        errorClass: "locator",
        executionId: "exec-g4",
        scenarioId: SCENARIO_ID,
        flowId: FLOW_ID,
        page: async () => page4,
        limitScreenshot: async (fn) => {
          const result = await fn();
          await new Promise((r) => setTimeout(r, 1200));
          return result;
        }
      });
      check("a frame handed back after the deadline: the diagnosis settles budget-exhausted without using it", has(lateRecord, "budget-exhausted") && late.taken === 0, `${show(lateRecord)} ${JSON.stringify(late)}`);
      await new Promise((r) => setTimeout(r, 1500));
      check("...and the late frame is released once it arrives, with nothing left in flight", late.lateReleased === 1 && late.released === 0 && d4.inFlight() === 0, `${JSON.stringify(late)} in flight ${d4.inFlight()}`);
      await page4.close();
    }

    // ── H. Enablement, wiring and the record shape ──────────────────────────────────────────────
    console.log("H. Enablement, wiring and the codes-only record");
    {
      check("AWKIT_VISUAL_DIAGNOSIS: only exactly 'on' enables it", visualDiagnosisMode({}) === "off" && visualDiagnosisMode({ AWKIT_VISUAL_DIAGNOSIS: "ON" }) === "off" && visualDiagnosisMode({ AWKIT_VISUAL_DIAGNOSIS: "on" }) === "on");
      const engine = await readFile(join(process.cwd(), "src/runner/ExecutionEngine.ts"), "utf8");
      const runner = await readFile(join(process.cwd(), "src/runner/PlaywrightRunner.ts"), "utf8");
      const flow = await readFile(join(process.cwd(), "src/runner/FlowExecutor.ts"), "utf8");
      check("the engine sets the folder only when the mode is on", /visualDiagnosisRoot: visualDiagnosisMode\(\) === "on" \? join\(dirs\.root, "visual-references"\) : undefined/.test(engine));
      check("the runner loads the adapter lazily and only with the folder", /if \(!this\.options\.visualDiagnosisRoot\) return undefined;/.test(runner) && /import\("\.\/visualDiagnosis\/VisualFailureDiagnosis"\)/.test(runner));
      const hook = flow.indexOf("diagnoseFinalFailure(");
      check("the hook sits after the retry loop, never inside it", hook > flow.indexOf("const decision = this.retryPolicy.decide(") && hook > flow.indexOf("recordFailurePageContext?.(step)"), String(hook));
      check("the default deadline is the VD-8 provisional 1000 ms", VISUAL_DIAGNOSIS_DEADLINE_MS === 1000);
      check(
        "N5.7 (QC finding 5): the lazy loader races the first load against the deadline and hands the adapter only what is left",
        /Promise\.race\(\[load\(\), new Promise<undefined>/.test(runner) && /deadlineMs: Math\.max\(1, Math\.round\(deadlineMs - \(performance\.now\(\) - started\)\)\)/.test(runner)
      );
      const names = (await readdir(STORE)).sort();
      const changed = [];
      for (const name of names) if (seeded.get(name) !== sha(await readFile(join(STORE, name)))) changed.push(name);
      check(
        `across every case the store holds exactly the ${seeded.size} files the verifier seeded, byte for byte (no diagnosis wrote)`,
        seeded.size >= 7 && names.length === seeded.size && changed.length === 0,
        `${names.length} files, ${changed.length} new or changed`
      );
      const allowed = new Set(["version", "stepId", "attempt", "failureKind", "outcome", "conditions", "observations", "referenceSource", "examined", "domNamed", "truncated", "identicalOthers", "ms"]);
      const records = allRecords.filter((record): record is VisualDiagnosisRecord => !!record);
      const extra = records.flatMap((r) => Object.keys(r).filter((key) => !allowed.has(key)));
      check(`every record holds only the codes-only keys (${records.length} records)`, records.length >= 14 && records.length === allRecords.length && extra.length === 0, extra.join(","));
      check("no record ever carries a difference or an absence for a v1 reference", records.every((r) => hasNot(r, ...NO_IDENTITY_UNDER_V1) && r.conditions !== "equal-proven"));
      check(
        "N5.4: the runner sends records only to onVisualDiagnosis and logs none",
        /onRecord: \(record: VisualDiagnosisRecord\) => sink\(record\)/.test(runner) && !runner.includes("[visual-diagnosis]"),
        "runner wiring"
      );
    }
    console.log(`\n  (deadline-cut runs repeated: ${cutRuns})`);
  } finally {
    await browser?.close().catch(() => undefined);
    server.kill();
    await rm(ROOT, { recursive: true, force: true }).catch(() => undefined);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
