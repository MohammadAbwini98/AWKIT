/**
 * benchmark:visual-fusion — Phase N, N2.3 (awkit-vra.12.3) fusion calibration measurement. INFORMATIONAL.
 *
 * Drives the Feature Test Lab's /visual-intelligence/fusion toolbar on real Chromium, headless and headed, at device
 * scale factors 1, 1.25 and 2. For every variant (4 target positions x 3 base styles) it captures the reference from
 * the baseline state and then, per scenario, the DOM winner (the remembered position) and its three competitors
 * through the public capture -> evidence path, and records the relative statistic fusion uses:
 *
 *   c = best competitor score - winner score, in basis points (positive: a competitor looks more like the reference)
 *
 * From the raw distributions it derives the FD-9 margins with an explicit safety gap, or reports that there is no
 * separation (R8 stays disabled and N2 ships shadow-only). It then replays every sample through decideFusion under the
 * derived policy and counts vetoes, checks the unavailable/mismatch rows on real captures (F5 protected surface, F6
 * offscreen, F7 frame / popup / scale factor, F8 off), and attempts the real headed Ctrl+zoom capture check.
 *
 * Nothing it measures is asserted as a product gate. It exits non-zero only when the harness fails or a structural
 * row (R1/R2/R3, no scroll, no interaction) is wrong. No image leaves the process; `--json <path>` writes the numeric
 * samples only.
 *
 * The headed Ctrl+zoom check runs in its own browser with an un-emulated context (a deviceScaleFactor override pins
 * devicePixelRatio and hides browser zoom); `npm run benchmark:visual-fusion-zoom` runs that check alone.
 *
 * Run: npm run benchmark:visual-fusion [-- --headless-only] [-- --json <path>]
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

import { captureElement, captureViewport } from "@src/visual/capture";
import { compareVisualFingerprints } from "@src/visual/compare";
import { decideFusion, UNCALIBRATED_FUSION_POLICY, type FusionEvidenceInput, type FusionInput, type FusionPolicy } from "@src/visual/fusion/decideFusion";
import { buildVisualEvidence, type VisualEvidence } from "@src/visual/visualEvidence";

const PORT = 4426;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence/fusion`;
const DPRS = [1, 1.25, 2];
const STYLES = ["a", "b", "c"];
const TARGETS = [0, 1, 2, 3];
const NO_VETO = ["restyle-selected", "restyle-pressed", "theme-dark", "theme-contrast"];
const VETO_WANTED = ["swap"];
const SCENARIOS = ["baseline", ...NO_VETO, ...VETO_WANTED, "twins"];
/** FD-9 safety gap: each derived margin keeps at least this distance from the nearest measured sample. */
const SAFETY_GAP_BP = 500;
/** A DOM decision at the recovery margin (RECOVERY_MARGIN = 0.08) is the least decisive one fusion may see. */
const LAB_DOM_MARGIN = 0.08;
/** Policy anchors, not measurements: twice RECOVERY_MARGIN, and half the reference's CSS area. */
const DOM_DECISIVE_MARGIN_BP = 1600;
const MIN_SIZE_RATIO_BP = 5000;

const argv = process.argv.slice(2);
const HEADLESS_MODES = argv.includes("--headless-only") ? [true] : [true, false];
/** Only the headed Ctrl+zoom check (npm run benchmark:visual-fusion-zoom). */
const ZOOM_ONLY = argv.includes("--zoom-only");
const jsonFlag = argv.indexOf("--json");
const JSON_PATH = jsonFlag >= 0 ? argv[jsonFlag + 1] : undefined;

const keepAlive = setInterval(() => undefined, 1_000);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Sample {
  headless: boolean;
  dpr: number;
  style: string;
  target: number;
  scenario: string;
  winnerBp: number;
  bestBp: number;
  /** best competitor minus winner, bp */
  c: number;
  identical: boolean;
  minSizeRatioBp: number;
  evaluationMs: number;
}

const samples: Sample[] = [];
/** The captured evidence behind each sample, same index, kept in memory only for the decideFusion replay. */
const sampleEvidence: { reference: VisualEvidence; winner: VisualEvidence; competitors: VisualEvidence[] }[] = [];
const structural: { name: string; ok: boolean; detail: string }[] = [];
const zoom: { attempted: string[]; changedBy: string | null; before: number; after: number; detail: string[] } = {
  attempted: [],
  changedBy: null,
  before: 0,
  after: 0,
  detail: []
};

