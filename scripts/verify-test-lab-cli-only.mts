/**
 * Randomized Test Lab CLI-only boundary verifier (owner decision 2026-07-29, bd `awkit-wza.8`).
 *
 * Verifier class: **source-and-artifact hygiene**. It asserts that the Test Lab harness is not wired
 * into the shipped application: no `app/**` module imports it, no production bundle contains its
 * symbols, and no route registration file declares a Test Lab surface.
 *
 * What realistic regression would make this fail?
 *   Someone "finishing Phase 7" by adding a Super-User Test Lab page — which requires touching the
 *   RouteId union, the AppRoute table, RoutePermissions and LeftNavigation — or importing the
 *   generator from a renderer/main module so the harness and its dependencies land in the packaged
 *   artifact. Either would silently reverse a recorded architecture decision.
 *
 * Two things stop this from passing vacuously:
 *   1. Every symbol scanned for is first proven to be a REAL export under `src/testing/` (a scan for
 *      names that do not exist would report a clean bundle no matter what shipped).
 *   2. The pure evaluator is driven with synthetic violating input, so the guard is shown to fail.
 *
 * Bundle checks require a current build; they report BLOCKED (not PASS) when `out/` is absent, and
 * refuse a build older than the sources it claims to represent.
 *
 * Run: npx tsx scripts/verify-test-lab-cli-only.mts   (after `npm run build`)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import {
  FORBIDDEN_ROUTE_TOKENS,
  PRODUCTION_BUNDLE_GLOBS,
  ROUTE_REGISTRATION_FILES,
  TEST_LAB_HARNESS_SYMBOLS,
  TEST_LAB_PACKAGING_DECISION,
  TEST_LAB_SOURCE_ROOTS,
  evaluateTestLabPackaging
} from "./lib/test-lab-packaging-policy";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let passed = 0;
let failed = 0;
let blocked = 0;

const check = (name: string, cond: boolean, detail = ""): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const block = (name: string, reason: string): void => {
  blocked += 1;
  console.log(`  ⊘ ${name} — BLOCKED: ${reason}`);
};

const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

/** Every file under `dir` matching `test`, as repo-relative paths. */
function walk(dir: string, test: (name: string) => boolean): string[] {
  const out: string[] = [];
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return out;
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (test(entry.name)) out.push(relative(root, full).split(sep).join("/"));
    }
  };
  visit(absolute);
  return out;
}

console.log("Randomized Test Lab — CLI-only boundary verifier\n");

// ── Liveness: the symbols scanned for must actually be exports of the harness ────────────────────
console.log("Scan-list liveness (a scan for non-existent symbols cannot fail):");
const harnessFiles = walk("src/testing", (name) => name.endsWith(".ts"));
check(
  `the harness has source files to scan (found ${harnessFiles.length})`,
  harnessFiles.length >= 20,
  `${harnessFiles.length} files under src/testing`
);
const harnessSource = harnessFiles.map((rel) => read(rel)).join("\n");
for (const symbol of TEST_LAB_HARNESS_SYMBOLS) {
  const exported = new RegExp(`export\\s+(?:abstract\\s+)?(?:class|function|const|interface|type)\\s+${symbol}\\b`);
  check(`"${symbol}" is a real export under src/testing/`, exported.test(harnessSource));
}
check(
  `the scan list is non-empty (${TEST_LAB_HARNESS_SYMBOLS.length} symbols)`,
  TEST_LAB_HARNESS_SYMBOLS.length >= 5
);

// ── Source hygiene: no app/** module imports the harness ────────────────────────────────────────
console.log("\nSource hygiene:");
const appFiles = walk("app", (name) => /\.(ts|tsx)$/.test(name));
check(`app/** has source files to scan (found ${appFiles.length})`, appFiles.length >= 50);

