/**
 * Guards the one architectural rule the Zvec design rests on: **Zvec is reachable only from the
 * utility host's own packaged module root, never from the electron-vite main/preload/renderer
 * bundles.**
 *
 * This is not a style check. Phase 0B recorded a hard native crash — no JS error, no
 * uncaughtException, process gone — the moment a Vite-bundled caller reached its first collection
 * operation, while byte-identical unbundled code passed every step. Phase 0D then found the rule
 * silently violated twice:
 *
 *   1. electron-builder ships production `dependencies` regardless of the `files` allowlist, so
 *      `@zvec` was duplicated into `app.asar.unpacked` and stayed resolvable from the main process.
 *   2. A spike module statically imported the ops harness, which statically imports `@zvec/zvec`,
 *      pulling the native package into the main process for every mode. Running from
 *      `dist/win-unpacked` (inside the repo) let Node's upward `node_modules` walk satisfy that
 *      import from the REPOSITORY, hiding the violation entirely.
 *
 * Both were invisible to source review and to staging validation. Run: npx tsx
 * scripts/verify-zvec-host-source-boundary.mts
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `import.meta.dirname` is Node 20+; this repo's toolchain runs Node 18.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Files permitted to mention Zvec directly. Everything else must go through the host protocol. */
const ALLOWED_SOURCE_PREFIXES = [
  "native-hosts/zvec/",        // the raw host itself
  "scripts/",                  // staging, verifiers, spike harnesses
  "src/semantic/contracts/",   // protocol types (names only, no import)
  "docs/"
];

/** Vendor symbols that must never appear in bundled output. */
const NATIVE_SYMBOLS = ["ZVecCreateAndOpen", "ZVecOpen", "ZVecCollectionSchema", "ZVecInitialize"];
const PACKAGE_SPECIFIER = "@zvec/zvec";

