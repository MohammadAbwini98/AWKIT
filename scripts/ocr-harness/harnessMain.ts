/**
 * Test-only Electron entry for verify:ocr-host (Phase N, N7.4 / awkit-vra.9.5). esbuilt into a temporary app
 * directory by scripts/verify-ocr-host.mts; never bundled into out/main or shipped. It drives the PRODUCTION
 * `OcrUtilityHostManager` against the REAL `native-hosts/ocr/ocr-host.cjs` and the REAL staged N7.1a assets, in real
 * utility processes. Faults are injected from here (killing the host's pid, tampering a copy of the assets), never
 * from host code. Fixtures are rendered in a hidden window and turned into the host's input by the production N7.2
 * `preprocessForOcr`.
 *
 * The report (JSON at AWKIT_HARNESS_REPORT) holds codes, counts and timings, never recognized text.
 */

import { app, BrowserWindow } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OcrUtilityHostManager } from "@main/ocr/OcrUtilityHostManager";
import { expectedOcrAssetHashes, getOcrHostManager, ocrModeFromEnv } from "@main/ocr/ocrRuntime";
import { OCR_HOST_RESTART_POLICY, type OcrHostImage, type OcrHostOutcome } from "@src/ocr/OcrHostProtocol";
import { preprocessForOcr } from "@src/visual/ocr/preprocess";
import { decodePng } from "@src/visual/png";

interface Step {
  label: string;
  ok: boolean;
  durationMs: number;
  detail?: unknown;
  error?: string;
}

const REPORT = process.env.AWKIT_HARNESS_REPORT as string;
const HOST_PATH = process.env.AWKIT_HARNESS_HOST_PATH as string;
const ASSET_DIR = process.env.AWKIT_HARNESS_ASSET_DIR as string;
const steps: Step[] = [];
let inFlight = "starting";
const write = (extra: Record<string, unknown> = {}) => fs.writeFileSync(REPORT, JSON.stringify({ mode: "ocr-host", ok: steps.every((s) => s.ok), complete: false, inFlight, steps, ...extra }, null, 2));
const phase = (name: string) => {
  inFlight = name;
  write();
};

async function step(label: string, body: () => Promise<{ ok: boolean; detail?: unknown }>): Promise<void> {
  phase(label);
  const started = Date.now();
  try {
    const { ok, detail } = await body();
    steps.push({ label, ok, durationMs: Date.now() - started, detail });
  } catch (error) {
    steps.push({ label, ok: false, durationMs: Date.now() - started, error: String((error as Error)?.message ?? error).slice(0, 300) });
  }
  write();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const joined = (outcome: OcrHostOutcome) => (outcome.ok ? normalize(outcome.words.map((w) => w.text).join(" ")) : "");
const alive = (pid: number | null) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const killPid = (pid: number | null) => {
  if (pid) process.kill(pid);
};
async function until(predicate: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await sleep(25);
  }
  return predicate();
}

/** A canvas PNG decoded by the production N0 decoder, then the production N7.2 preprocessing: the product's path. */
async function renderFixture(win: BrowserWindow, lines: string[], px: number, width: number, height: number): Promise<OcrHostImage> {
  const dataUrl: string = await win.webContents.executeJavaScript(`(() => {
    const c = document.createElement("canvas"); c.width = ${width}; c.height = ${height};
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#000000"; g.font = "${px}px Arial"; g.textBaseline = "top";
    ${JSON.stringify(lines)}.forEach((line, i) => g.fillText(line, 12, 12 + i * ${Math.round(px * 1.25)}));
    return c.toDataURL("image/png");
  })()`);
  const image = decodePng(new Uint8Array(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64")));
  const pre = preprocessForOcr({ image, fontSizeCssPx: px, devicePixelRatio: 1 });
  if (!pre.ok) throw new Error(`preprocessing refused the fixture: ${pre.code}`);
  return { width: pre.width, height: pre.height, gray: pre.gray, psm: lines.length > 1 ? 6 : 7 };
}

function copyAssets(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `awkit-ocr-${name}-`));
  for (const file of fs.readdirSync(ASSET_DIR)) fs.copyFileSync(path.join(ASSET_DIR, file), path.join(dir, file));
  return dir;
}

