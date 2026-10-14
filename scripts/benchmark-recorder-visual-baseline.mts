/**
 * benchmark:recorder-visual-baseline — Phase N, N4.5 (awkit-vra.13.5) recorded-baseline calibration. INFORMATIONAL.
 *
 * Plan: docs/plans/ai-upgrade-v5/N4-recorder-visual-intelligence.md, N4.5 and *Headed and headless*. It answers one
 * question with the N3.2 method (`benchmark:visual-agreement`, N3.2-agreement-calibration.md) unchanged on the replay
 * side: does a reference captured by the REAL N4 Recorder path (headed, manual, after the recorded click) add any false
 * `agreed` relative to the N3.2 runtime-reference results?
 *
 *   launch R (fresh, headed)   the production `RecorderService` records a real click on every lab target (4 targets x 3
 *                              styles on the baseline state, plus vf-wide-tool-0 per style) and captures each step
 *                              through `captureVisualReference` (AWKIT_VISUAL_RECORDER=manual), three times per step.
 *                              The first capture is the recorded reference; every call is timed against the provisional
 *                              1500 ms manual-capture ceiling. The recording is cancelled, the browser closed.
 *   launch A (fresh, mode M)   the N3.2 runtime reference, captured the way N3.2 did (an in-run control)
 *   launch B (fresh, mode M)   the N3.2 replay: one fan-out per scenario, every candidate as the DOM best through the
 *                              real `decideVisualAgreement`, against the recorded reference, the cross-launch runtime
 *                              reference (A) and the same-launch reference (B)
 *
 * M is headed and headless, at device scale factors 1, 1.25 and 2. The Recorder launch is the production launch (headed,
 * no-egress hardening args); only its CONTEXT is given the cell's viewport (800x600, as N3.2) and device scale factor,
 * because N3's A5 compares only references with the same viewport and DPR (a mismatch is `conditions-changed`, never a
 * comparison), and the production Recorder context otherwise uses Playwright's default. The DOM half is synthesized
 * exactly as N3.2 (`below-threshold`, score 0.7, ancestry 0.8, margin 0.08).
 *
 * Metric definitions (per mode, DPR, scenario and reference source; one decision = one candidate as the DOM best):
 *   identical        the best's crop digest equals the reference digest
 *   agreed           `decideVisualAgreement` (shadow) answered `agreed`
 *   true element     the remembered position, except `swap`, where it is the neighbour carrying the remembered icon
 *   recall           baseline and drift, best = true element, `agreed`
 *   false identical  identical with best != true element, or on swap/restyle with best = remembered position
 *   false agreed     agreed with best != true element, or (the N3.2 acceptance row) agreed on swap, twins or restyle
 *                    with best = remembered position
 *
 * PRE-AGREED CRITERION (N4 plan, fixed before this script ran): with recorded baselines, no added false `agreed`
 * relative to the N3.2 runtime-reference results. Evaluated mechanically against the authoritative N3.2 numbers below:
 *   (1) recorded false agreed with best != true element = 0 (N3.2: 0 of 4644);
 *   (2) recorded acceptance-row false agreed <= N3.2 cross-launch, in EVERY mode x DPR cell and in total (N3.2: 17);
 *   (3) recorded wide-toolbar twins agreed <= N3.2 (3 of 18).
 * The recorded reference is compared to N3.2's cross-launch figures because it, too, comes from a separate launch. The
 * in-run runtime control is reported beside it as evidence of this machine's rendering, never as the criterion.
 *
 * Nothing is asserted as a product gate. It exits non-zero only when the harness fails or a structural row is wrong (the
 * Recorder launch was not headed or not at the cell's DPR, a step did not record, a replay touched the page, a fan-out
 * took more than one screenshot, shadow proceeded). No image leaves the process; references go to a temp folder only.
 *
 * Run: npm run benchmark:recorder-visual-baseline
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, cpus, release } from "node:os";
import { join } from "node:path";

import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

import { RecorderService } from "@src/recorder/RecorderService";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import { persistRecordedVisualReferences } from "@src/recorder/visual/RecorderVisualCapture";
import { RECORDER_VISUAL_CAPTURE_TIMEOUT_MS } from "@src/recorder/visual/recorderVisualCaptureCodes";
import { VisualReferenceStore } from "@src/runner/visualFusion/VisualReferenceStore";
import { recordedVisualReferenceKey } from "@src/runner/visualFusion/recordedVisualReferenceKey";
import { buildCandidateEvidence } from "@src/visual/candidateEvidence";
import { captureCandidates } from "@src/visual/capture";
import { decideVisualAgreement, type VisualAgreementEvidenceInput, type VisualAgreementInput, type VisualAgreementMode } from "@src/visual/fusion/decideVisualAgreement";
import { VISUAL_EVIDENCE_MAX_BYTES, VISUAL_EVIDENCE_VERSION, type VisualEvidence } from "@src/visual/visualEvidence";

const PORT = 4428;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence/fusion`;
const VIEWPORT = { width: 800, height: 600 };
const DPRS = [1, 1.25, 2];
const STYLES = ["a", "b", "c"];
const TARGETS = [0, 1, 2, 3];
const WIDE = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const RECALL_SCENARIOS = ["baseline", "drift"];
const ACCEPTANCE_SCENARIOS = ["swap", "twins", "restyle-selected", "restyle-pressed"];
const SCENARIOS = [...RECALL_SCENARIOS, ...ACCEPTANCE_SCENARIOS, "theme-dark", "theme-contrast"];
const CAPTURES_PER_STEP = 3;
const HEADLESS_MODES = [false, true];

/** Authoritative N3.2 (N3.2-agreement-calibration.md, 2026-10-13): acceptance-row false agreed, cross-launch, per cell. */
const N32_CROSS_ACCEPTANCE: Record<string, number> = {
  "headed DPR 1": 0,
  "headed DPR 1.25": 0,
  "headed DPR 2": 0,
  "headless DPR 1": 8,
  "headless DPR 1.25": 3,
  "headless DPR 2": 6
};
const N32_CROSS_ACCEPTANCE_TOTAL = 17;
const N32_SAME_ACCEPTANCE_TOTAL = 11;
const N32_FALSE_AGREED_BEST_NOT_TRUE = 0;
const N32_WIDE_TWINS_AGREED = 3;
const N32_RECALL = { crossBaseline: "66/72", crossDrift: "65/72", sameBaseline: "72/72", sameDrift: "71/72" };

