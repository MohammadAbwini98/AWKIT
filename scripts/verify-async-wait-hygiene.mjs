/**
 * verify:async-wait-hygiene — no Playwright wait may be handed an async predicate.
 *
 * What regression makes this fail?
 *   - someone writes `page.waitForFunction(async () => …)` again.
 *
 * Why that is worth a verifier of its own: `waitForFunction` does NOT await the predicate. It
 * receives a Promise, a Promise is always truthy, and the wait is therefore satisfied on its first
 * poll no matter what the predicate would have resolved to. Measured against real Playwright:
 *
 *     async-always-false predicate: resolved after 105ms
 *     sync-always-false  predicate: timed out after 3010ms
 *
 * Three waits in the Flow and Workflow capsule suites were written that way, because the state they
 * asked about (a persisted profile) is only reachable through an async IPC round-trip. All three
 * were inert for their whole lifetime, and each carried a careful comment about `polling: 100`
 * versus requestAnimationFrame — correct reasoning in defence of a wait that was not waiting. The
 * cost was three separate investigations into a "flaky reload", because the instrument reported a
 * save as persisted at exactly the moment it had not been.
 *
 * The correct construction is `waitForAsyncCondition` in `scripts/lib/gui-verify-harness.mjs`, which
 * polls from Node through `page.evaluate` — evaluate DOES await a returned Promise.
 *
 * This file scans source text; it never launches a browser or the app, which is why it is
 * classified static-source-validation. It is deliberately .mjs to match the other node verifiers.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ["scripts", "src", "app", "tests", "tools"];
const SCAN_EXTENSIONS = [".mjs", ".mts", ".ts", ".tsx", ".js"];
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "graphify-out", ".git", "release"]);

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  OK ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) walk(full, out);
    else if (SCAN_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

/**
 * Collect EVERY `waitForFunction(` call site, then classify.
 *
 * Deliberately not a regex for the violating shape alone. A collector narrow enough to match only
 * the defect cannot notice a defect spelled slightly differently, and this repository has already
 * shipped a guard that passed 135/135 against the exact mutation it existed to catch because its
 * capture pattern excluded it. Capture permissively, validate strictly.
 */
export function findWaitForFunctionCalls(source) {
  const calls = [];
  const needle = "waitForFunction(";
  let index = source.indexOf(needle);
  while (index !== -1) {
    const argStart = index + needle.length;
    const head = source.slice(argStart, argStart + 60).replace(/^[\s\r\n]+/, "");
    calls.push({
      index,
      line: source.slice(0, index).split("\n").length,
      head,
      isAsyncPredicate: /^async[\s(]/.test(head)
    });
    index = source.indexOf(needle, argStart);
  }
  return calls;
}

console.log("Detector behaviour (fixtures):");
const FIXTURES = [
  ["a single-line async predicate is flagged", "await page.waitForFunction(async () => false);", true],
  [
    "a multi-line async predicate is flagged",
    "await win.waitForFunction(\n      async (want) => {\n        return want;\n      },\n      12\n    );",
    true
  ],
  ["a synchronous arrow predicate is NOT flagged", "await page.waitForFunction(() => document.title === 'x');", false],
  ["a string predicate is NOT flagged", 'await page.waitForFunction("window.__ready===true", { timeout: 5000 });', false],
  [
    "a plain function-expression predicate is NOT flagged",
    "await page.waitForFunction(function () { return true; });",
    false
  ],
  [
    "the correct helper may take an async predicate",
    "await waitForAsyncCondition(win, async () => true, undefined, { timeout: 10 });",
    false
  ]
];

for (const [label, snippet, shouldFlag] of FIXTURES) {
  const calls = findWaitForFunctionCalls(snippet);
  const flagged = calls.some((call) => call.isAsyncPredicate);
  check(label, flagged === shouldFlag, `flagged=${flagged}, expected=${shouldFlag}`);
}

const helperOnly = findWaitForFunctionCalls("await waitForAsyncCondition(win, async () => true);");
check(
  "the helper is not mistaken for a waitForFunction call site",
  helperOnly.length === 0,
  `collected ${helperOnly.length}`
);

console.log("Repository scan:");
const files = SCAN_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root)));
check("the scan reaches source files at all", files.length > 100, `${files.length} files`);

