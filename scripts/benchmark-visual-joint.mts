/**
 * benchmark:visual-joint — the joint N8 + N9 qualification (2026-11-01). Both features ON together (the adapter with
 * `rowEvidence` and `stateRecognition`, deadline VISUAL_DIAGNOSIS_DEADLINE_MS + VISUAL_STATE_EXTRA_MS, exactly what
 * AWKIT_VISUAL_DIAGNOSIS=on + AWKIT_VISUAL_ROWS=on + AWKIT_VISUAL_STATE=on gives), through the real N0 capture and
 * Chromium, on the held-out variants b, c and d of the Visual State Lab (N9, S-1..S-5) and the Visual Rows Lab
 * (N8, R-1..R-5), against the UNCHANGED frozen criteria.
 *
 * Strict accounting, decided before this campaign ran:
 *   - late = the hook returned after the hard deadline, by ANY amount (no grace);
 *   - a deadline-cut trial counts in the work-time p95 at the full deadline (never dropped);
 *   - every overrun is recorded with its absolute size.
 * Disabled-mode control per cell: ten trials with both features off must carry no N8/N9 code and take at most one
 * frame.
 *
 *   --cell headless@1 | headless@1.25 | headless@2 | headed@1 | headed@1.25 | headed@2   run one cell
 *   --aggregate                                                                         pool the six cell files
 *
 * Evidence: docs/plans/ai-upgrade-v5/evidence/joint/N8N9-<cell>.json and N8N9-joint-summary.json. Codes, counts and
 * durations only.
 *
 *   --diagnostic <id> --cell <cell>   one instrumented run (2026-11-01, the campaign-5 headed@2 investigation). It writes
 *                                     only evidence/joint/diagnostic/<id>/, refuses to overwrite, is never a campaign and
 *                                     never counts as qualification. Per trial it adds timings and counters only: Node
 *                                     event-loop delay and utilization, process CPU and memory, host CPU busy share,
 *                                     Chromium renderer task metrics (CDP Performance), page visibility and focus, an
 *                                     evaluate round trip, and the adapter's frame timestamps. No page content.
 */

import { spawn } from "node:child_process";
import { cpus, freemem, totalmem } from "node:os";
import { monitorEventLoopDelay, performance as nodePerformance } from "node:perf_hooks";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, type CDPSession, type Page } from "playwright";
import { VisualFailureDiagnosis } from "@src/runner/visualDiagnosis/VisualFailureDiagnosis";
import { VISUAL_DIAGNOSIS_DEADLINE_MS, VISUAL_STATE_EXTRA_MS } from "@src/runner/visualDiagnosis/visualDiagnosisContract";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { N9_FROZEN_CRITERIA, evaluateStateCriteria, type StateDecision, type StateTrial } from "./lib/visual-state-criteria.mts";
import { N8_FROZEN_CRITERIA, evaluateRowsCriteria, type RowsTrial } from "./lib/visual-rows-criteria.mts";

const args = process.argv.slice(2);
const CELL = args.includes("--cell") ? args[args.indexOf("--cell") + 1] : undefined;
const AGGREGATE = args.includes("--aggregate");
const REPEATS = 2;
const PORT = 4616;
const BASE = `http://127.0.0.1:${PORT}`;
const DEADLINE = VISUAL_DIAGNOSIS_DEADLINE_MS + VISUAL_STATE_EXTRA_MS;
const OFF_DEADLINE = VISUAL_DIAGNOSIS_DEADLINE_MS;
/** `--campaign N` (N > 1) writes beside, never over, an earlier campaign's evidence. */
const CAMPAIGN = args.includes("--campaign") ? Number(args[args.indexOf("--campaign") + 1]) : 1;
const DIAGNOSTIC = args.includes("--diagnostic") ? args[args.indexOf("--diagnostic") + 1] : undefined;
const OUT = join(
  process.cwd(),
  "docs",
  "plans",
  "ai-upgrade-v5",
  "evidence",
  "joint",
  ...(DIAGNOSTIC ? ["diagnostic", DIAGNOSTIC] : CAMPAIGN > 1 ? [`c${CAMPAIGN}`] : [])
);
const CELLS = ["headless@1", "headless@1.25", "headless@2", "headed@1", "headed@1.25", "headed@2"];

