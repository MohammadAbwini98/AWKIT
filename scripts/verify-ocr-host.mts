/**
 * verify:ocr-host — Phase N, N7.4 (awkit-vra.9.5): the production `OcrUtilityHostManager` and the real
 * `native-hosts/ocr/ocr-host.cjs` with the real N7.1a-qualified assets, in real Electron utility processes.
 *
 * The assets are staged into a temp folder by the production scripts/prepare-ocr-assets.mjs (from the
 * lockfile-pinned spike install), then scripts/ocr-harness/harnessMain.ts (esbuilt into a temporary Electron app)
 * proves: the flag is off by default and nothing forks until the first request; real recognition through the
 * production N7.2 preprocessing; deadline and abort kill the host with no late result and no strike, and the next
 * request succeeds; the queue bound; invalid images; crash detection, replacement and the circuit; idle shutdown;
 * resident-set recycling; tampered, missing and replaced assets refused permanently; no write to the assets; dispose.
 *
 * Static checks pin what a run cannot show: the host blocks every network entry point before the engine loads,
 * writes no file, loads only the pinned SIMD LSTM files, and never imports Visual Intelligence; the manager and the
 * protocol stay outside src/visual.
 *
 * Run: npm run verify:ocr-host
 */

import { spawn, spawnSync } from "node:child_process";
import { build } from "esbuild";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "./lib/gui-verify-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST_PATH = path.join(ROOT, "native-hosts", "ocr", "ocr-host.cjs");
let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("verify:ocr-host — N7.4 OCR utility host and manager, real engine, real utility processes\n");

// ── Static ──────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("Static");
const host = fs.readFileSync(HOST_PATH, "utf8");
const code = host.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const blockAt = code.indexOf("(function blockNetwork()");
const engineAt = code.indexOf("require(path.join(dir, ENGINE_JS))");
check("the host blocks the network before it loads the engine", blockAt > 0 && engineAt > blockAt);
for (const entry of ["mod.request = refuse", "mod.get = refuse", '"node:http2").connect = refuse', "net.connect = refuse", "net.createConnection = refuse", '"node:tls").connect = refuse', "dns[name] = refuse", "globalThis.fetch", "globalThis.WebSocket", "electronNet[name] = refuse"]) {
  check(`the host replaces ${entry.split(" = ")[0].replace(/"node:|"\)/g, "")}`, code.includes(entry));
}
check("the host writes no file (no fs write API)", !/fs\.(writeFile|appendFile|mkdir|rm|rename|copyFile|createWriteStream|open)\w*\(/.test(code));
check("the host loads only the pinned SIMD LSTM engine and English data", /ENGINE_JS = "tesseract-core-simd-lstm\.js"/.test(code) && /ENGINE_WASM = "tesseract-core-simd-lstm\.wasm"/.test(code) && /LANGUAGE_DATA = "eng\.traineddata\.gz"/.test(code));
check("the host refuses a CPU without WebAssembly SIMD", /WebAssembly\.validate\(SIMD_PROBE\)\) return fail\("unsupported-cpu"\)/.test(code));
check("the host verifies every asset's SHA-256 before loading it", code.indexOf("verifyAssets(dir, expected)") > 0 && code.indexOf("verifyAssets(dir, expected)") < engineAt);
check("the host logs nothing", !/console\.\w+\(/.test(code));
check("the host never imports Visual Intelligence", !/src[\\/]visual/.test(host));
for (const file of ["app/main/ocr/OcrUtilityHostManager.ts", "app/main/ocr/ocrRuntime.ts", "src/ocr/OcrHostProtocol.ts"]) {
  const imports = [...fs.readFileSync(path.join(ROOT, file), "utf8").matchAll(/\bfrom\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);
  check(`${file} never imports Visual Intelligence`, !imports.some((spec) => /(^|\/)(@src\/)?visual(\/|$)|src\/visual/.test(spec)), imports.join(", "));
}
check("the manager logs no recognized text (only fixed messages)", !/log\([^)]*(words|text)\b/.test(fs.readFileSync(path.join(ROOT, "app/main/ocr/OcrUtilityHostManager.ts"), "utf8")));

// ── Real engine in Electron ─────────────────────────────────────────────────────────────────────────────────────
console.log("\nReal engine in Electron");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ocr-host-"));
const assets = path.join(work, "assets");
const harness = path.join(work, "harness");
try {
  const staged = spawnSync(process.execPath, [path.join(ROOT, "scripts", "prepare-ocr-assets.mjs"), "--out", assets], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
  check("the production staging script staged the qualified assets", staged.status === 0, `${staged.stderr}`.trim().slice(0, 300));
  fs.mkdirSync(harness);
  await build({
    entryPoints: [path.join(ROOT, "scripts", "ocr-harness", "harnessMain.ts")],
    outfile: path.join(harness, "main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"],
    alias: { "@main": path.join(ROOT, "app", "main"), "@src": path.join(ROOT, "src") },
    logLevel: "silent"
  });
  fs.writeFileSync(path.join(harness, "package.json"), JSON.stringify({ name: "awkit-ocr-harness", version: "0.0.0", main: "main.cjs" }));
  const report = path.join(work, "report.json");
  const electronPath = createRequire(import.meta.url)("electron") as unknown as string;
  const env: NodeJS.ProcessEnv = { ...process.env, AWKIT_HARNESS_REPORT: report, AWKIT_HARNESS_HOST_PATH: HOST_PATH, AWKIT_HARNESS_ASSET_DIR: assets };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.AWKIT_VISUAL_OCR;
  const child = spawn(electronPath, [harness], { env, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr = (stderr + chunk).slice(-2000)));
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const timedOut = await Promise.race([exited.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 240_000))]);
  if (timedOut) spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
  const result = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, "utf8")) : null;
  if (!result) check("the harness wrote a report", false, `Electron never reached app.whenReady(): ${stderr.trim().slice(-400)}`);
  else {
    for (const s of result.steps) check(`${s.label} (${s.durationMs} ms)`, s.ok, s.error ?? JSON.stringify(s.detail ?? "").slice(0, 300));
    check("the harness ran to completion", result.complete === true, `${timedOut ? "timed out" : "exited"} during: ${result.inFlight}; ${stderr.trim().slice(-300)}`);
    check("the harness ran every step", result.steps.length >= 29, `${result.steps.length} steps`);
    const details = JSON.stringify(result.steps.map((s: { detail?: unknown }) => s.detail ?? null));
    check("the report holds no recognized text", !/specterstudio|invoice|quick brown/i.test(details));
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