const keepAlive = setInterval(() => undefined, 1_000);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Source = "recorded" | "runtime-cross" | "runtime-same";

interface Decision {
  mode: "headed" | "headless";
  dpr: number;
  style: string;
  target: number;
  scenario: string;
  toolbar: "four" | "wide";
  source: Source;
  best: number;
  trueIndex: number;
  identical: boolean;
  outcome: string;
  reason: string;
}

const decisions: Decision[] = [];
const captureMs: number[] = [];
const captureRefusals = new Map<string, number>();
const structural: { name: string; ok: boolean; detail: string }[] = [];
const postAction: { dpr: number; mode: string; identical: number; total: number }[] = [];
const repeatStability = { stable: 0, total: 0 };
const storeReadMs: number[] = [];

function record(name: string, ok: boolean, detail = ""): void {
  structural.push({ name, ok, detail });
}

const cellOf = (mode: string, dpr: number): string => `${mode} DPR ${dpr}`;

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

async function setState(page: Page, state: { scenario: string; target: number; style: string; wide: boolean }): Promise<void> {
  await page.evaluate((next) => (window as unknown as { __fusionLab: { setState(s: unknown): unknown } }).__fusionLab.setState(next), state);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const interactions = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __fusionLab: { interactions: number } }).__fusionLab.interactions);

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

