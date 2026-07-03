#!/usr/bin/env node
/**
 * Seeds TEST-ONLY flows, workflows, and a data source that target the offline
 * mock-site (`npm run mock-site`, default http://localhost:4321) into the local
 * runtime userData folders, and writes the same fixtures to
 * resources/test-fixtures/mock-site/ for inspection.
 *
 * These are explicitly opt-in: nothing here runs on app startup, and a fresh
 * install still shows empty Flows/Workflows/Data Sources. Run for local testing:
 *
 *   npm run seed:mock-fixtures
 *
 * All fixture ids are prefixed `mock-` and names start with "Mock —" so they are
 * obviously test data.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.MOCK_SITE_URL || "http://localhost:4321";
const now = new Date().toISOString();

// ── Helpers ───────────────────────────────────────────────────────────────────
const staticValue = (value) => ({ type: "static", value });
const successChain = (id, ids) => ids.slice(0, -1).map((source, i) => ({ id: `${id}-e${i}`, source, target: ids[i + 1], type: "success" }));
const flow = (id, name, description, nodes, edges) => ({ id, name, description, version: 1, createdAt: now, updatedAt: now, nodes, edges });

// ── Data source ───────────────────────────────────────────────────────────────
const mockUsers = [
  { id: 1, username: "user1", password: "password1", firstName: "Mohammad", lastName: "Test", email: "mohammad.test@example.com", country: "JO", accountType: "BUSINESS" },
  { id: 2, username: "user2", password: "password2", firstName: "Ahmad", lastName: "Sample", email: "ahmad.sample@example.com", country: "US", accountType: "PERSONAL" },
  { id: 3, username: "user3", password: "password3", firstName: "Sara", lastName: "Mock", email: "sara.mock@example.com", country: "GB", accountType: "BUSINESS" }
];

// ── Flow fixtures ─────────────────────────────────────────────────────────────
const loginFlow = flow(
  "mock-login-flow",
  "Mock — Login Flow",
  "Logs into the mock site (/login → /form).",
  [
    { id: "start", type: "start", name: "Start" },
    { id: "goto", type: "goto", name: "Open Login", url: `${BASE}/login`, valueSource: staticValue(`${BASE}/login`) },
    { id: "user", type: "fill", name: "Username", locator: { strategy: "id", value: "username" }, valueSource: staticValue("user1") },
    { id: "pass", type: "fill", name: "Password", locator: { strategy: "id", value: "password" }, valueSource: staticValue("password1") },
    { id: "login", type: "click", name: "Login", locator: { strategy: "id", value: "loginButton" } },
    { id: "end", type: "end", name: "End" }
  ],
  successChain("login", ["start", "goto", "user", "pass", "login", "end"])
);

const fillFormFlow = flow(
  "mock-fill-form-flow",
  "Mock — Fill Form Flow",
  "Fills and submits the mock site form.",
  [
    { id: "start", type: "start", name: "Start" },
    { id: "goto", type: "goto", name: "Open Form", url: `${BASE}/form`, valueSource: staticValue(`${BASE}/form`) },
    { id: "first", type: "fill", name: "First Name", locator: { strategy: "id", value: "firstName" }, valueSource: staticValue("Mohammad") },
    { id: "last", type: "fill", name: "Last Name", locator: { strategy: "id", value: "lastName" }, valueSource: staticValue("Test") },
    { id: "email", type: "fill", name: "Email", locator: { strategy: "id", value: "email" }, valueSource: staticValue("mohammad.test@example.com") },
    { id: "terms", type: "check", name: "Accept Terms", locator: { strategy: "id", value: "acceptTerms" } },
    { id: "submit", type: "click", name: "Submit", locator: { strategy: "id", value: "submitButton" } },
    { id: "end", type: "end", name: "End" }
  ],
  successChain("form", ["start", "goto", "first", "last", "email", "terms", "submit", "end"])
);

const screenshotFlow = flow(
  "mock-screenshot-flow",
  "Mock — Screenshot Flow",
  "Captures a full-page screenshot of the current page.",
  [
    { id: "start", type: "start", name: "Start" },
    { id: "shot", type: "screenshot", name: "Capture Page", config: { fullPage: true, screenshotName: "mock-page" } },
    { id: "end", type: "end", name: "End" }
  ],
  successChain("shot", ["start", "shot", "end"])
);

const scrollFlow = flow(
  "mock-scroll-flow",
  "Mock — Scroll Flow",
  "Scrolls the page down.",
  [
    { id: "start", type: "start", name: "Start" },
    { id: "scroll", type: "scroll", name: "Scroll Down", config: { scrollTarget: "page", scrollDirection: "down", scrollAmount: 400 } },
    { id: "end", type: "end", name: "End" }
  ],
  successChain("scroll", ["start", "scroll", "end"])
);

const uploadFlow = flow(
  "mock-upload-flow",
  "Mock — Upload File Flow",
  "Uploads a file into the mock form #attachment input. Edit the file path to a real file before running.",
  [
    { id: "start", type: "start", name: "Start" },
    { id: "goto", type: "goto", name: "Open Form", url: `${BASE}/form`, valueSource: staticValue(`${BASE}/form`) },
    { id: "upload", type: "uploadFile", name: "Upload Attachment", locator: { strategy: "id", value: "attachment" }, valueSource: staticValue("package.json") },
    { id: "end", type: "end", name: "End" }
  ],
  successChain("upload", ["start", "goto", "upload", "end"])
);

const waitFlow = flow(
  "mock-wait-flow",
  "Mock — Wait For Selector Flow",
  "Waits for the form first-name field to be visible.",
  [
    { id: "start", type: "start", name: "Start" },
    { id: "goto", type: "goto", name: "Open Form", url: `${BASE}/form`, valueSource: staticValue(`${BASE}/form`) },
    { id: "wait", type: "wait", name: "Wait For Field", locator: { strategy: "id", value: "firstName" }, config: { waitType: "selector" }, timeoutMs: 10000 },
    { id: "end", type: "end", name: "End" }
  ],
  successChain("wait", ["start", "goto", "wait", "end"])
);

const loopFlow = flow(
  "mock-loop-flow",
  "Mock — Loop (fixed count) Flow",
  "Fills the first-name field 3 times via a fixed-count loop.",
  [
    { id: "start", type: "start", name: "Start" },
    { id: "goto", type: "goto", name: "Open Form", url: `${BASE}/form`, valueSource: staticValue(`${BASE}/form`) },
    {
      id: "loop",
      type: "loop",
      name: "Loop Fill",
      locator: { strategy: "id", value: "firstName" },
      valueSource: staticValue("Loop"),
      config: { loopType: "fixedCount", iterationCount: 3, loopActionType: "fill", maxIterations: 100, loopStopOnFailure: true }
    },
    { id: "end", type: "end", name: "End" }
  ],
  successChain("loop", ["start", "goto", "loop", "end"])
);

const conditionalFlow = {
  id: "mock-conditional-flow",
  name: "Mock — Conditional Branch Flow",
  description: "Branches by runtime input `path`: 'A' fills FromA, otherwise FromB.",
  version: 1,
  createdAt: now,
  updatedAt: now,
  nodes: [
    { id: "start", type: "start", name: "Start" },
    { id: "goto", type: "goto", name: "Open Login", url: `${BASE}/login`, valueSource: staticValue(`${BASE}/login`) },
    { id: "cond", type: "condition", name: "Check Path", value: "${runtimeInputs.path} === 'A'" },
    { id: "fillA", type: "fill", name: "Fill A", locator: { strategy: "id", value: "username" }, valueSource: staticValue("FromA") },
    { id: "fillB", type: "fill", name: "Fill B", locator: { strategy: "id", value: "username" }, valueSource: staticValue("FromB") },
    { id: "end", type: "end", name: "End" }
  ],
  edges: [
    { id: "c-e0", source: "start", target: "goto", type: "success" },
    { id: "c-e1", source: "goto", target: "cond", type: "success" },
    { id: "c-e2", source: "cond", target: "fillA", type: "conditional", condition: { expression: "${runtimeInputs.path} === 'A'" } },
    { id: "c-e3", source: "cond", target: "fillB", type: "failure" },
    { id: "c-e4", source: "fillA", target: "end", type: "success" },
    { id: "c-e5", source: "fillB", target: "end", type: "success" }
  ]
};

const runAnotherFlow = flow(
  "mock-run-another-flow",
  "Mock — Run Another Flow",
  "Calls the Mock Login Flow via a Run Another Flow node (recursion-guarded).",
  [
    { id: "start", type: "start", name: "Start" },
    { id: "child", type: "runFlow", name: "Run Login Flow", flowId: "mock-login-flow", config: { targetFlowId: "mock-login-flow", stopParentOnChildFailure: true } },
    { id: "end", type: "end", name: "End" }
  ],
  successChain("child", ["start", "child", "end"])
);

const assertionFailFlow = {
  id: "mock-assertion-fail-flow",
  name: "Mock — Assertion Failure + Recovery Flow",
  description: "Intentionally failing assertion routed via a failure connector to a recovery screenshot.",
  version: 1,
  createdAt: now,
  updatedAt: now,
  nodes: [
    { id: "start", type: "start", name: "Start" },
    { id: "goto", type: "goto", name: "Open Login", url: `${BASE}/login`, valueSource: staticValue(`${BASE}/login`) },
    {
      id: "assert",
      type: "assertText",
      name: "Assert (will fail)",
      locator: { strategy: "id", value: "successMessage" },
      timeoutMs: 1000,
      onFailure: { action: "goToFailureEdge", screenshot: false },
      config: { assertionType: "text", comparisonOperator: "equals", expectedValue: "definitely-not-present" }
    },
    { id: "recover", type: "screenshot", name: "Recovery Screenshot", config: { fullPage: true, screenshotName: "failure-recovery" } },
    { id: "end", type: "end", name: "End" }
  ],
  edges: [
    { id: "a-e0", source: "start", target: "goto", type: "success" },
    { id: "a-e1", source: "goto", target: "assert", type: "success" },
    { id: "a-e2", source: "assert", target: "recover", type: "failure" },
    { id: "a-e3", source: "recover", target: "end", type: "success" }
  ]
};

const routeChangeFlow = flow(
  "mock-route-change-flow",
  "Mock — Route Change (new tab) Flow",
  "Opens /details in a new tab, switches the active page to it, fills a field and asserts the result.",
  [
    { id: "start", type: "start", name: "Start" },
    { id: "goto", type: "goto", name: "Open Form", url: `${BASE}/form`, valueSource: staticValue(`${BASE}/form`) },
    { id: "open", type: "click", name: "Open Details In New Tab", locator: { strategy: "id", value: "openNewTabButton" } },
    { id: "route", type: "routeChange", name: "Switch To Details Tab", config: { routeMode: "switchToLatestTab", urlMatch: "contains", routeWaitUntil: "load" }, timeoutMs: 10000 },
    { id: "fill", type: "fill", name: "Fill Reference", locator: { strategy: "id", value: "routeChangeTargetInput" }, valueSource: staticValue("REF-123") },
    { id: "save", type: "click", name: "Save Reference", locator: { strategy: "id", value: "routeChangeTargetSubmit" } },
    { id: "assert", type: "assertText", name: "Assert Result", locator: { strategy: "id", value: "routeChangeResult" }, config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "REF-123" } },
    { id: "shot", type: "screenshot", name: "Capture Details", config: { fullPage: true, screenshotName: "route-change" } },
    { id: "end", type: "end", name: "End" }
  ],
  successChain("rc", ["start", "goto", "open", "route", "fill", "save", "assert", "shot", "end"])
);

const flows = [
  loginFlow, fillFormFlow, screenshotFlow, scrollFlow, uploadFlow, waitFlow,
  loopFlow, conditionalFlow, runAnotherFlow, assertionFailFlow, routeChangeFlow
];

// ── Workflow fixtures ─────────────────────────────────────────────────────────
const wfNode = (flowId, order, required = true, alias) => ({
  id: flowId,
  type: "flowRef",
  flowId,
  alias: alias ?? flowId,
  order,
  required,
  inputBindings: {},
  retryPolicy: { count: 0, delayMs: 1000 },
  failurePolicy: "stop",
  position: { x: 140 + (order - 1) * 320, y: 180 }
});
const wfEdge = (id, source, target, type) => ({ id, source, target, type });
const workflow = (id, name, description, nodes, edges, extra = {}) => ({
  id, name, description, version: 1, createdAt: now, updatedAt: now,
  nodes, edges,
  runtimeInputs: [{ key: "path", label: "Branch Path", type: "dropdown", required: false, options: ["A", "B"] }],
  execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true },
  ...extra
});

const simpleWorkflow = workflow(
  "mock-simple-workflow",
  "Mock — Simple Workflow",
  "Login → Fill Form → Screenshot (sequential success path).",
  [wfNode("mock-login-flow", 1), wfNode("mock-fill-form-flow", 2), wfNode("mock-screenshot-flow", 3, false)],
  [wfEdge("sw-1", "mock-login-flow", "mock-fill-form-flow", "success"), wfEdge("sw-2", "mock-fill-form-flow", "mock-screenshot-flow", "success")]
);

const failureWorkflow = workflow(
  "mock-failure-handling-workflow",
  "Mock — Failure Handling Workflow",
  "Login → failing assertion → (failure connector) → recovery screenshot.",
  [wfNode("mock-login-flow", 1), wfNode("mock-assertion-fail-flow", 2), wfNode("mock-screenshot-flow", 3, false)],
  [
    wfEdge("fw-1", "mock-login-flow", "mock-assertion-fail-flow", "success"),
    wfEdge("fw-2", "mock-assertion-fail-flow", "mock-screenshot-flow", "failure")
  ]
);

const dataDrivenWorkflow = workflow(
  "mock-data-driven-workflow",
  "Mock — Data-Driven Workflow",
  "Login → Fill Form, bound to the Mock Users data source for per-row runs.",
  [wfNode("mock-login-flow", 1), wfNode("mock-fill-form-flow", 2)],
  [wfEdge("dw-1", "mock-login-flow", "mock-fill-form-flow", "success")],
  { dataSource: { dataSourceId: "mock-users", rootArrayPath: "$" } }
);

const routeChangeWorkflow = workflow(
  "mock-route-change-workflow",
  "Mock — Route Change Workflow",
  "Login → Route Change flow (open new tab, switch context, validate result).",
  [wfNode("mock-login-flow", 1), wfNode("mock-route-change-flow", 2)],
  [wfEdge("rcw-1", "mock-login-flow", "mock-route-change-flow", "success")]
);

const workflows = [simpleWorkflow, failureWorkflow, dataDrivenWorkflow, routeChangeWorkflow];

// ── Paths ─────────────────────────────────────────────────────────────────────
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const runtimeRoot = path.join(process.env.LOCALAPPDATA || os.homedir(), "WebFlow Studio");

let flowsDir = path.join(runtimeRoot, "flows");
let workflowsDir = path.join(runtimeRoot, "workflows");
let dataDir = path.join(runtimeRoot, "data");
try {
  const settings = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "storage", "ui-settings.json"), "utf8"));
  if (settings.paths?.flowsPath) flowsDir = settings.paths.flowsPath;
  if (settings.paths?.workflowsPath) workflowsDir = settings.paths.workflowsPath;
  if (settings.paths?.dataSourcesPath) dataDir = settings.paths.dataSourcesPath;
} catch {
  /* use defaults */
}
const dataFilesDir = path.join(dataDir, "files");