/**
 * Blank out comments before scanning, preserving offsets so reported line numbers stay true.
 *
 * A guard that reads prose reports the documentation describing the defect as the defect - this one
 * did exactly that on its first run, flagging the comment in `gui-verify-harness.mjs` that exists to
 * warn against the pattern. Only `//` at the start of a line is stripped, so a `//` inside a URL in a
 * string is left alone.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/^([ \t]*)\/\/.*$/gm, (match) => " ".repeat(match.length));
}

const SELF = "scripts/verify-async-wait-hygiene.mjs";

const allCalls = [];
for (const file of files) {
  const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
  if (rel === SELF) continue; // its fixtures are the violating pattern, held as data on purpose
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!source.includes("waitForFunction(")) continue;
  for (const call of findWaitForFunctionCalls(stripComments(source))) {
    allCalls.push({ ...call, file: rel });
  }
}

// The one file the scan skips must still be one the detector WOULD catch. Without this, deleting the
// detector's teeth and keeping the exclusion would look identical to a clean repository.
const selfFlagged = findWaitForFunctionCalls(readFileSync(join(REPO_ROOT, SELF), "utf8"))
  .filter((call) => call.isAsyncPredicate).length;
check(
  "the excluded self-file is one the detector would flag (so the exclusion hides nothing dead)",
  selfFlagged >= 2,
  `${selfFlagged} flagged in ${SELF}`
);

check(
  "comments are stripped, not scanned",
  findWaitForFunctionCalls(stripComments("/* await page.waitForFunction(async () => false); */")).length === 0 &&
    findWaitForFunctionCalls(stripComments("  // await page.waitForFunction(async () => false);")).length === 0
);

check(
  "stripping comments does not disturb reported line numbers",
  findWaitForFunctionCalls(stripComments("/* doc\n   doc */\nawait page.waitForFunction(() => true);"))[0]?.line === 3
);

check(
  "a // inside a string is not treated as a comment",
  findWaitForFunctionCalls(stripComments('const u = "http://x"; await page.waitForFunction(async () => false);')).length === 1
);

// Cardinality BEFORE the .every()-shaped assertion below: "no violations" is worthless if the
// collector found nothing to inspect. This verifier's own subject must exist for it to mean anything.
check("the scan collects real waitForFunction call sites", allCalls.length >= 20, `${allCalls.length} call sites`);

const violations = allCalls.filter((call) => call.isAsyncPredicate);
check(
  "no waitForFunction is handed an async predicate",
  violations.length === 0,
  violations.map((v) => `${v.file}:${v.line}`).join(", ")
);

console.log("Guard fires on a real file:");
const tmp = mkdtempSync(join(tmpdir(), "awkit-async-wait-"));
try {
  const offender = join(tmp, "offender.mjs");
  writeFileSync(offender, "export const wait = async (page) => page.waitForFunction(async () => false);\n");
  const injected = findWaitForFunctionCalls(readFileSync(offender, "utf8"));
  check("a violating file on disk is detected end to end", injected.filter((c) => c.isAsyncPredicate).length === 1);

  const clean = join(tmp, "clean.mjs");
  writeFileSync(clean, "export const wait = async (page) => page.waitForFunction(() => false);\n");
  const cleanCalls = findWaitForFunctionCalls(readFileSync(clean, "utf8"));
  check(
    "a clean file on disk is collected but not flagged",
    cleanCalls.length === 1 && cleanCalls.every((c) => !c.isAsyncPredicate)
  );
} finally {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

console.log(`\n${passed}/${passed + failed} async wait hygiene checks passed`);
if (failed > 0) process.exit(1);