async function fanout(page: Page, prefix: string, indices: number[], label: string): Promise<{ evidence: VisualEvidence[]; screenshots: number }> {
  const before = shotsOf(page);
  const result = await captureCandidates(page, indices.map((index) => ({ id: `${prefix}${index}`, target: page.getByTestId(`${prefix}${index}`) as Locator })));
  if (!result.ok) throw new Error(`${label} fan-out failed: ${result.code} (${result.message})`);
  const evidence: VisualEvidence[] = [];
  for (const candidate of buildCandidateEvidence(result.value).candidates) {
    if (!candidate.evidence.ok) throw new Error(`${label} candidate ${candidate.id} failed: ${candidate.evidence.code}`);
    evidence.push(candidate.evidence.value);
  }
  if (evidence.length !== indices.length) throw new Error(`${label}: ${evidence.length} of ${indices.length} candidates`);
  return { evidence, screenshots: shotsOf(page) - before };
}

const digest = (evidence: VisualEvidence): string => evidence.fingerprint.contentDigest;

function decideAll(base: Omit<Decision, "best" | "outcome" | "reason" | "source" | "identical">, source: Source, reference: VisualEvidence, evidence: VisualEvidence[]): void {
  for (let best = 0; best < evidence.length; best += 1) {
    const competitors = evidence.filter((_, i) => i !== best);
    const verdict = decideVisualAgreement(agreementInput("shadow", reference, evidence[best], competitors));
    if (verdict.effect !== "none") record(`shadow never proceeds (${source} ${base.scenario} best ${best})`, false, verdict.effect);
    decisions.push({ ...base, source, best, identical: digest(evidence[best]) === digest(reference), outcome: verdict.outcome, reason: verdict.reason });
  }
}

// ── The Recorder launch ─────────────────────────────────────────────────────────────────────────
// The production RecorderService calls chromium.launch(...) then browser.newContext(...). Only the context is given the
// cell's viewport and DPR; the launch options (headed, hardening args) are observed, never changed.
const productionLaunch = chromium.launch.bind(chromium);
let recorderDpr = 1;
let recorderLaunchHeadless: boolean | undefined;
(chromium as { launch: typeof chromium.launch }).launch = (async (options?: Parameters<typeof chromium.launch>[0]) => {
  recorderLaunchHeadless = options?.headless;
  const browser = await productionLaunch(options);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = ((contextOptions?: Parameters<Browser["newContext"]>[0]) => newContext({ ...(contextOptions ?? {}), viewport: VIEWPORT, deviceScaleFactor: recorderDpr })) as Browser["newContext"];
  return browser;
}) as typeof chromium.launch;

interface RecordedReferences {
  four: Map<string, VisualEvidence>;
  wide: Map<string, VisualEvidence>;
}

async function until<T>(probe: () => T | null | undefined, timeoutMs = 10_000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = probe();
    if (value) return value;
    await sleep(25);
  }
  return null;
}

