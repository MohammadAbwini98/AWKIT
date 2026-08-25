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
  const src = readFileSync(join("app", "main", "ipc", "execution.ipc.ts"), "utf8");
  const bodyStart = src.indexOf("async function readDataFile");
  const body = src.slice(bodyStart, bodyStart + 1200);
  check(
    "SEC-005 readDataFile rejects files confined to the runtime root before parsing",
    body.includes("isReadableDataSourceFile(getRuntimeDataRoot(), getConfiguredPaths().dataSources, resolved)") && body.indexOf("isReadableDataSourceFile") < body.indexOf("JSON.parse")
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
