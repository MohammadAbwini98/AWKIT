/**
 * benchmark:ocr — Phase N, N7.6 (awkit-vra.9.7): ONE OCR calibration session, or (`--report`) the decision over every
 * recorded session. A measurement gate, not a deterministic test. Plan: docs/plans/ai-upgrade-v5/N7-ocr-text-in-
 * image.md › Determinism and accuracy (OC-10); criteria in scripts/lib/ocr-calibration-criteria.mts.
 *
 * A session stages the N7.3-pinned engine assets into a local folder (the Parallels share cannot initialise the
 * engine, KNOWN_ISSUES), verifies the bundled OCR Lab font against its manifest, fingerprints the fixture table and the
 * OCR pipeline sources, starts the mock site, builds scripts/ocr-calibration/calibrationMain.ts into
 * out/ocr-calibration/ and runs it in real Electron for SESSION_BUDGET_MS. Evidence goes to
 * %LOCALAPPDATA%/SpecterStudio/ocr-calibration/sessions (codes, counts and timings only).
 *
 *  - Qualification needs >= 300 complete launches per cell over >= 3 sessions of ONE environment, so it takes many
 *    sessions: run this again until every cell is decided. Nothing is shortened, simulated or carried over.
 *  - Without the bundled font the session is BLOCKED (owner action in mock-site/fonts-src/package.json).
 *  - `--diagnostic` runs with whatever font loads, for the latency breakdown only. Its evidence is marked diagnostic
 *    and never counts toward qualification.
 *
 * Run: npm run benchmark:ocr [-- --diagnostic | -- --report]
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { OCR_CALIBRATION_CELLS, evaluateOcrCell, cellIdOf, latencySummary, type OcrCalibrationLaunch, type OcrCellSummary } from "./lib/ocr-calibration-criteria.mts";
import { runEmulationProbe } from "./lib/ocr-emulation-probe.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIAGNOSTIC = process.argv.includes("--diagnostic");
const REPORT_ONLY = process.argv.includes("--report");
/** One session fits a 10-minute agent command with time to stage, start and decide. */
const BUDGET_FLAG = process.argv.indexOf("--budget-sec");
/** `--budget-sec N` shortens DIAGNOSTIC sessions only (harness smoke runs); qualifying sessions always use 7 minutes. */
const SESSION_BUDGET_MS = DIAGNOSTIC && BUDGET_FLAG > 0 ? Math.max(10, Number.parseInt(process.argv[BUDGET_FLAG + 1] ?? "", 10) || 60) * 1000 : 7 * 60 * 1000;
const EVIDENCE_DIR = path.join(process.env.LOCALAPPDATA ?? os.homedir(), "SpecterStudio", "ocr-calibration", "sessions");
const KNOWN_LOCAL_DIST = "C:\\electron-dist";
/** The OCR pipeline sources a result depends on: any change starts a new environment. */
const PIPELINE_SOURCES = [
  "src/runner/ocr/OcrStep.ts",
  "src/runner/ocr/ocrAssertionContract.ts",
  "src/runner/StepExecutor.ts",
  "src/visual/ocr/decideTextAssertion.ts",
  "src/visual/ocr/preprocess.ts",
  "src/visual/capture.ts",
  "src/visual/internal/captureCore.ts",
  "src/visual/png.ts",
  "src/ocr/OcrHostProtocol.ts",
  "src/ocr/ocrExpectedText.ts",
  "app/main/ocr/OcrUtilityHostManager.ts",
  "native-hosts/ocr/ocr-host.cjs",
  "scripts/ocr-calibration/calibrationMain.ts",
  "scripts/lib/ocr-calibration-criteria.mts"
];

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