async function recordReferences(dpr: number, work: string): Promise<RecordedReferences> {
  recorderDpr = dpr;
  recorderLaunchHeadless = undefined;
  const recorder = new RecorderService();
  const internal = recorder as any;
  recorder.configureDraftStorage(join(work, `draft-${dpr}.json`));
  recorder.configureUrlStorage(join(work, `urls-${dpr}.json`));
  const references: RecordedReferences = { four: new Map(), wide: new Map() };
  const used = new Set<string>();
  const bindings: { stepId: string; bindingDigest: string; evidence: unknown }[] = [];
  await recorder.startRecording(LAB, { executablePath: chromium.executablePath(), captureSmartWaits: false, captureWaitTime: false });
  try {
    const page: Page = internal.page;
    await page.getByTestId("vf-tool-0").waitFor();
    const observed = await page.evaluate(() => ({ dpr: window.devicePixelRatio, width: window.innerWidth, height: window.innerHeight }));
    record(`Recorder DPR ${dpr}: production launch is headed`, recorderLaunchHeadless === false, String(recorderLaunchHeadless));
    record(`Recorder DPR ${dpr}: page runs at the cell's DPR and viewport`, observed.dpr === dpr && observed.width === VIEWPORT.width && observed.height === VIEWPORT.height, JSON.stringify(observed));
    const steps: { key: string; wide: boolean; testId: string; style: string; target: number }[] = [];
    for (const style of STYLES) {
      for (const target of TARGETS) steps.push({ key: `${style}:${target}`, wide: false, testId: `vf-tool-${target}`, style, target });
      steps.push({ key: style, wide: true, testId: "vf-wide-tool-0", style, target: 0 });
    }
    for (const step of steps) {
      await setState(page, { scenario: "baseline", target: step.target, style: step.style, wide: step.wide });
      await page.getByTestId(step.testId).click();
      const action = await until(() =>
        recorder.getActions().find((a: RecordedAction) => !used.has(a.id) && a.type === "click" && JSON.stringify(a.locator ?? {}).includes(`"${step.testId}"`))
      );
      if (!action) {
        record(`Recorder DPR ${dpr}: the click on ${step.testId} (${step.key}) was recorded`, false);
        continue;
      }
      used.add(action.id);
      const digests: string[] = [];
      for (let i = 0; i < CAPTURES_PER_STEP; i += 1) {
        const started = performance.now();
        const result = await recorder.captureVisualReference(action.id);
        captureMs.push(performance.now() - started);
        if (!result.ok) {
          captureRefusals.set(result.code, (captureRefusals.get(result.code) ?? 0) + 1);
          continue;
        }
        const pending = internal.visualPending.get(action.id) as { evidence: VisualEvidence; bindingDigest: string } | undefined;
        if (!pending) {
          record(`Recorder DPR ${dpr}: a captured step holds its pending reference`, false, step.key);
          continue;
        }
        digests.push(digest(pending.evidence));
        if (i === 0) {
          (step.wide ? references.wide : references.four).set(step.key, pending.evidence);
          bindings.push({ stepId: action.id, bindingDigest: pending.bindingDigest, evidence: pending.evidence });
        }
      }
      if (digests.length > 1) {
        repeatStability.total += digests.length - 1;
        repeatStability.stable += digests.slice(1).filter((d) => d === digests[0]).length;
      }
    }
    record(`Recorder DPR ${dpr}: every step has a recorded reference (${STYLES.length * TARGETS.length} + ${STYLES.length})`, references.four.size === STYLES.length * TARGETS.length && references.wide.size === STYLES.length, `${references.four.size} + ${references.wide.size}`);
  } finally {
    // cancelRecording discards the draft and closes the Recorder browser.
    await recorder.cancelRecording().catch(() => undefined);
  }

  // The N4.3 write and the N4.6 read it would feed: the unchanged store, the recorded key, the digest round trip.
  const folder = join(work, `refs-${dpr}`);
  const counts = await persistRecordedVisualReferences(folder, "bench-flow", bindings);
  const store = new VisualReferenceStore({ folder, evidenceVersion: VISUAL_EVIDENCE_VERSION, maxEvidenceBytes: VISUAL_EVIDENCE_MAX_BYTES, digestOf: (v) => (v as VisualEvidence).fingerprint.contentDigest });
  let roundTrip = 0;
  for (const binding of bindings) {
    const started = performance.now();
    const read = await store.get(recordedVisualReferenceKey("bench-flow", binding.stepId, binding.bindingDigest));
    storeReadMs.push(performance.now() - started);
    if (read.status === "found" && read.contentDigest === digest(binding.evidence as VisualEvidence)) roundTrip += 1;
  }
  record(`Recorder DPR ${dpr}: every reference persists and reads back under the recorded key`, counts.written === bindings.length && roundTrip === bindings.length && bindings.length > 0, `${counts.written} written, ${roundTrip}/${bindings.length} read back`);
  return references;
}

// ── The replay launches (unchanged N3.2 method) ─────────────────────────────────────────────────

