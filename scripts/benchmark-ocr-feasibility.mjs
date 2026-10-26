/**
 * benchmark:ocr-feasibility — N7.1a (awkit-vra.9.2): the actual offline OCR engine feasibility proof, wrapper vs core.
 *
 * The spike lives in scripts/ocr-feasibility/, with its own pinned package.json, so nothing reaches the product
 * (electron-builder packages only out/** and listed root files). Its dependencies are installed once by the owner:
 *
 *   npm install --prefix scripts/ocr-feasibility --ignore-scripts --no-audit --no-fund
 *
 * Without them, the harness self-test still runs, and both candidates are reported NOT RUN (exit 1). Nothing is ever
 * downloaded by this script.
 *
 * The run:
 *   1. inventories each candidate: installed version, license, lockfile integrity, SHA-256 of the files it loads;
 *   2. starts Electron 33 (scripts/ocr-feasibility/electron-main.cjs), which evaluates the probe host (harness
 *      self-test) and each installed candidate in a utilityProcess (see that file for the rows);
 *   3. applies the gates declared below BEFORE any result was seen, and selects per the plan: of the candidates that
 *      pass every row, the one with the least integration code. If none passes, the result is NO-GO and the engine
 *      choice returns to the owner;
 *   4. writes scripts/ocr-feasibility/results/latest.json.
 *
 * Exit 0 when the evaluation completed (GO or NO-GO); exit 1 when the harness self-test failed or a candidate could
 * not run.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "./lib/gui-verify-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const spikeDir = path.join(root, "scripts", "ocr-feasibility");
const modules = path.join(spikeDir, "node_modules");
const relative = (p) => path.relative(root, p).replace(/\\/g, "/");
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const INSTALL = "npm install --prefix scripts/ocr-feasibility --ignore-scripts --no-audit --no-fund";

/** Declared before any candidate ran. Targets from OC-9 where the plan has one. */
const THRESHOLDS = {
  initMs: 120000,
  recognizeMs: 60000,
  cancelAfterMs: 150,
  cancelDeadlineMs: 1500,
  killDeadlineMs: 5000,
  lateGraceMs: 3000,
  peakWorkingSetMB: 400,
  growthMB: 64,
  repeat: 10
};
const LICENSE_ALLOWLIST = new Set(["Apache-2.0", "MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "CC0-1.0", "BlueOak-1.0.0"]);
const GATED_ROWS = ["runtime", "init", "recognition", "memory", "cancellation", "crashIsolation", "hangIsolation", "network", "cleanup"];

const pinned = readJson(path.join(spikeDir, "package.json")).dependencies;
const lock = fs.existsSync(path.join(spikeDir, "package-lock.json")) ? readJson(path.join(spikeDir, "package-lock.json")) : null;

function installed(name) {
  const file = path.join(modules, ...name.split("/"), "package.json");
  if (!fs.existsSync(file)) return null;
  const pkg = readJson(file);
  return {
    name,
    version: pkg.version,
    pinned: pinned[name] ?? null,
    license: pkg.license ?? null,
    integrity: lock?.packages?.[`node_modules/${name}`]?.integrity ?? null
  };
}

function findDataFile() {
  const base = path.join(modules, "@tesseract.js-data", "eng");
  if (!fs.existsSync(base)) return null;
  const files = fs.readdirSync(base, { recursive: true }).map(String).filter((f) => /(^|[\\/])eng\.traineddata(\.gz)?$/.test(f));
  const rank = (f) => (/4\.0\.0_best_int/.test(f) ? 0 : /4\.0\.0/.test(f) ? 1 : 2);
  files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return files.length ? path.join(base, files[0]) : null;
}

function licenses() {
  if (!fs.existsSync(modules)) return [];
  const out = [];
  for (const entry of fs.readdirSync(modules)) {
    const dirs = entry.startsWith("@") ? fs.readdirSync(path.join(modules, entry)).map((d) => path.join(entry, d)) : entry.startsWith(".") ? [] : [entry];
    for (const dir of dirs) {
      const file = path.join(modules, dir, "package.json");
      if (!fs.existsSync(file)) continue;
      const pkg = readJson(file);
      const license = typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? null;
      out.push({ name: pkg.name, version: pkg.version, license, allowed: LICENSE_ALLOWLIST.has(license) });
    }
  }
  return out;
}

function codeLines(file) {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("//")).length;
}

const wrapper = installed("tesseract.js");
const core = installed("tesseract.js-core");
const data = installed("@tesseract.js-data/eng");
const dataFile = findDataFile();
const coreDir = path.join(modules, "tesseract.js-core");
const coreFiles = core ? fs.readdirSync(coreDir).filter((f) => /^tesseract-core.*\.(js|wasm)$/.test(f)).sort() : [];

const inventory = {
  wrapper: wrapper && core && data && dataFile
    ? {
        packages: [wrapper, core, data],
        files: [path.join(modules, "tesseract.js", "package.json"), path.join(modules, "tesseract.js", "src", "worker-script", "node", "index.js"), ...coreFiles.map((f) => path.join(coreDir, f)), dataFile].filter((f) => fs.existsSync(f)).map((f) => ({ file: relative(f), sha256: sha256(f) })),
        integrationLines: codeLines(path.join(spikeDir, "host-wrapper.cjs")) + codeLines(path.join(spikeDir, "worker-shim.cjs"))
      }
    : null,
  core: core && data && dataFile
    ? {
        packages: [core, data],
        files: [...coreFiles.map((f) => path.join(coreDir, f)), dataFile].map((f) => ({ file: relative(f), sha256: sha256(f) })),
        integrationLines: codeLines(path.join(spikeDir, "host-core.cjs"))
      }
    : null
};

const nativeArm64 = process.platform === "win32" && (fs.existsSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "xtajit64.dll")) || /arm/i.test(os.cpus()[0]?.model ?? ""));
const electronPath = createRequire(import.meta.url)("electron");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ocr-feasibility-"));
const resultPath = path.join(workDir, "result.json");
const candidates = Object.entries(inventory).filter(([, value]) => value).map(([kind]) => kind);
fs.writeFileSync(path.join(workDir, "config.json"), JSON.stringify({ spikeDir, dataFile, resultPath, candidates, thresholds: THRESHOLDS }));