interface Trial {
  lab: "state" | "rows" | "control";
  fixture: string;
  variant: string;
  truth: string;
  adversarial: boolean;
  coverage?: string;
  structure?: string;
  codes: string[];
  n5: string;
  stateMs: number | null;
  rowMs: number | null;
  recordMs: number;
  /** F5: the unrounded duration (campaigns after 2 only). */
  recordMsRaw?: number;
  overrunMs: number;
  frames: number;
  refused: boolean;
  cut: boolean;
  /** `--diagnostic` only. */
  diag?: TrialDiagnostics;
}

/** Timings and counters only (`--diagnostic`). Times in ms; `at` is ms since the cell started. */
interface TrialDiagnostics {
  at: number;
  /** Adapter probe timestamps relative to the diagnosis start: inspect, then each frame taken / released. */
  marks: Array<[string, number]>;
  loopDelay: { mean: number; p99: number; max: number };
  loopUtilization: number;
  processCpu: { user: number; system: number };
  rssMb: number;
  heapMb: number;
  hostBusy: number;
  hostFreeMb: number;
  renderer: { task: number; script: number; layout: number; style: number } | null;
  pingBefore: number;
  pingAfter: number;
  visibility: string;
  focused: boolean;
  /** Time spent collecting this entry outside the measured diagnosis window. */
  overheadMs: number;
}

const pct = (values: number[], q: number): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * q) - 1)];
};
let seq = 0;

async function diagnose(page: Page, locator: string, on: boolean, marks?: Array<[string, number]>) {
  let stateMs: number | null = null;
  let rowMs: number | null = null;
  let frames = 0;
  let started = 0;
  const mark = (name: string) => marks?.push([name, Math.round((performance.now() - started) * 10) / 10]);
  const diagnosis = new VisualFailureDiagnosis({
    folder: join(process.cwd(), "build", "joint-no-references"),
    handedOff: () => false,
    reader: { get: async () => ({ status: "missing" }) as never },
    ...(on ? { rowEvidence: true, stateRecognition: true, deadlineMs: DEADLINE } : {}),
    probe: {
      // Observers only (`--diagnostic`); campaigns pass no `marks` and keep the campaign-5 probe set.
      ...(marks ? { onInspect: () => mark("inspect") } : {}),
      onFrame: (event) => {
        if (event === "taken") frames += 1;
        if (marks) mark(`frame-${event}`);
      },
      onState: (event) => {
        stateMs = event.ms;
      },
      onRows: (event) => {
        rowMs = event.ms;
      }
    }
  });
  const step = { id: "joint", name: "Joint", type: "click", timeoutMs: 800, locator: { strategy: "testId", value: locator } } as unknown as FlowStep;
  started = performance.now();
  const record = await diagnosis.diagnoseFinalFailure({
    step,
    attempt: 0,
    errorClass: "locator",
    executionId: `joint-${(seq += 1)}`,
    scenarioId: "joint",
    flowId: "joint-flow",
    page: async () => page,
    limitScreenshot: (fn) => fn()
  });
  const recordMs = performance.now() - started;
  const obs = record?.observations ?? [];
  return { obs, stateMs, rowMs, frames, recordMs };
}

/** `--diagnostic` instruments; `null` for campaigns, which then run each diagnosis exactly as before. */
let instrument: { start: number; loop: ReturnType<typeof monitorEventLoopDelay>; cdp: Map<Page, CDPSession> } | null = null;

const hostCpu = () =>
  cpus().reduce(
    (sum, { times }) => ({ idle: sum.idle + times.idle, total: sum.total + times.user + times.nice + times.sys + times.idle + times.irq }),
    { idle: 0, total: 0 }
  );

async function rendererMetrics(cdp: CDPSession | undefined): Promise<Record<string, number> | null> {
  if (!cdp) return null;
  try {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  } catch {
    return null;
  }
}

