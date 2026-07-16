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
import { isPathInside, isReadableDataSourceFile } from "../src/utils/pathSafety";
import { normalizeFlowBounds, FLOW_BOUNDS } from "../src/profiles/FlowValidation";
import type { FlowProfile } from "../src/profiles/FlowProfile";
import { setJsonAtPath } from "../src/data/TableEditing";
import { resolveJsonPath } from "../src/data/JsonPathResolver";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
