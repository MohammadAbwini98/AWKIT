/**
 * benchmark:visual-rows — Phase N, N8 (awkit-vra.10). Measures row/grid evidence through the REAL N5 adapter
 * (`VisualFailureDiagnosis` with `rowEvidence`), the real N0 capture and Chromium, against the Visual Rows Lab
 * (`/visual-intelligence/rows`). Plan: docs/plans/ai-upgrade-v5/N8-row-grid-intelligence.md.
 *
 *   (default)        development variant `a`, headless DPR 1, 1.25 and 2; prints each fixture's codes and withheld
 *                    reasons so the policy can be frozen BEFORE qualification (plan § 5).
 *   --qualify        held-out variants `b`, `c` and `d` under MEASURED_VISUAL_ROWS_POLICY, evaluated against
 *                    N8_FROZEN_CRITERIA; refuses to run until frozen. `--only headless|headed` splits the cells.
 *   --tag <name>     suffixes the evidence file.
 *
 * Writes docs/plans/ai-upgrade-v5/evidence/N8-<mode>[-only][-tag].json: codes, counts and durations only.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { VisualFailureDiagnosis } from "@src/runner/visualDiagnosis/VisualFailureDiagnosis";
import { VISUAL_DIAGNOSIS_DEADLINE_MS } from "@src/runner/visualDiagnosis/visualDiagnosisContract";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { MEASURED_VISUAL_ROWS_POLICY, type VisualRowsVerdict } from "@src/visual";
import { N8_FROZEN_CRITERIA, evaluateRowsCriteria, p95, type RowsTrial } from "./lib/visual-rows-criteria.mts";

const args = process.argv.slice(2);
const MODE = args.includes("--qualify") ? "qualification" : "baseline";
const REPEATS = 2;
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const TAG = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : undefined;
const PORT = 4613;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence/rows`;
const DEADLINE = VISUAL_DIAGNOSIS_DEADLINE_MS;

interface FixtureRow {
  id: string;
  association: "consistent" | "inconclusive" | "none" | "refusal";
  structure: RowsTrial["truthStructure"] | "refusal";
  coverage: RowsTrial["truthCoverage"] | "refusal";
  adversarial: boolean;
  locator: string;
}
interface TrialRow extends RowsTrial {
  variant: string;
  cell: string;
  frames: number;
  failures: string[];
  recordMs: number;
  refused: boolean;
  /** The N5 part of the record (development printout only; codes, never page content). */
  n5: string[];
}

let seq = 0;

async function trial(page: Page, fixture: FixtureRow, variant: string, cell: string): Promise<TrialRow> {
  await page.evaluate(([id, v]) => (window as unknown as { __rowsLab: { show(i: string, x: string): Promise<unknown> } }).__rowsLab.show(id, v), [fixture.id, variant]);
  await page.waitForSelector(`#rw-stage[data-shown="${fixture.id}:${variant}"]`);
  const frames = { taken: 0 };
  let rows: { verdict: VisualRowsVerdict; ms: number } | undefined;
  const diagnosis = new VisualFailureDiagnosis({
    folder: join(process.cwd(), "build", "n8-benchmark-no-references"),
    handedOff: () => false,
    reader: { get: async () => ({ status: "missing" }) as never },
    rowEvidence: true,
    probe: {
      onFrame: (event) => {
        if (event === "taken") frames.taken += 1;
      },
      onRows: (event) => {
        rows = event;
      }
    }
  });
  const step = { id: "n8-rows", name: "Rows probe", type: "click", timeoutMs: 800, locator: { strategy: "testId", value: fixture.locator } } as unknown as FlowStep;
  const started = performance.now();
  const record = await diagnosis.diagnoseFinalFailure({
    step,
    attempt: 0,
    errorClass: "locator",
    executionId: `n8-bench-${(seq += 1)}`,
    scenarioId: "n8",
    flowId: "n8-flow",
    page: async () => page,
    limitScreenshot: (fn) => fn()
  });
  const waited = performance.now() - started;
  const codes = (record?.observations ?? []).filter((c) => c.startsWith("rows-") || c.startsWith("row-association-"));
  return {
    fixture: fixture.id,
    adversarial: fixture.adversarial,
    truthAssociation: fixture.association === "refusal" ? "none" : fixture.association,
    truthStructure: fixture.structure === "refusal" ? "any" : fixture.structure,
    truthCoverage: fixture.coverage === "refusal" ? "full" : fixture.coverage,
    codes,
    rowMs: rows ? rows.ms : null,
    late: waited > DEADLINE + 50,
    variant,
    cell,
    frames: frames.taken,
    failures: rows ? rows.verdict.failures : [],
    recordMs: Math.round(waited),
    refused: fixture.association === "refusal",
    n5: (record?.observations ?? []).filter((c) => !codes.includes(c))
  };
}