async function measured(page: Page, run: (marks?: Array<[string, number]>) => ReturnType<typeof diagnose>): Promise<{ d: Awaited<ReturnType<typeof diagnose>>; diag?: TrialDiagnostics }> {
  if (!instrument) return { d: await run() };
  const begun = performance.now();
  const [visibility, focused] = await page.evaluate(() => [document.visibilityState, document.hasFocus()] as [string, boolean]);
  const pingBefore = performance.now() - begun;
  const r0 = await rendererMetrics(instrument.cdp.get(page));
  const h0 = hostCpu();
  const c0 = process.cpuUsage();
  const u0 = nodePerformance.eventLoopUtilization();
  const at = performance.now() - instrument.start;
  const pre = performance.now() - begun;
  const marks: Array<[string, number]> = [];
  instrument.loop.reset();
  const d = await run(marks);
  const after = performance.now();
  const ms = (ns: number) => (Number.isFinite(ns) ? Math.round(ns / 1e4) / 100 : 0);
  const loopDelay = { mean: ms(instrument.loop.mean), p99: ms(instrument.loop.percentile(99)), max: ms(instrument.loop.max) };
  const loopUtilization = Math.round(nodePerformance.eventLoopUtilization(u0).utilization * 1000) / 1000;
  const cpu = process.cpuUsage(c0);
  const h1 = hostCpu();
  const memory = process.memoryUsage();
  const r1 = await rendererMetrics(instrument.cdp.get(page));
  const pinged = performance.now();
  await page.evaluate(() => 0);
  const pingAfter = performance.now() - pinged;
  const delta = (name: string) => (r0 && r1 ? Math.round(((r1[name] ?? 0) - (r0[name] ?? 0)) * 10000) / 10 : 0);
  return {
    d,
    diag: {
      at: Math.round(at),
      marks,
      loopDelay,
      loopUtilization,
      processCpu: { user: Math.round(cpu.user / 100) / 10, system: Math.round(cpu.system / 100) / 10 },
      rssMb: Math.round(memory.rss / 1048576),
      heapMb: Math.round(memory.heapUsed / 1048576),
      hostBusy: h1.total > h0.total ? Math.round((1 - (h1.idle - h0.idle) / (h1.total - h0.total)) * 1000) / 1000 : 0,
      hostFreeMb: Math.round(freemem() / 1048576),
      renderer: r0 && r1 ? { task: delta("TaskDuration"), script: delta("ScriptDuration"), layout: delta("LayoutDuration"), style: delta("RecalcStyleDuration") } : null,
      pingBefore: Math.round(pingBefore * 10) / 10,
      pingAfter: Math.round(pingAfter * 10) / 10,
      visibility,
      focused,
      overheadMs: Math.round((pre + performance.now() - after) * 10) / 10
    }
  };
}

async function show(page: Page, lab: "state" | "rows", id: string, variant: string): Promise<void> {
  const api = lab === "state" ? "__stateLab" : "__rowsLab";
  const stage = lab === "state" ? "st-stage" : "rw-stage";
  // Campaign 2 harness fix: both labs share one window, and a headed background tab is throttled by Chromium (its
  // animations and screenshots stall), so the page under test is brought to the front before every trial.
  if (CAMPAIGN > 1) await page.bringToFront();
  await page.evaluate(([a, i, v]) => (window as unknown as Record<string, { show(i: string, v: string): Promise<unknown> }>)[a].show(i, v), [api, id, variant]);
  await page.waitForSelector(`#${stage}[data-shown="${id}:${variant}"]`);
}

const isState = (c: string) => c.startsWith("visual-state-");
const isRow = (c: string) => c.startsWith("rows-") || c.startsWith("row-association-");

