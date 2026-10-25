/**
 * verify:visual-calibration — Phase N, N6.6 (awkit-vra.15.6): the VA-12 qualification criterion and the boundary of the
 * grant issuer. Deterministic; the measurement itself is `benchmark:visual-assertion`.
 *
 *   A  `evaluateCalibrationCell` over synthetic launch records: qualified exactly at the thresholds, and each criterion
 *      alone disqualifies (299 passes, two sessions, one failed primary, 29 failed negatives, a negative that passed, a
 *      moved/clipped/interaction fixture not inconclusive, a refusal with a capture or not inconclusive, p95 over
 *      2000 ms); other cells and other environments never count; a second primary in one launch is not independent.
 *   B  the issuer's boundary: the calibration root refuses a packaged app, issues only inside `if (summary.qualified)`,
 *      is the only caller of `issueGrantUnchecked` outside the store, registers no IPC, is built by its own config to
 *      `out/calibration-main/` which electron-builder excludes, and is not reachable from the production main entry.
 *
 * Mutation contract (run 2026-10-25 by temporary source edits, each red and reverted): C1 a failed primary trial no
 * longer disqualifies ("one failed primary trial disqualifies" red); C2 launches of another environment counted (all
 * seven environment-field checks red).
 *
 * Run: npm run verify:visual-calibration
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import {
  VISUAL_CALIBRATION_MIN_NEGATIVE_LAUNCHES,
  VISUAL_CALIBRATION_MIN_PASSED,
  evaluateCalibrationCell,
  type VisualCalibrationCellKey,
  type VisualCalibrationEnvironment,
  type VisualCalibrationFixture,
  type VisualCalibrationLaunch,
  type VisualCalibrationTrial
} from "@src/runner/visualAssertion/calibration/visualCalibrationCriteria";

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

const REPO = resolve(".");
const CELL: VisualCalibrationCellKey = { renderMode: "headed", devicePixelRatio: 1 };
const ENV: VisualCalibrationEnvironment = {
  browserVersion: "140.0.7339.16",
  appVersion: "0.1.53",
  osBuild: "win32-10.0.26300",
  capturePolicy: "awkit-va15-v1",
  fingerprintVersion: "awkit-vfp-1",
  assertionPolicyVersion: 1,
  calibrationSuiteVersion: "awkit-n6-calibration-v1"
};

const trial = (fixture: VisualCalibrationFixture, verdict: VisualCalibrationTrial["verdict"], extra: Partial<VisualCalibrationTrial> = {}): VisualCalibrationTrial => ({
  fixture,
  verdict,
  code: verdict === "passed" ? "identical-to-baseline" : verdict === "failed" ? "differs-from-baseline" : "position-changed",
  durationMs: 400,
  captures: verdict === "inconclusive" && ["protected", "handoff", "sensitive"].includes(fixture) ? 0 : 1,
  ...extra
});
const FIXTURES = (): VisualCalibrationTrial[] => [
  trial("restyle", "failed"),
  trial("swap", "failed"),
  trial("text", "failed"),
  trial("size", "failed", { code: "size-differs-from-baseline" }),
  trial("moved", "inconclusive"),
  trial("clipped", "inconclusive", { code: "target-clipped" }),
  trial("hovered", "inconclusive", { code: "interaction-state-changed" }),
  trial("focused", "inconclusive", { code: "interaction-state-changed" }),
  trial("protected", "inconclusive", { code: "protected-surface" }),
  trial("handoff", "inconclusive", { code: "handoff-active" }),
  trial("sensitive", "inconclusive", { code: "sensitive-step" })
];

/** A qualifying evidence set: 300 launches over three sessions, fixtures on every fifth launch (60 of them). */
function qualifying(): VisualCalibrationLaunch[] {
  return Array.from({ length: VISUAL_CALIBRATION_MIN_PASSED }, (_, i) => ({
    sessionId: `s${i % 3}`,
    cell: CELL,
    environment: ENV,
    startedAt: new Date(Date.UTC(2026, 9, 25, 0, 0, i)).toISOString(),
    trials: [trial("primary", "passed"), ...(i % 5 === 0 ? FIXTURES() : [])]
  }));
}
const decide = (launches: VisualCalibrationLaunch[]) => evaluateCalibrationCell(CELL, ENV, launches);
const edit = (launches: VisualCalibrationLaunch[], index: number, change: (l: VisualCalibrationLaunch) => void): VisualCalibrationLaunch[] => {
  const copy = launches.map((l) => ({ ...l, trials: l.trials.map((t) => ({ ...t })) }));
  change(copy[index]);
  return copy;
};
const unmetIncludes = (launches: VisualCalibrationLaunch[], prefix: string) => {
  const s = decide(launches);
  return !s.qualified && s.unmet.some((u) => u.startsWith(prefix));
};

