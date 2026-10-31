/**
 * benchmark:visual-coverage — QC F2 (2026-11-01): how often the N5 diagnosis itself is cut (`budget-exhausted`) at a
 * realistic 1920 x 1080 viewport, DPR 1 and 1.5, with N8 + N9 off (N5 alone, deadline VISUAL_DIAGNOSIS_DEADLINE_MS) and
 * on (deadline + VISUAL_STATE_EXTRA_MS), through the real adapter, the real N0 capture and Chromium. A measurement for
 * the owner's decision (accept the limit, or move whole-frame pixel work into a worker); it judges no criterion.
 *
 *   --mode headless | headed   (default headless)
 *
 * Evidence: docs/plans/ai-upgrade-v5/evidence/n5-coverage/N5-coverage-<mode>.json. Codes, counts and durations only.
 */

import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { VisualFailureDiagnosis } from "@src/runner/visualDiagnosis/VisualFailureDiagnosis";
import { VISUAL_DIAGNOSIS_DEADLINE_MS, VISUAL_STATE_EXTRA_MS } from "@src/runner/visualDiagnosis/visualDiagnosisContract";
import type { FlowStep } from "@src/profiles/FlowProfile";

const args = process.argv.slice(2);
const MODE = args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "headless";
const PORT = 4617;
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1920, height: 1080 };
const DPRS = [1, 1.5];
const REPEATS = 8;
/** Not `coverage/`: that name is ignored repository-wide. */
const OUT = join(process.cwd(), "docs", "plans", "ai-upgrade-v5", "evidence", "n5-coverage");
/** Fixtures from both labs: a present target, several matches, no rows, and three page states with a missing target. */
const CASES: Array<{ lab: "rows" | "state"; id: string; locator: string }> = [
  { lab: "rows", id: "table-uniform", locator: "rw-target" },
  { lab: "rows", id: "multi-match", locator: "rw-action" },
  { lab: "rows", id: "no-rows", locator: "rw-target" },
  { lab: "state", id: "ready-table", locator: "st-missing-target" },
  { lab: "state", id: "spinner", locator: "st-missing-target" },
  { lab: "state", id: "error-banner", locator: "st-missing-target" }
];

interface Trial {
  dpr: number;
  features: "off" | "on";
  fixture: string;
  first: string;
  cut: boolean;
  recordMs: number;
  overrunMs: number;
}

let seq = 0;

async function diagnose(page: Page, locator: string, on: boolean) {
  const diagnosis = new VisualFailureDiagnosis({
    folder: join(process.cwd(), "build", "coverage-no-references"),
    handedOff: () => false,
    reader: { get: async () => ({ status: "missing" }) as never },
    ...(on ? { rowEvidence: true, stateRecognition: true, deadlineMs: VISUAL_DIAGNOSIS_DEADLINE_MS + VISUAL_STATE_EXTRA_MS } : {})
  });
  const step = { id: "coverage", name: "Coverage", type: "click", timeoutMs: 800, locator: { strategy: "testId", value: locator } } as unknown as FlowStep;
  const started = performance.now();
  const record = await diagnosis.diagnoseFinalFailure({
    step,
    attempt: 0,
    errorClass: "locator",
    executionId: `coverage-${(seq += 1)}`,
    scenarioId: "coverage",
    flowId: "coverage-flow",
    page: async () => page,
    limitScreenshot: (fn) => fn()
  });
  return { first: record?.observations[0] ?? "none", ms: performance.now() - started };
}

const pct = (values: number[], q: number): number => {
  const s = [...values].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * q) - 1))] * 10) / 10;
};

async function main(): Promise<void> {
  if (MODE !== "headless" && MODE !== "headed") {
    console.error("--mode must be headless or headed");
    process.exit(1);
  }
  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  const trials: Trial[] = [];
  try {
    for (let a = 0; a < 80 && !(await fetch(`${BASE}/visual-intelligence/state`).then((r) => r.ok, () => false)); a += 1) await new Promise((r) => setTimeout(r, 100));
    const browser = await chromium.launch({ headless: MODE === "headless" });
    try {
      for (const dpr of DPRS) {
        const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: dpr });
        const page = await context.newPage();
        for (const lab of ["rows", "state"] as const) {
          await page.goto(`${BASE}/visual-intelligence/${lab}`);
          await page.waitForSelector("body[data-fixtures]");
          const api = lab === "state" ? "__stateLab" : "__rowsLab";
          const stage = lab === "state" ? "st-stage" : "rw-stage";
          for (const c of CASES.filter((x) => x.lab === lab)) {
            for (const features of ["off", "on"] as const) {
              const deadline = VISUAL_DIAGNOSIS_DEADLINE_MS + (features === "on" ? VISUAL_STATE_EXTRA_MS : 0);
              for (let r = 0; r < REPEATS; r += 1) {
                await page.evaluate(([a, i]) => (window as unknown as Record<string, { show(i: string, v: string): Promise<unknown> }>)[a].show(i, "b"), [api, c.id]);
                await page.waitForSelector(`#${stage}[data-shown="${c.id}:b"]`);
                const d = await diagnose(page, c.locator, features === "on");
                trials.push({
                  dpr,
                  features,
                  fixture: c.id,
                  first: d.first,
                  cut: d.first === "budget-exhausted",
                  recordMs: Math.round(d.ms * 10) / 10,
                  overrunMs: d.ms > deadline ? Math.round((d.ms - deadline) * 10) / 10 : 0
                });
              }
            }
          }
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
  const cells = DPRS.flatMap((dpr) =>
    (["off", "on"] as const).map((features) => {
      const t = trials.filter((x) => x.dpr === dpr && x.features === features);
      const cut = t.filter((x) => x.cut).length;
      const firsts: Record<string, number> = {};
      for (const x of t) firsts[x.first] = (firsts[x.first] ?? 0) + 1;
      return {
        dpr,
        features,
        trials: t.length,
        budgetExhausted: cut,
        budgetExhaustedPermille: t.length ? Math.round((cut / t.length) * 1000) : null,
        firstObservation: firsts,
        recordMs: { p50: pct(t.map((x) => x.recordMs), 0.5), p95: pct(t.map((x) => x.recordMs), 0.95), max: Math.max(...t.map((x) => x.recordMs)) },
        overruns: t.filter((x) => x.overrunMs > 0).map((x) => x.overrunMs)
      };
    })
  );
  for (const c of cells) {
    console.log(
      `${MODE} 1920x1080@${c.dpr} features ${c.features}: ${c.budgetExhausted}/${c.trials} budget-exhausted (${c.budgetExhaustedPermille}‰), record p50 ${c.recordMs.p50} p95 ${c.recordMs.p95} max ${c.recordMs.max} ms, overruns ${c.overruns.length}; first ${JSON.stringify(c.firstObservation)}`
    );
  }
  let revision = "unknown";
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // recorded as unknown
  }
  await mkdir(OUT, { recursive: true });
  const evidence = {
    benchmark: "benchmark:visual-coverage",
    mode: MODE,
    date: new Date().toISOString(),
    revision,
    environment: { platform: process.platform, arch: process.arch, node: process.version, chromium: chromium.name() },
    viewport: VIEWPORT,
    deadlinesMs: { off: VISUAL_DIAGNOSIS_DEADLINE_MS, on: VISUAL_DIAGNOSIS_DEADLINE_MS + VISUAL_STATE_EXTRA_MS },
    cells,
    trials
  };
  await writeFile(join(OUT, `N5-coverage-${MODE}.json`), `${JSON.stringify(evidence, null, 1)}\n`, "utf8");
}

await main();
