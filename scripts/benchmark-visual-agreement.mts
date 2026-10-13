/**
 * benchmark:visual-agreement — Phase N, N3.2 (awkit-vra.4.2) Visual Locator Recovery calibration. INFORMATIONAL.
 *
 * Plan: docs/plans/ai-upgrade-v5/N3-visual-locator-recovery.md, N3.2. Results: N3.2-agreement-calibration.md.
 *
 * Drives the Feature Test Lab's /visual-intelligence/fusion toolbar on real Chromium, headless and headed, at device
 * scale factors 1, 1.25 and 2, and replays the real captures through the pure N3.1 policy `decideVisualAgreement`:
 *
 *   launch A (fresh browser)  captures every reference from the baseline state (4 targets x 3 styles, plus the nine-
 *                             button wide toolbar), the way the N2.4b store would have written it on an earlier run
 *   launch B (fresh browser)  captures every scenario (baseline, drift, restyle-selected/pressed, swap, twins,
 *                             theme-dark/contrast) through `captureCandidates` (one screenshot) with the product's
 *                             24 px context default, and also keeps its own baseline as a same-launch reference
 *
 * Every candidate is tried as the DOM best in turn (the others are its competitors), so an `agreed` on any element other
 * than the scenario's true element is counted as a false `agreed`, whatever the DOM would have ranked first. The true
 * element is the remembered position, except in `swap`, where the lab defines the remembered position as now wrong and
 * the neighbour as carrying the remembered icon. The plan's own acceptance row is counted separately: an `agreed` on
 * swap, twins or restyle with the remembered position as the DOM best.
 *
 * The DOM decision is synthesized (a `below-threshold` refusal at score 0.7, ancestry 0.8, margin 0.08, one DOM
 * competitor per captured competitor), as N2.3 did: the real runner scoring is measured in N3.3. Recall is reported, not
 * assumed. Nothing is asserted as a product gate; it exits non-zero only when the harness fails or a structural row (no
 * interaction, one screenshot per fan-out, drift really changes the DOM and not the classes, shadow never proceeds) is
 * wrong. No image leaves the process; `--json <path>` writes numbers and verdict codes only.
 *
 * Run: npm run benchmark:visual-agreement [-- --headless-only] [-- --json <path>]
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

import { buildCandidateEvidence } from "@src/visual/candidateEvidence";
import { captureCandidates } from "@src/visual/capture";
import {
  AGREEMENT_MAX_COMPETITORS,
  decideVisualAgreement,
  type VisualAgreementEvidenceInput,
  type VisualAgreementInput,
  type VisualAgreementMode
} from "@src/visual/fusion/decideVisualAgreement";
import type { VisualEvidence } from "@src/visual/visualEvidence";

const PORT = 4427;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence/fusion`;
const DPRS = [1, 1.25, 2];
const STYLES = ["a", "b", "c"];
const TARGETS = [0, 1, 2, 3];
const WIDE = [0, 1, 2, 3, 4, 5, 6, 7, 8];
/** Appearance unchanged: the true element must be identical to its reference. */
const RECALL_SCENARIOS = ["baseline", "drift"];
/** The plan's acceptance row: no `agreed` with the remembered position as the DOM best. */
const ACCEPTANCE_SCENARIOS = ["swap", "twins", "restyle-selected", "restyle-pressed"];
const SCENARIOS = [...RECALL_SCENARIOS, ...ACCEPTANCE_SCENARIOS, "theme-dark", "theme-contrast"];
/** Repeated wide fan-outs per style and scenario, for the 8-competitor cost distribution. */
const WIDE_REPEATS = 3;
/** FD-5: the visual stage budget per recovery attempt, wall clock, including captures. Not tuned here. */
const FD5_BUDGET_MS = 400;

const argv = process.argv.slice(2);
const HEADLESS_MODES = argv.includes("--headless-only") ? [true] : [true, false];
const jsonFlag = argv.indexOf("--json");
const JSON_PATH = jsonFlag >= 0 ? argv[jsonFlag + 1] : undefined;

const keepAlive = setInterval(() => undefined, 1_000);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type ReferenceSource = "cross-launch" | "same-launch";

interface Decision {
  headless: boolean;
  dpr: number;
  style: string;
  target: number;
  scenario: string;
  toolbar: "four" | "wide";
  source: ReferenceSource;
  best: number;
  trueIndex: number;
  outcome: string;
  reason: string;
}

