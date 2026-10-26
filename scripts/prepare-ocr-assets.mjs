/**
 * prepare:ocr-assets — Phase N, N7.3 (awkit-vra.9.11): stage the offline OCR engine assets that N7.1a qualified.
 *
 * Reads the pin src/offline/ocr-runtime.json (DECISIONS 2026-10-26: direct tesseract.js-core 6.0.0, SIMD LSTM flavor
 * only, @tesseract.js-data/eng 1.0.0 best_int English data) and stages EXACTLY the pinned files into build/ocr, which
 * electron-builder ships to resources/ocr via extraResources. Nothing is downloaded: the inputs are the lockfile-pinned
 * install the N7.1a benchmark qualified (scripts/ocr-feasibility/node_modules) or a folder passed with --inputs, and
 * every file must match its pinned SHA-256 and package version before anything is written.
 *
 * Output: the three engine and data files, the Tesseract licence text, a generated notice, and
 * ocr-asset-manifest.json listing every staged file with its size and SHA-256 (folded into the signed dependency
 * manifest by generate-dependency-manifest.ps1 and re-checked by validate-offline-bundle.ps1). The total must stay
 * within the pinned OC-9 size target. Any mismatch fails before the output is replaced, leaving an earlier staging
 * intact.
 *
 *   node scripts/prepare-ocr-assets.mjs [--out <dir>] [--inputs <dir>]
 *
 * --out must be the default build/ocr or a directory outside the repository (verifiers stage into a temp folder).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PIN_PATH = path.join(ROOT, "src", "offline", "ocr-runtime.json");
const DEFAULT_INPUTS = path.join(ROOT, "scripts", "ocr-feasibility", "node_modules");
const DEFAULT_OUT = path.join(ROOT, "build", "ocr");
const MANIFEST_NAME = "ocr-asset-manifest.json";
const NOTICE_NAME = "OCR-NOTICE.txt";

function fail(message) {
  console.error(`prepare-ocr-assets FAILED: ${message}`);
  process.exit(1);
}

const argument = (flag) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? null : process.argv[at + 1] ?? fail(`${flag} needs a value.`);
};
const OUT_DIR = path.resolve(argument("--out") ?? DEFAULT_OUT);
const INPUTS = path.resolve(argument("--inputs") ?? DEFAULT_INPUTS);
const insideRoot = !path.relative(ROOT, OUT_DIR).startsWith("..") && !path.isAbsolute(path.relative(ROOT, OUT_DIR));
if (OUT_DIR !== DEFAULT_OUT && insideRoot) fail(`--out must be the default build/ocr or a directory outside the repository (got ${OUT_DIR}).`);
if (fs.existsSync(OUT_DIR) && fs.readdirSync(OUT_DIR).length > 0 && !fs.existsSync(path.join(OUT_DIR, MANIFEST_NAME))) {
  fail(`Refusing to replace ${OUT_DIR}: it is not empty and holds no ${MANIFEST_NAME}.`);
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const plainRelative = (value) => typeof value === "string" && value.length > 0 && !value.includes("\\") && !value.split("/").some((part) => part === "" || part === "." || part === "..");

// ── The pin ───────────────────────────────────────────────────────────────────────────────────────────────────────
if (!fs.existsSync(PIN_PATH)) fail("src/offline/ocr-runtime.json is missing.");
let PIN;
try {
  PIN = JSON.parse(fs.readFileSync(PIN_PATH, "utf8"));
} catch (error) {
  fail(`src/offline/ocr-runtime.json is not valid JSON: ${error.message}`);
}
if (PIN.schema?.name !== "awkit-ocr-runtime-pin" || PIN.schema?.version !== 1) fail("src/offline/ocr-runtime.json is not a version-1 OCR runtime pin.");
if (PIN.engine?.package !== "tesseract.js-core" || PIN.engine?.flavor !== "simd-lstm") fail("The pin must name tesseract.js-core with the qualified simd-lstm flavor only.");
if (!Array.isArray(PIN.files) || PIN.files.length !== 3) fail("The pin must list exactly the three qualified files (engine JS, engine WASM, language data).");
for (const file of PIN.files) {
  if (!plainRelative(file.source) || !/^[A-Za-z0-9._-]+$/.test(file.target ?? "") || !/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) {
    fail(`Pin entry ${JSON.stringify(file.target)} needs a plain source path, a plain target name and a SHA-256.`);
  }
}
if (!PIN.files.some((f) => f.role === "engine-wasm") || !PIN.files.some((f) => f.role === "engine-js") || !PIN.files.some((f) => f.role === "language-data")) {
  fail("The pin must cover the engine JS, the engine WASM and the language data.");
}
if (!plainRelative(PIN.license?.source) || !/^[A-Za-z0-9._-]+$/.test(PIN.license?.target ?? "")) fail("The pin must name the licence file to ship.");
if (!Number.isInteger(PIN.budget?.maxTotalBytes) || PIN.budget.maxTotalBytes <= 0) fail("The pin must carry the OC-9 size target (budget.maxTotalBytes).");

// ── The inputs ────────────────────────────────────────────────────────────────────────────────────────────────────
for (const [label, spec] of [["engine", PIN.engine], ["data", PIN.data]]) {
  const manifest = path.join(INPUTS, ...String(spec.package).split("/"), "package.json");
  if (!fs.existsSync(manifest)) fail(`${spec.package} is not present under ${INPUTS} (install the N7.1a spike dependencies or pass --inputs).`);
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== spec.version) fail(`${label} package ${spec.package} is ${version}, not the pinned ${spec.version}.`);
}
const sources = PIN.files.map((file) => {
  const source = path.join(INPUTS, ...file.source.split("/"));
  if (!fs.existsSync(source)) fail(`${file.source} is missing under ${INPUTS}.`);
  if (fs.lstatSync(source).isSymbolicLink()) fail(`${file.source} is a link; only regular files are staged.`);
  const actual = sha256(source);
  if (actual !== file.sha256) fail(`${file.source} does not match its pinned SHA-256 (got ${actual}).`);
  return { ...file, source };
});
const licenseSource = path.join(INPUTS, ...PIN.license.source.split("/"));
if (!fs.existsSync(licenseSource)) fail(`${PIN.license.source} is missing under ${INPUTS}.`);
if (!fs.readFileSync(licenseSource, "utf8").includes(PIN.license.mustContain ?? "Apache License")) fail(`${PIN.license.source} is not the expected licence text.`);

// ── Stage beside the output, then swap ───────────────────────────────────────────────────────────────────────────
const staging = `${OUT_DIR}.staging-${process.pid}`;
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });
const assets = [];
const add = (name, role, write) => {
  const target = path.join(staging, name);
  write(target);
  assets.push({ relativePath: name, role, size: fs.statSync(target).size, sha256: sha256(target) });
};
for (const file of sources) add(file.target, file.role, (target) => fs.copyFileSync(file.source, target));
add(PIN.license.target, "license", (target) => fs.copyFileSync(licenseSource, target));
const notice = [
  "Offline OCR assets shipped with SpecterStudio (Phase N, N7). Optional and off by default.",
  "",
  `Engine: ${PIN.engine.package} ${PIN.engine.version} (${PIN.engine.license}), ${PIN.engine.flavor} build: Tesseract OCR compiled to WebAssembly.`,
  `Licence text: ${PIN.license.target}.`,
  `Language data: ${PIN.data.package} ${PIN.data.version} (package licence ${PIN.data.packageLicense}), ${PIN.data.variant}/eng.traineddata.gz,`,
  "trained Tesseract LSTM recognition data for English. A fixed-function recognition model (OC-2); never generative,",
  "never downloaded, never required by the rest of the application.",
  "",
  `Qualified by ${PIN.qualification?.benchmark} at commit ${PIN.qualification?.commit} (${PIN.decision}).`,
  ""
].join("\n");
add(NOTICE_NAME, "notice", (target) => fs.writeFileSync(target, notice));

const totalBytes = assets.reduce((sum, asset) => sum + asset.size, 0);
if (totalBytes > PIN.budget.maxTotalBytes) {
  fs.rmSync(staging, { recursive: true, force: true });
  fail(`The staged OCR assets total ${totalBytes} bytes, above the pinned OC-9 target of ${PIN.budget.maxTotalBytes}.`);
}
const manifest = {
  schema: { name: "awkit-ocr-asset-manifest", version: 1 },
  engine: { package: PIN.engine.package, version: PIN.engine.version, integrity: PIN.engine.integrity, license: PIN.engine.license, flavor: PIN.engine.flavor, requiresWasmSimd: PIN.engine.requiresWasmSimd === true },
  data: { package: PIN.data.package, version: PIN.data.version, integrity: PIN.data.integrity, packageLicense: PIN.data.packageLicense, variant: PIN.data.variant, language: PIN.data.language },
  qualification: PIN.qualification,
  fileCount: assets.length,
  totalBytes,
  assets
};
fs.writeFileSync(path.join(staging, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(path.dirname(OUT_DIR), { recursive: true });
fs.renameSync(staging, OUT_DIR);
console.log(`prepare-ocr-assets: staged ${assets.length} files, ${totalBytes} bytes (target ${PIN.budget.maxTotalBytes}), into ${path.relative(ROOT, OUT_DIR) || OUT_DIR}.`);