async function launch(headless: boolean, dpr: number): Promise<{ browser: Browser; page: Page }> {
  const browser = await productionLaunch({ headless });
  const context: BrowserContext = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: dpr });
  const page = await context.newPage();
  countScreenshots(page);
  await page.goto(LAB);
  await page.frameLocator('[data-testid="vf-frame"]').getByTestId("vf-tool-0").waitFor();
  return { browser, page };
}

async function runtimeReferences(headless: boolean, dpr: number): Promise<{ four: Map<string, VisualEvidence[]>; wide: Map<string, VisualEvidence> }> {
  const { browser, page } = await launch(headless, dpr);
  const four = new Map<string, VisualEvidence[]>();
  const wide = new Map<string, VisualEvidence>();
  try {
    for (const style of STYLES) {
      await setState(page, { scenario: "baseline", target: 0, style, wide: true });
      four.set(style, (await fanout(page, "vf-tool-", TARGETS, "reference")).evidence);
      wide.set(style, (await fanout(page, "vf-wide-tool-", WIDE, "wide reference")).evidence[0]);
    }
  } finally {
    await browser.close();
  }
  return { four, wide };
}

async function measureCell(headless: boolean, dpr: number, recorded: RecordedReferences): Promise<void> {
  const mode = headless ? "headless" : "headed";
  const runtime = await runtimeReferences(headless, dpr);
  // Post-action effect: the recorded reference (after the recorded click) against a never-clicked capture.
  let same = 0;
  let total = 0;
  for (const style of STYLES) {
    for (const target of TARGETS) {
      total += 1;
      if (digest(recorded.four.get(`${style}:${target}`)!) === digest(runtime.four.get(style)![target])) same += 1;
    }
  }
  postAction.push({ dpr, mode, identical: same, total });

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
          const run = await fanout(page, "vf-tool-", TARGETS, scenario);
          fanouts += 1;
          if (run.screenshots !== 1) oneShotEach = false;
          const base = { mode: mode as Decision["mode"], dpr, style, target, scenario, toolbar: "four" as const, trueIndex: scenario === "swap" ? (target + 1) % TARGETS.length : target };
          decideAll(base, "recorded", recorded.four.get(`${style}:${target}`)!, run.evidence);
          decideAll(base, "runtime-cross", runtime.four.get(style)![target], run.evidence);
          if (scenario === "baseline") sameLaunch = run.evidence[target];
          if (sameLaunch) decideAll(base, "runtime-same", sameLaunch, run.evidence);
        }
      }
      for (const scenario of ["baseline", "twins"]) {
        await setState(page, { scenario, target: 0, style, wide: true });
        const run = await fanout(page, "vf-wide-tool-", WIDE, `wide ${scenario}`);
        fanouts += 1;
        if (run.screenshots !== 1) oneShotEach = false;
        const competitors = run.evidence.slice(1);
        for (const [source, reference] of [["recorded", recorded.wide.get(style)!], ["runtime-cross", runtime.wide.get(style)!]] as const) {
          const verdict = decideVisualAgreement(agreementInput("shadow", reference, run.evidence[0], competitors));
          decisions.push({ mode, dpr, style, target: 0, scenario, toolbar: "wide", source, best: 0, trueIndex: 0, identical: digest(run.evidence[0]) === digest(reference), outcome: verdict.outcome, reason: verdict.reason });
        }
      }
    }
    const moved = (await interactions(page)) - interactionsBefore;
    record(`${cellOf(mode, dpr)} replay: no click, key, focus or scroll across ${fanouts} fan-outs`, moved === 0, `${moved} interactions`);
    record(`${cellOf(mode, dpr)} replay: exactly one screenshot per fan-out`, oneShotEach);
  } finally {
    await browser.close();
  }
}

// ── Report ──────────────────────────────────────────────────────────────────────────────────────

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const agreed = (d: Decision): boolean => d.outcome === "agreed";
const isFalseAgreed = (d: Decision): boolean => agreed(d) && (d.best !== d.trueIndex || (ACCEPTANCE_SCENARIOS.includes(d.scenario) && d.best === d.target));
const isFalseIdentical = (d: Decision): boolean =>
  d.identical && (d.best !== d.trueIndex || ((d.scenario === "swap" || d.scenario.startsWith("restyle-")) && d.best === d.target));