function readSessions(): Array<{ sessionId: string; diagnostic: boolean; launches: OcrCalibrationLaunch[]; replays?: Array<{ cell: string; screenshotMs: number; decodeMs: number; pixels: number }>; emulation?: unknown }> {
  if (!existsSync(EVIDENCE_DIR)) return [];
  return readdirSync(EVIDENCE_DIR)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      try {
        const parsed = JSON.parse(readFileSync(path.join(EVIDENCE_DIR, name), "utf8"));
        return parsed?.version === 1 && Array.isArray(parsed.launches) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

function printCell(s: OcrCellSummary & { diagnostic?: boolean }): void {
  const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(2)}%`);
  console.log(
    `  ${s.cell.padEnd(18)} ${s.qualified ? "QUALIFIED" : "unqualified"}${s.diagnostic ? " (diagnostic)" : ""} launches=${s.launches.complete}+${s.launches.failed}failed sessions=${s.launches.sessions} ` +
      `exact=${pct(s.supported.exactMatchRate)} (${s.supported.matched}/${s.supported.trials}) CER=${pct(s.supported.cer)} falseMatched=${s.confusable.falseMatched}/${s.confusable.trials} ` +
      `unsupportedInconclusive=${pct(s.unsupported.inconclusiveRate)} refusals=${pct(s.refusal.correctRate)} budgetExhausted=${s.budgetExhausted.trials}/${s.budgetExhausted.of} ` +
      `p50/p95/p99=${s.latency.p50}/${s.latency.p95}/${s.latency.p99}ms warm-p95=${s.latencyWarm.p95} cold-p50=${s.latencyCold.p50}(n=${s.latencyCold.n})`
  );
  if (s.unmet.length) console.log(`${" ".repeat(21)}unmet: ${s.unmet.join("; ")}`);
}

/** The newest environment of each cell, decided over every session of that environment. */
function decideAll(diagnostic: boolean): Array<OcrCellSummary & { diagnostic: boolean }> {
  const launches = readSessions().flatMap((s) => s.launches);
  return OCR_CALIBRATION_CELLS.map((cell) => {
    const mine = launches.filter((l) => cellIdOf(l.cell) === cellIdOf(cell) && l.diagnostic === diagnostic && !l.coldProbe && l.complete);
    const environment = mine.at(-1)?.environment ?? {};
    return { ...evaluateOcrCell(cell, environment, launches, { diagnostic }), diagnostic };
  });
}

/**
 * The latency breakdown per cell: each phase as the interval between the probe points of one trial (milliseconds from
 * the step's start), over trials that reached recognition. Cold-host and warm-host recognition are reported apart; the
 * N0 replay (a timed screenshot and PNG decode of the same viewport, outside every clock) splits the capture.
 */
function breakdown(diagnostic: boolean): void {
  const sessions = readSessions().filter((s) => s.diagnostic === diagnostic);
  const launches = sessions.flatMap((s) => s.launches);
  const fmt = (values: number[]) => {
    const s = latencySummary(values);
    return s.n ? `${String(s.p50).padStart(5)} / ${String(s.p95).padStart(5)}` : "    - /     -";
  };
  const rows: Array<[string, (p: Record<string, number>, trial: OcrCalibrationLaunch["trials"][number]) => number | undefined]> = [
    ["pre-assess (page, value, loader)", (p) => p["assess-start"]],
    ["protected-surface check", (p) => diff(p["protected-checked"], p["assess-start"])],
    ["target and sensitive checks", (p) => diff(p["target-checked"], p["protected-checked"])],
    ["N0 guarded capture", (p) => diff(p.captured, p["capture-start"])],
    ["preprocessing", (p) => diff(p.preprocessed, p.captured)],
    ["recognize call (queue+IPC+engine)", (p) => p.recognizeCallMs],
    ["  engine recognition (host)", (p) => p.hostRecognizeMs],
    ["  queue, start-up and IPC", (p) => diff(p.recognizeCallMs, p.hostRecognizeMs)],
    ["decision and settlement", (p) => diff(p.wallMs, p.recognized)],
    ["whole operation (record)", (_p, t) => t.durationMs],
    ["  outside the record (flow retry loop)", (p, t) => diff(p.wallMs, t.durationMs)],
    ["event-loop max lag", (p) => p.maxLoopLagMs]
  ];
  function diff(a: number | undefined, b: number | undefined): number | undefined {
    return a === undefined || b === undefined ? undefined : a - b;
  }
  console.log(`\nLatency breakdown (${diagnostic ? "diagnostic" : "qualifying"} evidence, ${sessions.length} sessions), p50 / p95 ms over trials that reached recognition:`);
  console.log(`  ${"phase".padEnd(36)} ${OCR_CALIBRATION_CELLS.map((c) => cellIdOf(c).padStart(16)).join("")}`);
  const ofCell = (cell: (typeof OCR_CALIBRATION_CELLS)[number]) =>
    launches.filter((l) => cellIdOf(l.cell) === cellIdOf(cell) && !l.coldProbe).flatMap((l) => l.trials).filter((t) => t.phases && t.phases["recognize-start"] !== undefined);
  for (const [label, pick] of rows) {
    console.log(`  ${label.padEnd(36)} ${OCR_CALIBRATION_CELLS.map((c) => fmt(ofCell(c).flatMap((t) => { const v = pick(t.phases ?? {}, t); return v === undefined ? [] : [v]; })).padStart(16)).join("")}`);
  }
  const coldTrials = launches.flatMap((l) => l.trials.filter((t) => t.coldHost && t.phases?.["recognize-start"] !== undefined));
  const warmTrials = launches.flatMap((l) => l.trials.filter((t) => !t.coldHost && t.phases?.["recognize-start"] !== undefined));
  const call = (ts: typeof coldTrials) => ts.flatMap((t) => (t.phases?.recognizeCallMs === undefined ? [] : [t.phases.recognizeCallMs]));
  const whole = (ts: typeof coldTrials) => ts.map((t) => t.durationMs);
  console.log(`\n  Host: cold recognize call p50/p95 ${fmt(call(coldTrials))} ms (n=${coldTrials.length}, whole ${fmt(whole(coldTrials))}); warm ${fmt(call(warmTrials))} ms (n=${warmTrials.length}, whole ${fmt(whole(warmTrials))})`);
  const coldBudget = coldTrials.filter((t) => t.code === "budget-exhausted").length;
  console.log(`  Cold-host trials ending budget-exhausted: ${coldBudget} of ${coldTrials.length}`);
  console.log("  N0 replay (same viewport, outside the clock), screenshot / PNG decode p50/p95 ms:");
  for (const cell of OCR_CALIBRATION_CELLS) {
    const replays = sessions.flatMap((s) => s.replays ?? []).filter((r) => r.cell === cellIdOf(cell));
    console.log(`    ${cellIdOf(cell).padEnd(18)} screenshot ${fmt(replays.map((r) => r.screenshotMs))}  decode ${fmt(replays.map((r) => r.decodeMs))}  pixels ${replays[0]?.pixels ?? "-"} (n=${replays.length})`);
  }
  // Per fixture over every cell (codes only): where the misses and false matches come from.
  const byFixture = new Map<string, { cls: string; n: number; verdicts: Record<string, number>; codes: Record<string, number> }>();
  for (const trial of launches.filter((l) => !l.coldProbe).flatMap((l) => l.trials)) {
    // Keyed by fixture AND its class in the cell (small-9 is unsupported at DPR 1 and supported above it).
    const key = `${trial.fixtureId}@${trial.fixtureClass}`;
    const row = byFixture.get(key) ?? { cls: trial.fixtureClass, n: 0, verdicts: {}, codes: {} };
    row.n += 1;
    row.verdicts[trial.verdict] = (row.verdicts[trial.verdict] ?? 0) + 1;
    row.codes[trial.code] = (row.codes[trial.code] ?? 0) + 1;
    byFixture.set(key, row);
  }
  console.log("\n  Outcomes per fixture (all cells; codes only):");
  for (const [id, row] of [...byFixture.entries()].sort((a, b) => a[1].cls.localeCompare(b[1].cls) || a[0].localeCompare(b[0]))) {
    const codes = Object.entries(row.codes).sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c} ${k}`).join(", ");
    console.log(`    ${row.cls.padEnd(11)} ${id.split("@")[0].padEnd(16)} n=${String(row.n).padStart(3)}  matched ${row.verdicts.matched ?? 0}  differs ${row.verdicts.differs ?? 0}  inconclusive ${row.verdicts.inconclusive ?? 0}  [${codes}]`);
  }
  const emulation = sessions.map((s) => s.emulation).filter(Boolean).at(-1);
  if (emulation) console.log(`  Emulation probe (latest session): ${JSON.stringify(emulation)}`);
}

