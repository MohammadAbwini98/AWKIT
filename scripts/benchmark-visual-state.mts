/**
 * benchmark:visual-state — Phase N, N9 (awkit-vra.11). Measures screenshot state recognition through the REAL N5
 * adapter (`VisualFailureDiagnosis` with `stateRecognition`), the real N0 capture and the real Chromium renderer, against
 * the Visual State Lab (`/visual-intelligence/state`). Plan: docs/plans/ai-upgrade-v5/N9-screenshot-state-recognition.md.
 *
 *   --baseline (default)  development variant `a` only, headless DPR 1, 1.25 and 2; prints every fixture's integer
 *                         features and decision so the policy can be set BEFORE qualification (plan § 6).
 *   --qualify             held-out variants `b`, `c` and `d` in every cell (headless and headed x DPR 1, 1.25, 2) under
 *                         the production MEASURED_VISUAL_STATE_POLICY, evaluated against N9_FROZEN_CRITERIA. Refuses to
 *                         run until the criteria are frozen. A cell that cannot launch is BLOCKED, never passing.
 *   --repeats N           trials per fixture, variant and cell (default 2).
 *
 * Writes docs/plans/ai-upgrade-v5/evidence/N9-<mode>.json (counts, codes and integer features only: no pixels, text,
 * selectors or URLs). Informational: the exit code is 0 when the campaign ran, whatever the criteria say.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { VisualFailureDiagnosis } from "@src/runner/visualDiagnosis/VisualFailureDiagnosis";
import { VISUAL_DIAGNOSIS_DEADLINE_MS, VISUAL_STATE_EXTRA_MS } from "@src/runner/visualDiagnosis/visualDiagnosisContract";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { MEASURED_VISUAL_STATE_POLICY, type VisualMotion, type VisualStateFrameFeatures, type VisualStateVerdict } from "@src/visual";
import { N9_FROZEN_CRITERIA, evaluateStateCriteria, p95, type StateDecision, type StateTrial, type StateTruth } from "./lib/visual-state-criteria.mts";

const args = process.argv.slice(2);
const MODE = args.includes("--qualify") ? "qualification" : "baseline";
const REPEATS = Math.max(1, Number(args[args.indexOf("--repeats") + 1]) || 2);
/** `--only headless|headed` runs one render mode (the evidence file is suffixed), so a campaign fits a bounded run. */
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
/** `--tag c2` keeps a later campaign's evidence beside the earlier one instead of overwriting it. */
const TAG = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : undefined;
const PORT = 4611;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence/state`;
const DEADLINE = VISUAL_DIAGNOSIS_DEADLINE_MS + VISUAL_STATE_EXTRA_MS;

interface FixtureRow {
  id: string;
  truth: StateTruth | "refusal";
  adversarial: boolean;
}
interface Cell {
  mode: "headless" | "headed";
  dpr: number;
}
interface TrialRow extends StateTrial {
  variant: string;
  cell: string;
  frames: number;
  features?: VisualStateFrameFeatures;
  motion?: VisualMotion | null;
  cue?: VisualStateVerdict["cue"];
  recordMs: number;
}

const step = (): FlowStep =>
  ({ id: "n9-state", name: "State probe", type: "click", timeoutMs: 800, locator: { strategy: "testId", value: "st-missing-target" } }) as unknown as FlowStep;

let seq = 0;

async function trial(page: Page, fixture: FixtureRow, variant: string, cell: string): Promise<TrialRow> {
  await page.evaluate(([id, v]) => (window as unknown as { __stateLab: { show(i: string, x: string): Promise<unknown> } }).__stateLab.show(id, v), [fixture.id, variant]);
  await page.waitForSelector(`#st-stage[data-shown="${fixture.id}:${variant}"]`);
  const frames = { taken: 0 };
  let state: { features: VisualStateFrameFeatures; motion: VisualMotion | null; verdict: VisualStateVerdict; ms: number } | undefined;
  const diagnosis = new VisualFailureDiagnosis({
    folder: join(process.cwd(), "build", "n9-benchmark-no-references"),
    handedOff: () => false,
    reader: { get: async () => ({ status: "missing" }) as never },
    stateRecognition: true,
    deadlineMs: DEADLINE,
    probe: {
      onFrame: (event) => {
        if (event === "taken") frames.taken += 1;
      },
      onState: (event) => {
        state = event;
      }
    }
  });
  const started = performance.now();
  const record = await diagnosis.diagnoseFinalFailure({
    step: step(),
    attempt: 0,
    errorClass: "locator",
    executionId: `n9-bench-${(seq += 1)}`,
    scenarioId: "n9",
    flowId: "n9-flow",
    page: async () => page,
    limitScreenshot: (fn) => fn()
  });
  const waited = performance.now() - started;
  const code = record?.observations.find((c) => c.startsWith("visual-state-"));
  const decided: StateDecision = code ? (code.slice("visual-state-".length) as StateDecision) : "none";
  return {
    fixture: fixture.id,
    truth: fixture.truth === "refusal" ? "unknown" : fixture.truth,
    adversarial: fixture.adversarial,
    decided,
    stateMs: state ? state.ms : null,
    late: waited > DEADLINE + 50,
    variant,
    cell,
    frames: frames.taken,
    ...(state ? { features: state.features, motion: state.motion, cue: state.verdict.cue } : {}),
    recordMs: Math.round(waited)
  };
}