const acceptanceRow = (d: Decision): boolean => d.toolbar === "four" && ACCEPTANCE_SCENARIOS.includes(d.scenario) && d.best === d.target && agreed(d);

function report(): boolean {
  const cells = HEADLESS_MODES.flatMap((h) => DPRS.map((dpr) => cellOf(h ? "headless" : "headed", dpr)));
  const four = decisions.filter((d) => d.toolbar === "four");
  if (four.length === 0) {
    record("decisions were recorded", false, "0");
    return false;
  }

  console.log("\nIdentity quality — recorded reference, four-button toolbar (n = decisions; recall = true element agreed / true-element decisions):");
  console.log("  cell               scenario          n    recall   identical  agreed  false-identical  false-agreed  other outcomes");
  for (const cell of cells) {
    for (const scenario of SCENARIOS) {
      const rows = four.filter((d) => d.source === "recorded" && cellOf(d.mode, d.dpr) === cell && d.scenario === scenario);
      const trueRows = rows.filter((d) => d.best === d.trueIndex);
      const recall = RECALL_SCENARIOS.includes(scenario) ? `${trueRows.filter(agreed).length}/${trueRows.length}` : "-";
      const reasons = new Map<string, number>();
      for (const d of rows.filter((x) => !agreed(x))) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
      console.log(
        `  ${cell.padEnd(18)} ${scenario.padEnd(17)} ${String(rows.length).padStart(3)}  ${recall.padStart(6)}   ${String(rows.filter((d) => d.identical).length).padStart(9)}  ${String(rows.filter(agreed).length).padStart(6)}  ${String(rows.filter(isFalseIdentical).length).padStart(15)}  ${String(rows.filter(isFalseAgreed).length).padStart(12)}  ${[...reasons].map(([r, n]) => `${r} ${n}`).join(", ")}`
      );
    }
  }

  console.log("\nSide by side — false agreed (acceptance row: swap/twins/restyle, best = remembered position) and recall:");
  console.log("  cell               N3.2 cross  N3.2 same | run: recorded  runtime-cross  runtime-same | recall baseline rec/cross/same");
  for (const cell of cells) {
    const own = (source: Source): Decision[] => four.filter((d) => d.source === source && cellOf(d.mode, d.dpr) === cell);
    const acc = (source: Source): number => own(source).filter(acceptanceRow).length;
    const rec = (source: Source): string => {
      const rows = own(source).filter((d) => d.scenario === "baseline" && d.best === d.trueIndex);
      return `${rows.filter(agreed).length}/${rows.length}`;
    };
    console.log(`  ${cell.padEnd(18)} ${String(N32_CROSS_ACCEPTANCE[cell]).padStart(10)}  ${"".padStart(9)} | ${String(acc("recorded")).padStart(13)}  ${String(acc("runtime-cross")).padStart(13)}  ${String(acc("runtime-same")).padStart(12)} | ${rec("recorded")} / ${rec("runtime-cross")} / ${rec("runtime-same")}`);
  }
  const totalAcc = (source: Source): number => four.filter((d) => d.source === source).filter(acceptanceRow).length;
  const anyBest = (source: Source): number => decisions.filter((d) => d.source === source && agreed(d) && d.best !== d.trueIndex).length;
  const ofSource = (source: Source): number => decisions.filter((d) => d.source === source).length;
  console.log(`  total acceptance-row false agreed: N3.2 cross ${N32_CROSS_ACCEPTANCE_TOTAL}, N3.2 same ${N32_SAME_ACCEPTANCE_TOTAL} | recorded ${totalAcc("recorded")}, runtime-cross ${totalAcc("runtime-cross")}, runtime-same ${totalAcc("runtime-same")}`);
  console.log(`  false agreed with best != true element: N3.2 ${N32_FALSE_AGREED_BEST_NOT_TRUE} of 4644 | recorded ${anyBest("recorded")} of ${ofSource("recorded")}, runtime-cross ${anyBest("runtime-cross")} of ${ofSource("runtime-cross")}, runtime-same ${anyBest("runtime-same")} of ${ofSource("runtime-same")}`);
  for (const scenario of ACCEPTANCE_SCENARIOS) {
    console.log(`    ${scenario.padEnd(17)} recorded ${four.filter((d) => d.source === "recorded" && d.scenario === scenario && acceptanceRow(d)).length}, runtime-cross ${four.filter((d) => d.source === "runtime-cross" && d.scenario === scenario && acceptanceRow(d)).length}`);
  }
  const recallTotals = (source: Source, scenario: string): string => {
    const rows = four.filter((d) => d.source === source && d.scenario === scenario && d.best === d.trueIndex);
    return `${rows.filter(agreed).length}/${rows.length}`;
  };
  console.log(`  recall: N3.2 cross baseline ${N32_RECALL.crossBaseline}, drift ${N32_RECALL.crossDrift}; same ${N32_RECALL.sameBaseline}, ${N32_RECALL.sameDrift}`);
  console.log(`          run recorded baseline ${recallTotals("recorded", "baseline")}, drift ${recallTotals("recorded", "drift")}; runtime-cross ${recallTotals("runtime-cross", "baseline")}, ${recallTotals("runtime-cross", "drift")}; runtime-same ${recallTotals("runtime-same", "baseline")}, ${recallTotals("runtime-same", "drift")}`);
  const wideTwins = (source: Source): string => {
    const rows = decisions.filter((d) => d.toolbar === "wide" && d.scenario === "twins" && d.source === source);
    return `${rows.filter(agreed).length} of ${rows.length}`;
  };
  const wideBase = (source: Source): string => {
    const rows = decisions.filter((d) => d.toolbar === "wide" && d.scenario === "baseline" && d.source === source);
    return `${rows.filter(agreed).length} of ${rows.length}`;
  };
  console.log(`  wide toolbar (8 competitors): twins agreed N3.2 ${N32_WIDE_TWINS_AGREED} of 18 | recorded ${wideTwins("recorded")}, runtime-cross ${wideTwins("runtime-cross")}; baseline recall recorded ${wideBase("recorded")}, runtime-cross ${wideBase("runtime-cross")}`);

  console.log("\nPost-action effect — recorded reference (after the recorded click) identical to a never-clicked capture, same DPR:");
  for (const row of postAction) console.log(`  vs ${row.mode.padEnd(8)} DPR ${String(row.dpr).padEnd(4)} ${row.identical}/${row.total}`);
  console.log(`  repeated Recorder captures of the same step identical to its first: ${repeatStability.stable}/${repeatStability.total}`);

  console.log(`\nManual capture cost — RecorderService.captureVisualReference wall clock (re-proof + protected checks + capture), against the provisional ${RECORDER_VISUAL_CAPTURE_TIMEOUT_MS} ms ceiling:`);
  console.log(`  n ${captureMs.length}  median ${captureMs.length ? percentile(captureMs, 50).toFixed(1) : "-"} ms  p95 ${percentile(captureMs, 95).toFixed(1)} ms  max ${Math.max(...captureMs).toFixed(1)} ms  over ceiling ${captureMs.filter((v) => v > RECORDER_VISUAL_CAPTURE_TIMEOUT_MS).length}  refusals ${[...captureRefusals].map(([c, n]) => `${c} ${n}`).join(", ") || "0"}`);
  console.log(`  recorded-key store.get (N4.6 read cost): n ${storeReadMs.length}  median ${percentile(storeReadMs, 50).toFixed(2)} ms  p95 ${percentile(storeReadMs, 95).toFixed(2)} ms  max ${Math.max(...storeReadMs).toFixed(2)} ms`);

  // The pre-agreed criterion, mechanically.
  const perCell = cells.map((cell) => ({ cell, recorded: four.filter((d) => d.source === "recorded" && cellOf(d.mode, d.dpr) === cell).filter(acceptanceRow).length, n32: N32_CROSS_ACCEPTANCE[cell] }));
  const c1 = anyBest("recorded") <= N32_FALSE_AGREED_BEST_NOT_TRUE;
  const c2 = perCell.every((row) => row.recorded <= row.n32) && totalAcc("recorded") <= N32_CROSS_ACCEPTANCE_TOTAL && perCell.length === 6;
  const recordedWideTwins = decisions.filter((d) => d.toolbar === "wide" && d.scenario === "twins" && d.source === "recorded");
  const c3 = recordedWideTwins.filter(agreed).length <= N32_WIDE_TWINS_AGREED && recordedWideTwins.length === 18;
  console.log("\nN4.5 criterion (no added false agreed relative to N3.2):");
  console.log(`  (1) best != true element agreed: recorded ${anyBest("recorded")} <= N3.2 ${N32_FALSE_AGREED_BEST_NOT_TRUE}: ${c1 ? "yes" : "NO"}`);
  console.log(`  (2) acceptance row per cell: ${perCell.map((r) => `${r.cell} ${r.recorded}<=${r.n32}`).join(", ")}; total ${totalAcc("recorded")}<=${N32_CROSS_ACCEPTANCE_TOTAL}: ${c2 ? "yes" : "NO"}`);
  console.log(`  (3) wide twins agreed: recorded ${recordedWideTwins.filter(agreed).length} <= N3.2 ${N32_WIDE_TWINS_AGREED}: ${c3 ? "yes" : "NO"}`);
  const met = c1 && c2 && c3;
  console.log(`  N4.5 criterion: ${met ? "MET" : "NOT MET"}`);
  record("every replay cell was measured against a recorded reference", cells.every((cell) => four.some((d) => d.source === "recorded" && cellOf(d.mode, d.dpr) === cell)), `${cells.length} cells`);
  return met;
}

