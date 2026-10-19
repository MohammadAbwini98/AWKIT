/**
 * benchmark:visual-diagnosis — Phase N, N5.6 (awkit-vra.14.6): the Visual Failure Diagnosis calibration. INFORMATIONAL,
 * never a release gate. Plan: docs/plans/ai-upgrade-v5/N5-visual-failure-diagnosis.md › VD-10.
 *
 * Method. Per cell, a FRESH reference launch captures the step's reference (N0 `captureElement`, as N2/N4 store it) on the
 * fusion lab's baseline, and a separate FRESH diagnosis launch replays the failing step through the REAL `FlowExecutor`
 * retry loop over a REAL `StepExecutor` with the REAL N5.3 adapter at its production 1000 ms deadline. Cells: headed and
 * headless at DPR 1, 1.25 and 2, plus a headed reference replayed headless at each DPR. Nothing is retried, nothing is
 * scrolled, and no image is written anywhere.
 *
 * Fixture truth (fixed before the run; `allowedTarget` / `allowedGroup` say whether an identity code is TRUE there):
 *   identity scenarios — single locator `vf-tool-0` and group locator `[data-testid^="vf-tool-"]` (4 matches):
 *     baseline, drift          target unchanged          single: target identity allowed   group: allowed (tool-0)
 *     restyle-selected/-pressed target changed           single: not allowed               group: not allowed
 *     swap                     target carries neighbour  single: not allowed               group: allowed (neighbour)
 *     twins                    every button the target's single: allowed                   group: allowed
 *     theme-dark/-contrast     page-wide restyle         single: not allowed               group: not allowed
 *   geometry — detach (target-not-in-dom), overlay (target-occluded, never offscreen), zero (target-zero-size, never
 *     offscreen), offscreen (target-offscreen), blank (target-not-in-dom + viewport-uniform), baseline (never uniform);
 *   scope — many with the reference past the cap (truncated, never counted), many with it inside (truncated),
 *     omitted contender (reference tool-1, step tool-0: no identity code);
 *   refusals — injected one-time-code surface, handed-off page, a masked field: refused with zero frames;
 *   passing — a passing click is never diagnosed.
 *
 * VD-10 criterion per code (fixed here before the run):
 *   target-identical-to-reference / other-examined-identical: zero reports where the fixture says they are false;
 *   target-differs-from-reference / no-examined-identical / equal-proven: never reported (v1 references are unproven);
 *   target-not-in-dom / -occluded / -zero-size / -offscreen / viewport-uniform: present exactly where the fixture says,
 *     never where it says not, in every cell (a deadline-cut diagnosis is counted separately, not as a wrong code);
 *   truncation and omitted contender: as above; refusals: zero frames; uniqueness: no record key beyond the allowlist;
 *   cost: p95 of diagnoses that took a frame within the 1000 ms deadline; passing runs: zero diagnoser calls.
 * A failing code is pruned to `inconclusive` before N5.5 shows it.
 *
 * Run: npm run benchmark:visual-diagnosis   (writes docs/plans/ai-upgrade-v5/evidence/N5.6-visual-diagnosis-calibration.json)
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { VisualFailureDiagnosis } from "@src/runner/visualDiagnosis/VisualFailureDiagnosis";
import { VISUAL_DIAGNOSIS_DEADLINE_MS, type VisualDiagnosisRecord, type VisualFailureDiagnoser } from "@src/runner/visualDiagnosis/visualDiagnosisContract";
import { VISUAL_DIAGNOSIS_RECORD_KEYS } from "@src/runner/visualDiagnosis/visualDiagnosisRecord";
import { buildVisualEvidence, captureElement, type VisualEvidence } from "@src/visual";

const PORT = 4598;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence/fusion`;
const SCENARIO_ID = "n5-6";
const FLOW_ID = "calibration-flow";
const DPRS = [1, 1.25, 2] as const;
const EVIDENCE_PATH = join(process.cwd(), "docs", "plans", "ai-upgrade-v5", "evidence", "N5.6-visual-diagnosis-calibration.json");
const ALLOWED_KEYS = new Set<string>(VISUAL_DIAGNOSIS_RECORD_KEYS);

type Mode = "headed" | "headless";
interface Cell {
  name: string;
  referenceMode: Mode;
  replayMode: Mode;
  dpr: number;
}
interface CaseResult {
  cell: string;
  name: string;
  family: "identity" | "geometry" | "scope" | "refusal" | "passing";
  record?: VisualDiagnosisRecord;
  frames: number;
  calls: number;
  ms?: number;
  cut: boolean;
  problems: string[];
  /** Identity recall (informational): an identity code the fixture says is true, reported. */
  recalled?: boolean;
}