function record(name: string, ok: boolean, detail = ""): void {
  structural.push({ name, ok, detail });
}

async function evidenceOf(page: Page, target: Locator): Promise<FusionEvidenceInput> {
  const capture = await captureElement(page, target, { contextPaddingCss: 0 });
  if (!capture.ok) return { available: false, code: capture.code };
  const evidence = buildVisualEvidence(capture.value);
  return evidence.ok ? evidence.value : { available: false, code: evidence.code };
}

function isEvidence(input: FusionEvidenceInput): input is VisualEvidence {
  return (input as { available?: boolean }).available !== false;
}

function scoreBp(a: VisualEvidence, b: VisualEvidence): { bp: number; identical: boolean } {
  const result = compareVisualFingerprints(a.fingerprint, b.fingerprint);
  if (!result.ok) throw new Error(`compare failed: ${result.code}`);
  return { bp: Math.round(result.value.score * 10000), identical: result.value.identical };
}

function sizeRatioBp(a: VisualEvidence, b: VisualEvidence): number {
  const x = a.bounds!.actualCss.width * a.bounds!.actualCss.height;
  const y = b.bounds!.actualCss.width * b.bounds!.actualCss.height;
  return Math.floor((Math.min(x, y) * 10000) / Math.max(x, y));
}

function labInput(mode: FusionInput["mode"], reference: FusionEvidenceInput | null, winner: FusionEvidenceInput, competitors: FusionEvidenceInput[]): FusionInput {
  return {
    mode,
    eligibility: "eligible",
    dom: { layer: "local", winner: { score: 0.9 }, competitors: competitors.map(() => ({ score: 0.9 - LAB_DOM_MARGIN })), margin: LAB_DOM_MARGIN },
    reference,
    winner,
    competitors
  };
}

const tool = (scope: Page | ReturnType<Page["frameLocator"]>, index: number): Locator => scope.getByTestId(`vf-tool-${index}`);

async function setState(page: Page, state: { scenario: string; target: number; style: string }): Promise<void> {
  await page.evaluate((next) => (window as unknown as { __fusionLab: { setState(s: unknown): unknown } }).__fusionLab.setState(next), state);
  // Let the frame copy and paint settle before a capture.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function openLab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(LAB);
  await page.frameLocator('[data-testid="vf-frame"]').getByTestId("vf-tool-0").waitFor();
  return page;
}

const interactions = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __fusionLab: { interactions: number } }).__fusionLab.interactions);

async function measureDistributions(page: Page, headless: boolean, dpr: number): Promise<void> {
  for (const style of STYLES) {
    for (const target of TARGETS) {
      await setState(page, { scenario: "baseline", target, style });
      const reference = await evidenceOf(page, tool(page, target));
      if (!isEvidence(reference)) throw new Error(`reference capture failed: ${reference.code}`);
      for (const scenario of SCENARIOS) {
        await setState(page, { scenario, target, style });
        const started = performance.now();
        const winner = await evidenceOf(page, tool(page, target));
        const competitors: FusionEvidenceInput[] = [];
        for (const index of TARGETS) if (index !== target) competitors.push(await evidenceOf(page, tool(page, index)));
        const evaluationMs = performance.now() - started;
        if (!isEvidence(winner) || !competitors.every(isEvidence)) throw new Error(`${scenario} capture failed`);
        const w = scoreBp(reference, winner);
        const best = Math.max(...(competitors as VisualEvidence[]).map((c) => scoreBp(reference, c).bp));
        const ratios = [winner, ...(competitors as VisualEvidence[])].map((e) => sizeRatioBp(reference, e));
        samples.push({
          headless,
          dpr,
          style,
          target,
          scenario,
          winnerBp: w.bp,
          bestBp: best,
          c: best - w.bp,
          identical: w.identical,
          minSizeRatioBp: Math.min(...ratios),
          evaluationMs
        });
        sampleEvidence.push({ reference, winner, competitors: competitors as VisualEvidence[] });
      }
    }
  }
}