async function main(): Promise<void> {
  const qualify = MODE === "qualification";
  if (qualify && !N8_FROZEN_CRITERIA.frozen) {
    console.error("benchmark:visual-rows --qualify refuses to run: N8_FROZEN_CRITERIA is not frozen (plan § 5).");
    process.exit(1);
  }
  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  const all: TrialRow[] = [];
  const cellsOut: Array<{ cell: string; status: "RAN" | "BLOCKED"; reason?: string }> = [];
  try {
    for (let attempt = 0; attempt < 80 && !(await fetch(LAB).then((r) => r.ok, () => false)); attempt += 1) await new Promise((r) => setTimeout(r, 100));
    const table = (await (await fetch(`${BASE}/visual-intelligence/rows-fixtures.json`)).json()) as { fixtures: FixtureRow[]; developmentVariants: string[]; qualificationVariants: string[] };
    const variants = qualify ? table.qualificationVariants : table.developmentVariants;
    const modes = (qualify ? ["headless", "headed"] : ["headless"]).filter((m) => !ONLY || m === ONLY) as Array<"headless" | "headed">;
    for (const mode of modes) {
      for (const dpr of [1, 1.25, 2]) {
        const name = `${mode}@${dpr}`;
        let browser: Browser | undefined;
        try {
          browser = await chromium.launch({ headless: mode === "headless" });
        } catch (error) {
          cellsOut.push({ cell: name, status: "BLOCKED", reason: error instanceof Error ? error.message.split("\n")[0] : "launch failed" });
          console.log(`${name}: BLOCKED`);
          continue;
        }
        try {
          const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr });
          const page = await context.newPage();
          await page.goto(LAB);
          await page.waitForSelector("body[data-fixtures]");
          for (const variant of variants) for (const fixture of table.fixtures) for (let r = 0; r < REPEATS; r += 1) all.push(await trial(page, fixture, variant, name));
          await context.close();
          cellsOut.push({ cell: name, status: "RAN" });
          console.log(`${name}: ${all.filter((t) => t.cell === name).length} trials`);
        } finally {
          await browser.close();
        }
      }
    }
  } finally {
    server.kill();
  }

  const scored = all.filter((t) => !t.refused);
  const refused = all.filter((t) => t.refused);
  console.log(`\n${MODE}: ${all.length} trials (${scored.length} scored, ${refused.length} protected)`);
  const byFixture = new Map<string, TrialRow[]>();
  for (const t of all) byFixture.set(t.fixture, [...(byFixture.get(t.fixture) ?? []), t]);
  for (const [fixture, list] of byFixture) {
    const counts = new Map<string, number>();
    for (const t of list) {
      const key = t.codes.join("+") || "(none)";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const why = [...new Set(list.flatMap((t) => t.failures))].join(",");
    const n5 = qualify ? "" : `  {n5: ${list[0].n5.join(",")}}`;
    console.log(`  ${fixture.padEnd(17)} ${[...counts.entries()].map(([k, n]) => `${k}:${n}`).join("  ")}${why ? `  [withheld: ${why}]` : ""}${n5}`);
  }
  const protectedOk = refused.every((t) => t.frames === 0 && t.codes.length === 0);
  console.log(`\nprotected: ${refused.length} trials, ${protectedOk ? "zero frames and no row code in every trial" : "VIOLATION"}`);
  const times = scored.map((t) => t.rowMs).filter((v): v is number => v !== null);
  console.log(`row work: p95 ${p95(times)} ms, max ${Math.max(...times)} ms; whole diagnosis p95 ${p95(scored.map((t) => t.recordMs))} ms (deadline ${DEADLINE} ms)`);

  const evidence: Record<string, unknown> = {
    benchmark: "benchmark:visual-rows",
    mode: MODE,
    date: new Date().toISOString(),
    policy: MEASURED_VISUAL_ROWS_POLICY,
    deadlineMs: DEADLINE,
    repeats: REPEATS,
    cells: cellsOut,
    protected: { trials: refused.length, zeroFramesNoCode: protectedOk },
    trials: all.map(({ fixture, variant, cell, codes, failures, rowMs, recordMs, frames }) => ({ fixture, variant, cell, codes, failures, rowMs, recordMs, frames }))
  };
  const show = (rs: ReturnType<typeof evaluateRowsCriteria>) => rs.forEach((r) => console.log(`  ${r.id}${r.part ? ` ${r.part}` : ""}: ${r.met ? "MET" : "NOT MET"} — ${r.observed}`));
  const criteria = N8_FROZEN_CRITERIA.frozen ? N8_FROZEN_CRITERIA.criteria : null;
  if (criteria) {
    const perCell = cellsOut.filter((c) => c.status === "RAN").map((c) => ({ cell: c.cell, criteria: evaluateRowsCriteria(scored.filter((t) => t.cell === c.cell), criteria) }));
    for (const c of perCell) {
      console.log(`\n${c.cell}:`);
      show(c.criteria);
    }
    const pooled = evaluateRowsCriteria(scored, criteria);
    console.log("\npooled:");
    show(pooled);
    evidence.criteria = N8_FROZEN_CRITERIA;
    evidence.results = { perCell, pooled };
  }
  const out = join(process.cwd(), "docs", "plans", "ai-upgrade-v5", "evidence", `N8-${MODE}${ONLY ? `-${ONLY}` : ""}${TAG ? `-${TAG}` : ""}.json`);
  await mkdir(join(process.cwd(), "docs", "plans", "ai-upgrade-v5", "evidence"), { recursive: true });
  await writeFile(out, `${JSON.stringify(evidence, null, 1)}\n`, "utf8");
  console.log(`\nevidence: ${out}`);
}

await main();