console.log("A. The VA-12 criterion\n");
{
  const base = qualifying();
  const s = decide(base);
  check("300 passing launches over three sessions with every fixture as specified qualify", s.qualified && s.primary.passed === 300 && s.sessions === 3, JSON.stringify(s.unmet));
  check("a negative counted in exactly 60 launches (>= 30) and p95 recorded", s.negatives.restyle.failed === 60 && s.p95Ms === 400);
  check(
    "the reported bound is the plan's 1 - 0.05^(1/300) (about 0.994 %) with zero failures",
    s.falseMismatchUpperBound95 !== null && Math.abs(s.falseMismatchUpperBound95 - 0.009936) < 0.00001,
    String(s.falseMismatchUpperBound95)
  );
  check("observe usefulness counts unchanged passes and changed failures (540 of 540)", s.observeUsefulness.decisive === 540 && s.observeUsefulness.total === 540 && s.observeUsefulness.rate === 1);
  check("no bound is reported once a primary failed", decide(edit(base, 7, (l) => (l.trials[0] = trial("primary", "failed")))).falseMismatchUpperBound95 === null);
  check("299 passing launches do not qualify", unmetIncludes(base.slice(1), "primary-passed"));
  check(
    "300 passing launches in only two sessions do not qualify",
    unmetIncludes(base.map((l) => ({ ...l, sessionId: l.sessionId === "s2" ? "s1" : l.sessionId })), "sessions")
  );
  check("one failed primary trial disqualifies", unmetIncludes(edit(base, 7, (l) => (l.trials[0] = trial("primary", "failed"))), "primary-failed"));
  check(
    "an inconclusive primary counts toward neither (299 passed + 1 inconclusive does not qualify, and is not a failure)",
    (() => {
      const r = decide(edit(base, 7, (l) => (l.trials[0] = trial("primary", "inconclusive"))));
      return !r.qualified && r.primary.failed === 0 && r.primary.inconclusive === 1 && r.unmet.some((u) => u.startsWith("primary-passed"));
    })()
  );
  check(
    "a second primary trial in one launch is not an independent trial (150 launches x 2 passes do not qualify)",
    unmetIncludes(base.slice(0, 150).map((l) => ({ ...l, trials: [trial("primary", "passed"), ...l.trials] })), "primary-passed")
  );
  check(
    "29 failed launches of one negative do not qualify",
    unmetIncludes(base.map((l, i) => (i % 5 === 0 && i >= 145 ? { ...l, trials: l.trials.filter((t) => t.fixture !== "swap") } : l)), "swap-failed")
  );
  check("one negative that passed disqualifies", unmetIncludes(edit(base, 0, (l) => (l.trials[1] = trial("restyle", "passed"))), "restyle-passed"));
  for (const fixture of ["moved", "clipped", "hovered", "focused"] as const) {
    check(`a ${fixture} fixture that is not inconclusive disqualifies`, unmetIncludes(edit(base, 5, (l) => (l.trials[l.trials.findIndex((t) => t.fixture === fixture)] = trial(fixture, "failed"))), "not-inconclusive"));
  }
  for (const fixture of ["protected", "handoff", "sensitive"] as const) {
    check(
      `a ${fixture} refusal that captured disqualifies`,
      unmetIncludes(edit(base, 10, (l) => (l.trials[l.trials.findIndex((t) => t.fixture === fixture)].captures = 1)), "refusal-violations")
    );
  }
  check("a refusal that was not inconclusive disqualifies", unmetIncludes(edit(base, 10, (l) => (l.trials[l.trials.findIndex((t) => t.fixture === "handoff")] = trial("handoff", "failed", { captures: 0 }))), "refusal-violations"));
  check(
    "p95 over 2000 ms disqualifies (16 of 300 primary trials at 2001 ms)",
    unmetIncludes(base.map((l, i) => (i < 16 ? { ...l, trials: [trial("primary", "passed", { durationMs: 2001 }), ...l.trials.slice(1)] } : l)), "p95")
  );
  check(
    "p95 at exactly 2000 ms qualifies (15 slow trials stay above the 95th percentile rank)",
    decide(base.map((l, i) => (i < 15 ? { ...l, trials: [trial("primary", "passed", { durationMs: 2500 }), ...l.trials.slice(1)] } : l))).qualified
  );
  check("launches of another cell never count", !decide(base.map((l) => ({ ...l, cell: { renderMode: "headless" as const, devicePixelRatio: 1 } }))).qualified);
  for (const key of Object.keys(ENV) as Array<keyof VisualCalibrationEnvironment>) {
    const other = base.map((l, i) => (i < 150 ? { ...l, environment: { ...ENV, [key]: typeof ENV[key] === "number" ? (ENV[key] as number) + 1 : `${ENV[key]}-other` } } : l));
    check(`launches of another ${key} never count toward this environment`, unmetIncludes(other, "primary-passed"));
  }
  check("the negative threshold is the plan's 30", VISUAL_CALIBRATION_MIN_NEGATIVE_LAUNCHES === 30 && VISUAL_CALIBRATION_MIN_PASSED === 300);
}

