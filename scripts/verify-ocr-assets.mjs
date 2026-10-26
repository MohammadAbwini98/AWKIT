/**
 * verify:ocr-assets — Phase N, N7.3 (awkit-vra.9.11): the offline OCR asset pin, its staging and its packaging wiring.
 *
 * Source-level evidence only. The packaged load is N7.1b, and strict offline validation of a real release needs the
 * regenerated signed manifest from a packaging run; both stay BLOCKED until the approved release host exists.
 *
 *   A. The pin src/offline/ocr-runtime.json equals the N7.1a decision: the qualified engine, flavor, data variant and
 *      SHA-256 values recorded by the qualifying benchmark run, and the lockfile integrity of the spike install.
 *   B. Staging: prepare-ocr-assets.mjs stages exactly the pinned files (plus the licence, the notice and the
 *      manifest) into a temp folder, every SHA-256 matching, within the OC-9 size target; nothing remote is named.
 *   C. Refusals: a tampered input, a missing input, a wrong package version, a non-empty output without a manifest
 *      and an output inside the repository other than build/ocr are each refused, and an earlier staging survives a
 *      refusal.
 *   D. Wiring: electron-builder ships build/ocr to resources/ocr and never ships the spike; both packaging scripts
 *      stage OCR before the manifest is generated without a new progress step; the manifest generator folds the
 *      staged manifest in as ocrRuntime; the offline validator checks it against the pin; both PowerShell scripts
 *      parse; THIRD_PARTY_NOTICES names the engine and the data.
 *
 * Run: npm run verify:ocr-assets
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const STAGER = path.join(root, "scripts", "prepare-ocr-assets.mjs");
const SPIKE_INPUTS = path.join(root, "scripts", "ocr-feasibility", "node_modules");

let passed = 0;
let failed = 0;
const check = (label, condition, detail) => {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const stage = (args) => spawnSync(process.execPath, [STAGER, ...args], { cwd: root, encoding: "utf8", timeout: 120_000 });

console.log("verify:ocr-assets — N7.3 offline OCR asset pin, staging and packaging wiring\n");

// ── A. Pin equals the N7.1a decision ──────────────────────────────────────────────────────────────────────────────
console.log("A. The pin is the qualified engine");
const pin = JSON.parse(read("src/offline/ocr-runtime.json"));
const evidence = JSON.parse(read("scripts/ocr-feasibility/results/latest.json"));
const lock = JSON.parse(read("scripts/ocr-feasibility/package-lock.json"));
check("the qualifying run selected the direct core with a GO", evidence.selection?.status === "GO" && evidence.selection?.selected === "core");
check("the qualifying run passed every core row", evidence.evaluation?.core?.status === "PASS" && (evidence.evaluation.core.failedRows ?? ["?"]).length === 0);
check("pin schema is awkit-ocr-runtime-pin v1", pin.schema?.name === "awkit-ocr-runtime-pin" && pin.schema?.version === 1);
check("pin engine is tesseract.js-core 6.0.0, simd-lstm, SIMD required", pin.engine?.package === "tesseract.js-core" && pin.engine?.version === "6.0.0" && pin.engine?.flavor === "simd-lstm" && pin.engine?.requiresWasmSimd === true);
check("pin data is @tesseract.js-data/eng 1.0.0, 4.0.0_best_int English", pin.data?.package === "@tesseract.js-data/eng" && pin.data?.version === "1.0.0" && pin.data?.variant === "4.0.0_best_int" && pin.data?.language === "eng");
check("pin engine integrity equals the spike lockfile", pin.engine?.integrity === lock.packages?.["node_modules/tesseract.js-core"]?.integrity && /^sha512-/.test(pin.engine?.integrity ?? ""));
check("pin data integrity equals the spike lockfile", pin.data?.integrity === lock.packages?.["node_modules/@tesseract.js-data/eng"]?.integrity && /^sha512-/.test(pin.data?.integrity ?? ""));
const qualified = new Map((evidence.evaluation?.core?.rows?.integrity?.files ?? []).map((f) => [f.file.replace(/^scripts\/ocr-feasibility\/node_modules\//, ""), f.sha256]));
for (const file of pin.files ?? []) check(`pin ${file.target} SHA-256 equals the qualifying run's hash of ${file.source}`, qualified.get(file.source) === file.sha256, `${file.sha256} vs ${qualified.get(file.source)}`);
const loadedByCore = new Set((evidence.evaluation?.core?.rows?.localAssets?.files ?? []).map((f) => f.file.replace(/^node_modules\//, "")));
check("every pinned file is one the qualified core actually loaded", (pin.files ?? []).length === 3 && pin.files.every((f) => loadedByCore.has(f.source)), [...loadedByCore].join(", "));
check("no non-SIMD, non-LSTM or wrapper file is pinned", (pin.files ?? []).every((f) => !/tesseract-core(-lstm|-simd)?\.(js|wasm)$|tesseract\.js\//.test(f.source) && !/(^|\/)tesseract-core\.(js|wasm)$/.test(f.source)));
check("the pin carries the OC-9 8 MB target", pin.budget?.maxTotalBytes === 8_000_000);
check("the pin names no remote URL", !/https?:\/\//i.test(JSON.stringify(pin)));

// ── B. Staging ────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nB. Staging the pinned files");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ocr-assets-"));
try {
  const out = path.join(work, "staged");
  const run = stage(["--out", out]);
  check("prepare-ocr-assets stages from the qualified spike install (exit 0)", run.status === 0, `${run.status}: ${`${run.stderr}`.trim().slice(0, 300)}`);
  const manifestPath = path.join(out, "ocr-asset-manifest.json");
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
  check("the staged manifest exists with schema awkit-ocr-asset-manifest v1", manifest?.schema?.name === "awkit-ocr-asset-manifest" && manifest?.schema?.version === 1);
  const onDisk = fs.existsSync(out) ? fs.readdirSync(out, { recursive: true }).map(String).filter((f) => f !== "ocr-asset-manifest.json").sort() : [];
  const listed = (manifest?.assets ?? []).map((a) => a.relativePath).sort();
  check("the staged folder holds exactly the listed files", JSON.stringify(onDisk) === JSON.stringify(listed), `${onDisk.join(", ")} vs ${listed.join(", ")}`);
  check("exactly the three pinned files, the licence and the notice are staged", JSON.stringify(listed) === JSON.stringify([...pin.files.map((f) => f.target), pin.license.target, "OCR-NOTICE.txt"].sort()), listed.join(", "));
  for (const file of pin.files) {
    const staged = path.join(out, file.target);
    check(`${file.target} is staged byte-identical to the pin`, fs.existsSync(staged) && sha256(staged) === file.sha256);
  }
  check("every listed size and SHA-256 matches the staged bytes", (manifest?.assets ?? []).length > 0 && manifest.assets.every((a) => fs.existsSync(path.join(out, a.relativePath)) && fs.statSync(path.join(out, a.relativePath)).size === a.size && sha256(path.join(out, a.relativePath)) === a.sha256));
  const total = (manifest?.assets ?? []).reduce((sum, a) => sum + a.size, 0);
  check(`the staged total (${total} bytes) is within the OC-9 target (measured)`, manifest?.totalBytes === total && total > 0 && total <= pin.budget.maxTotalBytes);
  check("the licence shipped is the Apache-2.0 text", fs.existsSync(path.join(out, pin.license.target)) && fs.readFileSync(path.join(out, pin.license.target), "utf8").includes("Apache License"));
  check("nothing staged names a remote URL in the manifest or notice", !/https?:\/\//i.test(fs.readFileSync(manifestPath, "utf8") + fs.readFileSync(path.join(out, "OCR-NOTICE.txt"), "utf8")));
  const again = path.join(work, "again");
  stage(["--out", again]);
  check("staging is deterministic (same manifest assets twice)", fs.existsSync(path.join(again, "ocr-asset-manifest.json")) && JSON.stringify(JSON.parse(fs.readFileSync(path.join(again, "ocr-asset-manifest.json"), "utf8")).assets) === JSON.stringify(manifest?.assets));

  // ── C. Refusals ─────────────────────────────────────────────────────────────────────────────────────────────────
  console.log("\nC. Refusals");
  const copyInputs = (name) => {
    const inputs = path.join(work, name);
    for (const relative of [...pin.files.map((f) => f.source), pin.license.source, "tesseract.js-core/package.json", "@tesseract.js-data/eng/package.json"]) {
      const target = path.join(inputs, ...relative.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(SPIKE_INPUTS, ...relative.split("/")), target);
    }
    return inputs;
  };
  const before = sha256(path.join(out, "ocr-asset-manifest.json"));
  const tampered = copyInputs("tampered");
  const wasm = path.join(tampered, ...pin.files.find((f) => f.role === "engine-wasm").source.split("/"));
  const bytes = fs.readFileSync(wasm);
  bytes[bytes.length - 1] ^= 0xff;
  fs.writeFileSync(wasm, bytes);
  const tamperRun = stage(["--out", out, "--inputs", tampered]);
  check("a tampered engine WASM is refused", tamperRun.status === 1 && /does not match its pinned SHA-256/.test(tamperRun.stderr), tamperRun.stderr.trim().slice(0, 200));
  check("the earlier staging survives the refusal", fs.existsSync(path.join(out, "ocr-asset-manifest.json")) && sha256(path.join(out, "ocr-asset-manifest.json")) === before);
  const missing = copyInputs("missing");
  fs.rmSync(path.join(missing, ...pin.files.find((f) => f.role === "language-data").source.split("/")));
  const missingRun = stage(["--out", path.join(work, "missing-out"), "--inputs", missing]);
  check("a missing language-data file is refused", missingRun.status === 1 && /is missing/.test(missingRun.stderr), missingRun.stderr.trim().slice(0, 200));
  const version = copyInputs("version");
  const corePackage = path.join(version, "tesseract.js-core", "package.json");
  fs.writeFileSync(corePackage, JSON.stringify({ ...JSON.parse(fs.readFileSync(corePackage, "utf8")), version: "6.0.1" }));
  const versionRun = stage(["--out", path.join(work, "version-out"), "--inputs", version]);
  check("a different engine package version is refused", versionRun.status === 1 && /not the pinned 6\.0\.0/.test(versionRun.stderr), versionRun.stderr.trim().slice(0, 200));
  const occupied = path.join(work, "occupied");
  fs.mkdirSync(occupied);
  fs.writeFileSync(path.join(occupied, "keep.txt"), "user data");
  const occupiedRun = stage(["--out", occupied]);
  check("a non-empty output without a manifest is refused and left untouched", occupiedRun.status === 1 && fs.existsSync(path.join(occupied, "keep.txt")), occupiedRun.stderr.trim().slice(0, 200));
  const insideRun = stage(["--out", path.join(root, "out", "ocr-not-allowed")]);
  check("an output inside the repository other than build/ocr is refused", insideRun.status === 1 && /--out must be/.test(insideRun.stderr) && !fs.existsSync(path.join(root, "out", "ocr-not-allowed")));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

// ── D. Packaging wiring ───────────────────────────────────────────────────────────────────────────────────────────
console.log("\nD. Packaging wiring");
const builder = JSON.parse(read("electron-builder.json"));
const ocrEntry = (builder.extraResources ?? []).find((e) => e.from === "build/ocr");
check("electron-builder ships build/ocr to resources/ocr", ocrEntry?.to === "resources/ocr" && (ocrEntry.filter ?? []).includes("**/*"));
const packaged = [...(builder.files ?? []), ...(builder.extraResources ?? []).map((e) => e.from)];
check("the feasibility spike and its node_modules are never packaged", packaged.every((g) => !String(g).startsWith("scripts")) && !(builder.files ?? []).some((g) => /tesseract/.test(g)));
for (const script of ["scripts/package-portable.ps1", "scripts/package-per-user-installer.ps1"]) {
  const text = read(script);
  const staging = text.indexOf("prepare-ocr-assets.mjs");
  const generate = text.indexOf("generate-dependency-manifest.ps1");
  check(`${script} stages OCR before generating the manifest and stops on failure`, staging > 0 && generate > staging && /prepare-ocr-assets\.mjs"\)\s*\r?\nif \(\$LASTEXITCODE -ne 0\) \{ throw/.test(text));
}
// The roadmap dashboard sizes its progress bar from a fixed [STEP] count (8 before N7.3), so OCR joins an existing step.
check("package-portable keeps its 8 progress steps (OCR staged inside the existing staging step)", (read("scripts/package-portable.ps1").match(/Write-Step "/g) ?? []).length === 8 && /Write-Step "Staging the native utility hosts \(Zvec, local AI, DOM intelligence\) and the OCR assets"/.test(read("scripts/package-portable.ps1")));
const generator = read("scripts/generate-dependency-manifest.ps1");
check("the manifest generator folds build/ocr/ocr-asset-manifest.json in as ocrRuntime", /build\\ocr\\ocr-asset-manifest\.json/.test(generator) && /ocrRuntime = \$ocrRuntime/.test(generator) && /relativePath = "ocr\/\$\(\$_\.relativePath\)"/.test(generator));
const validator = read("scripts/validate-offline-bundle.ps1");
check("the offline validator checks ocrRuntime against the pin, every checksum and the staged set", /Test-Property \$manifestJson "ocrRuntime"/.test(validator) && /src\\offline\\ocr-runtime\.json/.test(validator) && /OCR asset checksum mismatch/.test(validator) && /OCR staged tree holds/.test(validator) && /maxTotalBytes/.test(validator));
for (const script of ["scripts/generate-dependency-manifest.ps1", "scripts/validate-offline-bundle.ps1", "scripts/package-portable.ps1", "scripts/package-per-user-installer.ps1"]) {
  const parse = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${path.join(root, script).replace(/'/g, "''")}', [ref]$null, [ref]$errors); $errors.Count`], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  check(`${script} parses without errors`, parse.status === 0 && parse.stdout.trim() === "0", `${parse.stdout.trim()} ${parse.stderr.trim().slice(0, 200)}`);
}
const notices = read("resources/THIRD_PARTY_NOTICES.md");
check("THIRD_PARTY_NOTICES names tesseract.js-core 6.0.0 (Apache-2.0) and the English data", /tesseract\.js-core.{0,40}6\.0\.0/.test(notices) && /Apache-2\.0/.test(notices) && /@tesseract\.js-data\/eng.{0,40}1\.0\.0/.test(notices));
check("package.json has the prepare:ocr-assets script and no OCR runtime dependency", JSON.parse(read("package.json")).scripts?.["prepare:ocr-assets"] === "node scripts/prepare-ocr-assets.mjs" && !JSON.stringify({ ...JSON.parse(read("package.json")).dependencies }).includes("tesseract"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
