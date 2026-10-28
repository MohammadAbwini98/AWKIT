/**
 * benchmark:ocr-engine-spike — Phase N, N7.6 (awkit-vra.9.7). DIAGNOSTIC ONLY (owner approval 2026-10-28): a bounded
 * comparison of alternative OCR engines and recognition data, already on this machine, against the GO / NO-GO
 * criteria fixed beforehand in scripts/lib/ocr-engine-spike-criteria.mts. It never counts toward OC-10, writes no
 * calibration session, and changes no production verdict, threshold, deadline, pin, engine, N0 or host policy.
 *
 * Candidates (nothing is downloaded; every Tesseract file comes from the lockfile-pinned scripts/ocr-feasibility
 * install, is hashed here and verified again by the host before it loads):
 *  - c0-lstm-best: the production pin (tesseract-core-simd-lstm, 4.0.0_best_int, LSTM), the control;
 *  - c1-lstm-standard: the same engine with the standard 4.0.0 data's LSTM model;
 *  - c2-legacy-standard: tesseract-core-simd with the 4.0.0 data, legacy engine only;
 *  - c3-combined-standard: tesseract-core-simd with the 4.0.0 data, legacy and LSTM combined;
 *  - c4-windows: the Windows built-in recognizer (Windows.Media.Ocr) through a PowerShell bridge; it reports no
 *    confidence, so it is judged only as a composite's second reader;
 *  - k1/k2/k3: composites that keep c0's verdict but demote text-matched unless c2, c4 or c1 also read the expected
 *    text. They can only remove matches, never add one.
 *
 * Each launch renders every fixture on the OCR Lab stage (bundled font), captures it with the production N0
 * captureElement and preprocessForOcr, and gives the same plane to every candidate. The Tesseract hosts are forked
 * fresh per launch, so each launch also measures a cold first recognition. Trials are reduced to codes and numbers at
 * once; the aggregate report goes to %LOCALAPPDATA%/SpecterStudio/ocr-calibration/engine-spike after
 * assertAggregateOnly proves it holds no text.
 *
 * Exit: 0 report written; 2 BLOCKED (font, spike install or a pin mismatch); 1 error.
 */
import { createHash, randomBytes } from "node:crypto";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";

import { captureElement } from "@src/visual/capture";
import { preprocessForOcr } from "@src/visual/ocr/preprocess";
import { decideTextAssertion, TEXT_ASSERTION_CODES, TEXT_ASSERTION_INPUT_VERSION, type OcrWord, type TextAssertionMatchMode } from "@src/visual/ocr/decideTextAssertion";
import { buildChromiumHardeningArgs } from "@src/runner/ChromiumHardening";
import { OCR_CALIBRATION_CELLS, cellIdOf, latencySummary, percentile } from "./lib/ocr-calibration-criteria.mts";
import { assertAggregateOnly, quantiles } from "./lib/ocr-ambiguity-analysis.mts";
import { ENGINE_SPIKE_CRITERIA, compositeCode, estimateWholeP95, evaluateCandidate, type CandidateMeasurement } from "./lib/ocr-engine-spike-criteria.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const LOCAL = path.join(process.env.LOCALAPPDATA ?? os.homedir(), "SpecterStudio", "ocr-calibration");
const OUT_DIR = path.join(LOCAL, "engine-spike");
const QUALIFYING_SESSION = path.join(LOCAL, "sessions", "2026-10-27T17-21-44-341Z-e52a5a5f.json");
const REPS = 2;
const TIME_BUDGET_MS = 20 * 60 * 1000;
const VIEWPORT = { width: 800, height: 600 };
const SPIKE = path.join(root, "scripts", "ocr-feasibility", "node_modules");

// ── Candidates ───────────────────────────────────────────────────────────────────────────────────────────────────────