const appImports: Array<readonly [string, string]> = [];
for (const rel of appFiles) {
  const text = read(rel);
  // Capture permissively — any import/require specifier — then validate strictly against the roots.
  for (const match of text.matchAll(/(?:from|require\()\s*["'`]([^"'`]+)["'`]/g)) {
    const specifier = match[1];
    const normalised = specifier.replace(/^@src\//, "src/");
    if (TEST_LAB_SOURCE_ROOTS.some((testRoot) => normalised.startsWith(testRoot))) {
      appImports.push([rel, specifier] as const);
    }
  }
}
check("no app/** module imports the Test Lab harness", appImports.length === 0, appImports.map(([f, i]) => `${f} → ${i}`).join("; "));

// ── Route registration: no Test Lab surface is declared ─────────────────────────────────────────
console.log("\nRoute registration:");
const routeTokens: Array<readonly [string, string]> = [];
for (const rel of ROUTE_REGISTRATION_FILES) {
  check(`${rel} exists (registration file still where the policy expects it)`, existsSync(join(root, rel)));
  if (!existsSync(join(root, rel))) continue;
  const text = read(rel);
  for (const token of FORBIDDEN_ROUTE_TOKENS) {
    if (text.includes(token)) routeTokens.push([rel, token] as const);
  }
}
check(
  "no route registration file declares a Test Lab surface",
  routeTokens.length === 0,
  routeTokens.map(([f, t]) => `${f} → ${t}`).join("; ")
);

// ── Built artifacts: the harness is absent from every production bundle ──────────────────────────
console.log("\nProduction bundles:");
const bundleSymbols: Array<readonly [string, string]> = [];
const newestSource = Math.max(
  ...[...harnessFiles, ...appFiles].map((rel) => statSync(join(root, rel)).mtimeMs)
);

for (const target of PRODUCTION_BUNDLE_GLOBS) {
  const absolute = join(root, target);
  if (!existsSync(absolute)) {
    block(`${target} scanned for harness symbols`, "no build present — run `npm run build`");
    continue;
  }
  const files = statSync(absolute).isDirectory()
    ? walk(target, (name) => /\.(js|mjs|cjs)$/.test(name))
    : [target];
  if (files.length === 0) {
    block(`${target} scanned for harness symbols`, "build directory contains no JavaScript");
    continue;
  }
  // A stale bundle is a sound check applied to the wrong artifact: it would clear a harness that the
  // current sources do wire in. Refuse rather than report a pass against yesterday's output.
  const oldest = Math.min(...files.map((rel) => statSync(join(root, rel)).mtimeMs));
  if (oldest < newestSource) {
    block(`${target} scanned for harness symbols`, "bundle is older than its sources — rebuild first");
    continue;
  }
  const text = files.map((rel) => read(rel)).join("\n");
  for (const symbol of TEST_LAB_HARNESS_SYMBOLS) {
    if (new RegExp(`\\b${symbol}\\b`).test(text)) bundleSymbols.push([target, symbol] as const);
  }
  check(`${target} contains no Test Lab harness symbol`, !bundleSymbols.some(([bundle]) => bundle === target));
}

// ── The guard must be able to fail ──────────────────────────────────────────────────────────────
console.log("\nNegative control (the evaluator is shown to reject each violation kind):");
const clean = evaluateTestLabPackaging({ appImports: [], bundleSymbols: [], routeTokens: [] });
check("a clean repository evaluates ok", clean.ok && clean.violations.length === 0);

const withImport = evaluateTestLabPackaging({
  appImports: [["app/renderer/pages/TestLab.tsx", "@src/testing/random/generateWorkflow"]],
  bundleSymbols: [],
  routeTokens: []
});
check("an app/** harness import is rejected", !withImport.ok && withImport.violations[0]?.kind === "source-import");

const withSymbol = evaluateTestLabPackaging({
  appImports: [],
  bundleSymbols: [["out/main/main.js", "RandomTestRunner"]],
  routeTokens: []
});
check("a harness symbol in a bundle is rejected", !withSymbol.ok && withSymbol.violations[0]?.kind === "bundle-symbol");

const withRoute = evaluateTestLabPackaging({
  appImports: [],
  bundleSymbols: [],
  routeTokens: [["app/renderer/routes.tsx", "testLab"]]
});
check("a Test Lab route registration is rejected", !withRoute.ok && withRoute.violations[0]?.kind === "route-token");

const all = evaluateTestLabPackaging({
  appImports: [["a.ts", "src/testing/x"]],
  bundleSymbols: [["out/main/main.js", "CoverageTracker"]],
  routeTokens: [["app/renderer/routes.tsx", "TestLab"]]
});
check("every violation is reported, not just the first", all.violations.length === 3);

// ── Documentation records the decision ──────────────────────────────────────────────────────────
console.log("\nDecision record:");
const decisions = read("docs/ai/DECISIONS.md");
check("DECISIONS.md quotes the canonical decision sentence verbatim", decisions.includes(TEST_LAB_PACKAGING_DECISION));

// ── Live result must agree with the pure evaluator ──────────────────────────────────────────────
const live = evaluateTestLabPackaging({ appImports, bundleSymbols, routeTokens });
check(
  "the repository satisfies the CLI-only boundary",
  live.ok,
  live.violations.map((v) => `${v.location}: ${v.detail}`).join("; ")
);

console.log(
  `\n${passed} PASS / ${failed} FAIL${blocked ? ` / ${blocked} BLOCKED` : ""} — Test Lab CLI-only boundary`
);
if (failed > 0) process.exitCode = 1;
