/**
 * Security-hardening regression checks (audit remediation).
 * Pure logic only — no Electron/Chromium. Run: `npm run verify:security`.
 *
 * Covers the helpers introduced to close audit findings:
 *   - urlPolicy.isNavigableUrl / assertNavigableUrl  (F-02, F-11)
 *   - pathSafety.isPathInside                         (F-04, F-05, F-08 confinement)
 *   - pathSafety.isReadableDataSourceFile             (§14 data-source read confinement)
 */
import { isNavigableUrl, assertNavigableUrl } from "../src/runner/urlPolicy";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { isPathInside, isReadableDataSourceFile } from "../src/utils/pathSafety";
import { normalizeFlowBounds, FLOW_BOUNDS } from "../src/profiles/FlowValidation";
import type { FlowProfile } from "../src/profiles/FlowProfile";
import { setJsonAtPath } from "../src/data/TableEditing";
import { resolveJsonPath } from "../src/data/JsonPathResolver";

let passed = 0;
let failed = 0;
/**
 * `detail` is printed on failure only. Callers already passed it — the parameter was simply never
 * declared, so every diagnostic string they computed (`ungated=… gated=…`, `gates=… handlers=…`)
 * was discarded and a red run said nothing about WHICH channel was ungated.
 */
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("Navigation protocol policy (F-02 / F-11):");
check("http allowed", isNavigableUrl("http://example.com"));
check("https allowed", isNavigableUrl("https://internal.local:8443/app"));
check("localhost allowed (internal automation)", isNavigableUrl("http://127.0.0.1:3000"));
check("about:blank allowed", isNavigableUrl("about:blank"));
check("data: allowed (inline, no FS access)", isNavigableUrl("data:text/html,<h1>hi</h1>"));
check("relative/scheme-less allowed", isNavigableUrl("/dashboard"));
check("file: rejected", !isNavigableUrl("file:///C:/Windows/win.ini"));
check("javascript: rejected", !isNavigableUrl("javascript:alert(1)"));
check("chrome: rejected", !isNavigableUrl("chrome://settings"));
check("chrome-extension: rejected", !isNavigableUrl("chrome-extension://abc/x.html"));
check("devtools: rejected", !isNavigableUrl("devtools://devtools/bundled/x.html"));
check("empty rejected", !isNavigableUrl(""));

let threw = false;
try {
  assertNavigableUrl("file:///C:/secret.txt");
} catch {
  threw = true;
}
check("assertNavigableUrl throws on file:", threw);
check("assertNavigableUrl returns http url", assertNavigableUrl("https://ok.test") === "https://ok.test");

console.log("Path confinement (F-04 / F-05):");
const root = process.platform === "win32" ? "C:\\app\\data" : "/app/data";
check("file directly inside root", isPathInside(root, `${root}${process.platform === "win32" ? "\\" : "/"}sessions${process.platform === "win32" ? "\\" : "/"}a.json`));
check("root equals target", isPathInside(root, root));
check("traversal escape rejected", !isPathInside(root, `${root}${process.platform === "win32" ? "\\" : "/"}..${process.platform === "win32" ? "\\" : "/"}other${process.platform === "win32" ? "\\" : "/"}x.json`));
check("sibling prefix not treated as inside", !isPathInside(root, `${root}-evil${process.platform === "win32" ? "\\" : "/"}x.json`));
check("unrelated path rejected", !isPathInside(root, process.platform === "win32" ? "C:\\Windows\\System32\\cmd.exe" : "/etc/passwd"));
if (process.platform === "win32") {
  check("case-insensitive on Windows", isPathInside("C:\\App\\Data", "c:\\app\\data\\x.json"));
}

console.log("Data-source read confinement (§14):");
const sep = process.platform === "win32" ? "\\" : "/";
const runtimeRoot = process.platform === "win32" ? "C:\\rt" : "/rt";
const dataDir = `${runtimeRoot}${sep}dataSources`;
const inRuntime = (rel: string) => `${runtimeRoot}${sep}${rel}`;
check("external user file allowed", isReadableDataSourceFile(runtimeRoot, dataDir, process.platform === "win32" ? "C:\\Users\\u\\rows.json" : "/home/u/rows.json"));
check("data-sources workspace file allowed", isReadableDataSourceFile(runtimeRoot, dataDir, `${dataDir}${sep}files${sep}x.json`));
check("saved session profile refused", !isReadableDataSourceFile(runtimeRoot, dataDir, inRuntime(`sessions${sep}portal.json`)));
check("runtime durable store refused", !isReadableDataSourceFile(runtimeRoot, dataDir, inRuntime(`secrets.json`)));
check("logs/reports refused", !isReadableDataSourceFile(runtimeRoot, dataDir, inRuntime(`reports${sep}run.json`)));
check("traversal out of workspace back into runtime refused", !isReadableDataSourceFile(runtimeRoot, dataDir, `${dataDir}${sep}..${sep}sessions${sep}p.json`));