let executionSeq = 0;
const fileFor = (folder: string, key: string) => join(folder, `${createHash("sha256").update(key).digest("hex")}.json`);
const runtimeKey = (stepId: string) => `${SCENARIO_ID}\u0000${FLOW_ID}\u0000${stepId}`;

async function seed(folder: string, stepId: string, evidence: VisualEvidence): Promise<void> {
  const record = { version: 1, scopeKey: runtimeKey(stepId), evidenceVersion: 1, contentDigest: evidence.fingerprint.contentDigest, evidence, updatedAt: "2026-10-19T00:00:00.000Z" };
  await writeFile(fileFor(folder, runtimeKey(stepId)), JSON.stringify(record), "utf8");
}

async function openLab(context: BrowserContext, failure = "none", state: Record<string, unknown> = {}): Promise<Page> {
  const page = await context.newPage();
  await page.goto(LAB);
  await page.getByTestId("vf-tool-0").waitFor();
  await page.evaluate(
    ({ s, f }) => {
      const lab = (window as unknown as { __fusionLab: { setState(x: unknown): void; setFailure(k: string): void } }).__fusionLab;
      lab.setState({ scenario: "baseline", target: 0, style: "a", wide: false, ...s });
      lab.setFailure(f);
    },
    { s: state, f: failure }
  );
  // Double rAF after a state change, as N3.2 / N4.5 did; no other wait.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return page;
}

function contextFor(executionId: string, root: string): InstanceExecutionContext {
  return {
    executionId,
    instanceId: "inst-1",
    scenarioId: SCENARIO_ID,
    flowId: FLOW_ID,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: root, screenshots: join(root, "evidence"), logs: root, reports: root }
  };
}

/** One failing (or passing) step through the real retry loop and adapter. */
async function diagnose(page: Page, folder: string, root: string, step: FlowStep, handedOff = false): Promise<{ record?: VisualDiagnosisRecord; frames: number; calls: number }> {
  const executionId = `exec-${(executionSeq += 1)}`;
  const context = contextFor(executionId, root);
  const records: VisualDiagnosisRecord[] = [];
  let frames = 0;
  let calls = 0;
  const adapter = new VisualFailureDiagnosis({
    folder,
    handedOff: () => handedOff,
    onRecord: (record) => records.push(record),
    probe: { onFrame: (event) => (event === "taken" ? (frames += 1) : undefined) }
  });
  const spy: VisualFailureDiagnoser = {
    diagnoseFinalFailure: (request) => {
      calls += 1;
      return adapter.diagnoseFinalFailure(request);
    }
  };
  const stepExecutor = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(context), context);
  const flowExecutor = new FlowExecutor(stepExecutor, undefined, undefined, undefined, false, spy);
  await (flowExecutor as unknown as { executeWithRetry(s: FlowStep, c: InstanceExecutionContext): Promise<unknown> }).executeWithRetry(step, context);
  return { record: records[0], frames, calls };
}

const fill = (id: string, locator: Record<string, unknown>): FlowStep => ({ id, name: id, type: "fill", value: "x", timeoutMs: 800, locator }) as unknown as FlowStep;
const click = (id: string, locator: Record<string, unknown>, extra: Record<string, unknown> = {}): FlowStep => ({ id, name: id, type: "click", timeoutMs: 800, locator, ...extra }) as unknown as FlowStep;
const TOOL0 = { strategy: "testId", value: "vf-tool-0" };
const GROUP = { strategy: "css", value: '[data-testid^="vf-tool-"]' };
const has = (record: VisualDiagnosisRecord | undefined, code: string) => !!record?.observations.includes(code);