if (REPORT_ONLY) {
  console.log(`OCR calibration report over ${EVIDENCE_DIR}\n`);
  for (const s of decideAll(false)) printCell(s);
  breakdown(false);
  console.log("\nDiagnostic evidence (never qualifies):");
  for (const s of decideAll(true)) printCell(s);
  breakdown(true);
  process.exit(0);
}

function electronExecutable(): string {
  const override = process.env.ELECTRON_OVERRIDE_DIST_PATH ?? (process.platform === "win32" && existsSync(path.join(KNOWN_LOCAL_DIST, "electron.exe")) ? KNOWN_LOCAL_DIST : undefined);
  const installed = readFileSync(path.join(root, "node_modules/electron/dist/version"), "utf8").trim();
  if (override) {
    const local = existsSync(path.join(override, "version")) ? readFileSync(path.join(override, "version"), "utf8").trim() : "unknown";
    if (local !== installed) throw new Error(`the local Electron copy at ${override} is ${local}, not the installed ${installed}`);
    return path.join(override, "electron.exe");
  }
  return path.join(root, "node_modules/electron/dist/electron.exe");
}

/** The bundled font, verified byte for byte against its manifest; "missing" when absent or altered. */
function fontFingerprint(): Record<string, string> | "missing" {
  const dir = path.join(root, "mock-site", "public", "fonts");
  const manifestPath = path.join(dir, "fonts-manifest.json");
  if (!existsSync(manifestPath)) return "missing";
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { files: Array<{ file: string; sha256: string }> };
  const out: Record<string, string> = {};
  for (const f of manifest.files) {
    const file = path.join(dir, f.file);
    if (!existsSync(file) || sha256(readFileSync(file)) !== f.sha256) return "missing";
    out[f.file] = f.sha256;
  }
  return out;
}