function snapshot(dir: string): string {
  return fs
    .readdirSync(dir)
    .sort()
    .map((file) => `${file}:${crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, file))).digest("hex")}`)
    .join("|");
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.on("window-all-closed", () => {});
process.on("uncaughtException", (error) => {
  inFlight = `uncaught: ${String(error?.message ?? error).slice(0, 200)} (during ${inFlight})`;
  write();
});

app.whenReady().then(() =>
  run().catch((error) => {
    inFlight = `failed: ${String(error?.message ?? error).slice(0, 200)} (during ${inFlight})`;
    write();
    app.exit(1);
  })
);

async function run(): Promise<void> {
  phase("ready");
  const expected = expectedOcrAssetHashes();
  const assetsBefore = snapshot(ASSET_DIR);
  phase("opening the fixture window");
  const win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent("<!doctype html><meta charset=utf-8><title>f</title>")}`);
  phase("rendering fixtures");
  const label = await renderFixture(win, ["SpecterStudio"], 32, 300, 60);
  const invoice = await renderFixture(win, ["Invoice 4471 Total 1284.50"], 28, 520, 56);
  // 40 px text needs no upscale, so the 0.65 MP page stays inside the 1 MP limit (20 px text would be refused).
  const page = await renderFixture(win, Array.from({ length: 14 }, (_, i) => `Line ${i + 1} the quick brown fox`), 40, 900, 724);
  const make = (limits: Record<string, number> = {}, assetDir = ASSET_DIR) => new OcrUtilityHostManager({ hostPath: HOST_PATH, assetDir, expected, limits });

  await step("OC-6: the flag is off by default and only 'observe' turns it on", async () => ({
    ok: ocrModeFromEnv({}) === "off" && ocrModeFromEnv({ AWKIT_VISUAL_OCR: "enforce" }) === "off" && ocrModeFromEnv({ AWKIT_VISUAL_OCR: "observe" }) === "observe"
  }));
  await step("OCR off: no manager is constructed and no host is forked", async () => ({ ok: getOcrHostManager({}) === null }));

  const manager = make();
  await step("constructing the manager forks nothing", async () => ({ ok: manager.status().state === "stopped" && manager.status().pid === null }));

  let firstPid: number | null = null;
  await step("first recognition starts the host lazily and reads the label (real engine)", async () => {
    const outcome = await manager.recognize(label, { deadlineMs: 15_000 });
    firstPid = manager.status().pid;
    return { ok: outcome.ok && joined(outcome).includes("specterstudio") && alive(firstPid), detail: outcome.ok ? { words: outcome.words.length, recognizeMs: outcome.recognizeMs, minConfidence: Math.min(...outcome.words.map((w) => w.confidence)) } : outcome };
  });
  await step("a second fixture reads on the same host", async () => {
    const outcome = await manager.recognize(invoice, { deadlineMs: 5_000 });
    return { ok: outcome.ok && joined(outcome).includes("invoice 4471 total 1284.50") && manager.status().pid === firstPid, detail: outcome.ok ? { words: outcome.words.length, recognizeMs: outcome.recognizeMs } : outcome };
  });
  await step("every word carries a confidence between 0 and 100", async () => {
    const outcome = await manager.recognize(invoice, { deadlineMs: 5_000 });
    return { ok: outcome.ok && outcome.words.length > 0 && outcome.words.every((w) => w.confidence >= 0 && w.confidence <= 100) };
  });

  await step("a deadline mid-recognition answers budget-exhausted and kills the host", async () => {
    const pid = manager.status().pid;
    const started = Date.now();
    const outcome = await manager.recognize(page, { deadlineMs: 40 });
    const elapsed = Date.now() - started;
    const gone = await until(() => !alive(pid), 3_000);
    return { ok: !outcome.ok && outcome.reason === "budget-exhausted" && elapsed < 1_000 && gone, detail: { elapsedMs: elapsed, hostGone: gone } };
  });
  await step("the killed recognition delivers no late result, and the kill is not a strike", async () => {
    await sleep(1_500);
    const status = manager.status();
    return { ok: status.unexpectedExits === 0 && !status.circuitOpen, detail: status };
  });
  await step("the next request forks a fresh host and succeeds", async () => {
    const outcome = await manager.recognize(label, { deadlineMs: 15_000 });
    return { ok: outcome.ok && joined(outcome).includes("specterstudio") && manager.status().pid !== firstPid };
  });

  await step("an abort mid-recognition answers cancelled and kills the host", async () => {
    const pid = manager.status().pid;
    const controller = new AbortController();
    const pending = manager.recognize(page, { deadlineMs: 15_000, signal: controller.signal });
    await sleep(30);
    controller.abort();
    const outcome = await pending;
    const gone = await until(() => !alive(pid), 3_000);
    return { ok: !outcome.ok && outcome.reason === "cancelled" && gone };
  });
  await step("an already-aborted signal is refused without forking", async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await manager.recognize(label, { signal: controller.signal });
    return { ok: !outcome.ok && outcome.reason === "cancelled" };
  });
  await step("the queue bound refuses excess requests as ocr-busy and settles every other one", async () => {
    const outcomes = await Promise.all(Array.from({ length: 7 }, () => manager.recognize(label, { deadlineMs: 30_000 })));
    const busy = outcomes.filter((o) => !o.ok && o.reason === "ocr-busy").length;
    const read = outcomes.filter((o) => o.ok && joined(o).includes("specterstudio")).length;
    return { ok: busy >= 1 && busy + read === 7, detail: { busy, read } };
  });
  await step("an invalid image is refused without reaching the host", async () => {
    const outcome = await manager.recognize({ width: 10, height: 10, gray: new Uint8Array(5) });
    return { ok: !outcome.ok && outcome.reason === "image-invalid" };
  });

  await step("a host killed while idle is detected and replaced (one strike)", async () => {
    const pid = manager.status().pid;
    killPid(pid);
    await until(() => !alive(pid), 3_000);
    await sleep(200);
    const outcome = await manager.recognize(label, { deadlineMs: 15_000 });
    return { ok: outcome.ok && manager.status().unexpectedExits === 1 && manager.status().pid !== pid, detail: manager.status() };
  });
  await step("a host killed mid-recognition answers ocr-unavailable and the next request succeeds", async () => {
    const pending = manager.recognize(page, { deadlineMs: 15_000 });
    await until(() => manager.status().state === "busy", 2_000);
    killPid(manager.status().pid);
    const outcome = await pending;
    const next = await manager.recognize(label, { deadlineMs: 15_000 });
    return { ok: !outcome.ok && outcome.reason === "ocr-unavailable" && next.ok, detail: manager.status() };
  });
  await step("the assets are unchanged: the host wrote nothing", async () => ({ ok: snapshot(ASSET_DIR) === assetsBefore }));
  await step("the host's resident set is reported and within the 400 MB ceiling (measured)", async () => {
    const rss = manager.status().lastRss;
    return { ok: typeof rss === "number" && rss > 0 && rss <= 400 * 1024 * 1024, detail: { rssMB: rss ? Math.round(rss / 1048576) : null } };
  });
  await step("dispose stops the host and refuses later requests", async () => {
    const pid = manager.status().pid;
    await manager.dispose();
    const gone = await until(() => !alive(pid), 3_000);
    const outcome = await manager.recognize(label);
    return { ok: gone && manager.status().state === "disposed" && !outcome.ok && outcome.reason === "ocr-unavailable" };
  });

  await step(`the circuit opens after more than ${OCR_HOST_RESTART_POLICY.maxRestartsInWindow} unexpected exits in the window`, async () => {
    const crashy = make();
    for (let i = 0; i <= OCR_HOST_RESTART_POLICY.maxRestartsInWindow; i += 1) {
      const outcome = await crashy.recognize(label, { deadlineMs: 15_000 });
      if (!outcome.ok) break;
      const pid = crashy.status().pid;
      killPid(pid);
      await until(() => !alive(pid), 3_000);
      await sleep(100);
    }
    const status = crashy.status();
    const after = await crashy.recognize(label);
    await crashy.dispose();
    return { ok: status.circuitOpen && !after.ok && after.reason === "ocr-unavailable", detail: status };
  });
  await step("an idle host is shut down after the idle period (intentional, no strike)", async () => {
    const idle = make({ idleShutdownMs: 300 });
    await idle.recognize(label, { deadlineMs: 15_000 });
    const pid = idle.status().pid;
    const gone = await until(() => !alive(pid), 4_000);
    const status = idle.status();
    await idle.dispose();
    return { ok: gone && status.unexpectedExits === 0, detail: status };
  });
  await step("a host past the resident-set ceiling is recycled after its job", async () => {
    const small = make({ rssCeilingBytes: 1 });
    const outcome = await small.recognize(label, { deadlineMs: 15_000 });
    const pid = small.status().pid;
    const gone = await until(() => !alive(pid) || small.status().pid === null, 4_000);
    const status = small.status();
    await small.dispose();
    return { ok: outcome.ok && status.recycles === 1 && gone && status.unexpectedExits === 0, detail: status };
  });
  await step("a tampered engine WASM is refused as checksum-mismatch, permanently, without strikes", async () => {
    const dir = copyAssets("tampered");
    const wasm = path.join(dir, "tesseract-core-simd-lstm.wasm");
    const bytes = fs.readFileSync(wasm);
    bytes[bytes.length - 1] ^= 0xff;
    fs.writeFileSync(wasm, bytes);
    const tampered = make({}, dir);
    const first = await tampered.recognize(label, { deadlineMs: 15_000 });
    const second = await tampered.recognize(label, { deadlineMs: 15_000 });
    const status = tampered.status();
    await tampered.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: !first.ok && first.reason === "checksum-mismatch" && !second.ok && second.reason === "checksum-mismatch" && status.permanentReason === "checksum-mismatch" && status.unexpectedExits === 0, detail: status };
  });
  await step("missing language data is refused as assets-missing", async () => {
    const dir = copyAssets("missing");
    fs.rmSync(path.join(dir, "eng.traineddata.gz"));
    const missing = make({}, dir);
    const outcome = await missing.recognize(label, { deadlineMs: 15_000 });
    await missing.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: !outcome.ok && outcome.reason === "assets-missing" };
  });
  await step("a replaced asset with a matching staged manifest is still refused (the pin, not the manifest, decides)", async () => {
    const dir = copyAssets("replaced");
    fs.writeFileSync(path.join(dir, "eng.traineddata.gz"), Buffer.from("not the pinned data"));
    const replaced = make({}, dir);
    const outcome = await replaced.recognize(label, { deadlineMs: 15_000 });
    await replaced.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: !outcome.ok && outcome.reason === "checksum-mismatch" };
  });

  write({ complete: true });
  app.exit(0);
}