async function checkUnavailableRows(page: Page, context: BrowserContext, headless: boolean, dpr: number, referenceAtDpr1: VisualEvidence | null): Promise<VisualEvidence> {
  const label = `${headless ? "headless" : "headed"} DPR ${dpr}`;
  await setState(page, { scenario: "baseline", target: 0, style: "a" });
  const reference = await evidenceOf(page, tool(page, 0));
  if (!isEvidence(reference)) throw new Error("reference capture failed");
  const competitors = [] as FusionEvidenceInput[];
  for (const index of [1, 2, 3]) competitors.push(await evidenceOf(page, tool(page, index)));
  const before = await interactions(page);

  // F5 — every protected kind refuses, and the verdict is R2 with no effect.
  for (const kind of ["otp", "mfa", "captcha", "passkey"]) {
    await page.evaluate((k) => (window as unknown as { __fusionLab: { injectProtected(k: string): void } }).__fusionLab.injectProtected(k), kind);
    const winner = await evidenceOf(page, tool(page, 0));
    const verdict = decideFusion(labInput("enforce-veto", reference, winner, competitors));
    record(`F5 ${kind} refused, R2 (${label})`, !isEvidence(winner) && winner.code === "PROTECTED_SURFACE" && verdict.outcome === "dom-only" && verdict.reason === "protected-surface" && verdict.effect === "none", `${verdict.outcome}/${verdict.reason}`);
    await page.evaluate(() => (window as unknown as { __fusionLab: { removeProtected(): void } }).__fusionLab.removeProtected());
  }

  // F6 — an offscreen winner is refused without scrolling to it.
  const offscreen = await evidenceOf(page, page.getByTestId("vf-offscreen-tool"));
  const f6 = decideFusion(labInput("enforce-veto", reference, offscreen, competitors));
  const scrollY = await page.evaluate(() => window.scrollY);
  record(`F6 offscreen refused, R2, no scroll (${label})`, !isEvidence(offscreen) && offscreen.code === "TARGET_OFFSCREEN" && f6.reason === "target-offscreen" && f6.effect === "none" && scrollY === 0, `${f6.outcome}/${f6.reason} scrollY=${scrollY}`);

  // F7 — the frame copy is depth 1 against a depth-0 reference: R3.
  const framed = await evidenceOf(page, tool(page.frameLocator('[data-testid="vf-frame"]'), 0));
  const f7frame = decideFusion(labInput("enforce-veto", reference, framed, competitors));
  record(`F7 frame copy gives R3 (${label})`, isEvidence(framed) && framed.frame?.depth === 1 && f7frame.reason === "conditions-changed" && f7frame.effect === "none", `${f7frame.outcome}/${f7frame.reason}`);

  // F7 — a winner captured at another scale factor than the reference: R3.
  if (referenceAtDpr1 && dpr !== 1) {
    const f7dpr = decideFusion(labInput("enforce-veto", referenceAtDpr1, reference, competitors));
    record(`F7 DPR 1 reference vs DPR ${dpr} winner gives R3 (${label})`, f7dpr.reason === "conditions-changed" && f7dpr.effect === "none", `${f7dpr.outcome}/${f7dpr.reason}`);
  }

  // F8 — fusion off is R1 whatever the evidence says.
  const f8 = decideFusion(labInput("off", reference, competitors[0], competitors), UNCALIBRATED_FUSION_POLICY);
  record(`F8 fusion off is R1 (${label})`, f8.outcome === "unchecked" && f8.reason === "fusion-off" && f8.effect === "none", `${f8.outcome}/${f8.reason}`);

  const after = await interactions(page);
  record(`captures cause no interaction (${label})`, after === before, `${before} -> ${after}`);

  // F7 — the popup has another viewport: R3. Opening it is the harness's own click.
  const [popup] = await Promise.all([context.waitForEvent("page"), page.getByTestId("vf-open-popup").click()]);
  await popup.waitForLoadState();
  await tool(popup, 0).waitFor();
  const popped = await evidenceOf(popup, tool(popup, 0));
  const f7popup = decideFusion(labInput("enforce-veto", reference, popped, competitors));
  record(`F7 popup gives R3 (${label})`, isEvidence(popped) && f7popup.reason === "conditions-changed" && f7popup.effect === "none", `${f7popup.outcome}/${f7popup.reason}`);
  await popup.close();
  return reference;
}

async function dprOf(page: Page): Promise<number> {
  return page.evaluate(() => window.devicePixelRatio);
}

/**
 * Win32 only: a real OS keystroke to the headed Chromium window. The lone Alt press first releases the Windows
 * foreground lock, without which AppActivate can report success while the window never takes the keys.
 */
function osKeystroke(keys: string): Promise<string> {
  const script = `$w = New-Object -ComObject WScript.Shell; $w.SendKeys('%'); if ($w.AppActivate('Visual Fusion Calibration Lab')) { Start-Sleep -Milliseconds 400; $w.SendKeys('${keys}'); 'sent' } else { 'not-activated' }`;
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk) => (out += String(chunk)));
    child.on("error", (error) => resolve(`spawn-error ${error.message}`));
    child.on("close", () => resolve(out.trim()));
  });
}