console.log("\nB. The grant issuer's boundary\n");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
const ROOT = "app/main/calibration/visualCalibrationRoot.ts";
{
  const rootCode = code(ROOT);
  const refuseAt = rootCode.indexOf("app.isPackaged || getAppMode() !== \"dev\"");
  check("the root refuses a packaged app before anything else", refuseAt > 0 && refuseAt < rootCode.indexOf("getRuntimePaths()") && refuseAt < rootCode.indexOf("issueGrantUnchecked"));
  check("the root issues a grant only inside `if (summary.qualified)`", /if \(summary\.qualified\) \{[\s\S]*?issueGrantUnchecked\(/.test(rootCode) && (rootCode.match(/issueGrantUnchecked\(/g) ?? []).length === 1);
  check("the root registers no IPC channel and opens no window", !/ipcMain|BrowserWindow|contextBridge/.test(rootCode));

  const walkFiles = (dir: string): string[] =>
    existsSync(join(REPO, dir))
      ? readdirSync(join(REPO, dir)).flatMap((name) => {
          const rel = `${dir}/${name}`;
          return statSync(join(REPO, rel)).isDirectory() ? walkFiles(rel) : /\.(ts|tsx|mts|mjs)$/.test(name) ? [rel] : [];
        })
      : [];
  const product = [...walkFiles("src"), ...walkFiles("app")];
  const callers = product.filter((f) => /issueGrantUnchecked\(/.test(code(f)) && !f.endsWith("VisualBaselineStore.ts"));
  check("outside the store, only the calibration root calls issueGrantUnchecked", callers.length === 1 && callers[0] === ROOT, callers.join(", "));
  check("no preload or renderer module names the calibration harness or grant issuance", ![...walkFiles("app/renderer"), "app/main/preload.ts"].some((f) => /visualCalibration|VisualCalibration|calibration-main|issueGrant/.test(code(f))));

  const builder = JSON.parse(read("electron-builder.json")) as { files: string[] };
  check("electron-builder ships out/** and excludes out/calibration-main/**", builder.files.includes("out/**") && builder.files.includes("!out/calibration-main/**"));
  check("the production electron-vite config does not build the calibration root", !/calibration/i.test(read("electron.vite.config.ts")));
  check("the calibration config builds only the root, into out/calibration-main", /outDir: "out\/calibration-main"/.test(read("electron.vite.calibration.config.ts")) && /visualCalibrationRoot\.ts/.test(read("electron.vite.calibration.config.ts")));

  // The production main entry's import closure (relative and @src/@main aliases) never reaches calibration code.
  const resolveImport = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@src/")) base = join(REPO, "src", spec.slice(5));
    else if (spec.startsWith("@main/")) base = join(REPO, "app/main", spec.slice(6));
    else if (spec.startsWith(".")) base = resolve(dirname(join(REPO, from)), spec);
    else return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return relative(REPO, candidate).split(sep).join("/");
    }
    return null;
  };
  const seen = new Set<string>(["app/main/main.ts"]);
  const queue = ["app/main/main.ts"];
  while (queue.length) {
    const file = queue.shift() as string;
    for (const m of read(file).matchAll(/(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const target = resolveImport(file, m[1] ?? m[2]);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  const reached = [...seen].filter((f) => /calibration/i.test(f));
  check("the production main entry's import closure was walked", seen.size > 150, String(seen.size));
  check("the production main entry never reaches the calibration root, harness or criterion", reached.length === 0, reached.join(", "));

  const manifest = read("scripts/write-calibration-root-manifest.mjs");
  check("the root's manifest reuses the app's name, productName and version (same userData and safeStorage key)", /name: pkg\.name/.test(manifest) && /productName: pkg\.productName/.test(manifest) && /version: pkg\.version/.test(manifest));
  if (existsSync(join(REPO, "out/calibration-main/package.json"))) {
    const built = JSON.parse(read("out/calibration-main/package.json")) as { version: string; productName: string };
    const pkg = JSON.parse(read("package.json")) as { version: string; productName: string };
    check("the built root manifest matches the app version and product name", built.version === pkg.version && built.productName === pkg.productName);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