interface CostSample {
  headless: boolean;
  dpr: number;
  candidates: number;
  screenshots: number;
  captureMs: number;
  fingerprintMs: number;
  decideMs: number;
  totalMs: number;
  peakTemporaryBytes: number;
}

const decisions: Decision[] = [];
const costs: CostSample[] = [];
/** Pixel identity between same-icon buttons at different positions (twins), per cell: identical pairs / pairs. */
const twinPairs = new Map<string, { identical: number; pairs: number }>();

function countTwinPairs(key: string, evidence: VisualEvidence[]): void {
  const entry = twinPairs.get(key) ?? { identical: 0, pairs: 0 };
  for (let i = 0; i < evidence.length; i += 1) {
    for (let j = i + 1; j < evidence.length; j += 1) {
      entry.pairs += 1;
      if (evidence[i].fingerprint.contentDigest === evidence[j].fingerprint.contentDigest) entry.identical += 1;
    }
  }
  twinPairs.set(key, entry);
}
const structural: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail = ""): void {
  structural.push({ name, ok, detail });
}

/** The synthesized local-layer refusal N3 is eligible for: below threshold, the DOM floors held. */
function agreementInput(mode: VisualAgreementMode, reference: VisualAgreementEvidenceInput, best: VisualAgreementEvidenceInput, competitors: VisualAgreementEvidenceInput[]): VisualAgreementInput {
  return {
    mode,
    eligibility: "eligible",
    dom: { refusal: "below-threshold", best: { score: 0.7, ancestry: 0.8 }, margin: 0.08, competitorCount: competitors.length },
    reference,
    best,
    competitors
  };
}

const toolLocator = (page: Page, prefix: string, index: number): Locator => page.getByTestId(`${prefix}${index}`);

async function setState(page: Page, state: { scenario: string; target: number; style: string; wide: boolean }): Promise<void> {
  await page.evaluate((next) => (window as unknown as { __fusionLab: { setState(s: unknown): unknown } }).__fusionLab.setState(next), state);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const screenshotCounts = new WeakMap<Page, { count: number }>();

function countScreenshots(page: Page): void {
  const counter = { count: 0 };
  const original = page.screenshot.bind(page);
  page.screenshot = ((options?: Parameters<Page["screenshot"]>[0]) => {
    counter.count += 1;
    return original(options);
  }) as Page["screenshot"];
  screenshotCounts.set(page, counter);
}

const shotsOf = (page: Page): number => screenshotCounts.get(page)?.count ?? 0;

async function openLab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  countScreenshots(page);
  await page.goto(LAB);
  await page.frameLocator('[data-testid="vf-frame"]').getByTestId("vf-tool-0").waitFor();
  return page;
}

const interactions = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __fusionLab: { interactions: number } }).__fusionLab.interactions);

interface Fanout {
  evidence: VisualEvidence[];
  screenshots: number;
  captureMs: number;
  fingerprintMs: number;
  peakTemporaryBytes: number;
}

/** One fan-out over `indices` (one screenshot), with the product's default 24 px context. Every candidate must capture. */
async function fanout(page: Page, prefix: string, indices: number[], label: string): Promise<Fanout> {
  const before = shotsOf(page);
  const started = performance.now();
  const result = await captureCandidates(page, indices.map((index) => ({ id: `${prefix}${index}`, target: toolLocator(page, prefix, index) })));
  const captured = performance.now();
  if (!result.ok) throw new Error(`${label} fan-out failed: ${result.code} (${result.message})`);
  const built = buildCandidateEvidence(result.value);
  const evidence: VisualEvidence[] = [];
  for (const candidate of built.candidates) {
    if (!candidate.evidence.ok) throw new Error(`${label} candidate ${candidate.id} failed: ${candidate.evidence.code}`);
    evidence.push(candidate.evidence.value);
  }
  if (evidence.length !== indices.length) throw new Error(`${label}: ${evidence.length} of ${indices.length} candidates`);
  return {
    evidence,
    screenshots: shotsOf(page) - before,
    captureMs: captured - started,
    fingerprintMs: built.fingerprintMs,
    peakTemporaryBytes: result.value.memory.peakTemporaryBytes
  };
}