async function headedCtrlZoom(page: Page, reference: VisualEvidence): Promise<void> {
  zoom.before = await dprOf(page);
  const changed = async (): Promise<boolean> => {
    await sleep(600);
    return (await dprOf(page)) !== zoom.before;
  };
  await page.bringToFront();
  zoom.attempted.push("playwright keyboard Control+Equal");
  await page.keyboard.press("Control+Equal");
  if (await changed()) zoom.changedBy = "playwright keyboard";
  if (!zoom.changedBy) {
    zoom.attempted.push("playwright Control + mouse wheel");
    await page.mouse.move(600, 400);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    if (await changed()) zoom.changedBy = "playwright wheel";
  }
  let reset: () => Promise<void> = async () => {
    await page.keyboard.press("Control+Digit0");
  };
  for (const keys of ["^{ADD}", "^="]) {
    if (zoom.changedBy || process.platform !== "win32") break;
    zoom.attempted.push(`OS SendKeys ${keys}`);
    zoom.detail.push(`SendKeys ${keys}: ${await osKeystroke(keys)}`);
    if (await changed()) {
      zoom.changedBy = `OS SendKeys ${keys}`;
      reset = async () => {
        zoom.detail.push(`reset SendKeys: ${await osKeystroke("^0")}`);
      };
    }
  }
  zoom.after = await dprOf(page);
  if (!zoom.changedBy) return;

  const box = await tool(page, 0).boundingBox();
  const viewport = await captureViewport(page);
  const element = await captureElement(page, tool(page, 0), { contextPaddingCss: 0 });
  zoom.detail.push(`viewport capture: ${viewport.ok ? `ok scale ${viewport.value.viewport.scaleX.toFixed(4)} css ${viewport.value.viewport.cssWidth}x${viewport.value.viewport.cssHeight}` : `${viewport.code} (${viewport.message})`}`);
  // The raw numbers the capture guard compares, so a refusal can be explained.
  const metrics = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio, pinch: window.visualViewport?.scale ?? 1 }));
  const shot = await page.screenshot({ type: "png", scale: "device" });
  const shotWidth = shot.readUInt32BE(16);
  const shotHeight = shot.readUInt32BE(20);
  zoom.detail.push(`zoomed metrics: css ${metrics.w}x${metrics.h}, dpr ${metrics.dpr}, visualViewport.scale ${metrics.pinch}, screenshot ${shotWidth}x${shotHeight} = scale ${(shotWidth / metrics.w).toFixed(4)} x ${(shotHeight / metrics.h).toFixed(4)}`);
  if (element.ok && box) {
    const crop = element.value.element;
    const css = crop.actualCssBounds;
    const boundsOk = Math.abs(css.x - box.x) <= 1 && Math.abs(css.y - box.y) <= 1 && Math.abs(css.width - box.width) <= 1 && Math.abs(css.height - box.height) <= 1;
    // Sample inside the left padding, clear of the 1px border and the icon: the style-a fill #2563eb.
    const px = Math.round(4 * element.value.viewport.scaleX);
    const py = Math.floor(crop.image.height / 2);
    const at = (py * crop.image.width + px) * 4;
    const [r, g, b] = [crop.image.data[at], crop.image.data[at + 1], crop.image.data[at + 2]];
    const fillOk = Math.abs(r - 0x25) <= 12 && Math.abs(g - 0x63) <= 12 && Math.abs(b - 0xeb) <= 12;
    const evidence = buildVisualEvidence(element.value);
    const verdict = evidence.ok ? decideFusion(labInput("enforce-veto", reference, evidence.value, [])) : null;
    zoom.detail.push(`element capture: ok, bounds match boundingBox ${boundsOk}, fill rgb(${r},${g},${b}) ${fillOk ? "matches" : "DOES NOT match"} #2563eb`);
    zoom.detail.push(`unzoomed reference vs zoomed winner: ${verdict ? `${verdict.outcome}/${verdict.reason}` : "evidence failed"}`);
    record("Ctrl+zoom element capture maps to the right pixels", boundsOk && fillOk, `DPR ${zoom.before} -> ${zoom.after}`);
    record("Ctrl+zoom against an unzoomed reference gives R3", !!verdict && verdict.reason === "conditions-changed" && verdict.effect === "none", verdict ? verdict.reason : "none");
  } else {
    // A refusal is an acceptable outcome; a wrong crop is not, and there is no crop here.
    zoom.detail.push(`element capture refused: ${element.ok ? "no bounding box" : `${element.code} (${element.message})`}`);
    record("Ctrl+zoom capture refuses rather than mis-crops", !element.ok, element.ok ? "no box" : element.code);
  }
  await reset();
  await sleep(600);
  zoom.detail.push(`after reset DPR ${await dprOf(page)}`);
}

