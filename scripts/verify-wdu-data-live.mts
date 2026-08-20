/**
 * WebDriverUniversity LIVE **data, persistence and report** acceptance suite (`awkit-9fvb`).
 *
 * The first tranche parameterised a flow's shape over two credential records in the harness and was
 * careful to call that authoring rather than data binding. Three matrix columns stayed `NOT RUN` as
 * a result: Data, Persist and Report. This closes all three against the live site.
 *
 * Everything here goes through product paths. Rows come from a real `JsonArrayDataSourceProfile` on
 * disk, resolved into a `ResolvedDataSource`; instances are created by `InstanceManager` in
 * `dataDrivenConcurrent` mode; execution is `ExecutionEngine.startRun`; reports are the
 * `ConcurrentRunReport` the engine itself writes to disk. No loop in this file stands in for the
 * product's row iteration — the check that the engine created one instance per row, each bound to
 * its own row, is the point.
 *
 * THIS IS AN EXTERNAL-SITE GATE, like `verify:wdu-live` and `verify:wdu-recorder-live`. It needs the
 * public internet and is deliberately NOT part of AWKIT's deterministic verification set.
 *
 * Run with: npx tsx scripts/verify-wdu-data-live.mts [--only <substring>]
 */
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import { InstanceManager, type StorageDirs } from "@src/instances/InstanceManager";
import { JsonProfileStore } from "@src/storage/ProfileStore";
import { workflowToScenarioProfile } from "@src/profiles/WorkflowProfile";
import { validateFlowDefinition, errorsOf } from "@src/validation/FlowValidator";
import { materializeDataSourceRows, type ResolvedDataSource } from "@src/runner/InstanceExecutionContext";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { JsonArrayDataSourceProfile } from "@src/data/DataSourceProfile";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";

const BASE = "https://webdriveruniversity.com";
const CONTACT = `${BASE}/Contact-Us/contactus.html`;
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;

type Outcome = "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE";
interface CaseResult {
  id: string;
  challenge: string;
  scenario: string;
  outcome: Outcome;
  checks: { label: string; ok: boolean; detail?: string }[];
}
const results: CaseResult[] = [];
let current: CaseResult | null = null;

function check(label: string, condition: unknown, detail?: string): void {
  const ok = Boolean(condition);
  const line = `${ok ? "  ✓" : "  ✗"} ${label}${!ok && detail ? ` — ${String(detail).slice(0, 300)}` : ""}`;
  if (ok) console.log(line);
  else console.error(line);
  current?.checks.push({ label, ok, detail: ok ? undefined : String(detail ?? "").slice(0, 300) });
}

function open(id: string, challenge: string, scenario: string): boolean {
  if (only && !`${id} ${challenge} ${scenario}`.toLowerCase().includes(only.toLowerCase())) return false;
  current = { id, challenge, scenario, outcome: "PASS", checks: [] };
  console.log(`\n${id} — ${challenge} / ${scenario}`);
  return true;
}

function close(): void {
  if (!current) return;
  if (current.checks.some((c) => !c.ok)) current.outcome = "FAIL";
  if (current.checks.length === 0) current.outcome = "INCONCLUSIVE";
  results.push(current);
  current = null;
}

/**
 * The five data cases the acceptance scope requires, as one JSON array a Data Source can point at.
 *
 * `expected` is what the SITE should say for that row, and it is read at run time through a
 * `currentRow` value source — so the assertion itself is data-bound, not just the input.
 */
const ROWS = [
  { label: "valid", first: "Specter", last: "Studio", email: "valid.row@example.com", comments: "Row 1 — a complete, valid submission.", expected: "Thank You for your Message!" },
  { label: "invalid-email", first: "Specter", last: "Studio", email: "not-an-email", comments: "Row 2 — MEASURED: the site rejects a malformed address with its own message.", expected: "Error: Invalid email address" },
  { label: "empty-mandatory", first: "Specter", last: "", email: "", comments: "Row 3 — mandatory fields left empty.", expected: "Error: all fields are required" },
  { label: "boundary-long", first: "S".repeat(120), last: "T".repeat(120), email: "boundary.row@example.com", comments: "Row 4 — 120-character boundary values.", expected: "Thank You for your Message!" },
  { label: "empty-comments", first: "Specter", last: "Studio", email: "row5@example.com", comments: "", expected: "Error: all fields are required" }
];