const fixturesRoot = path.join(repoRoot, "resources", "test-fixtures", "mock-site");

// ── Write ─────────────────────────────────────────────────────────────────────
const writeJson = (dir, name, value) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

// 1) Inspectable fixtures under resources/test-fixtures/mock-site/
for (const f of flows) writeJson(path.join(fixturesRoot, "flows"), `${f.id}.json`, f);
for (const w of workflows) writeJson(path.join(fixturesRoot, "workflows"), `${w.id}.json`, w);
writeJson(path.join(fixturesRoot, "data-sources"), "mock-users.json", mockUsers);

// 2) Seed into the runtime userData folders (explicit, dev-only)
for (const f of flows) writeJson(flowsDir, `${f.id}.json`, f);
for (const w of workflows) writeJson(workflowsDir, `${w.id}.json`, w);

const mockUsersFile = path.join(dataFilesDir, "mock-users.json");
writeJson(dataFilesDir, "mock-users.json", mockUsers);
writeJson(dataDir, "mock-users.json", {
  id: "mock-users",
  name: "Mock Users (test)",
  type: "jsonArray",
  file: mockUsersFile,
  path: "$",
  createdAt: now,
  updatedAt: now,
  rowCount: mockUsers.length,
  sampleRow: mockUsers[0]
});

console.log(`Seeded ${flows.length} flows, ${workflows.length} workflows, 1 data source.`);
console.log(`  flows      → ${flowsDir}`);
console.log(`  workflows  → ${workflowsDir}`);
console.log(`  data       → ${dataDir} (data file: ${mockUsersFile})`);
console.log(`  fixtures   → ${fixturesRoot}`);
console.log(`Start the mock site first:  npm run mock-site  (default ${BASE})`);