function quantiles(values: number[]): string {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return `n=${s.length} min ${s[0]} p05 ${at(0.05)} median ${at(0.5)} p95 ${at(0.95)} max ${s[s.length - 1]}`;
}

function derivePolicy(): { policy: FusionPolicy; separated: boolean; maxNoVeto: number; minVeto: number; gap: number } {
  const noVeto = samples.filter((s) => NO_VETO.includes(s.scenario)).map((s) => s.c);
  const veto = samples.filter((s) => VETO_WANTED.includes(s.scenario)).map((s) => s.c);
  const maxNoVeto = Math.max(...noVeto);
  const minVeto = Math.min(...veto);
  const gap = minVeto - maxNoVeto;
  const separated = gap >= 2 * SAFETY_GAP_BP;
  // R6 must never corroborate a look-alike swap: the winner leads by at most -minVeto there.
  const corroborate = Math.max(SAFETY_GAP_BP, -minVeto + SAFETY_GAP_BP);
  const contradict = separated ? maxNoVeto + SAFETY_GAP_BP : Math.max(1, maxNoVeto + SAFETY_GAP_BP);
  return {
    separated,
    maxNoVeto,
    minVeto,
    gap,
    policy: {
      calibrated: true,
      corroborateMarginBp: Math.min(10000, corroborate),
      contradictMarginBp: Math.min(10000, Math.max(1, contradict)),
      domDecisiveMarginBp: DOM_DECISIVE_MARGIN_BP,
      minSizeRatioBp: MIN_SIZE_RATIO_BP,
      contradictionEnabled: separated
    }
  };
}

/** Replays one sample's captured evidence through the real decideFusion in enforce-veto mode on an eligible step. */
function replay(index: number, policy: FusionPolicy): string {
  const { reference, winner, competitors } = sampleEvidence[index];
  const verdict = decideFusion(labInput("enforce-veto", reference, winner, competitors), policy);
  return `${verdict.outcome}/${verdict.reason}${verdict.effect === "veto" ? "/veto" : ""}`;
}

const server = spawn(process.execPath, ["mock-site/server.mjs"], {
  env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
  stdio: ["ignore", "ignore", "inherit"],
  windowsHide: true
});