console.log("Workflow bounds normalization (F-03):");
const evilFlow = {
  id: "evil",
  name: "evil",
  version: 1,
  nodes: [
    {
      id: "n1",
      type: "goto",
      name: "go",
      timeoutMs: 9_999_999,
      retry: { count: 5000, delayMs: 9_999_999 },
      loop: { maxIterations: 1_000_000 },
      locator: { strategy: "css", value: "#x", alternatives: Array.from({ length: 500 }, () => ({ strategy: "css", value: "#y" })) },
      afterWaits: Array.from({ length: 300 }, () => ({ type: "fixedDelay", delayMs: 9_999_999 }))
    },
    { id: "n1", type: "click", name: "dup id" }
  ],
  edges: [{ id: "e1", source: "n1", target: "n1", type: "loop", loop: { mode: "count", maxIterations: 1_000_000 } }]
} as unknown as FlowProfile;
const warnings = normalizeFlowBounds(evilFlow);
const n1 = evilFlow.nodes[0];
check("timeoutMs clamped", n1.timeoutMs === FLOW_BOUNDS.maxTimeoutMs);
check("retry.count clamped", n1.retry!.count === FLOW_BOUNDS.maxRetryCount);
check("loop.maxIterations clamped", n1.loop!.maxIterations === FLOW_BOUNDS.maxLoopIterations);
check("alternatives truncated", (n1.locator!.alternatives || []).length === FLOW_BOUNDS.maxAlternatives);
check("afterWaits truncated", (n1.afterWaits || []).length === FLOW_BOUNDS.maxWaitsPerStep);
check("fixedDelay clamped", (n1.afterWaits![0] as { delayMs: number }).delayMs === FLOW_BOUNDS.maxDelayMs);
check("connector loop maxIterations clamped", evilFlow.edges[0].loop!.maxIterations === FLOW_BOUNDS.maxLoopIterations);
check("duplicate node id warned", warnings.some((w) => w.includes("duplicate node ids")));
check("in-range values untouched (no over-clamp)", normalizeFlowBounds({ id: "ok", name: "ok", version: 1, nodes: [{ id: "a", type: "goto", name: "g", timeoutMs: 30_000 }], edges: [] } as unknown as FlowProfile).length === 0);

console.log("Prototype-pollution guard (JSON path helpers):");
let protoThrew = false;
try {
  setJsonAtPath({}, "$.__proto__.polluted", "x");
} catch {
  protoThrew = true;
}
check("setJsonAtPath rejects __proto__ path", protoThrew);
check("global Object.prototype not polluted", ({} as Record<string, unknown>).polluted === undefined);
check("resolveJsonPath does not traverse __proto__", resolveJsonPath({ a: 1 }, "$.__proto__.x") === undefined);
check("setJsonAtPath still writes normal paths", JSON.stringify(setJsonAtPath({ a: { b: 1 } }, "$.a.c", 2)) === JSON.stringify({ a: { b: 1, c: 2 } }));

// ── AWKIT-SEC-003 — every MUTATING Oracle profiles/drivers/java channel requires SETTINGS_EDIT ──
{
  const src = readFileSync(join("app", "main", "ipc", "oracle.ipc.ts"), "utf8");
  const mutating = [
    "oracle:profiles:save", "oracle:profiles:delete", "oracle:profiles:test", "oracle:profiles:testDraft",
    "oracle:drivers:import", "oracle:drivers:validate", "oracle:drivers:setDefault",
    "oracle:drivers:remove", "oracle:drivers:testLoad",
    "oracle:java:addExe", "oracle:java:addDir", "oracle:java:validate",
    "oracle:java:setDefault", "oracle:java:remove", "oracle:java:testBridge"
  ];
  const HANDLE = /ipcMain\.handle\(\s*"([^"]+)"/g;
  const positions = [...src.matchAll(HANDLE)].map((m) => ({ name: m[1], idx: m.index }));
  let ungated = 0;
  const gated = [];
  for (let i = 0; i < positions.length; i += 1) {
    if (!mutating.includes(positions[i].name)) continue;
    const end = i + 1 < positions.length ? positions[i + 1].idx : src.length;
    const body = src.slice(positions[i].idx, end);
    if (/requireSettingsEdit\(event\)|assertSenderPermission\(/.test(body)) gated.push(positions[i].name);
    else ungated += 1;
  }
  check("SEC-003 all 15 mutating Oracle channels enforce SETTINGS_EDIT", ungated === 0 && gated.length === 15, `ungated=${ungated} gated=${gated.length}`);
  // The execution sinks stay behind the gate: binary probe + JAR load live in main only.
  const oracleSvc = readFileSync(join("app", "main", "oracleService.ts"), "utf8");
  check("SEC-003 Java probe/driver load sinks exist in MAIN (never renderer)", oracleSvc.includes("execFile") || oracleSvc.includes("spawn"), "no exec sink found in main");
}