function appCommit(): string {
  const head = readFileSync(path.join(root, ".git", "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) return head;
  const ref = head.slice(5);
  const loose = path.join(root, ".git", ref);
  if (existsSync(loose)) return readFileSync(loose, "utf8").trim();
  const packed = readFileSync(path.join(root, ".git", "packed-refs"), "utf8").split("\n").find((line) => line.endsWith(` ${ref}`));
  return packed?.split(" ")[0] ?? "unknown";
}

const fonts = fontFingerprint();
if (fonts === "missing" && !DIAGNOSTIC) {
  console.error(
    "BLOCKED: the bundled OCR Lab font is not staged (mock-site/public/fonts). Owner action: " +
      "npm install --prefix mock-site/fonts-src --ignore-scripts --no-audit --no-fund, then node scripts/prepare-ocr-lab-fonts.mjs. " +
      "Use --diagnostic for the latency breakdown only (never counted)."
  );
  process.exit(2);
}

const work = mkdtempSync(path.join(os.tmpdir(), "awkit-ocr-cal-"));
const assets = path.join(work, "assets");
let exitCode = 1;
let server: ReturnType<typeof spawn> | undefined;
try {
  const staged = spawnSync(process.execPath, [path.join(root, "scripts", "prepare-ocr-assets.mjs"), "--out", assets], { cwd: root, encoding: "utf8", timeout: 120_000 });
  if (staged.status !== 0) throw new Error(`asset staging failed: ${String(staged.stderr).trim().slice(0, 300)}`);
  const stagedManifest = readFileSync(path.join(assets, "ocr-asset-manifest.json"));
  const fingerprint = {
    harness: 1,
    platform: process.platform,
    osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCount: os.cpus().length,
    hostArch: process.env.PROCESSOR_ARCHITEW6432 ?? process.env.PROCESSOR_ARCHITECTURE ?? os.arch(),
    stagedAssetManifest: sha256(stagedManifest),
    fonts,
    fixtures: sha256(readFileSync(path.join(root, "mock-site", "public", "ocr-fixtures.json"))),
    labPage: sha256(readFileSync(path.join(root, "mock-site", "public", "visual-intelligence-ocr.html"))),
    pipeline: sha256(PIPELINE_SOURCES.map((file) => `${file}:${sha256(readFileSync(path.join(root, file)))}`).join("\n")),
    policy: { thresholds: "UNCALIBRATED_TEXT_ASSERTION_POLICY 80/92", deadlineMs: 1500 }
  };
  const orchestratorEmulation = runEmulationProbe();

  const outDir = path.join(root, "out", "ocr-calibration");
  mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: [path.join(root, "scripts", "ocr-calibration", "calibrationMain.ts")],
    outfile: path.join(outDir, "main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron", "playwright", "playwright-core"],
    alias: { "@main": path.join(root, "app", "main"), "@src": path.join(root, "src") },
    logLevel: "silent"
  });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ name: "awkit-ocr-calibration", version: "0.0.0", main: "main.cjs" }));

  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("no free port"))));
    });
  });
  const lab = `http://127.0.0.1:${port}/visual-intelligence/ocr`;
  server = spawn(process.execPath, ["mock-site/server.mjs"], { cwd: root, env: { ...process.env, MOCK_SITE_PORT: String(port) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  for (let attempt = 0; attempt < 100 && !(await fetch(lab).then((r) => r.ok, () => false)); attempt += 1) await new Promise((r) => setTimeout(r, 100));

  const installedBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "ms-playwright") : undefined);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(installedBrowsers && existsSync(installedBrowsers) ? { PLAYWRIGHT_BROWSERS_PATH: installedBrowsers } : {}),
    AWKIT_OCR_CAL_LAB_URL: lab,
    AWKIT_OCR_CAL_BUDGET_MS: String(SESSION_BUDGET_MS),
    AWKIT_OCR_CAL_EVIDENCE_DIR: EVIDENCE_DIR,
    AWKIT_OCR_CAL_ASSET_DIR: assets,
    AWKIT_OCR_CAL_HOST_PATH: path.join(root, "native-hosts", "ocr", "ocr-host.cjs"),
    AWKIT_OCR_CAL_DIAGNOSTIC: DIAGNOSTIC ? "1" : "0",
    AWKIT_OCR_CAL_ENV: JSON.stringify({ fingerprint, appCommit: appCommit(), orchestratorEmulation })
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = electronExecutable();
  console.log(`OCR calibration session${DIAGNOSTIC ? " (DIAGNOSTIC: never counts)" : ""}: budget ${SESSION_BUDGET_MS / 60000} min, commit ${appCommit().slice(0, 9)}, fonts ${fonts === "missing" ? "MISSING (fallback)" : "bundled"}`);
  console.log(`  emulation probe (orchestrator ${orchestratorEmulation.arch}): preprocess ${orchestratorEmulation.preprocessMs} ms, sha256 ${orchestratorEmulation.sha256Ms} ms\n`);
  const lines: Array<Record<string, unknown>> = [];
  exitCode = await new Promise<number>((resolve) => {
    const child = spawn(executable, [outDir], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("OCRCAL ")) {
          try {
            lines.push(JSON.parse(line.slice(7)) as Record<string, unknown>);
          } catch {
            // not ours
          }
        }
      }
    });
    child.stderr.on("data", () => undefined);
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
  for (const line of lines) {
    if (line.kind === "cell") printCell(line as unknown as OcrCellSummary & { diagnostic?: boolean });
    else console.log(`  [${line.kind}] ${JSON.stringify(line)}`);
  }
  if (!lines.some((l) => l.kind === "done")) console.error("\nThe calibration session did not finish (see the lines above).");
} finally {
  server?.kill();
  rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);