const linear = (id: string, steps: FlowStep[]): FlowProfile => {
  const nodes: FlowStep[] = [{ id: "start", type: "start", name: "start" }, ...steps, { id: "end", type: "end", name: "end" }];
  const ids = nodes.map((n) => n.id);
  return {
    id,
    name: id,
    version: 1,
    nodes,
    edges: ids.slice(0, -1).map((source, i) => ({ id: `${id}-e${i}`, source, target: ids[i + 1], type: "success" as const }))
  };
};

/** The data-driven Contact Us flow. Every input AND the assertion read from the current row. */
function contactFlow(id: string): FlowProfile {
  const fill = (stepId: string, name: string, path: string): FlowStep => ({
    id: stepId,
    type: "fill",
    name,
    locator: { strategy: "css", value: `[name='${name}']` },
    valueSource: { type: "currentRow", path }
  });
  return linear(id, [
    { id: "goto", type: "goto", name: "open Contact Us", valueSource: { type: "static", value: CONTACT }, waitUntil: "domcontentloaded" },
    fill("first", "first_name", "$.first"),
    fill("last", "last_name", "$.last"),
    fill("email", "email", "$.email"),
    {
      id: "comments",
      type: "fill",
      name: "message",
      locator: { strategy: "css", value: "textarea[name='message']" },
      valueSource: { type: "currentRow", path: "$.comments" }
    },
    { id: "submit", type: "click", name: "submit", locator: { strategy: "css", value: "input[type='submit']" } },
    {
      id: "outcome",
      type: "assertText",
      name: "the site's response matches this row's expectation",
      locator: { strategy: "css", value: "body" },
      // The EXPECTATION is bound to the row too, so one flow expresses both the accepted and the
      // rejected case without the harness deciding which is which.
      valueSource: { type: "currentRow", path: "$.expected" },
      config: { assertionType: "text", comparisonOperator: "contains" },
      timeoutMs: 20_000
    }
  ]);
}

async function ensureDirs(dirs: string[]): Promise<void> {
  for (const d of dirs) await mkdir(d, { recursive: true });
}

interface RunOutcome {
  report: ConcurrentRunReport;
  reportPath: string;
  instances: ReturnType<ExecutionEngine["getInstances"]>;
  maxConcurrentObserved: number;
}