/** Every candidate as the DOM best in turn, the rest as its competitors. */
function decideAll(base: Omit<Decision, "best" | "outcome" | "reason" | "source">, source: ReferenceSource, reference: VisualEvidence, evidence: VisualEvidence[]): void {
  for (let best = 0; best < evidence.length; best += 1) {
    const competitors = evidence.filter((_, i) => i !== best);
    const verdict = decideVisualAgreement(agreementInput("shadow", reference, evidence[best], competitors));
    if (verdict.effect !== "none") record(`shadow never proceeds (${base.scenario}, best ${best})`, false, verdict.effect);
    if (verdict.outcome === "agreed") {
      const enforced = decideVisualAgreement(agreementInput("enforce", reference, evidence[best], competitors));
      if (enforced.outcome !== "agreed" || enforced.effect !== "proceed") record(`enforce proceeds exactly where shadow agrees (${base.scenario})`, false, `${enforced.outcome}/${enforced.effect}`);
    }
    decisions.push({ ...base, source, best, outcome: verdict.outcome, reason: verdict.reason });
  }
}

async function launch(headless: boolean, dpr: number): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr });
  return { browser, page: await openLab(context) };
}

/** Launch A: the references, from the baseline state, keyed by style and toolbar. Then the browser is closed. */
async function captureReferences(headless: boolean, dpr: number): Promise<Map<string, VisualEvidence[]>> {
  const { browser, page } = await launch(headless, dpr);
  const references = new Map<string, VisualEvidence[]>();
  try {
    for (const style of STYLES) {
      await setState(page, { scenario: "baseline", target: 0, style, wide: true });
      references.set(`four:${style}`, (await fanout(page, "vf-tool-", TARGETS, "reference")).evidence);
      references.set(`wide:${style}`, (await fanout(page, "vf-wide-tool-", WIDE, "wide reference")).evidence);
    }
  } finally {
    await browser.close();
  }
  return references;
}