async function runCell(cell: string): Promise<void> {
  const [mode, dprText] = cell.split("@");
  const dpr = Number(dprText);
  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  const trials: Trial[] = [];
  let status: "RAN" | "BLOCKED" = "RAN";
  let reason: string | undefined;
  try {
    for (let a = 0; a < 80 && !(await fetch(`${BASE}/visual-intelligence/state`).then((r) => r.ok, () => false)); a += 1) await new Promise((r) => setTimeout(r, 100));
    const stateTable = (await (await fetch(`${BASE}/visual-intelligence/state-fixtures.json`)).json()) as { fixtures: Array<{ id: string; truth: string; adversarial: boolean }>; qualificationVariants: string[] };
    const rowsTable = (await (await fetch(`${BASE}/visual-intelligence/rows-fixtures.json`)).json()) as {
      fixtures: Array<{ id: string; association: string; structure: string; coverage: string; adversarial: boolean; locator: string }>;
      qualificationVariants: string[];
    };
    let browser;
    try {
      browser = await chromium.launch({ headless: mode === "headless" });
    } catch (error) {
      status = "BLOCKED";
      reason = error instanceof Error ? error.message.split("\n")[0] : "launch failed";
    }
    if (browser) {
      try {
        const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr });
        const statePage = await context.newPage();
        await statePage.goto(`${BASE}/visual-intelligence/state`);
        await statePage.waitForSelector("body[data-fixtures]");
        const rowsPage = await context.newPage();
        await rowsPage.goto(`${BASE}/visual-intelligence/rows`);
        await rowsPage.waitForSelector("body[data-fixtures]");
        if (DIAGNOSTIC) {
          const cdp = new Map<Page, CDPSession>();
          for (const page of [statePage, rowsPage]) {
            const session = await context.newCDPSession(page);
            await session.send("Performance.enable");
            cdp.set(page, session);
          }
          const loop = monitorEventLoopDelay({ resolution: 10 });
          loop.enable();
          instrument = { start: performance.now(), loop, cdp };
        }
        const trial = async (page: Page, lab: Trial["lab"], f: { id: string; adversarial: boolean }, variant: string, locator: string, on: boolean, extra: Partial<Trial>, deadline: number) => {
          const { d, diag } = await measured(page, (marks) => diagnose(page, locator, on, marks));
          trials.push({ ...record(lab, f, variant, d, extra, deadline), ...(diag ? { diag } : {}) });
        };
        const record = (lab: Trial["lab"], f: { id: string; adversarial: boolean }, variant: string, d: Awaited<ReturnType<typeof diagnose>>, extra: Partial<Trial>, deadline: number): Trial => ({
          lab,
          fixture: f.id,
          variant,
          truth: "",
          adversarial: f.adversarial,
          codes: d.obs.filter((c) => isState(c) || isRow(c)),
          n5: d.obs.find((c) => !isState(c) && !isRow(c)) ?? "none",
          stateMs: d.stateMs,
          rowMs: d.rowMs,
          recordMs: Math.round(d.recordMs * 10) / 10,
          recordMsRaw: d.recordMs,
          overrunMs: d.recordMs > deadline ? Math.max(0.1, Math.round((d.recordMs - deadline) * 10) / 10) : 0,
          frames: d.frames,
          refused: ["protected-surface", "sensitive", "handoff-active"].includes(d.obs[0] ?? ""),
          cut: d.obs[0] === "budget-exhausted",
          ...extra
        });
        for (const variant of stateTable.qualificationVariants) {
          for (const f of stateTable.fixtures) {
            for (let r = 0; r < REPEATS; r += 1) {
              await show(statePage, "state", f.id, variant);
              await trial(statePage, "state", f, variant, "st-missing-target", true, { truth: f.truth }, DEADLINE);
            }
          }
          for (const f of rowsTable.fixtures) {
            for (let r = 0; r < REPEATS; r += 1) {
              await show(rowsPage, "rows", f.id, variant);
              await trial(rowsPage, "rows", f, variant, f.locator, true, { truth: f.association, coverage: f.coverage, structure: f.structure }, DEADLINE);
            }
          }
        }
        // Disabled-mode control: both features off.
        for (const id of ["spinner", "ready-table", "error-banner", "empty-text", "protected"]) {
          await show(statePage, "state", id, "b");
          await trial(statePage, "control", { id, adversarial: false }, "b", "st-missing-target", false, { truth: "off" }, OFF_DEADLINE);
        }
        for (const f of rowsTable.fixtures.filter((x) => ["table-uniform", "displaced", "virtualized", "no-rows", "multi-match"].includes(x.id))) {
          await show(rowsPage, "rows", f.id, "b");
          await trial(rowsPage, "control", { id: f.id, adversarial: false }, "b", f.locator, false, { truth: "off" }, OFF_DEADLINE);
        }
        instrument?.loop.disable();
        await context.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.kill();
  }
  let revision = "unknown";
  let treeClean: boolean | null = null;
  // Read-only; `safe.directory` for this one call only, because the checkout may sit on a host share (2026-11-01).
  const git = (...gitArgs: string[]) => execFileSync("git", ["-c", "safe.directory=*", ...gitArgs], { encoding: "utf8" }).trim();
  try {
    revision = git("rev-parse", "HEAD");
    // QC nit 2 (2026-11-01): whether tracked files differed from the revision when the cell ran.
    treeClean = git("status", "--porcelain", "--untracked-files=no") === "";
  } catch {
    // recorded as unknown
  }
  await mkdir(OUT, { recursive: true });
  const evidence = {
    benchmark: "benchmark:visual-joint",
    ...(DIAGNOSTIC ? { diagnostic: DIAGNOSTIC, qualification: false } : {}),
    cell,
    status,
    reason,
    date: new Date().toISOString(),
    revision,
    treeClean,
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      chromium: chromium.name(),
      ...(DIAGNOSTIC ? { hostProcessor: process.env.PROCESSOR_IDENTIFIER ?? null, logicalCpus: cpus().length, totalMemMb: Math.round(totalmem() / 1048576) } : {})
    },
    deadlineMs: DEADLINE,
    accounting: "strict: late = any overrun of the hard deadline; a cut trial counts at the full deadline in the work-time p95",
    trials
  };
  await writeFile(join(OUT, `N8N9-${cell}.json`), `${JSON.stringify(evidence, null, 1)}\n`, "utf8");
  report([evidence]);
}

