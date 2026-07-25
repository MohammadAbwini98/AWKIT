/**
 * Phase 0C — validate the FINAL PACKAGED application, not the staging tree.
 *
 * Staging-tree validation (scripts/validate-offline-bundle.ps1) proves the inputs were correct.
 * It cannot catch electron-builder omissions, path changes, dictionary displacement, stale staged
 * files, copy/compression mistakes, or accidental duplication of Zvec into app.asar. This verifier
 * recomputes every hash from the packaged files and compares them against the manifest that
 * shipped inside the same package.
 *
 * Usage: node scripts/verify-zvec-packaged-assets.mjs [path-to-win-unpacked]
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PKG_ROOT = path.resolve(process.argv[2] || path.join(ROOT, "dist", "win-unpacked"));
const RES = path.join(PKG_ROOT, "resources");
const HOST_DIR = path.join(RES, "native-hosts", "zvec");

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const s = dirSize(p);
      files += s.files;
      bytes += s.bytes;
    } else if (e.isFile()) {
      files++;
      bytes += fs.statSync(p).size;
    }
  }
  return { files, bytes };
}

const mb = (b) => +(b / 1024 / 1024).toFixed(1);

if (!fs.existsSync(PKG_ROOT)) {
  console.error(`Packaged directory not found: ${PKG_ROOT}`);
  process.exit(1);
}

// ── 1. Full-offline package composition ──────────────────────────────────────────────────────
const chromium = path.join(RES, "resources", "browsers", "chromium", "chrome.exe");
const asar = path.join(RES, "app.asar");
const asarUnpacked = path.join(RES, "app.asar.unpacked");

check("bundledChromium", fs.existsSync(chromium), chromium);
// npm nests playwright-core under playwright/ rather than hoisting it, so accept either layout.
const pwDir = path.join(asarUnpacked, "node_modules", "playwright");
const pwCoreHoisted = path.join(asarUnpacked, "node_modules", "playwright-core");
const pwCoreNested = path.join(pwDir, "node_modules", "playwright-core");
check(
  "playwrightRuntime",
  fs.existsSync(pwDir) && (fs.existsSync(pwCoreHoisted) || fs.existsSync(pwCoreNested)),
  `playwright + playwright-core (${fs.existsSync(pwCoreNested) ? "nested" : "hoisted"})`
);
check("appAsarPresent", fs.existsSync(asar), asar);
check("vendorResources", fs.existsSync(path.join(RES, "vendor")), path.join(RES, "vendor"));
check("appResources", fs.existsSync(path.join(RES, "resources", "sample-flows")), "resources/resources/sample-flows");
check("oracleBridge", fs.existsSync(path.join(RES, "resources", "oracle-jdbc", "manifest.json")), "resources/resources/oracle-jdbc");

// sql.js ships inside app.asar; probe the asar bytes rather than assuming.
const asarBuf = fs.existsSync(asar) ? fs.readFileSync(asar) : Buffer.alloc(0);
check("sqlJsWasmInAsar", asarBuf.includes(Buffer.from("sql-wasm.wasm")), "string present in app.asar");

// ── 2. Packaged manifest ↔ packaged files ────────────────────────────────────────────────────
const packagedManifestPath = path.join(RES, "resources", "dependency-manifest.json");
check("packagedDependencyManifest", fs.existsSync(packagedManifestPath), packagedManifestPath);

let semantic = null;
if (fs.existsSync(packagedManifestPath)) {
  const m = JSON.parse(fs.readFileSync(packagedManifestPath, "utf8"));
  semantic = m.semanticNative ?? null;
  check("manifestDeclaresSemanticNative", semantic?.enabled === true, `enabled=${semantic?.enabled}`);
  check(
    "semanticNotRequiredForStartup",
    semantic?.requiredForAppStartup === false,
    `requiredForAppStartup=${semantic?.requiredForAppStartup}`
  );
}

let verified = 0;
let mismatched = 0;
if (semantic?.enabled) {
  for (const asset of semantic.assets) {
    // relativePath is package-resources-relative, e.g. native-hosts/zvec/zvec-host.cjs
    const abs = path.join(RES, asset.relativePath.replace(/\//g, path.sep));
    if (!fs.existsSync(abs)) {
      check(`packagedAsset:${asset.relativePath}`, false, "MISSING from package");
      mismatched++;
      continue;
    }
    const size = fs.statSync(abs).size;
    if (size !== asset.size) {
      check(`packagedAsset:${asset.relativePath}`, false, `size ${size} != manifest ${asset.size}`);
      mismatched++;
      continue;
    }
    if (sha256(abs) !== asset.sha256) {
      check(`packagedAsset:${asset.relativePath}`, false, "SHA-256 mismatch");
      mismatched++;
      continue;
    }
    verified++;
  }
  check("allPackagedAssetsMatchManifest", mismatched === 0, `${verified} verified, ${mismatched} bad`);
}

// The host's own manifest must also have shipped and must agree with the dependency manifest.
const hostManifestPath = path.join(HOST_DIR, "zvec-native-host-manifest.json");
check("packagedHostManifest", fs.existsSync(hostManifestPath), hostManifestPath);
if (fs.existsSync(hostManifestPath) && semantic) {
  const hm = JSON.parse(fs.readFileSync(hostManifestPath, "utf8"));
  check(
    "hostManifestAgreesWithDependencyManifest",
    hm.zvecVersion === semantic.zvecVersion && hm.bindingVersion === semantic.bindingVersion,
    `host ${hm.zvecVersion}/${hm.bindingVersion} vs dep ${semantic.zvecVersion}/${semantic.bindingVersion}`
  );
}

// ── 3. Required native layout ────────────────────────────────────────────────────────────────
const hostCjs = path.join(HOST_DIR, "zvec-host.cjs");
const bindingDir = path.join(HOST_DIR, "node_modules", "@zvec", "bindings-win32-x64");
const nodeBinary = path.join(bindingDir, "zvec_node_binding.node");
const jiebaDict = path.join(bindingDir, "jieba_dict", "jieba.dict.utf8");
const hmmModel = path.join(bindingDir, "jieba_dict", "hmm_model.utf8");

check("hostCjsPresent", fs.existsSync(hostCjs), hostCjs);
check("nativeBindingOutsideAsar", fs.existsSync(nodeBinary) && !nodeBinary.includes("app.asar"), nodeBinary);
check("jiebaDictPresent", fs.existsSync(jiebaDict), jiebaDict);
check("hmmModelPresent", fs.existsSync(hmmModel), hmmModel);
check(
  "dictionaryAdjacentToBinding",
  fs.existsSync(nodeBinary) && path.dirname(path.dirname(jiebaDict)) === path.dirname(nodeBinary),
  "jieba_dict/ sits beside zvec_node_binding.node"
);

// The packaged host must be byte-identical to the repository source — proof it was copied, not
// transformed by Vite/Rollup on the way into the package.
const hostSource = path.join(ROOT, "native-hosts", "zvec", "zvec-host.cjs");
if (fs.existsSync(hostCjs) && fs.existsSync(hostSource)) {
  check("packagedHostMatchesSourceByteForByte", sha256(hostCjs) === sha256(hostSource), "sha256(packaged) == sha256(source)");
}

// Licenses must ship for redistribution, not just hashes.
check("zvecLicensePresent", fs.existsSync(path.join(HOST_DIR, "node_modules", "@zvec", "zvec", "LICENSE")), "@zvec/zvec/LICENSE");
check("bindingLicensePresent", fs.existsSync(path.join(bindingDir, "LICENSE")), "@zvec/bindings-win32-x64/LICENSE");

// ── 4. Zvec must NOT be duplicated into asar, and must not appear in bundled output ───────────
check("noZvecInAsarUnpacked", !fs.existsSync(path.join(asarUnpacked, "node_modules", "@zvec")), "app.asar.unpacked/node_modules/@zvec absent");
check("noZvecPackageInAsar", !asarBuf.includes(Buffer.from("zvec_node_binding.node")), "no binding filename inside app.asar");

// Source-boundary scan (plan §8.1 / §17): no Zvec operation symbol or direct import may reach the
// electron-vite main/preload/renderer output. Phase 0B Finding A makes this a crash guard, not style.
const OUT = path.join(ROOT, "out");
const FORBIDDEN = ["ZVecCreateAndOpen", "ZVecOpen", "ZVecCollectionSchema", "@zvec/zvec"];
const offenders = [];
function scan(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scan(p);
    else if (/\.(js|mjs|cjs|html)$/.test(e.name)) {
      const text = fs.readFileSync(p, "utf8");
      for (const sym of FORBIDDEN) {
        if (text.includes(sym)) offenders.push(`${path.relative(ROOT, p)} :: ${sym}`);
      }
    }
  }
}
scan(OUT);
check("noZvecSymbolsInBundledOutput", offenders.length === 0, offenders.length ? offenders.join("; ") : "out/** clean");

// ── 5. Sizes ─────────────────────────────────────────────────────────────────────────────────
const sizes = {
  fullUnpackedPackage: dirSize(PKG_ROOT),
  resourcesBrowsers: dirSize(path.join(RES, "resources", "browsers")),
  vendorBrowsers: dirSize(path.join(RES, "vendor", "browsers")),
  zvecNativeHostTree: dirSize(HOST_DIR),
  appAsar: { files: 1, bytes: fs.existsSync(asar) ? fs.statSync(asar).size : 0 },
  appAsarUnpacked: dirSize(asarUnpacked)
};

const portableCandidates = fs.existsSync(path.join(ROOT, "dist"))
  ? fs.readdirSync(path.join(ROOT, "dist")).filter((f) => f.endsWith(".exe") && !/Setup/i.test(f))
  : [];
const portable = portableCandidates[0] ? path.join(ROOT, "dist", portableCandidates[0]) : null;

// ── Report ───────────────────────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.ok);
console.log(`\nPackaged root: ${PKG_ROOT}\n`);
for (const c of checks) {
  if (c.name.startsWith("packagedAsset:") && c.ok) continue;
  console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  — ${c.detail}` : ""}`);
}
console.log(`\n  Packaged Zvec assets checksum-verified: ${verified}${semantic ? `/${semantic.assets.length}` : ""}`);
console.log("\nSizes:");
for (const [k, v] of Object.entries(sizes)) {
  console.log(`  ${k.padEnd(22)} ${String(v.files).padStart(6)} files  ${String(mb(v.bytes)).padStart(8)} MB`);
}
if (portable) console.log(`  ${"portableExe".padEnd(22)} ${" ".repeat(6)}        ${String(mb(fs.statSync(portable).size)).padStart(8)} MB  (${path.basename(portable)})`);

const report = { packagedRoot: PKG_ROOT, checks, verifiedAssets: verified, mismatchedAssets: mismatched, sizes, portableExe: portable };
const outFile = path.join(process.env.LOCALAPPDATA ?? ".", "SpecterStudio", "zvec-phase-0", "reports", `packaged-assets-${Date.now()}.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
console.log(`\nReport: ${outFile}`);

console.log(`\n${failed.length === 0 ? "PACKAGED ASSET VERIFICATION PASSED" : `PACKAGED ASSET VERIFICATION FAILED (${failed.length})`}`);
process.exit(failed.length === 0 ? 0 : 1);