type TessId = "c0-lstm-best" | "c1-lstm-standard" | "c2-legacy-standard" | "c3-combined-standard";
const TESSERACT: Record<TessId, { engine: string; data: string; oem: number }> = {
  "c0-lstm-best": { engine: "tesseract-core-simd-lstm.js", data: "eng-best-int.traineddata.gz", oem: 1 },
  "c1-lstm-standard": { engine: "tesseract-core-simd-lstm.js", data: "eng-standard.traineddata.gz", oem: 1 },
  "c2-legacy-standard": { engine: "tesseract-core-simd.js", data: "eng-standard.traineddata.gz", oem: 0 },
  "c3-combined-standard": { engine: "tesseract-core-simd.js", data: "eng-standard.traineddata.gz", oem: 2 }
};
const TESS_IDS = Object.keys(TESSERACT) as TessId[];
const COMPOSITES = { "k1-consensus-legacy": "c2-legacy-standard", "k2-consensus-windows": "c4-windows", "k3-consensus-lstm-standard": "c1-lstm-standard" } as const;
type CompositeId = keyof typeof COMPOSITES;
type CandidateId = TessId | "c4-windows" | CompositeId;
const CANDIDATES: CandidateId[] = [...TESS_IDS, "c4-windows", ...(Object.keys(COMPOSITES) as CompositeId[])];
/** Staged name -> source inside the lockfile-pinned spike install. */
const SOURCES: Record<string, string> = {
  "tesseract-core-simd-lstm.js": "tesseract.js-core/tesseract-core-simd-lstm.js",
  "tesseract-core-simd-lstm.wasm": "tesseract.js-core/tesseract-core-simd-lstm.wasm",
  "tesseract-core-simd.js": "tesseract.js-core/tesseract-core-simd.js",
  "tesseract-core-simd.wasm": "tesseract.js-core/tesseract-core-simd.wasm",
  "eng-best-int.traineddata.gz": "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  "eng-standard.traineddata.gz": "@tesseract.js-data/eng/4.0.0/eng.traineddata.gz"
};
const filesOf = (id: TessId): string[] => [TESSERACT[id].engine, TESSERACT[id].engine.replace(/\.js$/, ".wasm"), TESSERACT[id].data];

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────────

type Role = "negative" | "positive" | "unsupported";
type SpikeSet = "development" | "confirmation" | "holdout";
interface Item { set: SpikeSet; id: string; role: Role; text: string; expected: string; match: TextAssertionMatchMode; fontSize: number; fromTable: boolean; minDpr: number }
const table = JSON.parse(readFileSync(path.join(root, "mock-site", "public", "ocr-fixtures.json"), "utf8")) as {
  fixtures: Array<{ id: string; class: string; text: string; expected: string; match: TextAssertionMatchMode; minDevicePixelRatio?: number; style?: { fontSize?: number } }>;
};
const probe = JSON.parse(readFileSync(path.join(root, "scripts", "ocr-ambiguity", "probe-fixtures.json"), "utf8")) as { confirmation: Array<{ id: string; role: "negative" | "positive"; text: string; expected: string; fontSize: number }> };
const holdout = JSON.parse(readFileSync(path.join(root, "scripts", "ocr-engine-spike", "holdout-fixtures.json"), "utf8")) as { holdout: Array<{ id: string; role: "negative" | "positive"; text: string; expected: string; fontSize: number }> };
const ROLE_OF: Record<string, Role> = { supported: "positive", confusable: "negative", unsupported: "unsupported" };
const items: Item[] = [
  ...table.fixtures.filter((f) => ROLE_OF[f.class]).map((f): Item => ({ set: "development", id: f.id, role: ROLE_OF[f.class], text: f.text, expected: f.expected, match: f.match, fontSize: f.style?.fontSize ?? 22, fromTable: true, minDpr: f.minDevicePixelRatio ?? 0 })),
  ...probe.confirmation.map((f): Item => ({ set: "confirmation", ...f, match: "normalized", fromTable: false, minDpr: 0 })),
  ...holdout.holdout.map((f): Item => ({ set: "holdout", ...f, match: "normalized", fromTable: false, minDpr: 0 }))
];
const fixtureTexts = items.flatMap((i) => [i.text, i.expected]);

// ── Hosts ────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Reply { ok: boolean; reason?: string; words?: Array<OcrWord | string>; recognizeMs?: number; first?: boolean; rss?: number }

