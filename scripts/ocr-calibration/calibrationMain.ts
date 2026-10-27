/**
 * N7.6 (awkit-vra.9.7) OCR calibration session: an Electron MAIN-process entry, esbuilt by `benchmark:ocr` into
 * `out/ocr-calibration/` (never packaged, never reachable from the app, an IPC channel, a setting or a run).
 *
 * One process run is ONE session. Within its time budget it runs real browser launches round-robin over the six cells
 * (headed and headless x DPR 1, 1.25 and 2): a fresh Playwright Chromium per launch, the Image Text Assertion Lab in
 * calibration mode, and each trial through the REAL `FlowExecutor` -> `StepExecutor` -> `OcrStep` (the guarded N0
 * capture, N7.2 preprocessing and decision) with the REAL `OcrUtilityHostManager` and its Tesseract host, so the
 * recorded duration is the product's whole-operation clock. A pass-through recognizer measures the host and computes the
 * CER edit count in memory; the recognized text is dropped before anything is written.
 *
 * Evidence (one JSON file per session under the evidence folder) holds codes, counts and timings only. Nothing here
 * writes recognized or expected text, pixels, selectors or credentials. Results go to stdout as `OCRCAL ` JSON lines.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { chromium, type Browser, type Page } from "playwright";

import { OcrUtilityHostManager } from "@main/ocr/OcrUtilityHostManager";
import { expectedOcrAssetHashes } from "@main/ocr/ocrRuntime";
import { buildChromiumHardeningArgs } from "@src/runner/ChromiumHardening";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { ManualHandoffController } from "@src/runner/ManualHandoffController";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { OcrStep, type OcrAssertionPhase } from "@src/runner/ocr/OcrStep";
import type { OcrAssertionRecord, OcrRecognizer } from "@src/runner/ocr/ocrAssertionContract";
import type { OcrHostImage, OcrHostOutcome } from "@src/ocr/OcrHostProtocol";
import { decodePng } from "@src/visual/png";
import {
  OCR_CALIBRATION_CELLS,
  cellIdOf,
  cerText,
  evaluateOcrCell,
  levenshtein,
  type OcrCalibrationCell,
  type OcrCalibrationLaunch,
  type OcrCalibrationTrial,
  type OcrFixtureClass
} from "../lib/ocr-calibration-criteria.mts";
import { runEmulationProbe } from "../lib/ocr-emulation-probe.mts";

interface Fixture {
  id: string;
  class: OcrFixtureClass;
  minDevicePixelRatio?: number;
  text: string;
  expected: string;
  match: "exact" | "contains" | "normalized";
  expectCode?: string;
}

const LAB = process.env.AWKIT_OCR_CAL_LAB_URL ?? "";
const BUDGET_MS = Number.parseInt(process.env.AWKIT_OCR_CAL_BUDGET_MS ?? "", 10);
const EVIDENCE_DIR = process.env.AWKIT_OCR_CAL_EVIDENCE_DIR ?? "";
const ASSET_DIR = process.env.AWKIT_OCR_CAL_ASSET_DIR ?? "";
const HOST_PATH = process.env.AWKIT_OCR_CAL_HOST_PATH ?? "";
const DIAGNOSTIC = process.env.AWKIT_OCR_CAL_DIAGNOSTIC === "1";
const SHARED_ENV = JSON.parse(process.env.AWKIT_OCR_CAL_ENV ?? "{}") as Record<string, unknown>;
const VIEWPORT = { width: 800, height: 600 };
/** Every fifth launch of a cell also runs the refusal fixtures. */
const REFUSALS_EVERY = 5;
/** Every 15th launch of a session is an extra cold-host probe launch (never counted toward the 300). */
const COLD_PROBE_EVERY = 15;
const LAUNCH_LIMIT_MS = 120_000;

const emit = (kind: string, data: Record<string, unknown> = {}) => console.log(`OCRCAL ${JSON.stringify({ kind, ...data })}`);