async function measureCell(headless: boolean, dpr: number): Promise<void> {
  const references = await captureReferences(headless, dpr);
  const { browser, page } = await launch(headless, dpr);
  try {
    const interactionsBefore = await interactions(page);
    let fanouts = 0;
    let oneShotEach = true;
    for (const style of STYLES) {
      for (const target of TARGETS) {
        let sameLaunch: VisualEvidence | null = null;
        for (const scenario of SCENARIOS) {
          await setState(page, { scenario, target, style, wide: false });
          if (scenario === "drift") {
            const dom = await page.getByTestId(`vf-tool-${target}`).evaluate((n) => ({ name: n.getAttribute("aria-label"), drift: n.getAttribute("data-drift"), cls: n.className }));
            if (dom.name !== "Delete selected item" || dom.drift !== "renamed" || dom.cls !== `vf-tool vf-style-${style}`) record(`drift changes the DOM identity only (${style}/${target})`, false, JSON.stringify(dom));
          }
          const started = performance.now();
          const run = await fanout(page, "vf-tool-", TARGETS, scenario);
          fanouts += 1;
          if (run.screenshots !== 1) oneShotEach = false;
          const base = { headless, dpr, style, target, scenario, toolbar: "four" as const, trueIndex: scenario === "swap" ? (target + 1) % TARGETS.length : target };
          const decideStarted = performance.now();
          decideAll(base, "cross-launch", references.get(`four:${style}`)![target], run.evidence);
          const decideMs = (performance.now() - decideStarted) / TARGETS.length;
          if (scenario === "twins") countTwinPairs(`${headless ? "headless" : "headed"} DPR ${dpr} four`, run.evidence);
          if (scenario === "baseline") sameLaunch = run.evidence[target];
          if (sameLaunch) decideAll(base, "same-launch", sameLaunch, run.evidence);
          costs.push({ headless, dpr, candidates: 4, screenshots: run.screenshots, captureMs: run.captureMs, fingerprintMs: run.fingerprintMs, decideMs, totalMs: performance.now() - started, peakTemporaryBytes: run.peakTemporaryBytes });
        }
      }
      // VR-4: the target plus 8 competitors, the most N3 will ever capture.
      for (const scenario of ["baseline", "twins"]) {
        await setState(page, { scenario, target: 0, style, wide: true });
        for (let repeat = 0; repeat < WIDE_REPEATS; repeat += 1) {
          const started = performance.now();
          const run = await fanout(page, "vf-wide-tool-", WIDE, `wide ${scenario}`);
          fanouts += 1;
          if (run.screenshots !== 1) oneShotEach = false;
          const competitors = run.evidence.slice(1);
          const decideStarted = performance.now();
          const verdict = decideVisualAgreement(agreementInput("shadow", references.get(`wide:${style}`)![0], run.evidence[0], competitors));
          const decideMs = performance.now() - decideStarted;
          costs.push({ headless, dpr, candidates: WIDE.length, screenshots: run.screenshots, captureMs: run.captureMs, fingerprintMs: run.fingerprintMs, decideMs, totalMs: performance.now() - started, peakTemporaryBytes: run.peakTemporaryBytes });
          if (repeat === 0) {
            if (scenario === "twins") countTwinPairs(`${headless ? "headless" : "headed"} DPR ${dpr} wide`, run.evidence);
            decisions.push({ headless, dpr, style, target: 0, scenario, toolbar: "wide", source: "cross-launch", best: 0, trueIndex: 0, outcome: verdict.outcome, reason: verdict.reason });
            if (competitors.length !== AGREEMENT_MAX_COMPETITORS) record("the wide toolbar gives exactly 8 competitors", false, String(competitors.length));
          }
        }
      }
    }
    const moved = (await interactions(page)) - interactionsBefore;
    record(`${headless ? "headless" : "headed"} DPR ${dpr}: no click, key, focus or scroll across ${fanouts} fan-outs`, moved === 0, `${moved} interactions`);
    record(`${headless ? "headless" : "headed"} DPR ${dpr}: exactly one screenshot per fan-out`, oneShotEach);
  } finally {
    await browser.close();
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const ms = (value: number): string => `${Math.round(value)} ms`;

function report(): void {
  const four = decisions.filter((d) => d.toolbar === "four");
  if (four.length === 0) {
    record("decisions were recorded", false, "0 decisions");
    return;
  }
  const agreed = (d: Decision): boolean => d.outcome === "agreed";
  const cell = (d: Decision): string => `${d.headless ? "headless" : "headed"} DPR ${d.dpr}`;
  const cells = [...new Set(decisions.map(cell))];

  console.log("\nRecall — the true element identical to its reference (baseline and drift, best = true element):");
  for (const source of ["cross-launch", "same-launch"] as const) {
    for (const scenario of RECALL_SCENARIOS) {
      const rows = four.filter((d) => d.source === source && d.scenario === scenario && d.best === d.trueIndex);
      const byCell = cells.map((c) => {
        const own = rows.filter((d) => cell(d) === c);
        return `${c} ${own.filter(agreed).length}/${own.length}`;
      });
      console.log(`  ${source.padEnd(12)} ${scenario.padEnd(9)} ${rows.filter(agreed).length}/${rows.length}   ${byCell.join("   ")}`);
    }
  }
  const wideBaseline = decisions.filter((d) => d.toolbar === "wide" && d.scenario === "baseline");
  console.log(`  wide toolbar (8 competitors) baseline: ${wideBaseline.filter(agreed).length}/${wideBaseline.length} agreed`);

  const falseAgreed = decisions.filter((d) => agreed(d) && d.best !== d.trueIndex);
  const acceptance = four.filter((d) => ACCEPTANCE_SCENARIOS.includes(d.scenario) && d.best === d.target && agreed(d));
  const swapFollow = four.filter((d) => d.scenario === "swap" && d.best === d.trueIndex && agreed(d));
  const wideTwins = decisions.filter((d) => d.toolbar === "wide" && d.scenario === "twins");
  console.log("\nFalse agreed:");
  console.log(`  any scenario, any DOM best (best != true element): ${falseAgreed.length} of ${decisions.length} decisions`);
  for (const d of falseAgreed.slice(0, 20)) console.log(`    ${cell(d)} ${d.source} ${d.style}/${d.target} ${d.scenario} best ${d.best} true ${d.trueIndex}`);
  console.log(`  plan acceptance (swap, twins, restyle with best = remembered position): ${acceptance.length} agreed`);
  for (const scenario of ACCEPTANCE_SCENARIOS) {
    for (const source of ["cross-launch", "same-launch"] as const) {
      const rows = acceptance.filter((d) => d.scenario === scenario && d.source === source);
      if (rows.length > 0) console.log(`    ${scenario} ${source}: ${rows.length}   ${cells.map((c) => `${c} ${rows.filter((d) => cell(d) === c).length}`).join("   ")}`);
    }
  }
  console.log("  twin pixel identity (same icon, different position), identical pairs / pairs:");
  for (const [key, entry] of twinPairs) console.log(`    ${key.padEnd(24)} ${entry.identical}/${entry.pairs}`);
  const lost = four.filter((d) => RECALL_SCENARIOS.includes(d.scenario) && d.best === d.trueIndex && !agreed(d));
  console.log(`  recall misses: ${lost.map((d) => `${cell(d)} ${d.source} ${d.scenario} ${d.style}/${d.target} ${d.reason}`).join("; ") || "none"}`);
  console.log(`  swap with best = the neighbour carrying the remembered icon (the lab's true element): ${swapFollow.length} of ${four.filter((d) => d.scenario === "swap" && d.best === d.trueIndex).length} agreed`);
  console.log(`  wide twins (8 identical competitors): ${wideTwins.filter(agreed).length} agreed of ${wideTwins.length}`);

  console.log("\nReasons by scenario (cross-launch, best = remembered position):");
  for (const scenario of SCENARIOS) {
    const counts = new Map<string, number>();
    for (const d of four.filter((x) => x.source === "cross-launch" && x.scenario === scenario && x.best === x.target)) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
    console.log(`  ${scenario.padEnd(17)} ${[...counts].map(([reason, n]) => `${reason} ${n}`).join(", ")}`);
  }

  console.log(`\nCapture cost — captureCandidates + evidence + decide, wall clock, against FD-5 ${FD5_BUDGET_MS} ms:`);
  for (const c of cells) {
    for (const candidates of [4, WIDE.length]) {
      const rows = costs.filter((s) => `${s.headless ? "headless" : "headed"} DPR ${s.dpr}` === c && s.candidates === candidates);
      if (rows.length === 0) continue;
      const total = rows.map((s) => s.totalMs);
      const p95 = percentile(total, 95);
      console.log(
        `  ${c.padEnd(16)} ${String(candidates).padStart(2)} candidates  n ${String(rows.length).padStart(3)}  p50 ${ms(percentile(total, 50))}  p95 ${ms(p95)}  max ${ms(Math.max(...total))}  capture p50 ${ms(percentile(rows.map((s) => s.captureMs), 50))}  fingerprint p50 ${ms(percentile(rows.map((s) => s.fingerprintMs), 50))}  decide max ${Math.max(...rows.map((s) => s.decideMs)).toFixed(2)} ms  peak ${Math.round(Math.max(...rows.map((s) => s.peakTemporaryBytes)) / 1024)} KiB  ${p95 <= FD5_BUDGET_MS ? "within FD-5" : "OVER FD-5"}`
      );
    }
  }
  record("every cell measured the four-button and the wide toolbar", cells.length === DPRS.length * HEADLESS_MODES.length && costs.some((s) => s.candidates === WIDE.length), `${cells.length} cells`);
}

const server = spawn(process.execPath, ["mock-site/server.mjs"], {
  env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
  stdio: ["ignore", "ignore", "inherit"],
  windowsHide: true
});

let exitCode = 0;
try {
  let up = false;
  for (let i = 0; i < 80 && !up; i += 1) {
    try {
      up = (await fetch(LAB)).ok;
    } catch {
      // Not up yet.
    }
    if (!up) await sleep(100);
  }
  if (!up) throw new Error(`mock site did not start on ${PORT}`);
  console.log(`\nVisual agreement calibration — ${TARGETS.length * STYLES.length} variants x ${SCENARIOS.length} scenarios, every candidate as DOM best, DPR ${DPRS.join("/")}, ${HEADLESS_MODES.map((h) => (h ? "headless" : "headed")).join(" + ")}, references from a separate launch`);
  for (const headless of HEADLESS_MODES) {
    for (const dpr of DPRS) {
      process.stdout.write(`  ${headless ? "headless" : "headed"} DPR ${dpr} ... `);
      await measureCell(headless, dpr);
      console.log("done");
    }
  }
  report();
  console.log("\nStructural rows:");
  for (const row of structural) console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.name}${row.detail ? `  [${row.detail}]` : ""}`);
  if (structural.some((row) => !row.ok)) exitCode = 1;
  if (JSON_PATH) writeFileSync(JSON_PATH, JSON.stringify({ decisions, costs, structural }, null, 2));
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  server.kill();
  clearInterval(keepAlive);
}
process.exit(exitCode);