function stateTrials(trials: Trial[]): StateTrial[] {
  return trials
    .filter((t) => t.lab === "state" && t.fixture !== "protected")
    .map((t) => {
      const code = t.codes.find(isState);
      return {
        fixture: t.fixture,
        truth: t.truth as StateTrial["truth"],
        adversarial: t.adversarial,
        decided: (code ? code.slice("visual-state-".length) : "none") as StateDecision,
        // QC 2026-11-01 F3: a trial whose state work did not run (cut, or skipped near the budget) counts at the full
        // deadline in the p95; it is never dropped.
        stateMs: t.cut || t.stateMs === null ? DEADLINE : t.stateMs,
        // F5: lateness on the unrounded duration when the evidence has it.
        late: (t.recordMsRaw ?? t.recordMs) > DEADLINE
      };
    });
}

function rowsTrials(trials: Trial[]): RowsTrial[] {
  return trials
    .filter((t) => t.lab === "rows" && t.fixture !== "protected")
    .map((t) => ({
      fixture: t.fixture,
      adversarial: t.adversarial,
      truthAssociation: t.truth as RowsTrial["truthAssociation"],
      truthStructure: (t.structure ?? "any") as RowsTrial["truthStructure"],
      truthCoverage: (t.coverage ?? "full") as RowsTrial["truthCoverage"],
      codes: t.codes.filter(isRow),
      rowMs: t.cut || t.rowMs === null ? DEADLINE : t.rowMs,
      late: (t.recordMsRaw ?? t.recordMs) > DEADLINE
    }));
}

function report(cells: Array<{ cell: string; status: string; trials: Trial[] }>): { allMet: boolean } {
  let allMet = true;
  const all: Trial[] = [];
  for (const c of cells) {
    console.log(`\n${c.cell}: ${c.status}, ${c.trials.length} trials`);
    if (c.status !== "RAN") {
      allMet = false;
      continue;
    }
    all.push(...c.trials);
    summarize(c.trials, (met) => (allMet &&= met));
  }
  if (cells.length > 1) {
    console.log("\npooled:");
    summarize(all, () => undefined);
  }
  return { allMet };
}