class TessHost {
  private readonly child: ChildProcess;
  private readonly pending = new Map<string, (reply: Reply) => void>();
  readonly ready: Promise<{ initMs: number; rss: number }>;
  constructor(dir: string, id: TessId, expected: Record<string, string>) {
    this.child = fork(path.join(root, "scripts", "ocr-engine-spike", "spike-host.cjs"), [], {
      env: { SystemRoot: process.env.SystemRoot ?? "", AWKIT_OCR_SPIKE_DIR: dir, AWKIT_OCR_SPIKE_ENGINE: TESSERACT[id].engine, AWKIT_OCR_SPIKE_DATA: TESSERACT[id].data, AWKIT_OCR_SPIKE_OEM: String(TESSERACT[id].oem), AWKIT_OCR_SPIKE_EXPECTED: JSON.stringify(expected) },
      execArgv: [],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    });
    this.ready = new Promise((resolve, reject) => {
      this.child.on("message", (m: { type: string; id?: string } & Record<string, unknown>) => {
        if (m.type === "ready") resolve({ initMs: Number(m.initMs), rss: Number(m.rss) });
        else if (m.type === "failed") reject(new Error(`${id} failed: ${String(m.reason)} ${String(m.detail ?? "")}`));
        else if (m.type === "result" && m.id) {
          this.pending.get(m.id)?.(m as unknown as Reply);
          this.pending.delete(m.id);
        }
      });
      this.child.on("exit", () => reject(new Error(`${id} exited`)));
    });
  }
  recognize(image: { width: number; height: number; gray: Uint8Array }): Promise<Reply> {
    const id = randomBytes(6).toString("hex");
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), 30_000);
      this.pending.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      this.child.send({ type: "recognize", id, width: image.width, height: image.height, gray: image.gray });
    });
  }
  close(): void {
    if (this.child.connected) this.child.send({ type: "shutdown", id: "shutdown" });
    setTimeout(() => this.child.kill(), 2000).unref();
  }
}

class WindowsOcr {
  private readonly child: ChildProcess;
  private buffer = "";
  private readonly pending = new Map<string, (reply: Reply) => void>();
  readonly ready: Promise<{ available: boolean; reason?: string; languages?: string[] }>;
  constructor() {
    const script = readFileSync(path.join(root, "scripts", "ocr-engine-spike", "winocr-bridge.ps1"), "utf8");
    this.child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    this.ready = new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ available: false, reason: "bridge-timeout" }), 60_000);
      this.child.on("error", () => resolve({ available: false, reason: "bridge-unavailable" }));
      this.child.stdout!.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString("utf8");
        let newline: number;
        while ((newline = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, newline).trim();
          this.buffer = this.buffer.slice(newline + 1);
          let message: Record<string, unknown>;
          try {
            message = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (message.type === "ready") {
            clearTimeout(timer);
            resolve({ available: message.available === true, reason: typeof message.reason === "string" ? message.reason : undefined, languages: Array.isArray(message.languages) ? (message.languages as string[]) : typeof message.languages === "string" ? [message.languages] : [] });
          } else if (message.type === "result" && typeof message.id === "string") {
            const words = Array.isArray(message.words) ? message.words : typeof message.words === "string" ? [message.words] : [];
            this.pending.get(message.id)?.({ ok: message.ok === true, reason: message.reason as string | undefined, words: words as string[], recognizeMs: Number(message.recognizeMs) });
            this.pending.delete(message.id);
          }
        }
      });
    });
  }
  recognize(image: { width: number; height: number; gray: Uint8Array }): Promise<Reply> {
    const id = randomBytes(6).toString("hex");
    const bgra = Buffer.alloc(image.width * image.height * 4);
    for (let p = 0, i = 0; p < image.gray.length; p += 1, i += 4) {
      bgra[i] = bgra[i + 1] = bgra[i + 2] = image.gray[p];
      bgra[i + 3] = 255;
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), 30_000);
      this.pending.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      this.child.stdin!.write(`${JSON.stringify({ type: "recognize", id, w: image.width, h: image.height, b64: bgra.toString("base64") })}\n`);
    });
  }
  close(): void {
    try {
      this.child.stdin!.write(`${JSON.stringify({ type: "shutdown" })}\n`);
      this.child.stdin!.end();
    } catch {
      // already gone
    }
    setTimeout(() => this.child.kill(), 2000).unref();
  }
}

// ── Trials ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const wordsOf = (reply: Reply | undefined): OcrWord[] | null =>
  reply?.ok ? (reply.words ?? []).map((w) => (typeof w === "string" ? { text: w, confidence: 100 } : w)) : null;