/** Drive one data-driven run through the real engine and read back the report it wrote. */
async function runDataDriven(options: {
  executionId: string;
  workflow: WorkflowProfile;
  flows: FlowProfile[];
  rows: unknown[];
  dataSource: ResolvedDataSource;
  maxConcurrentInstances: number;
  root: string;
}): Promise<RunOutcome> {
  const dirs: StorageDirs = {
    root: options.root,
    downloads: join(options.root, "downloads"),
    screenshots: join(options.root, "screenshots"),
    logs: join(options.root, "logs"),
    reports: join(options.root, "reports")
  };
  await ensureDirs(Object.values(dirs));

  const scenario = workflowToScenarioProfile(options.workflow);
  const profile: ConcurrentRunProfile = {
    id: `wdu-data-${options.executionId}`,
    scenarioId: scenario.id,
    runMode: "dataDrivenConcurrent",
    maxConcurrentInstances: options.maxConcurrentInstances,
    browserWindowMode: "headless",
    instanceTemplate: { browser: "chromium", headless: true, isolationMode: "browserContext", timeoutMs: 45_000 },
    resourceControls: { maxBrowserContextsPerProcess: 1, delayBetweenInstanceStartsMs: 0 },
    failurePolicy: { stopAllOnCriticalFailure: false, continueOtherInstancesOnFailure: true, retryFailedInstance: false, retryCount: 0 }
  };

  const engine = new ExecutionEngine();
  engine.configureConcurrency({
    maxBrowsersPerHost: Math.max(2, options.maxConcurrentInstances),
    maxActiveFlows: Math.max(2, options.maxConcurrentInstances),
    useSharedBrowserPool: false,
    workloadWeights: false
  });

  let maxConcurrentObserved = 0;
  await engine.startRun(
    options.executionId,
    profile,
    options.rows,
    dirs,
    {},
    scenario,
    options.flows,
    options.dataSource,
    { [options.dataSource.id]: options.dataSource }
  );

  const deadline = Date.now() + 300_000;
  let instances = engine.getInstances().filter((i) => i.executionId === options.executionId);
  while (Date.now() < deadline) {
    instances = engine.getInstances().filter((i) => i.executionId === options.executionId);
    maxConcurrentObserved = Math.max(
      maxConcurrentObserved,
      instances.filter((i) => i.status === "starting" || i.status === "running").length
    );
    if (instances.length === options.rows.length && instances.every((i) => ["completed", "failed", "cancelled"].includes(i.status))) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  // The engine writes the run report on completion; give the final write a moment to land.
  const reportPath = join(dirs.reports, options.executionId, "report.json");
  for (let i = 0; i < 60; i += 1) {
    try {
      const raw = await readFile(reportPath, "utf8");
      return { report: JSON.parse(raw) as ConcurrentRunReport, reportPath, instances, maxConcurrentObserved };
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`no run report was written at ${reportPath}`);
}

async function main(): Promise<void> {
  const started = Date.now();
  const root = await mkdtemp(join(tmpdir(), "wdu-data-"));

  // ── A real Data Source profile on disk, exactly as the product stores one ────────────────────
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const dataFile = join(dataDir, "wdu-contact-rows.json");
  await writeFile(dataFile, JSON.stringify({ contacts: ROWS }, null, 2), "utf8");

  const dataSourceProfile: JsonArrayDataSourceProfile = {
    id: "wdu-contact-rows",
    name: "WDU Contact Us rows",
    type: "jsonArray",
    file: dataFile,
    path: "$.contacts",
    rowCount: ROWS.length
  };
  const dataSourceStore = new JsonProfileStore<JsonArrayDataSourceProfile>({ folder: join(root, "datasources") });
  await dataSourceStore.create(dataSourceProfile);

  const flowStore = new JsonProfileStore<FlowProfile>({ folder: join(root, "flows") });
  const workflowStore = new JsonProfileStore<WorkflowProfile>({ folder: join(root, "workflows") });

  let sharedReport: ConcurrentRunReport | undefined;
  let sharedReportPath = "";

  try {
    // ══ [D] The Data Source drives the run ═══════════════════════════════════════════════════
    if (open("WDU-D01", "Contact Us", "a saved Data Source drives one execution instance per row")) {
      const reloadedSource = await dataSourceStore.get("wdu-contact-rows");
      check("[D1] the Data Source profile saves and reloads", reloadedSource?.file === dataFile && reloadedSource?.path === "$.contacts", JSON.stringify(reloadedSource));

      const raw = JSON.parse(await readFile(reloadedSource!.file, "utf8")) as { contacts: unknown[] };
      const resolved: ResolvedDataSource = {
        id: reloadedSource!.id,
        name: reloadedSource!.name,
        file: reloadedSource!.file,
        rootArrayPath: reloadedSource!.path,
        rows: raw.contacts,
        type: "jsonArray"
      };
      const rows = await materializeDataSourceRows(resolved);
      check("[D2] the product materialises every row from the source", rows.length === ROWS.length, `${rows.length} rows`);

      // The engine's own instance planner, not a loop in this file.
      const planner = new InstanceManager();
      const planned = planner.createInstancesForRun(
        {
          id: "plan",
          scenarioId: "plan",
          runMode: "dataDrivenConcurrent",
          maxConcurrentInstances: 2,
          browserWindowMode: "headless",
          instanceTemplate: { browser: "chromium", headless: true, isolationMode: "browserContext" },
          resourceControls: { maxBrowserContextsPerProcess: 1, delayBetweenInstanceStartsMs: 0 },
          failurePolicy: { stopAllOnCriticalFailure: false, continueOtherInstancesOnFailure: true, retryFailedInstance: false, retryCount: 0 }
        } as ConcurrentRunProfile,
        rows,
        { root, downloads: root, screenshots: root, logs: root, reports: root },
        {}
      );
      check("[D3] one instance is planned per row", planned.length === ROWS.length, String(planned.length));
      check("[D4] each instance carries its OWN row, in order", planned.every((inst, i) => (inst.currentDataRow as { label?: string })?.label === ROWS[i].label), JSON.stringify(planned.map((p) => (p.currentDataRow as { label?: string })?.label)));
      check("[D5] each instance records which row index it is", planned.every((inst, i) => inst.currentDataRowIndex === i), JSON.stringify(planned.map((p) => p.currentDataRowIndex)));
      close();
    }

    // ══ [E] Execute the data-driven workflow for real ════════════════════════════════════════
    if (open("WDU-D02", "Contact Us", "five data rows execute against the live site, each asserting its own expectation")) {
      const flow = contactFlow("wdu-data-contact");
      await flowStore.create(flow);
      check("[E1] the data-bound flow passes preflight validation", errorsOf(validateFlowDefinition(flow)).length === 0, JSON.stringify(errorsOf(validateFlowDefinition(flow)).map((i) => i.code)));

      const workflow: WorkflowProfile = {
        id: "wdu-data-workflow",
        name: "WDU Contact Us — data driven",
        version: 1,
        dataSource: { dataSourceId: "wdu-contact-rows", rootArrayPath: "$.contacts" },
        nodes: [
          { id: "start", type: "start", alias: "Start", order: 0 },
          { id: "n1", type: "flowRef", flowId: flow.id, alias: "Submit contact form", order: 1, required: true, inputBindings: {}, dataSourceId: "wdu-contact-rows", jsonPath: "$.contacts" },
          { id: "end", type: "end", alias: "End", order: 2 }
        ],
        edges: [
          { id: "e1", source: "start", target: "n1", type: "always" },
          { id: "e2", source: "n1", target: "end", type: "always" }
        ],
        runtimeInputs: [],
        execution: { mode: "sequential", maxConcurrentInstances: 2, stopOnRequiredFlowFailure: false }
      };
      await workflowStore.create(workflow);

      const resolved: ResolvedDataSource = {
        id: dataSourceProfile.id,
        name: dataSourceProfile.name,
        file: dataFile,
        rootArrayPath: "$.contacts",
        rows: ROWS,
        type: "jsonArray"
      };
      const outcome = await runDataDriven({
        executionId: "wdu-data-concurrent",
        workflow,
        flows: [flow],
        rows: ROWS,
        dataSource: resolved,
        maxConcurrentInstances: 2,
        root: join(root, "run-concurrent")
      });
      sharedReport = outcome.report;
      sharedReportPath = outcome.reportPath;

      check("[E2] the engine ran one instance per row", outcome.instances.length === ROWS.length, String(outcome.instances.length));
      check("[E3] every instance reached a terminal state", outcome.instances.every((i) => ["completed", "failed", "cancelled"].includes(i.status)), JSON.stringify(outcome.instances.map((i) => i.status)));
      check(
        "[E4] every row passed its OWN expectation — accepted and rejected alike",
        outcome.report.instances.every((i) => i.status === "passed"),
        JSON.stringify(outcome.report.instances.map((i) => `${i.currentDataRowIndex}:${i.status}:${i.error ?? ""}`))
      );
      check("[E5] the run is reported as passed overall", outcome.report.status === "passed", outcome.report.status);
      check("[E6] more than one instance genuinely ran at once", outcome.maxConcurrentObserved >= 2, `max observed ${outcome.maxConcurrentObserved}`);
      close();
    }

    // ══ [R] The report says what actually happened ═══════════════════════════════════════════
    if (open("WDU-D03", "Contact Us", "the run report carries semantic execution evidence, not just a file")) {
      if (!sharedReport) {
        check("[R0] a report from the data-driven run is available", false, "the earlier case did not run");
        close();
      } else {
        const r = sharedReport;
        check("[R1] the report names the workflow", r.scenarioName === "WDU Contact Us — data driven", r.scenarioName);
        check("[R2] ...and its id", r.scenarioId === "wdu-data-workflow", r.scenarioId);
        check("[R3] the execution id is the one that ran", r.executionId === "wdu-data-concurrent", r.executionId);
        check("[R4] the run mode records that it was data driven", r.runMode === "dataDrivenConcurrent", r.runMode);
        check("[R5] start and end timestamps are real and ordered", Date.parse(r.startedAt) > 0 && Date.parse(r.endedAt) >= Date.parse(r.startedAt), `${r.startedAt} → ${r.endedAt}`);
        check("[R6] the duration matches the timestamps", r.durationMs === Date.parse(r.endedAt) - Date.parse(r.startedAt) && r.durationMs > 0, String(r.durationMs));
        check("[R7] every instance appears", r.instances.length === ROWS.length, String(r.instances.length));
        check(
          "[R8] each instance is identified, and by its DATA ROW",
          r.instances.every((i) => !!i.instanceId) &&
            [...new Set(r.instances.map((i) => i.currentDataRowIndex))].length === ROWS.length,
          JSON.stringify(r.instances.map((i) => ({ id: i.instanceId, row: i.currentDataRowIndex })))
        );
        check("[R9] each instance reports its own duration", r.instances.every((i) => typeof i.durationMs === "number" && i.durationMs >= 0), JSON.stringify(r.instances.map((i) => i.durationMs)));

        const flowResults = r.instances.flatMap((i) => i.scenarioResult?.flows ?? []);
        check("[R10] the flow that ran is named in the report", flowResults.length === ROWS.length && flowResults.every((f) => f.flowId === "wdu-data-contact"), JSON.stringify(flowResults.map((f) => f.flowId)));
        const steps = flowResults.flatMap((f) => f.steps ?? []);
        check("[R11] every step of every instance has a recorded result", steps.length >= ROWS.length * 6 && steps.every((s) => !!s.status), `${steps.length} steps`);
        check("[R12] the assertion step is among them and passed", steps.filter((s) => s.stepId === "outcome").length === ROWS.length && steps.filter((s) => s.stepId === "outcome").every((s) => s.status === "passed"), JSON.stringify(steps.filter((s) => s.stepId === "outcome").map((s) => s.status)));
        check("[R13] passed/failed flow counts are tallied", r.passedFlows === ROWS.length && r.failedFlows === 0, `${r.passedFlows} passed / ${r.failedFlows} failed`);
        check("[R14] the report is on disk where the run said it would be", sharedReportPath.endsWith(join("wdu-data-concurrent", "report.json")), sharedReportPath);

        // Rows are identified by INDEX, and deliberately not by echoing what they contained. A data
        // source routinely holds names, addresses and account numbers, and a run report is the
        // artifact most likely to be shared — so this is a property to protect, not a gap to close.
        // [R8] already proves a reader can tell the rows apart; [N3] proves a reader can tell WHICH
        // row failed.
        const serialized = JSON.stringify(r);
        check(
          "[R15] the report does not echo the rows' own field values",
          !serialized.includes("valid.row@example.com") && !serialized.includes("boundary.row@example.com"),
          "a row payload leaked into the run report"
        );
        close();
      }
    }

    // ══ [N] A deliberate failure, reported truthfully ════════════════════════════════════════
    if (open("WDU-D04", "Contact Us", "negative report case — a wrong expectation fails, and says where")) {
      // ONE row, deliberately expecting the wrong outcome. The site behaves correctly; the FLOW is
      // wrong, and the report must say so against the assertion step rather than blaming navigation.
      // TWO rows, only the second carrying a wrong expectation. One row could not show whether the
      // report actually pinpoints a row or merely reports that something in the run failed.
      const wrongRows = [
        { label: "correct-expectation", first: "Specter", last: "Studio", email: "negative.ok@example.com", comments: "Negative control — this row is correct.", expected: "Thank You for your Message!" },
        { label: "wrong-expectation", first: "Specter", last: "Studio", email: "negative.bad@example.com", comments: "Negative control — this row expects text the page never shows.", expected: "This text is not on the page" }
      ];
      const flow = contactFlow("wdu-data-negative");
      const workflow: WorkflowProfile = {
        id: "wdu-data-negative-workflow",
        name: "WDU Contact Us — negative control",
        version: 1,
        dataSource: { dataSourceId: "wdu-contact-rows", rootArrayPath: "$.contacts" },
        nodes: [
          { id: "start", type: "start", alias: "Start", order: 0 },
          { id: "n1", type: "flowRef", flowId: flow.id, alias: "Submit contact form", order: 1, required: true, inputBindings: {} },
          { id: "end", type: "end", alias: "End", order: 2 }
        ],
        edges: [
          { id: "e1", source: "start", target: "n1", type: "always" },
          { id: "e2", source: "n1", target: "end", type: "always" }
        ],
        runtimeInputs: [],
        execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: false }
      };
      const resolved: ResolvedDataSource = { id: "wdu-contact-rows", name: "neg", file: dataFile, rootArrayPath: "$.contacts", rows: wrongRows, type: "jsonArray" };
      const outcome = await runDataDriven({
        executionId: "wdu-data-negative",
        workflow,
        flows: [flow],
        rows: wrongRows,
        dataSource: resolved,
        maxConcurrentInstances: 1,
        root: join(root, "run-negative")
      });

      check("[N1] the run is reported as failed", outcome.report.status === "failed", outcome.report.status);
      check("[N1b] ...while the row that was right still passed", outcome.report.instances.filter((i) => i.status === "passed").length === 1, JSON.stringify(outcome.report.instances.map((i) => `${i.currentDataRowIndex}:${i.status}`)));
      const instance = outcome.report.instances.find((i) => i.status === "failed");
      check("[N2] the failing instance is identified", !!instance, JSON.stringify(outcome.report.instances.map((i) => i.status)));
      check("[N3] ...and the report pinpoints WHICH row it was", instance?.currentDataRowIndex === 1, String(instance?.currentDataRowIndex));
      const steps = instance?.scenarioResult?.flows.flatMap((f) => f.steps ?? []) ?? [];
      check("[N3b] the two instances are distinguishable in the report", new Set(outcome.report.instances.map((i) => i.instanceId)).size === 2, JSON.stringify(outcome.report.instances.map((i) => i.instanceId)));
      const failing = steps.filter((s) => s.status === "failed");
      check("[N4] exactly one step failed", failing.length === 1, JSON.stringify(steps.map((s) => `${s.stepId}:${s.status}`)));
      check("[N5] the report names the failing step", failing[0]?.stepId === "outcome", failing[0]?.stepId);
      check("[N6] ...and quotes the assertion that failed", /Assertion failed/.test(String(failing[0]?.error ?? "")), String(failing[0]?.error));
      check(
        "[N7] the error reports what the SITE actually said, so a flow bug is distinguishable from an engine one",
        /Thank You for your Message/.test(String(failing[0]?.error ?? "")),
        String(failing[0]?.error)
      );
      check("[N8] the steps BEFORE the assertion are reported as passed, not swept into the failure", steps.filter((s) => s.stepId === "submit").every((s) => s.status === "passed"), JSON.stringify(steps.map((s) => `${s.stepId}:${s.status}`)));
      check("[N9] the failed-flow tally is right", outcome.report.failedFlows === 1 && outcome.report.passedFlows === 1, `${outcome.report.passedFlows} passed / ${outcome.report.failedFlows} failed`);
      close();
    }

    // ══ [P] Persistence round trip for the data-bound assets ═════════════════════════════════
    if (open("WDU-D05", "Contact Us", "create → bind → save → reload → edit mapping → re-save → execute")) {
      const reloadedFlow = await flowStore.get("wdu-data-contact");
      check("[P1] the data-bound flow reloads", !!reloadedFlow, "flow store returned null");
      const boundStep = reloadedFlow?.nodes.find((n) => n.id === "email");
      check("[P2] the row binding survives save → reload", boundStep?.valueSource?.type === "currentRow" && boundStep?.valueSource?.path === "$.email", JSON.stringify(boundStep?.valueSource));
      const assertionStep = reloadedFlow?.nodes.find((n) => n.id === "outcome");
      check("[P3] the data-bound ASSERTION survives too", assertionStep?.valueSource?.type === "currentRow" && assertionStep?.valueSource?.path === "$.expected", JSON.stringify(assertionStep?.valueSource));

      const reloadedWorkflow = await workflowStore.get("wdu-data-workflow");
      check("[P4] the workflow reloads with its data source binding", reloadedWorkflow?.dataSource?.dataSourceId === "wdu-contact-rows" && reloadedWorkflow?.dataSource?.rootArrayPath === "$.contacts", JSON.stringify(reloadedWorkflow?.dataSource));
      const flowNode = reloadedWorkflow?.nodes.find((n) => n.type === "flowRef");
      check("[P5] the workflow's flow reference survives", (flowNode as { flowId?: string } | undefined)?.flowId === "wdu-data-contact", JSON.stringify(flowNode));

      // A legitimate mapping EDIT: point the comments field at a different column.
      const edited: FlowProfile = {
        ...(reloadedFlow as FlowProfile),
        nodes: (reloadedFlow as FlowProfile).nodes.map((n) => (n.id === "comments" ? { ...n, valueSource: { type: "currentRow" as const, path: "$.label" } } : n))
      };
      await flowStore.update("wdu-data-contact", edited);
      const reEdited = await flowStore.get("wdu-data-contact");
      const editedStep = reEdited?.nodes.find((n) => n.id === "comments");
      check("[P6] an edited mapping re-saves and reloads", editedStep?.valueSource?.path === "$.label", JSON.stringify(editedStep?.valueSource));
      check("[P7] ...without disturbing the other bindings", reEdited?.nodes.find((n) => n.id === "email")?.valueSource?.path === "$.email", JSON.stringify(reEdited?.nodes.find((n) => n.id === "email")?.valueSource));
      check("[P8] no step lost its locator in the round trip", reEdited?.nodes.filter((n) => n.type === "fill").every((n) => !!n.locator), JSON.stringify(reEdited?.nodes.filter((n) => n.type === "fill").map((n) => n.locator)));

      // Export → import → re-execute, through the store's own export/import.
      const exported = await flowStore.export("wdu-data-contact");
      check("[P9] the flow exports with its bindings intact", exported.nodes.find((n) => n.id === "email")?.valueSource?.type === "currentRow", JSON.stringify(exported.nodes.find((n) => n.id === "email")?.valueSource));
      const importStore = new JsonProfileStore<FlowProfile>({ folder: join(root, "flows-imported") });
      const imported = await importStore.import({ ...exported, id: "wdu-data-contact-imported" });
      check("[P10] it imports into a fresh store", imported.id === "wdu-data-contact-imported");
      const reloadedImport = await importStore.get("wdu-data-contact-imported");
      check(
        "[P11] the imported copy is semantically identical, not just present",
        JSON.stringify(reloadedImport?.nodes.map((n) => ({ t: n.type, l: n.locator, v: n.valueSource, c: n.config }))) ===
          JSON.stringify(exported.nodes.map((n) => ({ t: n.type, l: n.locator, v: n.valueSource, c: n.config }))),
        "imported nodes differ from the exported ones"
      );

      // ...and it still runs. Restore the comments mapping first so the rows behave as designed.
      const restored: FlowProfile = {
        ...(reloadedImport as FlowProfile),
        nodes: (reloadedImport as FlowProfile).nodes.map((n) => (n.id === "comments" ? { ...n, valueSource: { type: "currentRow" as const, path: "$.comments" } } : n))
      };
      const workflow: WorkflowProfile = {
        id: "wdu-data-imported-workflow",
        name: "WDU Contact Us — imported",
        version: 1,
        dataSource: { dataSourceId: "wdu-contact-rows", rootArrayPath: "$.contacts" },
        nodes: [
          { id: "start", type: "start", alias: "Start", order: 0 },
          { id: "n1", type: "flowRef", flowId: restored.id, alias: "Submit contact form", order: 1, required: true, inputBindings: {} },
          { id: "end", type: "end", alias: "End", order: 2 }
        ],
        edges: [
          { id: "e1", source: "start", target: "n1", type: "always" },
          { id: "e2", source: "n1", target: "end", type: "always" }
        ],
        runtimeInputs: [],
        execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: false }
      };
      const twoRows = [ROWS[0], ROWS[2]];
      const resolved: ResolvedDataSource = { id: "wdu-contact-rows", name: "imported", file: dataFile, rootArrayPath: "$.contacts", rows: twoRows, type: "jsonArray" };
      const outcome = await runDataDriven({
        executionId: "wdu-data-imported",
        workflow,
        flows: [restored],
        rows: twoRows,
        dataSource: resolved,
        maxConcurrentInstances: 1,
        root: join(root, "run-imported")
      });
      check("[P12] the exported-then-imported flow still runs green against the live site", outcome.report.status === "passed", `${outcome.report.status}: ${JSON.stringify(outcome.report.instances.map((i) => i.error))}`);
      check("[P13] ...for both the accepted and the rejected row", outcome.report.instances.length === 2 && outcome.report.instances.every((i) => i.status === "passed"), JSON.stringify(outcome.report.instances.map((i) => i.status)));
      close();
    }

    // ══ [S] Sequential mode, and the execution history on disk ═══════════════════════════════
    if (open("WDU-D06", "Contact Us", "sequential execution and the run history the reports form")) {
      const flow = contactFlow("wdu-data-sequential");
      const workflow: WorkflowProfile = {
        id: "wdu-data-sequential-workflow",
        name: "WDU Contact Us — sequential",
        version: 1,
        dataSource: { dataSourceId: "wdu-contact-rows", rootArrayPath: "$.contacts" },
        nodes: [
          { id: "start", type: "start", alias: "Start", order: 0 },
          { id: "n1", type: "flowRef", flowId: flow.id, alias: "Submit contact form", order: 1, required: true, inputBindings: {} },
          { id: "end", type: "end", alias: "End", order: 2 }
        ],
        edges: [
          { id: "e1", source: "start", target: "n1", type: "always" },
          { id: "e2", source: "n1", target: "end", type: "always" }
        ],
        runtimeInputs: [],
        execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: false }
      };
      const rows = [ROWS[0], ROWS[2], ROWS[3]];
      const resolved: ResolvedDataSource = { id: "wdu-contact-rows", name: "seq", file: dataFile, rootArrayPath: "$.contacts", rows, type: "jsonArray" };
      const runRoot = join(root, "run-sequential");
      const outcome = await runDataDriven({
        executionId: "wdu-data-sequential",
        workflow,
        flows: [flow],
        rows,
        dataSource: resolved,
        maxConcurrentInstances: 1,
        root: runRoot
      });
      check("[S1] sequential mode runs every row", outcome.report.instances.length === rows.length, String(outcome.report.instances.length));
      check("[S2] ...and never more than one at a time", outcome.maxConcurrentObserved <= 1, `max observed ${outcome.maxConcurrentObserved}`);
      check("[S3] every row passed", outcome.report.instances.every((i) => i.status === "passed"), JSON.stringify(outcome.report.instances.map((i) => `${i.currentDataRowIndex}:${i.status}`)));
      check("[S4] row identity is preserved in sequential mode too", outcome.report.instances.map((i) => i.currentDataRowIndex).join(",") === "0,1,2", JSON.stringify(outcome.report.instances.map((i) => i.currentDataRowIndex)));

      const reportRoot = join(runRoot, "reports");
      const historyDirs = await readdir(reportRoot).catch(() => [] as string[]);
      check("[S5] the run leaves a report directory named for its execution", historyDirs.includes("wdu-data-sequential"), JSON.stringify(historyDirs));
      close();
    }
  } finally {
    // nothing to tear down: every engine is local to its run and every artifact is under a temp root
  }

  const tally = { PASS: 0, FAIL: 0, BLOCKED: 0, INCONCLUSIVE: 0 } as Record<Outcome, number>;
  for (const r of results) tally[r.outcome] += 1;
  const checks = results.flatMap((r) => r.checks);
  console.log("\n──────────────────────────────────────────────────────────────");
  console.log(`WDU DATA / PERSISTENCE / REPORTS — ${results.length} cases in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(`PASS ${tally.PASS} · FAIL ${tally.FAIL} · BLOCKED ${tally.BLOCKED} · INCONCLUSIVE ${tally.INCONCLUSIVE}`);
  console.log(`${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
  for (const r of results.filter((x) => x.outcome !== "PASS")) {
    console.log(`  ${r.outcome} ${r.id} — ${r.challenge} / ${r.scenario}`);
    for (const c of r.checks.filter((x) => !x.ok)) console.log(`      ✗ ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  await writeFile(join(process.cwd(), "wdu-data-results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), tally, results }, null, 2), "utf8");
  if (tally.FAIL > 0 || tally.INCONCLUSIVE > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