function walk(dir: string, filter: (p: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");

console.log("Zvec host source boundary:\n");

// ── 1. No production source outside the allow-list may reference Zvec ──
console.log("Production source:");
const sourceFiles = walk(join(ROOT, "app"), (p) => /\.(ts|tsx)$/.test(p))
  .concat(walk(join(ROOT, "src"), (p) => /\.(ts|tsx)$/.test(p)));

const sourceOffenders: string[] = [];
for (const file of sourceFiles) {
  const r = rel(file);
  if (ALLOWED_SOURCE_PREFIXES.some((prefix) => r.startsWith(prefix))) continue;
  const text = readFileSync(file, "utf8");
  if (text.includes(PACKAGE_SPECIFIER)) sourceOffenders.push(`${r} references ${PACKAGE_SPECIFIER}`);
  for (const symbol of NATIVE_SYMBOLS) {
    if (text.includes(symbol)) sourceOffenders.push(`${r} references ${symbol}`);
  }
}
check(
  `no @zvec import or native symbol in app/** or src/** (${sourceFiles.length} files scanned)`,
  sourceOffenders.length === 0,
  sourceOffenders.join("; ")
);

// ── 2. No bundled output may contain Zvec ──
console.log("\nBundled output (out/**):");
const outDir = join(ROOT, "out");
if (!existsSync(outDir)) {
  console.log("  ! out/ is absent — run `npm run build` first to make this check meaningful");
  check("out/ present for bundle scan", false, "out/ missing");
} else {
  const bundleFiles = walk(outDir, (p) => /\.(js|mjs|cjs|html)$/.test(p));
  const bundleOffenders: string[] = [];
  for (const file of bundleFiles) {
    const text = readFileSync(file, "utf8");
    if (text.includes(PACKAGE_SPECIFIER)) bundleOffenders.push(`${rel(file)} :: ${PACKAGE_SPECIFIER}`);
    for (const symbol of NATIVE_SYMBOLS) {
      if (text.includes(symbol)) bundleOffenders.push(`${rel(file)} :: ${symbol}`);
    }
  }
  check(`no Zvec symbol in any bundle (${bundleFiles.length} files scanned)`, bundleOffenders.length === 0, bundleOffenders.join("; "));
}

// ── 3. The raw host must stay unbundled and out of the Vite input graph ──
console.log("\nHost file integrity:");
const hostPath = join(ROOT, "native-hosts", "zvec", "zvec-host.cjs");
check("raw host exists at native-hosts/zvec/zvec-host.cjs", existsSync(hostPath));
if (existsSync(hostPath)) {
  const host = readFileSync(hostPath, "utf8");
  check("host is CommonJS (uses require, not import)", host.includes('require("@zvec/zvec")') && !/^\s*import\s/m.test(host));
  check("host requires Zvec from its own module root", host.includes('require("@zvec/zvec")'));
  check("host re-implements path confinement independently", host.includes("SEMANTIC_PATH_OUTSIDE_APPROVED_ROOT"));
  // The approved root must come from the fork environment (so the user's configured runtime data
  // location is honoured) but be fixed ONCE at process start, never taken per request — a
  // per-request root would let one validation gap redirect the host anywhere.
  check("host takes its runtime root from the fork environment", host.includes("AWKIT_SEMANTIC_RUNTIME_ROOT"));
  check(
    "host fixes the approved root at module scope, not per request",
    /const\s+APPROVED_ROOT\s*=/.test(host) && !/function[^]*?AWKIT_SEMANTIC_RUNTIME_ROOT/.test(host.split("const APPROVED_ROOT")[1] ?? "")
  );
  check("host refuses to run outside a utilityProcess", host.includes("process.parentPort"));
  // A test-only abort must never ship enabled; it is gated behind an env var the harness sets.
  const hasAbort = host.includes("__testAbort");
  const abortGated = host.includes("AWKIT_ZVEC_HOST_TEST_ABORT");
  check(
    hasAbort ? "test-only abort is env-gated (and must be removed before release)" : "no test-only abort present",
    !hasAbort || abortGated,
    hasAbort ? "__testAbort present — gated, but classified REMOVE before release" : undefined
  );
}

const viteConfig = join(ROOT, "electron.vite.config.ts");
if (existsSync(viteConfig)) {
  const text = readFileSync(viteConfig, "utf8");
  check("native-hosts is not an electron-vite input", !text.includes("native-hosts"));
}

// ── 4. electron-builder must ship the host as extraResources and exclude it from the app ──
console.log("\nPackaging boundary:");
const builderPath = join(ROOT, "electron-builder.json");
check("electron-builder.json exists", existsSync(builderPath));
if (existsSync(builderPath)) {
  const builder = JSON.parse(readFileSync(builderPath, "utf8")) as {
    files?: string[];
    asarUnpack?: string[];
    extraResources?: Array<{ from?: string; to?: string }>;
  };
  const files = builder.files ?? [];
  const asarUnpack = builder.asarUnpack ?? [];
  const extra = builder.extraResources ?? [];

  check(
    "files[] excludes node_modules/@zvec (electron-builder ships prod deps regardless of the allowlist)",
    files.some((f) => f === "!node_modules/@zvec/**")
  );
  check("files[] excludes node_modules/bindings", files.some((f) => f === "!node_modules/bindings/**"));
  check("@zvec is not asarUnpack'd (it must not be in the app package at all)", !asarUnpack.some((f) => f.includes("@zvec")));
  check(
    "staged native host ships via extraResources -> native-hosts/zvec",
    extra.some((e) => e.from === "build/native-hosts/zvec" && e.to === "native-hosts/zvec")
  );
}

// ── 5. Semantic data must live under the canonical runtime root ──
// Regression guard: semanticService originally used app.getPath("userData"), which on Windows is
// the ROAMING profile. That silently pointed the semantic index at a different directory from every
// other AWKIT store, so startup reconciliation ran against an empty tree and left real orphans in
// place. Only observable by running the packaged app, so it is pinned here.
console.log("\nRuntime data root:");
const servicePath = join(ROOT, "app", "main", "semantic", "semanticService.ts");
check("semanticService.ts exists", existsSync(servicePath));
if (existsSync(servicePath)) {
  const service = readFileSync(servicePath, "utf8");
  const usesCanonical = service.includes("getRuntimeDataRoot()");
  // Allow the identifier inside the explanatory comment, but not as a live call.
  const callsUserData = /app\s*\.\s*getPath\(\s*["']userData["']\s*\)/.test(
    service
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .join("\n")
  );
  check("semantic data uses getRuntimeDataRoot() (%LOCALAPPDATA%/SpecterStudio)", usesCanonical);
  check("semantic data does NOT use app.getPath('userData') (roaming profile)", !callsUserData);
}

// ── 6. Zvec stays a pinned production dependency ──
console.log("\nDependency pinning:");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const pinned = pkg.dependencies?.["@zvec/zvec"];
check("@zvec/zvec is a production dependency", Boolean(pinned));
check("@zvec/zvec is pinned to an exact version", Boolean(pinned && /^\d+\.\d+\.\d+$/.test(pinned)), pinned);
check("@zvec/zvec is not also a devDependency", !pkg.devDependencies?.["@zvec/zvec"]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