const IDENTITY: Array<{ scenario: string; single: boolean; group: boolean }> = [
  { scenario: "baseline", single: true, group: true },
  { scenario: "drift", single: true, group: true },
  { scenario: "restyle-selected", single: false, group: false },
  { scenario: "restyle-pressed", single: false, group: false },
  { scenario: "swap", single: false, group: true },
  { scenario: "twins", single: true, group: true },
  { scenario: "theme-dark", single: false, group: false },
  { scenario: "theme-contrast", single: false, group: false }
];

async function runCell(cell: Cell, root: string): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  const folder = join(root, cell.name.replace(/[^a-z0-9]+/gi, "-"));
  await mkdir(folder, { recursive: true });
  const options = { viewport: { width: 800, height: 600 }, deviceScaleFactor: cell.dpr };

  // Fresh reference launch.
  const refBrowser: Browser = await chromium.launch({ headless: cell.referenceMode === "headless" });
  const ids: Record<string, string> = {};
  try {
    const context = await refBrowser.newContext(options);
    const base = await openLab(context);
    for (const { scenario } of IDENTITY) {
      ids[`single-${scenario}`] = `s-${scenario}`;
      ids[`group-${scenario}`] = `g-${scenario}`;
      const evidence = await captureOrThrow(base, base.getByTestId("vf-tool-0"));
      await seed(folder, ids[`single-${scenario}`], evidence);
      await seed(folder, ids[`group-${scenario}`], evidence);
    }
    await seed(folder, "omitted", await captureOrThrow(base, base.getByTestId("vf-tool-1")));
    await seed(folder, "geo-blank-ref", await captureOrThrow(base, base.getByTestId("vf-tool-0")));
    const many = await openLab(context, "many");
    await seed(folder, "cap-past", await captureOrThrow(many, many.getByTestId("vf-many-tool").nth(36)));
    await seed(folder, "cap-inside", await captureOrThrow(many, many.getByTestId("vf-many-tool").nth(5)));
    await context.close();
  } finally {
    await refBrowser.close();
  }

  // Fresh diagnosis launch.
  const browser: Browser = await chromium.launch({ headless: cell.replayMode === "headless" });
  try {
    const context = await browser.newContext(options);
    const record = (name: string, family: CaseResult["family"], out: { record?: VisualDiagnosisRecord; frames: number; calls: number }, problems: string[], recalled?: boolean) => {
      const cut = has(out.record, "budget-exhausted");
      const keys = out.record ? Object.keys(out.record).filter((key) => !ALLOWED_KEYS.has(key)) : [];
      if (keys.length) problems.push(`keys ${keys.join(",")}`);
      if (has(out.record, "target-differs-from-reference") || has(out.record, "no-examined-identical")) problems.push("a difference or absence under unproven");
      if (out.record?.conditions === "equal-proven") problems.push("equal-proven");
      results.push({ cell: cell.name, name, family, record: out.record, frames: out.frames, calls: out.calls, ms: out.record?.ms, cut, problems: cut ? [] : problems, recalled });
    };

    for (const { scenario, single, group } of IDENTITY) {
      for (const [kind, locator, allowed] of [
        ["single", TOOL0, single],
        ["group", GROUP, group]
      ] as const) {
        const page = await openLab(context, "none", { scenario });
        const out = await diagnose(page, folder, root, fill(ids[`${kind}-${scenario}`], locator));
        const code = kind === "single" ? "target-identical-to-reference" : "other-examined-identical";
        const problems: string[] = [];
        if (has(out.record, code) && !allowed) problems.push(`false ${code}`);
        if (kind === "single" && has(out.record, "other-examined-identical")) problems.push("other-examined-identical on a single match");
        record(`identity ${scenario} ${kind}`, "identity", out, problems, allowed ? has(out.record, code) : undefined);
        await page.close();
      }
    }

    const geometry: Array<[string, string, FlowStep, string[], string[]]> = [
      ["detach", "detach", click("geo-detach", TOOL0), ["target-not-in-dom"], ["target-occluded", "viewport-uniform"]],
      ["overlay", "overlay", click("geo-overlay", TOOL0), ["target-occluded"], ["target-offscreen", "target-not-in-dom"]],
      ["zero", "zero", click("geo-zero", TOOL0), ["target-zero-size"], ["target-offscreen", "target-not-in-dom"]],
      ["offscreen", "none", fill("geo-offscreen", { strategy: "testId", value: "vf-offscreen-tool" }), ["target-offscreen"], ["target-not-in-dom", "viewport-uniform"]],
      ["blank", "blank", click("geo-blank-ref", TOOL0), ["target-not-in-dom", "viewport-uniform"], ["target-occluded"]],
      ["busy", "none", fill("geo-busy", TOOL0), [], ["viewport-uniform", "target-not-in-dom", "target-occluded", "target-offscreen", "target-zero-size"]]
    ];
    for (const [name, failure, step, must, mustNot] of geometry) {
      const page = await openLab(context, failure);
      const out = await diagnose(page, folder, root, step);
      const problems = [...must.filter((code) => !has(out.record, code)).map((code) => `missing ${code}`), ...mustNot.filter((code) => has(out.record, code)).map((code) => `wrong ${code}`)];
      record(`geometry ${name}`, "geometry", out, problems);
      await page.close();
    }

    {
      const page = await openLab(context, "many");
      const out = await diagnose(page, folder, root, fill("cap-past", { strategy: "testId", value: "vf-many-tool" }));
      const problems: string[] = [];
      if (out.record && !out.record.truncated) problems.push("not truncated");
      if (out.record && out.record.examined !== 32) problems.push(`examined ${out.record.examined}`);
      if (has(out.record, "other-examined-identical")) problems.push("counted an element past the cap");
      record("scope over-cap, reference past the cap", "scope", out, problems);
      await page.close();
    }
    {
      const page = await openLab(context, "many");
      const out = await diagnose(page, folder, root, fill("cap-inside", { strategy: "testId", value: "vf-many-tool" }));
      record("scope over-cap, reference inside the cap", "scope", out, out.record && !out.record.truncated ? ["not truncated"] : [], has(out.record, "other-examined-identical"));
      await page.close();
    }
    {
      const page = await openLab(context);
      const out = await diagnose(page, folder, root, fill("omitted", TOOL0));
      record("scope omitted contender", "scope", out, has(out.record, "other-examined-identical") || has(out.record, "target-identical-to-reference") ? ["counted an element the step never names"] : []);
      await page.close();
    }

    const refusals: Array<[string, () => Promise<Page>, FlowStep, boolean, string]> = [
      ["protected surface", async () => { const p = await openLab(context); await p.evaluate(() => (window as unknown as { __fusionLab: { injectProtected(k: string): void } }).__fusionLab.injectProtected("otp")); return p; }, fill("ref-protected", TOOL0), false, "protected-surface"],
      ["handed off", () => openLab(context), fill("ref-handoff", TOOL0), true, "protected-surface"],
      // N5.7: N0's protected scan now runs before any inspection, so a one-time-code field is refused as the protected
      // surface it is; the masked-field rule is measured on an ordinary page with a card-number field.
      ["one-time-code field", async () => { const p = await openLab(context); await p.evaluate(() => (window as unknown as { __fusionLab: { injectProtected(k: string): void } }).__fusionLab.injectProtected("otp")); return p; }, click("ref-otp", { strategy: "css", value: '[data-testid="vf-protected-otp"] input' }, { type: "check" }), false, "protected-surface"],
      ["sensitive field", async () => {
        const p = await openLab(context);
        await p.evaluate(() => {
          const field = document.createElement("input");
          field.setAttribute("data-testid", "vf-card");
          field.setAttribute("name", "cardnumber");
          field.style.cssText = "position: absolute; left: 420px; top: 240px; width: 160px; height: 28px";
          document.body.appendChild(field);
        });
        return p;
      }, click("ref-sensitive", { strategy: "testId", value: "vf-card" }, { type: "check" }), false, "sensitive"]
    ];
    for (const [name, open, step, handedOff, code] of refusals) {
      const page = await open();
      const out = await diagnose(page, folder, root, step, handedOff);
      const problems: string[] = [];
      if (out.record?.outcome !== "refused" || !has(out.record, code)) problems.push(`expected ${code}, got ${out.record?.observations.join(",")}`);
      if (out.frames !== 0) problems.push(`${out.frames} frames`);
      record(`refusal ${name}`, "refusal", out, problems);
      await page.close();
    }
    {
      const page = await openLab(context);
      const out = await diagnose(page, folder, root, click("passing", { strategy: "testId", value: "vf-tool-1" }));
      results.push({ cell: cell.name, name: "passing click", family: "passing", frames: out.frames, calls: out.calls, cut: false, problems: out.calls === 0 && out.frames === 0 ? [] : [`${out.calls} calls, ${out.frames} frames`] });
      await page.close();
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return results;
}

async function captureOrThrow(page: Page, target: ReturnType<Page["getByTestId"]>): Promise<VisualEvidence> {
  const captured = await captureElement(page, target, { timeoutMs: 5000 });
  if (!captured.ok) throw new Error(`reference capture failed: ${captured.code}`);
  const built = buildVisualEvidence(captured.value);
  if (!built.ok) throw new Error(`reference evidence failed: ${built.code}`);
  return built.value;
}

const percentile = (values: number[], p: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

async function main(): Promise<void> {
  console.log("benchmark:visual-diagnosis — N5.6 calibration (informational)\n");
  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  const root = await mkdtemp(join(tmpdir(), "awkit-n5-6-"));
  const cells: Cell[] = [
    ...DPRS.flatMap((dpr) => (["headed", "headless"] as const).map((mode) => ({ name: `${mode} DPR ${dpr}`, referenceMode: mode, replayMode: mode, dpr }))),
    ...DPRS.map((dpr) => ({ name: `headed ref -> headless DPR ${dpr}`, referenceMode: "headed" as const, replayMode: "headless" as const, dpr }))
  ];
  const all: CaseResult[] = [];
  const blocked: Array<{ cell: string; reason: string }> = [];
  try {
    for (let attempt = 0; attempt < 80 && !(await fetch(LAB).then((r) => r.ok, () => false)); attempt += 1) await new Promise((r) => setTimeout(r, 100));
    for (const cell of cells) {
      const started = Date.now();
      try {
        const results = await runCell(cell, root);
        all.push(...results);
        const bad = results.filter((r) => r.problems.length);
        console.log(`  ${cell.name.padEnd(30)} ${results.length} cases, ${results.filter((r) => r.cut).length} cut, ${bad.length} with problems (${Math.round((Date.now() - started) / 1000)} s)`);
        for (const r of bad) console.log(`      ✗ ${r.name}: ${r.problems.join("; ")}`);
      } catch (error) {
        const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200);
        blocked.push({ cell: cell.name, reason });
        console.log(`  ${cell.name.padEnd(30)} BLOCKED — ${reason}`);
      }
    }
  } finally {
    server.kill();
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }

  // ── Per-code criterion ─────────────────────────────────────────────────────────────────────────
  const codeOf = (problem: string): string => {
    for (const code of ["target-identical-to-reference", "other-examined-identical", "target-not-in-dom", "target-occluded", "target-zero-size", "target-offscreen", "viewport-uniform"]) if (problem.includes(code)) return code;
    if (/truncated|examined|past the cap|never names/.test(problem)) return "scope";
    if (/frames|expected/.test(problem)) return "refusals";
    if (/calls/.test(problem)) return "passing";
    return "structure";
  };
  const failures = new Map<string, string[]>();
  for (const r of all) for (const p of r.problems) failures.set(codeOf(p), [...(failures.get(codeOf(p)) ?? []), `${r.cell}: ${r.name}: ${p}`]);
  const framed = all.filter((r) => r.family !== "refusal" && r.family !== "passing" && r.frames > 0 && typeof r.ms === "number").map((r) => r.ms!);
  const cutCount = all.filter((r) => r.cut).length;
  const cost = { n: framed.length, median: percentile(framed, 50), p95: percentile(framed, 95), max: framed.length ? Math.max(...framed) : 0, cut: cutCount, deadlineMs: VISUAL_DIAGNOSIS_DEADLINE_MS };
  const recall = (family: string, name: RegExp) => {
    const rows = all.filter((r) => r.family === family && name.test(r.name) && r.recalled !== undefined);
    return { hits: rows.filter((r) => r.recalled).length, of: rows.length };
  };
  const codes = ["target-identical-to-reference", "other-examined-identical", "target-not-in-dom", "target-occluded", "target-zero-size", "target-offscreen", "viewport-uniform", "scope", "refusals", "passing", "structure"];
  const verdicts = Object.fromEntries(codes.map((code) => [code, failures.has(code) ? "NOT MET" : "MET"]));
  const costMet = cost.p95 <= VISUAL_DIAGNOSIS_DEADLINE_MS;
  console.log("\n  VD-10 per code:");
  for (const code of codes) {
    console.log(`    ${code.padEnd(32)} ${verdicts[code]}${failures.has(code) ? ` (${failures.get(code)!.length}): ${failures.get(code)!.slice(0, 3).join(" | ")}` : ""}`);
  }
  console.log(`    cost p95 within ${VISUAL_DIAGNOSIS_DEADLINE_MS} ms             ${costMet ? "MET" : "NOT MET"} — median ${cost.median} ms, p95 ${cost.p95} ms, max ${cost.max} ms over ${cost.n} framed diagnoses; ${cost.cut} cut by the deadline`);
  const recallSingle = recall("identity", / single$/);
  const recallGroup = recall("identity", / group$/);
  console.log(`\n  Informational recall: single target identity ${recallSingle.hits}/${recallSingle.of}, group other identity ${recallGroup.hits}/${recallGroup.of}`);
  for (const cell of cells) {
    const rows = all.filter((r) => r.cell === cell.name && r.family === "identity" && / single$/.test(r.name) && r.recalled !== undefined);
    if (rows.length) console.log(`    ${cell.name.padEnd(30)} single ${rows.filter((r) => r.recalled).length}/${rows.length}`);
  }
  if (blocked.length) console.log(`\n  BLOCKED cells: ${blocked.map((b) => b.cell).join(", ")}`);

  const evidence = {
    benchmark: "benchmark:visual-diagnosis",
    task: "awkit-vra.14.6",
    informational: true,
    host: { platform: process.platform, arch: process.arch, cpus: cpus().length, node: process.version, chromium: chromium.executablePath().split(/[\\/]/).find((part) => part.startsWith("chromium")) ?? "bundled" },
    deadlineMs: VISUAL_DIAGNOSIS_DEADLINE_MS,
    cells: cells.map((c) => c.name),
    blocked,
    cases: all.map((r) => ({ cell: r.cell, case: r.name, family: r.family, observations: r.record?.observations ?? [], outcome: r.record?.outcome, conditions: r.record?.conditions, examined: r.record?.examined, domNamed: r.record?.domNamed, truncated: r.record?.truncated, identicalOthers: r.record?.identicalOthers, frames: r.frames, ms: r.ms, cut: r.cut, problems: r.problems })),
    criterion: { perCode: verdicts, cost: { ...cost, met: costMet }, failures: Object.fromEntries(failures) },
    recall: { single: recallSingle, group: recallGroup }
  };
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const met = codes.every((code) => verdicts[code] === "MET") && costMet && blocked.length === 0;
  console.log(`\n  VD-10 overall: ${met ? "MET" : "NOT MET"}${blocked.length ? " (with BLOCKED cells)" : ""}. Evidence: ${EVIDENCE_PATH}`);
}

await main();