async function writeAtomically(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value)}\n`, "utf8");
  await rename(tmp, path);
}

function within<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  work.catch(() => undefined);
  return Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(label)), ms)))]).finally(() => clearTimeout(timer));
}

/** Per-trial measurement state, filled by the probe and the pass-through recognizer; text is never kept. */
interface TrialState {
  expected: string;
  start: number;
  phases: Record<string, number>;
  edits: number | null;
  hostRecognizeMs?: number;
  recognizeCallMs?: number;
}
let current: TrialState | null = null;
const mark = (name: string) => {
  if (current) current.phases[name] = Math.round(performance.now() - current.start);
};

/** Passes every request to the real manager; measures it and computes the CER edit count in memory. */
class MeasuringRecognizer implements OcrRecognizer {
  constructor(public manager: OcrUtilityHostManager) {}
  prepare(): void {
    this.manager.prepare();
  }
  async recognize(image: OcrHostImage, options: { deadlineMs: number; signal?: AbortSignal }): Promise<OcrHostOutcome> {
    const trial = current;
    const started = performance.now();
    const outcome = await this.manager.recognize(image, options);
    if (trial === current && trial) {
      trial.recognizeCallMs = Math.round(performance.now() - started);
      if (outcome.ok) {
        trial.hostRecognizeMs = outcome.recognizeMs;
        // In memory only: the recognized text lives in this expression and is never stored.
        trial.edits = levenshtein(cerText(outcome.words.map((w) => w.text).join(" ")), cerText(trial.expected));
      }
    }
    return outcome;
  }
}

async function readSessions(): Promise<Array<{ launches: OcrCalibrationLaunch[] }>> {
  const out: Array<{ launches: OcrCalibrationLaunch[] }> = [];
  for (const name of (await readdir(EVIDENCE_DIR).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort()) {
    try {
      const parsed = JSON.parse(await readFile(join(EVIDENCE_DIR, name), "utf8")) as { version?: number; launches?: OcrCalibrationLaunch[] };
      if (parsed?.version === 1 && Array.isArray(parsed.launches)) out.push({ launches: parsed.launches });
    } catch {
      // An unreadable session file contributes no evidence.
    }
  }
  return out;
}

const classIn = (fixture: Fixture, cell: OcrCalibrationCell): OcrFixtureClass =>
  fixture.minDevicePixelRatio !== undefined && cell.devicePixelRatio < fixture.minDevicePixelRatio ? "unsupported" : fixture.class;

async function run(): Promise<number> {
  if (app.isPackaged) {
    emit("refused", { reason: "the OCR calibration harness runs only from source" });
    return 3;
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(LAB) || !Number.isFinite(BUDGET_MS) || BUDGET_MS <= 0 || !EVIDENCE_DIR || !ASSET_DIR || !HOST_PATH) {
    emit("refused", { reason: "lab URL, budget, evidence, asset and host paths are required" });
    return 2;
  }
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const table = (await (await fetch(`${new URL(LAB).origin}/visual-intelligence/ocr-fixtures.json`)).json()) as { fixtures: Fixture[] };
  const fixtures = table.fixtures;
  const emulation = runEmulationProbe();
  const sessionId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`;
  const sessionPath = join(EVIDENCE_DIR, `${sessionId}.json`);
  const session = {
    version: 1 as const,
    sessionId,
    startedAt: new Date().toISOString(),
    endedAt: undefined as string | undefined,
    budgetMs: BUDGET_MS,
    diagnostic: DIAGNOSTIC,
    appCommit: SHARED_ENV.appCommit ?? "unknown",
    emulation: { electron: emulation, orchestrator: SHARED_ENV.orchestratorEmulation ?? null },
    launches: [] as OcrCalibrationLaunch[],
    errors: [] as Array<{ cell: string; at: string; message: string }>,
    replays: [] as Array<{ cell: string; screenshotMs: number; decodeMs: number; pixels: number }>
  };
  await writeAtomically(sessionPath, session);

  const expected = expectedOcrAssetHashes();
  const newManager = () => new OcrUtilityHostManager({ hostPath: HOST_PATH, assetDir: ASSET_DIR, expected });
  const recognizer = new MeasuringRecognizer(newManager());

  // Prior evidence of this environment sets each cell's rotation index, so fixtures keep their cadence across sessions.
  const prior = (await readSessions()).flatMap((s) => s.launches).filter((l) => !l.coldProbe && l.diagnostic === DIAGNOSTIC);
  const counts = new Map(OCR_CALIBRATION_CELLS.map((cell) => [cellIdOf(cell), prior.filter((l) => cellIdOf(l.cell) === cellIdOf(cell)).length]));
  emit("session", { sessionId, budgetMs: BUDGET_MS, diagnostic: DIAGNOSTIC, priorLaunches: prior.length, emulation });

  const environmentFor = (browser: Browser): Record<string, unknown> => ({
    ...SHARED_ENV.fingerprint as Record<string, unknown>,
    electron: process.versions.electron,
    chromium: browser.version(),
    processArch: process.arch,
    engineAssets: expected,
    viewport: VIEWPORT
  });

  async function oneLaunch(cell: OcrCalibrationCell, n: number, coldProbe: boolean): Promise<OcrCalibrationLaunch> {
    const launch: OcrCalibrationLaunch = {
      launchId: randomBytes(8).toString("hex"),
      sessionId,
      cell,
      environment: {},
      diagnostic: DIAGNOSTIC,
      coldProbe,
      complete: false,
      trials: []
    };
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: cell.renderMode === "headless", args: buildChromiumHardeningArgs(process.env) });
      launch.environment = environmentFor(browser);
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: cell.devicePixelRatio });
      const page = await context.newPage();
      await page.goto(`${LAB}?calibration=1`);
      await page.waitForSelector("body[data-fonts][data-fixtures]");
      const fonts = await page.getAttribute("body", "data-fonts");
      if (fonts !== "ready" && !DIAGNOSTIC) throw new Error("fonts-missing: the bundled OCR Lab font did not load");
      const byClass = (c: OcrFixtureClass) => fixtures.filter((f) => classIn(f, cell) === c);
      const supported = byClass("supported");
      const confusable = byClass("confusable");
      const unsupported = byClass("unsupported");
      const chosen: Fixture[] = coldProbe
        ? [supported[n % supported.length]]
        : [
            supported[(3 * n) % supported.length],
            supported[(3 * n + 1) % supported.length],
            supported[(3 * n + 2) % supported.length],
            confusable[n % confusable.length],
            unsupported[n % unsupported.length],
            ...(n % REFUSALS_EVERY === 0 ? byClass("refusal") : [])
          ];
      for (const [index, fixture] of chosen.entries()) {
        launch.trials.push(await trial(page, cell, fixture));
        // One replay per launch (outside every clock): the N0 composition, a timed screenshot and PNG decode of the same
        // viewport. In memory only; the pixels are dropped at once.
        if (index === 0 && !coldProbe) {
          const s0 = performance.now();
          const bytes = await page.screenshot({ animations: "disabled", caret: "hide" });
          const s1 = performance.now();
          const image = decodePng(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
          const s2 = performance.now();
          session.replays.push({ cell: cellIdOf(cell), screenshotMs: Math.round(s1 - s0), decodeMs: Math.round(s2 - s1), pixels: image.width * image.height });
        }
      }
      launch.complete = true;
    } catch (error) {
      launch.error = (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200);
    } finally {
      await within(browser?.close() ?? Promise.resolve(), 15_000, "close").catch(() => undefined);
    }
    return launch;
  }

  async function trial(page: Page, cell: OcrCalibrationCell, fixture: Fixture): Promise<OcrCalibrationTrial> {
    await page.evaluate((id) => (window as unknown as { __ocrCalibration: { show(id: string): Promise<string> } }).__ocrCalibration.show(id), fixture.id);
    await page.waitForSelector(`#ocf-stage[data-shown="${fixture.id}"]`);
    const fixtureClass = classIn(fixture, cell);
    const coldHost = recognizer.manager.status().pid === null;
    let captures = 0;
    const adapter = new OcrStep({
      recognizer,
      probe: {
        onCapture: () => {
          captures += 1;
          mark("capture-start");
        },
        onRecognize: () => mark("recognize-start"),
        onPhase: (phase: OcrAssertionPhase) => mark(phase)
      }
    });
    const context = {
      executionId: `ocr-cal-${sessionId}`,
      instanceId: "cal",
      scenarioId: "n7-6",
      flowId: "ocr-calibration",
      instanceOrderNumber: 1,
      totalInstances: 1,
      runtimeInputs: {},
      instanceInputs: {},
      flowOutputs: {},
      paths: { downloads: EVIDENCE_DIR, screenshots: EVIDENCE_DIR, logs: EVIDENCE_DIR, reports: EVIDENCE_DIR }
    } as unknown as InstanceExecutionContext;
    const records: OcrAssertionRecord[] = [];
    const stepExecutor = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(context), context, new ManualHandoffController());
    stepExecutor.setOcrAssertion({
      mode: "observe",
      assessor: async () => ({
        assess: (request) => {
          mark("assess-start");
          return adapter.assess(request);
        }
      }),
      handedOff: () => false,
      onRecord: (record) => records.push(record)
    });
    const flowExecutor = new FlowExecutor(stepExecutor, undefined, undefined, undefined, false);
    const step = {
      id: `cal-${fixture.id}`,
      name: "Calibration observation",
      type: "assertImageText",
      locator: { strategy: "testId", value: "ocf-stage" },
      value: fixture.expected,
      config: { ocrMatch: fixture.match }
    } as unknown as FlowStep;
    // Event-loop lag across the trial (scheduling delay of the settlement): the largest late tick of a 10 ms interval.
    let maxLag = 0;
    let last = performance.now();
    const lag = setInterval(() => {
      const now = performance.now();
      maxLag = Math.max(maxLag, now - last - 10);
      last = now;
    }, 10);
    current = { expected: fixture.expected, start: performance.now(), phases: {}, edits: null };
    const state = current;
    try {
      await (flowExecutor as unknown as { executeWithRetry(s: FlowStep, c: InstanceExecutionContext): Promise<unknown> }).executeWithRetry(step, context);
    } finally {
      clearInterval(lag);
      current = null;
    }
    const record = records[0];
    const phases = { ...state.phases, wallMs: Math.round(performance.now() - state.start), maxLoopLagMs: Math.round(maxLag) };
    if (state.hostRecognizeMs !== undefined) phases.hostRecognizeMs = state.hostRecognizeMs;
    if (state.recognizeCallMs !== undefined) phases.recognizeCallMs = state.recognizeCallMs;
    return {
      fixtureId: fixture.id,
      fixtureClass,
      verdict: (record?.verdict ?? "inconclusive") as OcrCalibrationTrial["verdict"],
      code: record?.code ?? "no-record",
      durationMs: record?.durationMs ?? phases.wallMs,
      edits: state.edits,
      expectedChars: cerText(fixture.expected).length,
      ...(fixture.expectCode ? { expectedCode: fixture.expectCode } : {}),
      captures,
      coldHost,
      phases
    };
  }

  const deadline = Date.now() + BUDGET_MS;
  let sequence = 0;
  try {
    while (Date.now() < deadline) {
      for (const cell of OCR_CALIBRATION_CELLS) {
        if (Date.now() >= deadline) break;
        sequence += 1;
        const coldProbe = sequence % COLD_PROBE_EVERY === 0;
        if (coldProbe) {
          await recognizer.manager.dispose();
          recognizer.manager = newManager();
        }
        const id = cellIdOf(cell);
        const n = coldProbe ? sequence : counts.get(id) ?? 0;
        if (!coldProbe) counts.set(id, n + 1);
        const launch = await within(oneLaunch(cell, n, coldProbe), LAUNCH_LIMIT_MS, `launch exceeded ${LAUNCH_LIMIT_MS} ms`).catch((error: unknown) => {
          session.errors.push({ cell: id, at: new Date().toISOString(), message: String(error instanceof Error ? error.message : error).slice(0, 200) });
          return null;
        });
        if (launch) {
          session.launches.push(launch);
          if (launch.error?.startsWith("fonts-missing")) {
            emit("blocked", { reason: launch.error });
            await writeAtomically(sessionPath, session);
            return 4;
          }
        }
        await writeAtomically(sessionPath, session);
      }
    }
  } finally {
    await recognizer.manager.dispose().catch(() => undefined);
  }

  session.endedAt = new Date().toISOString();
  await writeAtomically(sessionPath, session);
  const all = (await readSessions()).flatMap((s) => s.launches);
  for (const cell of OCR_CALIBRATION_CELLS) {
    const environment = [...session.launches].reverse().find((l) => cellIdOf(l.cell) === cellIdOf(cell) && !l.coldProbe && l.complete)?.environment;
    if (!environment) {
      emit("cell", { cell: cellIdOf(cell), qualified: false, unmet: ["no complete launch in this session"] });
      continue;
    }
    emit("cell", { ...evaluateOcrCell(cell, environment, all, { diagnostic: DIAGNOSTIC }), diagnostic: DIAGNOSTIC });
  }
  emit("done", { sessionId, launches: session.launches.length, errors: session.errors.length, evidence: sessionPath });
  return 0;
}

app.disableHardwareAcceleration();
app.on("window-all-closed", () => undefined);
void app.whenReady().then(async () => {
  let code = 1;
  try {
    code = await run();
  } catch (error) {
    emit("error", { message: (error instanceof Error ? error.message : String(error)).split("\n")[0] });
  }
  app.exit(code);
});