const decide = (item: Item, words: OcrWord[] | null): string =>
  decideTextAssertion({ version: TEXT_ASSERTION_INPUT_VERSION, expected: { text: item.expected, match: item.match }, ocr: words ? { ok: true, words } : { ok: false, code: "ocr-unavailable" } }).code;
/** Did a reader read the expected text? The production comparison with the confidence gates out of play (100). */
const agrees = (item: Item, words: OcrWord[] | null): boolean | null =>
  words === null ? null : decide(item, words.map((w) => ({ text: w.text, confidence: 100 }))) === "text-matched";

let windowsCalls = 0;
interface Trial { set: SpikeSet; fixtureId: string; role: Role; cell: string; codes: Partial<Record<CandidateId, string>>; ms: Partial<Record<CandidateId, number>>; first: Partial<Record<CandidateId, boolean>>; rss: Partial<Record<CandidateId, number>> }

async function render(page: Page, item: Item): Promise<void> {
  if (item.fromTable) {
    await page.evaluate((id) => (window as unknown as { __ocrCalibration: { show(id: string): Promise<string> } }).__ocrCalibration.show(id), item.id);
  } else {
    await page.evaluate(
      ({ id, text, fontSize }) =>
        new Promise<void>((resolve) => {
          const stage = document.getElementById("ocf-stage") as HTMLElement;
          stage.setAttribute("data-shown", "");
          document.getElementById("ocf-protected")?.remove();
          stage.textContent = text;
          Object.assign(stage.style, { fontSize: `${fontSize}px`, color: "#000000", background: "#ffffff", transform: "none", writingMode: "horizontal-tb" });
          requestAnimationFrame(() => requestAnimationFrame(() => {
            stage.setAttribute("data-shown", id);
            resolve();
          }));
        }),
      { id: item.id, text: item.text, fontSize: item.fontSize }
    );
  }
  await page.waitForSelector(`#ocf-stage[data-shown="${item.id}"]`);
}