// ── AWKIT-SEC-004 — ignoreProtectedLoginDetection is a privileged settings write ──
{
  const src = readFileSync(join("app", "main", "ipc", "settings.ipc.ts"), "utf8");
  check(
    "SEC-004 patchTouchesSubstantiveSettings gates recorder.ignoreProtectedLoginDetection",
    /patch\.recorder\?\.ignoreProtectedLoginDetection !== undefined\) return true/.test(src)
  );
  // Consumption: recorder:start must read the persisted flag (single source of truth).
  const rec = readFileSync(join("app", "main", "ipc", "recorder.ipc.ts"), "utf8");
  check("SEC-004 recorder:start consumes the persisted ignore flag from Settings", rec.includes("ignoreProtectedLoginDetection: settings.recorder.ignoreProtectedLoginDetection"));
}

// ── AWKIT-SEC-005 — execution-time data-source reads enforce §14 confinement ──
{
  // The authoritative implementation lives in the execution APPLICATION SERVICE, not the IPC layer.
  // This check used to read app/main/ipc/execution.ipc.ts, which no longer declares readDataFile at
  // all: indexOf returned -1, the slice degenerated to a single character, and the assertion failed
  // closed while saying nothing about whether the invariant still held. The anchor guard below makes
  // that class of drift fail LOUDLY instead of silently degenerating into a slice of nothing.
  const sourceFile = join("app", "main", "execution", "ExecutionApplicationService.ts");
  const src = readFileSync(sourceFile, "utf8");
  const bodyStart = src.indexOf("async function readDataFile");
  const bodyEnd = src.indexOf("function resolveDataFilePath");
  check(
    "SEC-005 readDataFile anchors resolve in the authoritative execution service",
    bodyStart >= 0 && bodyEnd > bodyStart,
    `${sourceFile}: start("async function readDataFile")=${bodyStart} end("function resolveDataFilePath")=${bodyEnd} — the function was moved or renamed, so the extracted body is NOT readDataFile`
  );
  const body = src.slice(bodyStart, bodyEnd);

  /**
   * Pure predicate: validation-before-parse must hold INSIDE readDataFile's own body.
   * Presence of `isReadableDataSourceFile` or `JSON.parse` somewhere in the file proves nothing —
   * the invariant is that the REJECTING guard runs, throws, and does so strictly BEFORE the parse.
   */
  function sec005InvariantHolds(fnBody: string): { ok: boolean; reason: string } {
    const guardAt = fnBody.indexOf("if (!isReadableDataSourceFile(");
    if (guardAt < 0) {
      return { ok: false, reason: "no rejecting guard: `if (!isReadableDataSourceFile(` is absent from the readDataFile body" };
    }
    const validateAt = fnBody.indexOf("isReadableDataSourceFile");
    const parseAt = fnBody.indexOf("JSON.parse(");
    if (parseAt < 0) {
      return { ok: false, reason: "no `JSON.parse(` in the readDataFile body — the guard cannot be shown to precede the parse it protects" };
    }
    if (!(validateAt < parseAt)) {
      return { ok: false, reason: `ORDER violated: isReadableDataSourceFile at ${validateAt} is not strictly before JSON.parse at ${parseAt}` };
    }
    const throwAt = fnBody.indexOf("throw", guardAt);
    if (throwAt < 0 || throwAt > parseAt) {
      return { ok: false, reason: `guard does not reject: no \`throw\` between the guard (${guardAt}) and the parse (${parseAt})` };
    }
    if (!fnBody.includes("isReadableDataSourceFile(getRuntimeDataRoot(), getConfiguredPaths().dataSources, resolved)")) {
      return { ok: false, reason: "guard is not evaluated against the runtime root + configured data-sources workspace for the RESOLVED path" };
    }
    // Ordering alone is not confinement: the guard validates ONE binding, and the parse must consume
    // THAT SAME binding. `readFile(file, …)` leaves the guard and the ordering perfectly intact while
    // re-reading the raw, unresolved, unvalidated argument. The identifier is derived from the guard's
    // own third argument (balanced-paren scan), so this proves same-binding consumption rather than
    // merely proving that something spelled "resolved" appears somewhere.
    const argsFrom = fnBody.indexOf("isReadableDataSourceFile(", guardAt) + "isReadableDataSourceFile(".length;
    let depth = 1;
    let cursor = argsFrom;
    while (cursor < fnBody.length && depth > 0) {
      const ch = fnBody[cursor];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      if (depth === 0) break;
      cursor += 1;
    }
    const guardArgs = fnBody.slice(argsFrom, cursor);
    const validated = (guardArgs.split(",").pop() ?? "").trim();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(validated)) {
      return { ok: false, reason: `cannot derive the validated binding from the guard argument list \`${guardArgs}\` — same-binding consumption is unprovable` };
    }
    const parsedExpression = fnBody.slice(parseAt);
    if (!new RegExp(`readFile\\(\\s*${validated}\\s*,`).test(parsedExpression)) {
      return {
        ok: false,
        reason: `parse does not consume the VALIDATED binding: the guard validated \`${validated}\` but the parsed expression \`${parsedExpression.trim().split("\n")[0]}\` contains no \`readFile(${validated}, …)\` — the parsed bytes come from a path the guard never checked`,
      };
    }
    return { ok: true, reason: "" };
  }

  const real = sec005InvariantHolds(body);
  check(
    "SEC-005 readDataFile rejects files confined to the runtime root before parsing",
    real.ok,
    `${sourceFile}: ${real.reason}`
  );

  // Permanent mutant proof — the predicate must REJECT broken variants built by string surgery on
  // the REAL body. Without this, a predicate that always returned true would look identical to a
  // held invariant. Each surgery asserts it actually changed the text, so it cannot go vacuous.
  const guardAt = body.indexOf("if (!isReadableDataSourceFile(");
  const parseAt = body.indexOf("return JSON.parse(");
  const parseLineEnd = body.indexOf("\n", parseAt);
  const parseLine = parseAt >= 0 && parseLineEnd > parseAt ? body.slice(parseAt, parseLineEnd + 1) : "";
  const surgeryViable = guardAt >= 0 && parseAt > guardAt && parseLine.length > 0;

  // MUTANT A — validation absent: excise the whole guard statement (condition + throw + brace).
  const mutantA = surgeryViable ? body.slice(0, guardAt) + body.slice(parseAt) : body;
  check(
    "SEC-005 mutant A surgery really deleted the guard (non-vacuous)",
    mutantA !== body && !mutantA.includes("if (!isReadableDataSourceFile("),
    `guardAt=${guardAt} parseAt=${parseAt} — surgery was a no-op, so the mutant assertion below would be vacuous`
  );
  check(
    "SEC-005 predicate REJECTS mutant A (validation deleted)",
    sec005InvariantHolds(mutantA).ok === false,
    "predicate accepted a readDataFile body with no confinement guard at all"
  );

  // MUTANT B — parse before validation: hoist the `return JSON.parse(...)` line above the guard.
  const mutantB = surgeryViable
    ? body.slice(0, guardAt) + parseLine + body.slice(guardAt, parseAt) + body.slice(parseAt + parseLine.length)
    : body;
  check(
    "SEC-005 mutant B surgery really hoisted the parse above the guard (non-vacuous)",
    mutantB !== body && mutantB.indexOf("JSON.parse(") < mutantB.indexOf("isReadableDataSourceFile"),
    `guardAt=${guardAt} parseAt=${parseAt} parseLineLen=${parseLine.length} — surgery was a no-op, so the mutant assertion below would be vacuous`
  );
  check(
    "SEC-005 predicate REJECTS mutant B (parse hoisted above validation)",
    sec005InvariantHolds(mutantB).ok === false,
    "predicate accepted a readDataFile body that parses before it validates"
  );

  // MUTANT C — validated-path consumption: the guard and the ordering are left byte-identical, and
  // only the read INSIDE the parse is repointed from the validated binding to the raw `file` argument.
  // That is a genuine confinement bypass (`file` is the unresolved, unvalidated input) which mutants
  // A and B cannot see, because nothing about the guard or its position changes.
  const mutatedParseLine = parseLine.replace(/readFile\(\s*[A-Za-z_$][A-Za-z0-9_$]*\s*,/, "readFile(file,");
  const mutantC = surgeryViable && mutatedParseLine !== parseLine
    ? body.slice(0, parseAt) + mutatedParseLine + body.slice(parseAt + parseLine.length)
    : body;
  check(
    "SEC-005 mutant C surgery really repointed the read at the raw `file` argument, guard untouched (non-vacuous)",
    mutantC !== body
      && mutantC.slice(0, parseAt) === body.slice(0, parseAt)
      && /readFile\(\s*file\s*,/.test(mutantC.slice(parseAt)),
    `parseAt=${parseAt} parseLine=${JSON.stringify(parseLine)} — surgery was a no-op or disturbed the guard, so the mutant assertions below would be vacuous`
  );
  const mutantCReason = sec005InvariantHolds(mutantC).reason;
  check(
    "SEC-005 predicate REJECTS mutant C (parse consumes the unvalidated raw path)",
    sec005InvariantHolds(mutantC).ok === false,
    "predicate accepted a readDataFile body whose parse reads a path the guard never validated"
  );
  check(
    "SEC-005 mutant C is rejected for the CONSUMPTION reason, not incidental guard/order damage",
    mutantCReason.startsWith("parse does not consume the VALIDATED binding"),
    `mutant C must fail on validated-path consumption; instead the predicate said: ${mutantCReason}`
  );

  // Behavior of the confinement predicate itself (real filesystem evidence):
  const root = mkdtempSync(join(tmpdir(), "awkit-sec005-"));
  try {
    const internalStore = join(root, "storage", "ui-settings.json");
    mkdirSync(dirname(internalStore), { recursive: true });
    writeFileSync(internalStore, "{\"secretish\":true}", "utf8");
    check("SEC-005 an absolute path INSIDE the runtime root is rejected", !isReadableDataSourceFile(root, join(root, "data-sources"), internalStore));
    const workspace = join(root, "data-sources", "rows.json");
    mkdirSync(dirname(workspace), { recursive: true });
    writeFileSync(workspace, "[{}]", "utf8");
    check("SEC-005 the data-sources workspace remains readable", isReadableDataSourceFile(root, join(root, "data-sources"), workspace));
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
}

// ── AWKIT-SEC-006 — session/reauth env overrides are dev/test-only ──
{
  const src = readFileSync(join("app", "main", "security", "securityKernel.ts"), "utf8");
  const gateAt = src.indexOf("!isPackagedBuild()", src.indexOf("resolveKernelOptions"));
  const idleCodeAt = src.indexOf("process.env.AWKIT_SESSION_IDLE_MS");
  const reauthCodeAt = src.indexOf("process.env.AWKIT_REAUTH_WINDOW_MS");
  check(
    "SEC-006 both env overrides sit behind an app.isPackaged gate",
    gateAt > -1 && idleCodeAt > gateAt && reauthCodeAt > gateAt,
    `gate=${gateAt} idle=${idleCodeAt} reauth=${reauthCodeAt}`
  );
}

// ── AWKIT-SEC-001 / AWKIT-SEC-002 — IPC write confinement + authz registry wiring ──
{
  const ds = readFileSync(join("app", "main", "ipc", "dataSource.ipc.ts"), "utf8");
  const createBody = ds.slice(ds.indexOf("async function createFromScratch"), ds.indexOf("async function browseJsonDataSource"));
  check(
    "SEC-001 createFromScratch confines fileName via safePathComponent and re-asserts isPathInside",
    createBody.includes("safePathComponent(fileName") && createBody.includes("isPathInside(dataFilesDir(), file)"),
    "confinement calls missing from createFromScratch"
  );

  const floors: Array<[string, number]> = [
    ["dataSource.ipc.ts", 15],
    ["session.ipc.ts", 9],
    ["instance.ipc.ts", 9],
    ["runtimeInput.ipc.ts", 8],
    ["scenario.ipc.ts", 10]
  ];
  for (const [file, floor] of floors) {
    const src = readFileSync(join("app", "main", "ipc", file), "utf8");
    const gates = (src.match(/assertSenderPermission\(/g) ?? []).length;
    const handlers = (src.match(/ipcMain\.handle\(/g) ?? []).length;
    check(`SEC-002 ${file} gates every channel (${gates} assertions >= ${handlers} handlers)`, gates >= handlers && gates >= floor, `gates=${gates} handlers=${handlers}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