const server = spawn(process.execPath, ["mock-site/server.mjs"], {
  env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
  stdio: ["ignore", "ignore", "inherit"],
  windowsHide: true
});

let exitCode = 0;
const previousFlag = process.env.AWKIT_VISUAL_RECORDER;
const work = await mkdtemp(join(tmpdir(), "awkit-recorder-baseline-"));
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
  process.env.AWKIT_VISUAL_RECORDER = "manual";
  const probe = await productionLaunch({ headless: true });
  const version = probe.version();
  await probe.close();
  console.log(`\nRecorder visual baseline calibration — Windows ${release()}, ${cpus().length} logical CPUs, Node ${process.version}, Chromium ${version}`);
  console.log(`  ${STYLES.length * TARGETS.length} recorded steps + ${STYLES.length} wide per DPR, ${CAPTURES_PER_STEP} captures each; replay ${SCENARIOS.length} scenarios, every candidate as DOM best, DPR ${DPRS.join("/")}, headed + headless; every launch fresh`);
  for (const dpr of DPRS) {
    process.stdout.write(`  Recorder (headed) DPR ${dpr} ... `);
    const recorded = await recordReferences(dpr, work);
    console.log("done");
    if (recorded.four.size !== STYLES.length * TARGETS.length || recorded.wide.size !== STYLES.length) continue;
    for (const headless of HEADLESS_MODES) {
      process.stdout.write(`    replay ${headless ? "headless" : "headed"} DPR ${dpr} ... `);
      await measureCell(headless, dpr, recorded);
      console.log("done");
    }
  }
  report();
  console.log("\nStructural rows:");
  for (const row of structural) console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.name}${row.detail ? `  [${row.detail}]` : ""}`);
  if (structural.some((row) => !row.ok)) exitCode = 1;
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  if (previousFlag === undefined) delete process.env.AWKIT_VISUAL_RECORDER;
  else process.env.AWKIT_VISUAL_RECORDER = previousFlag;
  server.kill();
  clearInterval(keepAlive);
  await rm(work, { recursive: true, force: true }).catch(() => undefined);
}
process.exit(exitCode);