async function runTrial(page: Page, hosts: Record<TessId, TessHost>, windows: WindowsOcr | null, item: Item, cell: string): Promise<Trial> {
  const trial: Trial = { set: item.set, fixtureId: item.id, role: item.role, cell, codes: {}, ms: {}, first: {}, rss: {} };
  await render(page, item);
  const fontSizeCssPx = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.getElementById("ocf-stage") as HTMLElement).fontSize));
  const shot = await captureElement(page, page.getByTestId("ocf-stage"), { timeoutMs: 5000, contextPaddingCss: 0, stillness: true });
  const refusal = !shot.ok ? `capture-${String(shot.code).toLowerCase()}` : null;
  const prepared = shot.ok ? preprocessForOcr({ image: shot.value.element.image, fontSizeCssPx, devicePixelRatio: shot.value.viewport.devicePixelRatio, clipped: shot.value.element.wasClipped }) : null;
  if (!prepared || !prepared.ok) {
    // A refusal is a miss for every candidate alike (never excluded).
    for (const id of CANDIDATES) trial.codes[id] = refusal ?? (prepared && !prepared.ok ? prepared.code : "capture-unavailable");
    return trial;
  }
  const replies: Partial<Record<TessId | "c4-windows", Reply>> = {};
  for (const id of TESS_IDS) replies[id] = await hosts[id].recognize(prepared);
  if (windows) replies["c4-windows"] = await windows.recognize(prepared);
  for (const id of TESS_IDS) {
    const reply = replies[id];
    trial.codes[id] = reply?.ok ? decide(item, wordsOf(reply)) : `host-${reply?.reason ?? "failed"}`;
    if (reply?.ok) {
      trial.ms[id] = reply.recognizeMs;
      trial.first[id] = reply.first === true;
      trial.rss[id] = reply.rss;
    }
  }
  const win = replies["c4-windows"];
  if (win) {
    // Standalone Windows OCR has no confidence: its row is raw read agreement, never a policy verdict.
    const read = agrees(item, wordsOf(win));
    trial.codes["c4-windows"] = read === null ? `host-${win.reason ?? "failed"}` : read ? "text-matched" : "text-differs";
    if (win.ok) {
      trial.ms["c4-windows"] = win.recognizeMs;
      trial.first["c4-windows"] = windowsCalls === 0;
      windowsCalls += 1;
    }
  }
  for (const [composite, second] of Object.entries(COMPOSITES) as Array<[CompositeId, TessId | "c4-windows"]>) {
    const secondReply = replies[second];
    if (!secondReply) continue;
    trial.codes[composite] = compositeCode(trial.codes["c0-lstm-best"] as string, agrees(item, wordsOf(secondReply)));
    if (trial.ms["c0-lstm-best"] !== undefined && trial.ms[second] !== undefined) trial.ms[composite] = (trial.ms["c0-lstm-best"] as number) + (trial.ms[second] as number);
  }
  return trial;
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const startedAt = performance.now();
const blocked = (why: string): never => {
  console.error(`BLOCKED: ${why}`);
  process.exit(2);
};
const fontDir = path.join(root, "mock-site", "public", "fonts");
const fontManifest = path.join(fontDir, "fonts-manifest.json");
if (!existsSync(fontManifest)) blocked("the bundled OCR Lab font is not staged");
const fontsOk = (JSON.parse(readFileSync(fontManifest, "utf8")) as { files: Array<{ file: string; sha256: string }> }).files.every((f) => existsSync(path.join(fontDir, f.file)) && sha256(readFileSync(path.join(fontDir, f.file))) === f.sha256);
if (!fontsOk) blocked("the bundled OCR Lab font is altered");
const versionOf = (pkg: string) => (JSON.parse(readFileSync(path.join(SPIKE, pkg, "package.json"), "utf8")) as { version: string }).version;
if (!existsSync(path.join(SPIKE, "tesseract.js-core", "package.json")) || versionOf("tesseract.js-core") !== "6.0.0" || versionOf("@tesseract.js-data/eng") !== "1.0.0") blocked("the lockfile-pinned spike install (tesseract.js-core 6.0.0, @tesseract.js-data/eng 1.0.0) is missing");
const hashes: Record<string, string> = {};
const sizes: Record<string, number> = {};
for (const [name, source] of Object.entries(SOURCES)) {
  const bytes = readFileSync(path.join(SPIKE, source));
  hashes[name] = sha256(bytes);
  sizes[name] = statSync(path.join(SPIKE, source)).size;
}
const pin = JSON.parse(readFileSync(path.join(root, "src", "offline", "ocr-runtime.json"), "utf8")) as { files: Array<{ target: string; sha256: string }> };
const pinned = Object.fromEntries(pin.files.map((f) => [f.target, f.sha256]));
if (hashes["tesseract-core-simd-lstm.js"] !== pinned["tesseract-core-simd-lstm.js"] || hashes["tesseract-core-simd-lstm.wasm"] !== pinned["tesseract-core-simd-lstm.wasm"] || hashes["eng-best-int.traineddata.gz"] !== pinned["eng.traineddata.gz"]) {
  blocked("the control candidate is not byte-identical to the production pin");
}

