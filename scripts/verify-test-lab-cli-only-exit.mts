/**
 * Exit contract of `verify:test-lab-cli-only` against real fixture bundles.
 *
 * Verifier class: **static-source-validation** (spawns the real verifier; no app, no browser).
 *
 * What realistic regression would make this fail?
 *   The artifact verifier going green — exit 0 — when it never inspected the production bundle
 *   (missing, empty, stale, or not JavaScript), or when a bundle it did inspect carries a Test Lab
 *   harness symbol. Both have happened to sibling gates: a BLOCKED count printed beside a zero exit.
 *
 * Each case builds a bundle tree in a temp folder and runs the unmodified verifier against it via
 * `AWKIT_TEST_LAB_BUNDLE_ROOT`, asserting the process exit code AND the printed PASS/FAIL/BLOCKED
 * counts. Contract: PASS → 0, any FAIL → 1, BLOCKED without FAIL → 2.
 *
 * Not covered: an ACL-unreadable bundle — not portably constructible on Windows; the verifier's read
 * is wrapped so that case reports BLOCKED rather than throwing.
 *
 * Run: npm run verify:test-lab-cli-only-exit
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_BUNDLE_GLOBS } from "./lib/test-lab-packaging-policy";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, detail = ""): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const CLEAN_JS = "export const clean = 1;\n";

/** A complete, current, clean bundle tree; `mutate` then damages one aspect of it. */
function fixture(base: string, mutate: (dir: string) => void = () => {}): string {
  const dir = join(base, `case-${Math.random().toString(36).slice(2, 8)}`);
  for (const target of PRODUCTION_BUNDLE_GLOBS) {
    const file = target.endsWith(".js") || target.endsWith(".mjs") ? join(dir, target) : join(dir, target, "index.js");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, CLEAN_JS, "utf8");
  }
  mutate(dir);
  return dir;
}

function runVerifier(bundleRoot: string): { status: number | null; pass: number; fail: number; blocked: number; tail: string } {
  const result = spawnSync(
    process.execPath,
    [join(root, "node_modules", "tsx", "dist", "cli.mjs"), join(root, "scripts", "verify-test-lab-cli-only.mts")],
    { cwd: root, encoding: "utf8", env: { ...process.env, AWKIT_TEST_LAB_BUNDLE_ROOT: bundleRoot }, windowsHide: true }
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const summary = output.match(/(\d+) PASS \/ (\d+) FAIL(?: \/ (\d+) BLOCKED)? — Test Lab CLI-only boundary/);
  return {
    status: result.status,
    pass: Number(summary?.[1] ?? -1),
    fail: Number(summary?.[2] ?? -1),
    blocked: summary ? Number(summary[3] ?? 0) : -1,
    tail: output.trim().split("\n").slice(-3).join(" | ")
  };
}

console.log("Test Lab CLI-only verifier — exit contract\n");
const base = mkdtempSync(join(tmpdir(), "awkit-testlab-exit-"));
try {
  const blockedCases: Array<readonly [string, (dir: string) => void]> = [
    ["missing production bundles", (dir) => rmSync(dir, { recursive: true, force: true })],
    ["an empty main bundle", (dir) => writeFileSync(join(dir, "out/main/main.js"), "", "utf8")],
    ["a stale main bundle", (dir) => utimesSync(join(dir, "out/main/main.js"), new Date(2000, 0, 1), new Date(2000, 0, 1))],
    [
      "renderer assets with no JavaScript",
      (dir) => {
        rmSync(join(dir, "out/renderer/assets/index.js"));
        writeFileSync(join(dir, "out/renderer/assets/index.css"), "body{}", "utf8");
      }
    ],
    [
      "a main bundle path that is a directory, not a script",
      (dir) => {
        rmSync(join(dir, "out/main/main.js"));
        mkdirSync(join(dir, "out/main/main.js"));
      }
    ]
  ];

  for (const [label, mutate] of blockedCases) {
    console.log(`\n${label}:`);
    const run = runVerifier(fixture(base, mutate));
    check("exits 2 (BLOCKED), never 0", run.status === 2, `exit ${run.status}; ${run.tail}`);
    check("reports at least one BLOCKED", run.blocked >= 1, run.tail);
    check("reports no FAIL", run.fail === 0, run.tail);
  }

  console.log("\na contaminated main bundle:");
  const contaminated = runVerifier(
    fixture(base, (dir) => writeFileSync(join(dir, "out/main/main.js"), "class RandomTestRunner {}\n", "utf8"))
  );
  check("exits 1 (FAIL)", contaminated.status === 1, `exit ${contaminated.status}; ${contaminated.tail}`);
  check("reports the harness symbol as a FAIL", contaminated.fail >= 1, contaminated.tail);

  console.log("\ncurrent, clean production bundles:");
  const clean = runVerifier(fixture(base));
  check("exits 0", clean.status === 0, `exit ${clean.status}; ${clean.tail}`);
  check("reports 0 FAIL and 0 BLOCKED", clean.fail === 0 && clean.blocked === 0, clean.tail);
  check("every check passed and the summary was parsed", clean.pass > 20, clean.tail);
} finally {
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

console.log(`\n${passed} PASS / ${failed} FAIL — Test Lab CLI-only exit contract`);
process.exitCode = failed > 0 ? 1 : 0;