function summarize(trials: Trial[], onMet: (met: boolean) => void): void {
  const on = trials.filter((t) => t.lab !== "control");
  const control = trials.filter((t) => t.lab === "control");
  const durations = on.map((t) => t.recordMs);
  const overruns = on.filter((t) => t.overrunMs > 0);
  console.log(`  trials: state ${trials.filter((t) => t.lab === "state").length}, rows ${trials.filter((t) => t.lab === "rows").length}, control ${control.length}`);
  console.log(`  record duration: p50 ${pct(durations, 0.5)} ms, p95 ${pct(durations, 0.95)} ms, max ${Math.max(...durations)} ms (hard deadline ${DEADLINE} ms)`);
  console.log(`  overruns: ${overruns.length}${overruns.length ? ` (${overruns.map((t) => `${t.fixture}/${t.variant} +${t.overrunMs} ms`).join(", ")})` : ""}; cut: ${on.filter((t) => t.cut).length}`);
  const protectedTrials = on.filter((t) => t.fixture === "protected");
  console.log(`  protected: ${protectedTrials.length} trials, refused ${protectedTrials.filter((t) => t.refused).length}, frames ${protectedTrials.reduce((s, t) => s + t.frames, 0)}, codes ${protectedTrials.reduce((s, t) => s + t.codes.length, 0)}`);
  const controlOk = control.every((t) => t.codes.length === 0 && t.frames <= 1 && t.overrunMs === 0);
  console.log(`  disabled control: ${control.length} trials, ${controlOk ? "no N8/N9 code, at most one frame, none late" : "VIOLATION"}`);
  const st = stateTrials(trials);
  const confusion = new Map<string, number>();
  for (const t of st) confusion.set(`${t.truth}->${t.decided}`, (confusion.get(`${t.truth}->${t.decided}`) ?? 0) + 1);
  console.log(`  N9 decisions: ${[...confusion.entries()].sort().map(([k, n]) => `${k}:${n}`).join(" ")}`);
  const rt = rowsTrials(trials);
  const falseAssoc = rt.filter((t) => t.adversarial && t.codes.includes("row-association-consistent")).length;
  const missedAssoc = rt.filter((t) => t.truthAssociation === "consistent" && !t.codes.includes("row-association-consistent")).length;
  console.log(`  N8 association: false ${falseAssoc}, missed ${missedAssoc} of ${rt.filter((t) => t.truthAssociation === "consistent").length}`);
  const s = evaluateStateCriteria(st, N9_FROZEN_CRITERIA.criteria);
  const r = evaluateRowsCriteria(rt, N8_FROZEN_CRITERIA.criteria);
  for (const x of s) console.log(`  N9 ${x.id}${x.state ? ` ${x.state}` : ""}: ${x.met ? "MET" : "NOT MET"} — ${x.observed}`);
  for (const x of r) console.log(`  N8 ${x.id}${x.part ? ` ${x.part}` : ""}: ${x.met ? "MET" : "NOT MET"} — ${x.observed}`);
  const protectedOk = protectedTrials.every((t) => t.refused && t.frames === 0 && t.codes.length === 0);
  onMet(s.every((x) => x.met) && r.every((x) => x.met) && controlOk && protectedOk);
}

async function main(): Promise<void> {
  if (!N9_FROZEN_CRITERIA.frozen || !N8_FROZEN_CRITERIA.frozen) {
    console.error("benchmark:visual-joint refuses to run: the N8 or N9 criteria are not frozen.");
    process.exit(1);
  }
  if (AGGREGATE && DIAGNOSTIC !== undefined) {
    console.error("--diagnostic cannot be aggregated: it is never a qualification campaign");
    process.exit(1);
  }
  if (AGGREGATE) {
    const cells = [];
    for (const cell of CELLS) {
      try {
        cells.push(JSON.parse(await readFile(join(OUT, `N8N9-${cell}.json`), "utf8")));
      } catch {
        cells.push({ cell, status: "NOT RUN", trials: [] });
      }
    }
    const { allMet } = report(cells);
    const summary = { benchmark: "benchmark:visual-joint", date: new Date().toISOString(), cells: cells.map((c) => ({ cell: c.cell, status: c.status, revision: c.revision, trials: c.trials.length })), allCriteriaMet: allMet };
    await writeFile(join(OUT, "N8N9-joint-summary.json"), `${JSON.stringify(summary, null, 1)}\n`, "utf8");
    console.log(`\nJOINT QUALIFICATION: ${allMet ? "PASS (every frozen criterion met in every cell)" : "NOT MET"}`);
    return;
  }
  if (!CELL || !CELLS.includes(CELL)) {
    console.error(`--cell must be one of ${CELLS.join(", ")} (or --aggregate)`);
    process.exit(1);
  }
  // A diagnostic is never a campaign: its own id and one cell.
  if (DIAGNOSTIC !== undefined && (!/^[a-z0-9][a-z0-9-]*$/.test(DIAGNOSTIC) || args.includes("--campaign"))) {
    console.error("--diagnostic takes a lower-case id and cannot be combined with --campaign or --aggregate");
    process.exit(1);
  }
  // Recorded evidence is never overwritten (2026-11-01): a rerun needs a new campaign number or diagnostic id.
  if (await access(join(OUT, `N8N9-${CELL}.json`)).then(() => true, () => false)) {
    console.error(`${join(OUT, `N8N9-${CELL}.json`)} already exists; refusing to overwrite recorded evidence`);
    process.exit(1);
  }
  await runCell(CELL);
}

await main();