const work = mkdtempSync(path.join(os.tmpdir(), "awkit-ocr-engine-spike-"));
for (const [name, source] of Object.entries(SOURCES)) copyFileSync(path.join(SPIKE, source), path.join(work, name));
let server: ReturnType<typeof spawn> | undefined;
let windows: WindowsOcr | null = null;
let exitCode = 1;
try {
  windows = new WindowsOcr();
  const windowsReady = await windows.ready;
  console.log(`Windows OCR: ${JSON.stringify(windowsReady)}`);
  if (!windowsReady.available) {
    windows.close();
    windows = null;
  }
  const port = await new Promise<number>((resolve, reject) => {
    const probeServer = createServer();
    probeServer.once("error", reject);
    probeServer.listen(0, "127.0.0.1", () => {
      const address = probeServer.address();
      probeServer.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("no free port"))));
    });
  });
  const lab = `http://127.0.0.1:${port}/visual-intelligence/ocr`;
  server = spawn(process.execPath, ["mock-site/server.mjs"], { cwd: root, env: { ...process.env, MOCK_SITE_PORT: String(port) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  for (let attempt = 0; attempt < 300 && !(await fetch(lab).then((r) => r.ok, () => false)); attempt += 1) await new Promise((r) => setTimeout(r, 100));

  const trials: Trial[] = [];
  const starts: Record<TessId, number[]> = Object.fromEntries(TESS_IDS.map((id) => [id, []])) as unknown as Record<TessId, number[]>;
  const launches: Record<string, number> = {};
  let launchErrors = 0;
  outer: for (let rep = 0; rep < REPS; rep += 1) {
    for (const cell of OCR_CALIBRATION_CELLS) {
      if (performance.now() - startedAt > TIME_BUDGET_MS) break outer;
      let browser: Browser | undefined;
      const hosts = {} as Record<TessId, TessHost>;
      const launchStarted = performance.now();
      try {
        for (const id of TESS_IDS) {
          hosts[id] = new TessHost(work, id, Object.fromEntries(filesOf(id).map((f) => [f, hashes[f]])));
          starts[id].push((await hosts[id].ready).initMs);
        }
        browser = await chromium.launch({ headless: cell.renderMode === "headless", args: buildChromiumHardeningArgs(process.env) });
        const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: cell.devicePixelRatio });
        const page = await context.newPage();
        await page.goto(`${lab}?calibration=1`, { timeout: 60_000 });
        await page.waitForSelector("body[data-fonts][data-fixtures]");
        if ((await page.getAttribute("body", "data-fonts")) !== "ready") throw new Error("fonts-missing");
        for (const item of items) {
          // The calibration table's own DPR floor (small-9): unsupported in this cell, as declared there.
          const asDeclared: Item = item.minDpr > cell.devicePixelRatio ? { ...item, role: "unsupported" } : item;
          trials.push(await runTrial(page, hosts, windows, asDeclared, cellIdOf(cell)));
        }
        launches[cellIdOf(cell)] = (launches[cellIdOf(cell)] ?? 0) + 1;
        console.log(`  launch: ${cellIdOf(cell)} rep ${rep + 1}, ${items.length} fixtures, ${Math.round((performance.now() - launchStarted) / 1000)} s`);
      } catch (error) {
        launchErrors += 1;
        console.error(`launch error (${cellIdOf(cell)}): ${(error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 160)}`);
      } finally {
        await browser?.close().catch(() => undefined);
        for (const host of Object.values(hosts)) host.close();
      }
    }
  }

  // ── Aggregate ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const session = existsSync(QUALIFYING_SESSION)
    ? (JSON.parse(readFileSync(QUALIFYING_SESSION, "utf8")) as { launches: Array<{ coldProbe: boolean; trials: Array<{ coldHost: boolean; durationMs: number; fixtureClass: string; phases?: Record<string, number> }> }> })
    : null;
  const warmSessionTrials = session ? session.launches.filter((l) => !l.coldProbe).flatMap((l) => l.trials).filter((t) => !t.coldHost && (t.fixtureClass === "supported" || t.fixtureClass === "confusable") && t.phases?.["recognize-start"] !== undefined) : [];
  const sessionWarmWholeP95 = percentile(warmSessionTrials.map((t) => t.durationMs), 0.95);
  /** A composite's parts: its warm time excludes any trial where either part ran cold. */
  const partsOf = (id: CandidateId): Array<TessId | "c4-windows"> => (id in COMPOSITES ? ["c0-lstm-best", COMPOSITES[id as CompositeId]] : [id as TessId | "c4-windows"]);
  const warmMs = (id: CandidateId) => trials.filter((t) => t.ms[id] !== undefined && partsOf(id).every((p) => !t.first[p])).map((t) => t.ms[id] as number);
  const firstMs = (id: TessId | "c4-windows") => trials.filter((t) => t.first[id] && t.ms[id] !== undefined).map((t) => t.ms[id] as number);
  const c0p95 = percentile(warmMs("c0-lstm-best"), 0.95);
  const packageBytes = (id: CandidateId): number | null => {
    if (id === "c4-windows") return 0;
    const files = TESS_IDS.includes(id as TessId) ? filesOf(id as TessId) : [...new Set([...filesOf("c0-lstm-best"), ...(COMPOSITES[id as CompositeId] === "c4-windows" ? [] : filesOf(COMPOSITES[id as CompositeId] as TessId))])];
    return files.reduce((n, f) => n + sizes[f], 0);
  };
  const usesWindows = (id: CandidateId) => id === "c4-windows" || id === "k2-consensus-windows";
  const sets: Array<SpikeSet | "all"> = ["development", "confirmation", "holdout", "all"];
  const results = Object.fromEntries(
    CANDIDATES.map((id) => {
      const mine = trials.filter((t) => t.codes[id] !== undefined);
      const count = (list: Trial[], role: Role) => ({ trials: list.filter((t) => t.role === role).length, matched: list.filter((t) => t.role === role && t.codes[id] === "text-matched").length });
      const bySet = Object.fromEntries(sets.map((s) => {
        const list = s === "all" ? mine : mine.filter((t) => t.set === s);
        return [s, { negatives: count(list, "negative"), supported: count(list, "positive"), unsupported: count(list, "unsupported") }];
      }));
      const falseMatchedFixtures = Object.fromEntries([...new Set(mine.filter((t) => t.role === "negative" && t.codes[id] === "text-matched").map((t) => t.fixtureId))].map((f) => [f, mine.filter((t) => t.fixtureId === f && t.codes[id] === "text-matched").length]));
      const missedSupported = Object.fromEntries([...new Set(mine.filter((t) => t.role === "positive" && t.codes[id] !== "text-matched").map((t) => t.fixtureId))].map((f) => [f, mine.filter((t) => t.fixtureId === f && t.codes[id] !== "text-matched").reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.codes[id] as string]: (acc[t.codes[id] as string] ?? 0) + 1 }), {})]));
      const perCell = Object.fromEntries([...new Set(mine.map((t) => t.cell))].map((cell) => [cell, { falseMatched: mine.filter((t) => t.cell === cell && t.role === "negative" && t.codes[id] === "text-matched").length, supportedMatched: mine.filter((t) => t.cell === cell && t.role === "positive" && t.codes[id] === "text-matched").length, supported: mine.filter((t) => t.cell === cell && t.role === "positive").length }]));
      const warm = latencySummary(warmMs(id));
      // A composite's cold first recognition is its parts' cold first recognitions run in turn.
      const first = id in COMPOSITES ? null : latencySummary(firstMs(id as TessId | "c4-windows"));
      const firstFor = id in COMPOSITES ? partsOf(id).reduce<number | null>((sum, p) => (sum === null || latencySummary(firstMs(p)).p50 === null ? null : sum + (latencySummary(firstMs(p)).p50 as number)), 0) : first?.p50 ?? null;
      const estimated = c0p95 !== null && sessionWarmWholeP95 !== null && warm.p95 !== null ? estimateWholeP95(sessionWarmWholeP95, c0p95, warm.p95) : null;
      const all = (bySet.all as { negatives: { trials: number; matched: number }; supported: { trials: number; matched: number }; unsupported: { trials: number; matched: number } });
      const measurement: CandidateMeasurement = {
        noConfidence: id === "c4-windows",
        available: !usesWindows(id) || windows !== null,
        negatives: all.negatives,
        supported: all.supported,
        unsupported: all.unsupported,
        cellsMeasured: new Set(mine.map((t) => t.cell)).size,
        latency: { estimatedWholeP95Ms: estimated, firstRecognizeMs: firstFor },
        packageBytes: packageBytes(id),
        offlinePinned: !usesWindows(id),
        cpuCompatible: true
      };
      const evaluation = evaluateCandidate(measurement);
      const rssValues = TESS_IDS.includes(id as TessId) ? mine.map((t) => t.rss[id]).filter((v): v is number => typeof v === "number") : [];
      return [id, { ...evaluation, bySet, perCell, falseMatchedFixtures, missedSupported, latencyMs: { warm, first, estimatedWholeP95: estimated }, rssMiB: rssValues.length ? Math.round(Math.max(...rssValues) / 1048576) : null, packageBytes: measurement.packageBytes, offlinePinned: measurement.offlinePinned }];
    })
  );
  const initMs = Object.fromEntries(TESS_IDS.map((id) => [id, latencySummary(starts[id])]));
  const recognizeStart = warmSessionTrials.map((t) => t.phases?.["recognize-start"] as number);
  const report = {
    version: 1,
    kind: "ocr-engine-spike-diagnostic",
    diagnostic: true,
    qualifying: false,
    generated: new Date().toISOString().slice(0, 10),
    durationSec: Math.round((performance.now() - startedAt) / 1000),
    criteria: ENGINE_SPIKE_CRITERIA,
    // The declared inputs this run measured against, so their pre-measurement bytes can be checked later.
    declared: Object.fromEntries(["scripts/lib/ocr-engine-spike-criteria.mts", "scripts/ocr-engine-spike/holdout-fixtures.json", "scripts/ocr-ambiguity/probe-fixtures.json", "mock-site/public/ocr-fixtures.json"].map((rel) => [rel, sha256(readFileSync(path.join(root, rel))).slice(0, 16)])),
    environment: { platform: process.platform, hostArch: process.env.PROCESSOR_ARCHITEW6432 ?? process.env.PROCESSOR_ARCHITECTURE ?? os.arch(), processArch: process.arch },
    assets: Object.fromEntries(Object.keys(SOURCES).map((name) => [name, { bytes: sizes[name], sha256: hashes[name].slice(0, 16) }])),
    windows: JSON.parse(JSON.stringify(windowsReady)) as typeof windowsReady,
    launches: { perCell: launches, errors: launchErrors, repetitions: REPS },
    trials: trials.length,
    sessionWarmWholeP95Ms: sessionWarmWholeP95,
    initMs,
    timingClassification: {
      c0FirstRecognizeMs: latencySummary(firstMs("c0-lstm-best")),
      c0WarmRecognizeMs: latencySummary(warmMs("c0-lstm-best")),
      sessionRecognizeStartMs: quantiles(recognizeStart),
      sessionRecognizeStartAbove500: recognizeStart.filter((v) => v > 500).length,
      sessionRecognizeStartTrials: recognizeStart.length
    },
    results
  };
  const vocabulary = new Set<string>([
    ...items.map((i) => i.id), ...OCR_CALIBRATION_CELLS.map((c) => cellIdOf(c)), ...Object.keys(TEXT_ASSERTION_CODES), ...CANDIDATES, ...Object.keys(SOURCES),
    ...trials.flatMap((t) => Object.values(t.codes) as string[]),
    ...Object.values(hashes).map((h) => h.slice(0, 16)),
    ...(Object.keys(report.declared) as string[]), ...(Object.values(report.declared) as string[]),
    ...(windowsReady.languages ?? []), ...(windowsReady.reason ? [windowsReady.reason] : []),
    "ocr-engine-spike-diagnostic", "PASS", "FAIL", "NOT-RUN", "GO", "NO-GO", "development", "confirmation", "holdout", "all",
    "zeroFalseMatched", "supportedAccuracy", "unsupportedNeverMatched", "coverage", "latency", "packageBudget", "offlinePinned", "cpuCompatible", "policyCompatible",
    process.platform, process.arch, report.environment.hostArch, report.generated
  ]);
  assertAggregateOnly(report, vocabulary, fixtureTexts);
  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}.json`);
  writeFileSync(outFile, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`\nAggregate report (numbers and fixture ids only): ${outFile}`);
  for (const id of CANDIDATES) {
    const r = results[id] as unknown as { verdict: string; failed: string[]; supportedAccuracy: number | null; bySet: { all: { negatives: { trials: number; matched: number }; supported: { trials: number; matched: number }; unsupported: { trials: number; matched: number } } }; latencyMs: { warm: { p50: number | null; p95: number | null }; estimatedWholeP95: number | null }; packageBytes: number | null };
    const a = r.bySet.all;
    console.log(`  ${id.padEnd(28)} ${r.verdict.padEnd(6)} false ${a.negatives.matched}/${a.negatives.trials}  supported ${a.supported.matched}/${a.supported.trials} (${r.supportedAccuracy === null ? "-" : (r.supportedAccuracy * 100).toFixed(1)} %)  unsupported matched ${a.unsupported.matched}/${a.unsupported.trials}  warm p50/p95 ${Math.round(r.latencyMs.warm.p50 ?? -1)}/${Math.round(r.latencyMs.warm.p95 ?? -1)} ms  est. whole p95 ${r.latencyMs.estimatedWholeP95 ?? "-"} ms  bytes ${r.packageBytes}  failed [${r.failed.join(", ")}]`);
  }
  console.log(`  timing: ${JSON.stringify({ initMs, timingClassification: report.timingClassification })}`);
  exitCode = 0;
} catch (error) {
  console.error(`ERROR: ${(error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200)}`);
} finally {
  windows?.close();
  server?.kill();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);