let browser: Browser | undefined;
let exitCode = 0;
try {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(LAB)).ok) break;
    } catch {
      // Not up yet.
    }
    await sleep(100);
  }
  if (!ZOOM_ONLY) await runCalibration();
  if (ZOOM_ONLY || HEADLESS_MODES.includes(false)) {
    // Own headed browser and an un-emulated context: a deviceScaleFactor override pins devicePixelRatio and would
    // hide a real browser zoom.
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ viewport: null });
    const page = await openLab(context);
    await setState(page, { scenario: "baseline", target: 0, style: "a" });
    const reference = await evidenceOf(page, tool(page, 0));
    if (!isEvidence(reference)) throw new Error(`zoom reference capture failed: ${reference.code}`);
    await headedCtrlZoom(page, reference);
    await browser.close();
    browser = undefined;
  }

  console.log("\nStructural rows:");
  for (const row of structural) console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.name}${row.detail ? `  [${row.detail}]` : ""}`);
  if (ZOOM_ONLY || HEADLESS_MODES.includes(false)) {
    console.log(`\nHeaded Ctrl+zoom: DPR ${zoom.before} -> ${zoom.after}; attempted ${zoom.attempted.join(", ")}; ${zoom.changedBy ? `zoom applied by ${zoom.changedBy}` : "NO METHOD CHANGED THE ZOOM — NOT RUN"}`);
    for (const line of zoom.detail) console.log(`  ${line}`);
  }
  if (structural.some((row) => !row.ok)) exitCode = 1;
  if (JSON_PATH) writeFileSync(JSON_PATH, JSON.stringify({ samples, structural, zoom }, null, 2));
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  server.kill();
  clearInterval(keepAlive);
}
process.exit(exitCode);

async function runCalibration(): Promise<void> {
  console.log(`\nVisual fusion calibration — ${TARGETS.length * STYLES.length} variants x ${SCENARIOS.length} scenarios, DPR ${DPRS.join("/")}, ${HEADLESS_MODES.map((h) => (h ? "headless" : "headed")).join(" + ")}\n`);
  for (const headless of HEADLESS_MODES) {
    browser = await chromium.launch({ headless });
    let referenceAtDpr1: VisualEvidence | null = null;
    for (const dpr of DPRS) {
      const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr });
      const page = await openLab(context);
      const started = performance.now();
      await measureDistributions(page, headless, dpr);
      const reference = await checkUnavailableRows(page, context, headless, dpr, referenceAtDpr1);
      if (dpr === 1) referenceAtDpr1 = reference;
      console.log(`  ${headless ? "headless" : "headed  "} DPR ${dpr}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
      await context.close();
    }
    await browser.close();
    browser = undefined;
  }

  console.log("\nRaw c = best competitor - winner (bp), per scenario:");
  for (const scenario of SCENARIOS) console.log(`  ${scenario.padEnd(17)} ${quantiles(samples.filter((s) => s.scenario === scenario).map((s) => s.c))}`);
  console.log("\nWinner score (bp), per scenario:");
  for (const scenario of SCENARIOS) console.log(`  ${scenario.padEnd(17)} ${quantiles(samples.filter((s) => s.scenario === scenario).map((s) => s.winnerBp))}`);
  console.log("\nPer group, max c over no-veto vs min c over swap:");
  for (const headless of HEADLESS_MODES) {
    for (const dpr of DPRS) {
      const group = samples.filter((s) => s.headless === headless && s.dpr === dpr);
      const maxN = Math.max(...group.filter((s) => NO_VETO.includes(s.scenario)).map((s) => s.c));
      const minV = Math.min(...group.filter((s) => VETO_WANTED.includes(s.scenario)).map((s) => s.c));
      console.log(`  ${headless ? "headless" : "headed  "} DPR ${String(dpr).padEnd(4)} maxNoVeto ${maxN}  minSwap ${minV}  gap ${minV - maxN}`);
    }
  }
  const timing = samples.filter((s) => s.scenario !== "baseline").map((s) => Math.round(s.evaluationMs));
  console.log(`\nWinner + 3 competitor captures per evaluation (ms): ${quantiles(timing)}`);

  const derived = derivePolicy();
  console.log(`\nSeparation: max c over F1/F4 = ${derived.maxNoVeto}, min c over F2 = ${derived.minVeto}, gap ${derived.gap} bp, required ${2 * SAFETY_GAP_BP} (safety gap ${SAFETY_GAP_BP} each side)`);
  console.log(derived.separated ? "SEPARATED: R8 may be enabled with the derived margins." : "NOT SEPARATED: R8 stays disabled; N2 ships shadow-only (FD-9).");
  console.log(`Derived policy: ${JSON.stringify(derived.policy)}`);

  const outcomes = new Map<string, Map<string, number>>();
  const replayed = samples.map((sample, index) => replay(index, derived.policy));
  samples.forEach((sample, index) => {
    const row = outcomes.get(sample.scenario) ?? new Map<string, number>();
    row.set(replayed[index], (row.get(replayed[index]) ?? 0) + 1);
    outcomes.set(sample.scenario, row);
  });
  console.log("\nOutcomes under the derived policy (enforce-veto, eligible, DOM margin 0.08):");
  for (const scenario of SCENARIOS) {
    const row = outcomes.get(scenario)!;
    console.log(`  ${scenario.padEnd(17)} ${[...row.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }
  const count = (scenarios: string[], prefix: string): number => samples.filter((s, i) => scenarios.includes(s.scenario) && replayed[i].startsWith(prefix)).length;
  const falseVetoes = count(NO_VETO, "contradicted");
  const swapVetoes = count(VETO_WANTED, "contradicted");
  const swapCorroborated = count(VETO_WANTED, "corroborated");
  console.log(`  false vetoes on F1/F4: ${falseVetoes}; F2 vetoed: ${swapVetoes}/${samples.filter((s) => VETO_WANTED.includes(s.scenario)).length}; F2 corroborated: ${swapCorroborated}`);
  record("derived policy never vetoes F1/F4", falseVetoes === 0, String(falseVetoes));
  record("derived policy never corroborates F2", swapCorroborated === 0, String(swapCorroborated));
}
