/**
 * Phase 0C — final-package negative cases, run against DISPOSABLE COPIES of the packaged
 * native-host tree so the clean original package is never mutated.
 *
 * Each case damages the copy in a way a real corruption/tamper/build defect would, then asserts
 * that manifest-driven verification rejects it. A case that "passes" here means the damage was
 * DETECTED — silence would mean a corrupted package shipping as valid.
 *
 * Usage: node scripts/verify-zvec-packaged-negative-cases.mjs [path-to-win-unpacked]
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PKG_ROOT = path.resolve(process.argv[2] || path.join(ROOT, "dist", "win-unpacked"));
const RES = path.join(PKG_ROOT, "resources");
const SRC_HOST_DIR = path.join(RES, "native-hosts", "zvec");
const SRC_DEP_MANIFEST = path.join(RES, "resources", "dependency-manifest.json");

const sha256 = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

/**
 * The verification under test: recompute every declared asset from disk and compare to the
 * manifest. Mirrors what verify-zvec-packaged-assets.mjs does for the real package.
 */
function verifyTree(hostDir, depManifestPath) {
  const problems = [];
  const dep = JSON.parse(fs.readFileSync(depManifestPath, "utf8"));
  const semantic = dep.semanticNative;
  if (!semantic?.enabled) return ["semanticNative not declared"];

  for (const asset of semantic.assets) {
    // Assets are declared resources-relative (native-hosts/zvec/...); map onto the copied tree.
    const rel = asset.relativePath.replace(/^native-hosts\/zvec\//, "");
    const abs = path.join(hostDir, rel.replace(/\//g, path.sep));
    if (!fs.existsSync(abs)) {
      problems.push(`MISSING ${asset.relativePath}`);
      continue;
    }
    if (fs.statSync(abs).size !== asset.size) {
      problems.push(`SIZE ${asset.relativePath}`);
      continue;
    }
    if (sha256(abs) !== asset.sha256) {
      problems.push(`CHECKSUM ${asset.relativePath}`);
    }
  }

  // The host's own manifest must agree with the dependency manifest.
  const hostManifestPath = path.join(hostDir, "zvec-native-host-manifest.json");
  if (!fs.existsSync(hostManifestPath)) {
    problems.push("MISSING host manifest");
  } else {
    const hm = JSON.parse(fs.readFileSync(hostManifestPath, "utf8"));
    if (hm.zvecVersion !== semantic.zvecVersion || hm.bindingVersion !== semantic.bindingVersion) {
      problems.push("HOST MANIFEST VERSION DISAGREEMENT");
    }
    for (const a of hm.assets) {
      const abs = path.join(hostDir, a.relativePath.replace(/\//g, path.sep));
      if (fs.existsSync(abs) && sha256(abs) !== a.sha256) {
        problems.push(`HOST MANIFEST CHECKSUM ${a.relativePath}`);
      }
    }
  }
  return problems;
}

function freshCopy(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zvec-neg-${label}-`));
  const hostDir = path.join(dir, "native-hosts-zvec");
  fs.cpSync(SRC_HOST_DIR, hostDir, { recursive: true });
  const dep = path.join(dir, "dependency-manifest.json");
  fs.copyFileSync(SRC_DEP_MANIFEST, dep);
  return { dir, hostDir, dep };
}

const BINDING_REL = path.join("node_modules", "@zvec", "bindings-win32-x64");
const cases = [
  {
    name: "missing packaged native binding",
    expect: /MISSING .*zvec_node_binding\.node/,
    mutate: (c) => fs.rmSync(path.join(c.hostDir, BINDING_REL, "zvec_node_binding.node"), { force: true })
  },
  {
    name: "missing packaged jieba dictionary",
    expect: /MISSING .*jieba\.dict\.utf8/,
    mutate: (c) => fs.rmSync(path.join(c.hostDir, BINDING_REL, "jieba_dict", "jieba.dict.utf8"), { force: true })
  },
  {
    name: "same-size binding tamper",
    expect: /CHECKSUM .*zvec_node_binding\.node/,
    mutate: (c) => {
      // Flip one byte in place: size is unchanged, so only SHA-256 can catch this.
      const f = path.join(c.hostDir, BINDING_REL, "zvec_node_binding.node");
      const fd = fs.openSync(f, "r+");
      const buf = Buffer.alloc(1);
      fs.readSync(fd, buf, 0, 1, 4096);
      buf[0] = buf[0] ^ 0xff;
      fs.writeSync(fd, buf, 0, 1, 4096);
      fs.closeSync(fd);
    }
  },
  {
    name: "manifest checksum mismatch (declared hash altered)",
    expect: /CHECKSUM /,
    mutate: (c) => {
      const dep = JSON.parse(fs.readFileSync(c.dep, "utf8"));
      const target = dep.semanticNative.assets.find((a) => a.relativePath.endsWith("zvec-host.cjs"));
      target.sha256 = "0".repeat(64);
      fs.writeFileSync(c.dep, JSON.stringify(dep, null, 2));
    }
  },
  {
    name: "host manifest / dependency manifest version disagreement",
    expect: /HOST MANIFEST VERSION DISAGREEMENT/,
    mutate: (c) => {
      const hmPath = path.join(c.hostDir, "zvec-native-host-manifest.json");
      const hm = JSON.parse(fs.readFileSync(hmPath, "utf8"));
      hm.bindingVersion = "9.9.9";
      fs.writeFileSync(hmPath, JSON.stringify(hm, null, 2));
    }
  }
];

if (!fs.existsSync(SRC_HOST_DIR)) {
  console.error(`Packaged native-host tree not found: ${SRC_HOST_DIR}`);
  process.exit(1);
}

// Control: the untouched copy must verify cleanly, otherwise every "detection" below is meaningless.
const control = freshCopy("control");
const controlProblems = verifyTree(control.hostDir, control.dep);
fs.rmSync(control.dir, { recursive: true, force: true });

const results = [{ name: "CONTROL: unmodified copy verifies clean", ok: controlProblems.length === 0, detail: controlProblems.join("; ") || "no problems" }];

for (const c of cases) {
  const copy = freshCopy(c.name.replace(/\W+/g, "-").slice(0, 20));
  let detail;
  let ok = false;
  try {
    c.mutate(copy);
    const problems = verifyTree(copy.hostDir, copy.dep);
    ok = problems.some((p) => c.expect.test(p));
    detail = problems.length ? problems.slice(0, 2).join("; ") : "NOT DETECTED";
  } catch (err) {
    detail = `case error: ${err.message}`;
  } finally {
    fs.rmSync(copy.dir, { recursive: true, force: true });
  }
  results.push({ name: c.name, ok, detail });
}

console.log(`\nFinal-package negative cases (disposable copies of ${SRC_HOST_DIR})\n`);
for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}\n          ${r.detail}`);

// Prove the real package was never touched.
const untouched = fs.existsSync(path.join(SRC_HOST_DIR, BINDING_REL, "zvec_node_binding.node"));
console.log(`\n  Original package intact: ${untouched ? "yes" : "NO"}`);

const failed = results.filter((r) => !r.ok).length;
const outFile = path.join(process.env.LOCALAPPDATA ?? ".", "SpecterStudio", "zvec-phase-0", "reports", `packaged-negative-cases-${Date.now()}.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ packagedRoot: PKG_ROOT, results, originalIntact: untouched }, null, 2));
console.log(`\nReport: ${outFile}`);
console.log(`\n${failed === 0 ? "PACKAGED NEGATIVE CASES PASSED" : `PACKAGED NEGATIVE CASES FAILED (${failed})`}`);
process.exit(failed === 0 && untouched ? 0 : 1);