console.log("benchmark:ocr-feasibility — N7.1a offline OCR engine feasibility (wrapper vs core)\n");
console.log(`  host: ${process.platform} ${os.release()}, native CPU ${nativeArm64 ? "ARM64" : os.arch()}, Node ${process.version} ${process.arch}`);
for (const kind of ["wrapper", "core"]) {
  console.log(`  ${kind}: ${inventory[kind] ? inventory[kind].packages.map((p) => `${p.name}@${p.version}`).join(", ") : "NOT INSTALLED"}`);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync(electronPath, [path.join(spikeDir, "electron-main.cjs"), path.join(workDir, "config.json")], { env, encoding: "utf8", timeout: 20 * 60 * 1000, windowsHide: true });
const raw = fs.existsSync(resultPath) ? readJson(resultPath) : { error: `Electron produced no result (status ${run.status}, signal ${run.signal}): ${`${run.stderr ?? ""}`.slice(-800)}` };
fs.rmSync(workDir, { recursive: true, force: true });

const licenseList = licenses();
const evaluation = {};
for (const kind of ["wrapper", "core"]) {
  const inv = inventory[kind];
  const ran = raw.candidates?.[kind];
  if (!inv || !ran) {
    evaluation[kind] = { status: "NOT RUN", reason: inv ? raw.error ?? "the harness did not evaluate it" : `dependencies not installed: owner runs ${INSTALL}` };
    continue;
  }
  const rows = { ...ran.rows };
  rows.integrity = { pass: inv.packages.every((p) => p.version === p.pinned && p.integrity) && inv.files.length > 0, packages: inv.packages, files: inv.files };
  const names = new Set(inv.packages.map((p) => p.name));
  const relevant = licenseList.filter((l) => names.has(l.name) || kind === "wrapper");
  rows.licensing = { pass: relevant.length > 0 && relevant.every((l) => l.allowed), packages: relevant };
  rows.complexity = { pass: true, integrationLines: inv.integrationLines };
  const failed = [...GATED_ROWS, "integrity", "licensing"].filter((name) => !rows[name]?.pass);
  evaluation[kind] = { status: failed.length ? "FAIL" : "PASS", failedRows: failed, rows };
}

const probe = raw.harness?.probe;
const selfTestPass = Boolean(probe && probe.pass);
const passing = ["wrapper", "core"].filter((kind) => evaluation[kind].status === "PASS");
const notRun = ["wrapper", "core"].filter((kind) => evaluation[kind].status === "NOT RUN");
let selection;
if (!selfTestPass) selection = { status: "INCONCLUSIVE", reason: "the harness self-test failed, so no candidate result is trusted" };
else if (notRun.length) selection = { status: "NOT RUN", reason: `${notRun.join(" and ")} not evaluated` };
else if (passing.length === 0) selection = { status: "NO-GO", reason: "neither candidate met every requirement; the engine choice returns to the owner (OC-1)" };
else {
  passing.sort((a, b) => evaluation[a].rows.complexity.integrationLines - evaluation[b].rows.complexity.integrationLines);
  selection = { status: "GO", selected: passing[0], rule: "of the candidates that pass every row, the one with the least integration code (plan, Wrapper vs core)" };
}

const result = {
  spike: "awkit-n7.1a-ocr-feasibility",
  version: 1,
  ranAt: new Date().toISOString(),
  host: { platform: process.platform, release: os.release(), nativeCpu: nativeArm64 ? "ARM64" : os.arch(), nodeArch: process.arch },
  thresholds: THRESHOLDS,
  harness: { selfTest: selfTestPass ? "PASS" : "FAIL", probe, fixtures: raw.harness?.fixtures ?? null, chromiumRequests: raw.harness?.chromiumRequests ?? null, error: raw.error ?? null },
  evaluation,
  selection
};
fs.mkdirSync(path.join(spikeDir, "results"), { recursive: true });
fs.writeFileSync(path.join(spikeDir, "results", "latest.json"), `${JSON.stringify(result, null, 2)}\n`);

console.log(`\n  harness self-test: ${result.harness.selfTest}`);
if (probe) for (const [name, rowValue] of Object.entries(probe.rows)) console.log(`    ${rowValue.pass ? "PASS" : "FAIL"} probe ${name}`);
if (raw.error) console.log(`    error: ${raw.error.split("\n")[0]}`);
for (const kind of ["wrapper", "core"]) {
  const e = evaluation[kind];
  console.log(`  ${kind}: ${e.status}${e.reason ? ` — ${e.reason}` : ""}`);
  if (e.rows) for (const [name, rowValue] of Object.entries(e.rows)) console.log(`    ${rowValue.pass ? "PASS" : "FAIL"} ${name}`);
}
console.log(`\n  selection: ${selection.status}${selection.selected ? ` — ${selection.selected}` : ""}${selection.reason ? ` — ${selection.reason}` : ""}`);
console.log(`  result: ${relative(path.join(spikeDir, "results", "latest.json"))}`);
process.exit(selfTestPass && (selection.status === "GO" || selection.status === "NO-GO") ? 0 : 1);