async function main(): Promise<void> {
  const qualify = MODE === "qualification";
  if (qualify && !N9_FROZEN_CRITERIA.frozen) {
    console.error("benchmark:visual-state --qualify refuses to run: N9_FROZEN_CRITERIA is not frozen (plan § 6).");
    process.exit(1);
  }
  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  const rows: TrialRow[] = [];
  const cellsOut: Array<{ cell: string; status: "RAN" | "BLOCKED"; reason?: string }> = [];
  try {
    for (let attempt = 0; attempt < 80 && !(await fetch(LAB).then((r) => r.ok, () => false)); attempt += 1) await new Promise((r) => setTimeout(r, 100));
    const table = (await (await fetch(`${BASE}/visual-intelligence/state-fixtures.json`)).json()) as { fixtures: FixtureRow[]; developmentVariants: string[]; qualificationVariants: string[] };
    const variants = qualify ? table.qualificationVariants : table.developmentVariants;
    const cells: Cell[] = (qualify ? (["headless", "headed"] as const) : (["headless"] as const))
      .filter((mode) => !ONLY || mode === ONLY)
      .flatMap((mode) => [1, 1.25, 2].map((dpr) => ({ mode, dpr })));
    for (const cell of cells) {
      const name = `${cell.mode}@${cell.dpr}`;
      let browser: Browser | undefined;
      try {
        browser = await chromium.launch({ headless: cell.mode === "headless" });
      } catch (error) {
        cellsOut.push({ cell: name, status: "BLOCKED", reason: error instanceof Error ? error.message.split("\n")[0] : "launch failed" });
        console.log(`${name}: BLOCKED (browser launch failed)`);
        continue;
      }
      try {
        const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: cell.dpr });
        const page = await context.newPage();
        await page.goto(LAB);
        await page.waitForSelector("body[data-fixtures]");
        for (const variant of variants) {
          for (const fixture of table.fixtures) {
            for (let r = 0; r < REPEATS; r += 1) rows.push(await trial(page, fixture, variant, name));
          }
        }
        await context.close();
        cellsOut.push({ cell: name, status: "RAN" });
        console.log(`${name}: ${rows.filter((t) => t.cell === name).length} trials`);
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.kill();
  }

  // Report.
  const scored = rows.filter((t) => t.fixture !== "protected");
  const refusal = rows.filter((t) => t.fixture === "protected");
  console.log(`\n${MODE}: ${rows.length} trials (${scored.length} scored, ${refusal.length} protected)`);
  const byFixture = new Map<string, TrialRow[]>();
  for (const t of rows) byFixture.set(t.fixture, [...(byFixture.get(t.fixture) ?? []), t]);
  for (const [fixture, list] of byFixture) {
    const counts = new Map<string, number>();
    for (const t of list) counts.set(t.decided, (counts.get(t.decided) ?? 0) + 1);
    const decisions = [...counts.entries()].map(([k, n]) => `${k}:${n}`).join(" ");
    const f = list.find((t) => t.features)?.features;
    const motions = list.map((t) => (t.motion && t.motion.measured ? `${t.motion.cells}/${t.motion.sharePermille}` : t.motion ? "unmeasured" : "-")).join(",");
    console.log(
      `  ${fixture.padEnd(24)} truth=${list[0].truth.padEnd(8)} ${decisions.padEnd(30)}` +
        (f && !qualify
          ? ` lines=${f.contentLines} text=${f.textCells}+${f.chromeTextCells} skel=${f.skeletonCells} redT=${f.redTextCells} redF=${f.redFillCells} redInk=${f.redStrokeOfInk} ink=${f.inkPermille} soft=${f.softPermille} motion=${motions}`
          : "")
    );
  }
  const protectedOk = refusal.every((t) => t.frames === 0 && t.decided === "none");
  console.log(`\nprotected: ${refusal.length} trials, ${protectedOk ? "zero frames and no state code in every trial" : "VIOLATION"}`);
  const times = scored.map((t) => t.stateMs).filter((v): v is number => v !== null);
  console.log(`state work: p95 ${p95(times)} ms, max ${Math.max(...times)} ms; whole diagnosis p95 ${p95(scored.map((t) => t.recordMs))} ms (deadline ${DEADLINE} ms)`);

  const evidence: Record<string, unknown> = {
    benchmark: "benchmark:visual-state",
    mode: MODE,
    date: new Date().toISOString(),
    policy: MEASURED_VISUAL_STATE_POLICY,
    deadlineMs: DEADLINE,
    repeats: REPEATS,
    cells: cellsOut,
    protected: { trials: refusal.length, zeroFramesNoCode: protectedOk },
    trials: rows.map(({ fixture, variant, cell, truth, decided, cue, stateMs, recordMs, frames, features, motion }) => ({
      fixture, variant, cell, truth, decided, cue, stateMs, recordMs, frames,
      ...(qualify ? {} : { features, motion })
    }))
  };
  if (qualify) {
    const results = [];
    for (const cell of cellsOut.filter((c) => c.status === "RAN")) {
      const inCell = scored.filter((t) => t.cell === cell.cell);
      const evaluated = evaluateStateCriteria(inCell, N9_FROZEN_CRITERIA.criteria);
      results.push({ cell: cell.cell, criteria: evaluated });
      console.log(`\n${cell.cell}:`);
      for (const r of evaluated) console.log(`  ${r.id}${r.state ? ` ${r.state}` : ""}: ${r.met ? "MET" : "NOT MET"} — ${r.observed}`);
    }
    const pooled = evaluateStateCriteria(scored, N9_FROZEN_CRITERIA.criteria);
    console.log("\npooled:");
    for (const r of pooled) console.log(`  ${r.id}${r.state ? ` ${r.state}` : ""}: ${r.met ? "MET" : "NOT MET"} — ${r.observed}`);
    evidence.criteria = N9_FROZEN_CRITERIA;
    evidence.results = { perCell: results, pooled };
  }
  const out = join(process.cwd(), "docs", "plans", "ai-upgrade-v5", "evidence", `N9-${MODE}${ONLY ? `-${ONLY}` : ""}${TAG ? `-${TAG}` : ""}.json`);
  await mkdir(join(process.cwd(), "docs", "plans", "ai-upgrade-v5", "evidence"), { recursive: true });
  await writeFile(out, `${JSON.stringify(evidence, null, 1)}\n`, "utf8");
  console.log(`\nevidence: ${out}`);
}

await main();
