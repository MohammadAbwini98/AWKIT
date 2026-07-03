/**
 * Live verification of the Playwright runner (Phase 6B) against the offline
 * mock-site. Run with: npx tsx scripts/verify-runner.mts
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { StepExecutor } from "@src/runner/StepExecutor";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import { PlaywrightRunner } from "@src/runner/PlaywrightRunner";
import { ScenarioOrchestrator } from "@src/orchestrator/ScenarioOrchestrator";
import { ManualHandoffController } from "@src/runner/ManualHandoffController";
import type { FlowExecutionResult } from "@src/runner/RunnerResult";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import type { Page } from "playwright";

function simpleFlow(id: string, steps: FlowStep[]): FlowProfile {
  const nodes: FlowStep[] = [{ id: "start", type: "start", name: "start" }, ...steps, { id: "end", type: "end", name: "end" }];
  const ids = nodes.map((n) => n.id);
  const edges = ids.slice(0, -1).map((source, i) => ({ id: `${id}-e${i}`, source, target: ids[i + 1], type: "success" as const }));
  return { id, name: id, version: 1, nodes, edges };
}

const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ok = (label: string, r: { status: string; error?: string }) => check(`${label} (passed)`, r.status === "passed", r.error);

async function makeContext(flowId = "flow-1"): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "wfs-runner-"));
  return {
    executionId: "exec-1",
    instanceId: "inst-1",
    scenarioId: "scen-1",
    flowId,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: {
      downloads: join(dir, "downloads"),
      screenshots: join(dir, "screenshots"),
      logs: join(dir, "logs"),
      reports: join(dir, "reports"),
      sessions: join(dir, "sessions")
    }
  };
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Mock site did not start");
}

async function main() {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore"
  });
  await waitForServer();
  const browser = await chromium.launch();

  try {
    // ── Core node types ──────────────────────────────────────────────────────
    console.log("Core node types:");
    const page = await browser.newPage();
    const context = await makeContext();
    const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(context), context);

    ok("goto", await exec.execute({ id: "goto", type: "goto", name: "goto", url: `${BASE}/login` }));
    ok("fill+clearBeforeFill", await exec.execute({ id: "u", type: "fill", name: "u", locator: { strategy: "id", value: "username" }, value: "tester", config: { clearBeforeFill: true } }));
    ok("fill", await exec.execute({ id: "p", type: "fill", name: "p", locator: { strategy: "id", value: "password" }, value: "secret" }));
    ok("check", await exec.execute({ id: "rm", type: "check", name: "rm", locator: { strategy: "id", value: "rememberMe" } }));
    ok("click", await exec.execute({ id: "login", type: "click", name: "login", locator: { strategy: "id", value: "loginButton" } }));
    await page.waitForURL("**/form");
    ok("wait(selector)", await exec.execute({ id: "wsel", type: "wait", name: "w", locator: { strategy: "id", value: "firstName" }, config: { waitType: "selector" } }));
    ok("fill firstName", await exec.execute({ id: "fn", type: "fill", name: "fn", locator: { strategy: "id", value: "firstName" }, value: "Alice" }));
    ok("select(index)", await exec.execute({ id: "country", type: "select", name: "c", locator: { strategy: "id", value: "country" }, selectionMode: "index", value: "1" }));
    ok("select(multiple)", await exec.execute({ id: "skills", type: "select", name: "s", locator: { strategy: "id", value: "skills" }, selectionMode: "index", value: "0,1", config: { selectMultiple: true } }));
    ok("radio", await exec.execute({ id: "gender", type: "radio", name: "g", locator: { strategy: "id", value: "genderMale" } }));
    ok("check terms", await exec.execute({ id: "terms", type: "check", name: "t", locator: { strategy: "id", value: "acceptTerms" } }));
    ok("assert value equals", await exec.execute({ id: "av", type: "assertText", name: "av", locator: { strategy: "id", value: "firstName" }, config: { assertionType: "value", comparisonOperator: "equals", expectedValue: "Alice" } }));
    ok("scroll(direction)", await exec.execute({ id: "sc", type: "scroll", name: "sc", config: { scrollDirection: "down", scrollAmount: 300 } }));

    const elShot = await exec.execute({ id: "shotEl", type: "screenshot", name: "shotEl", locator: { strategy: "id", value: "submitButton" }, config: { screenshotName: "submit" } });
    ok("screenshot(element)", elShot);
    check("element screenshot file exists", elShot.screenshotPath && existsSync(elShot.screenshotPath), elShot.screenshotPath);
    const fullShot = await exec.execute({ id: "shotFull", type: "screenshot", name: "shotFull", config: { fullPage: true, screenshotName: "form" } });
    check("full-page screenshot file exists", fullShot.screenshotPath && existsSync(fullShot.screenshotPath), fullShot.screenshotPath);

    ok("click submit", await exec.execute({ id: "submit", type: "click", name: "submit", locator: { strategy: "id", value: "submitButton" } }));
    await page.waitForURL("**/success*");
    ok("assert text contains", await exec.execute({ id: "as", type: "assertText", name: "as", locator: { strategy: "id", value: "successMessage" }, config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "successful" } }));
    await page.close();

    // ── Loop ─────────────────────────────────────────────────────────────────
    console.log("Loop node:");
    const loopPage = await browser.newPage();
    await loopPage.goto(`${BASE}/login`);
    const loopExec = new StepExecutor(loopPage, new LocatorFactory(loopPage), new ValueResolver(context), context);
    const loopResult = await loopExec.execute({ id: "loop", type: "loop", name: "loop", locator: { strategy: "id", value: "username" }, value: "x", config: { loopType: "fixedCount", iterationCount: 3, loopActionType: "fill", maxIterations: 100, loopStopOnFailure: true } });
    ok("loop fixedCount", loopResult);
    check("loop ran 3 iterations", loopResult.outputs.iterations === 3, String(loopResult.outputs.iterations));
    await loopPage.close();

    // ── Run Another Flow (pass-through + failure propagation) ─────────────────
    console.log("Run Another Flow:");
    const rfPage = await browser.newPage();
    const passingChild = async (id: string): Promise<FlowExecutionResult> => ({ flowId: id, status: "passed", startedAt: "", endedAt: "", durationMs: 0, steps: [], outputs: { "child.value": "ok" } });
    const passExec = new StepExecutor(rfPage, new LocatorFactory(rfPage), new ValueResolver(context), context, undefined, undefined, passingChild);
    const rfPass = await passExec.execute({ id: "rf", type: "runFlow", name: "rf", flowId: "flow-child" });
    ok("runFlow pass-through", rfPass);
    check("child status propagated", rfPass.outputs.childFlowStatus === "passed");

    const failingChild = async (id: string): Promise<FlowExecutionResult> => ({ flowId: id, status: "failed", startedAt: "", endedAt: "", durationMs: 0, steps: [], outputs: {}, error: "child boom" });
    const failExec = new StepExecutor(rfPage, new LocatorFactory(rfPage), new ValueResolver(context), context, undefined, undefined, failingChild);
    const rfFail = await failExec.execute({ id: "rf2", type: "runFlow", name: "rf2", flowId: "flow-child", config: { stopParentOnChildFailure: true } });
    check("runFlow fails parent on child failure", rfFail.status === "failed", rfFail.status);
    await rfPage.close();

    // ── Connector routing (flow-level) ───────────────────────────────────────
    console.log("Connector routing (flow-level):");
    const gotoForm = async (page: Page) => {
      await page.goto(`${BASE}/login`);
      await page.fill("#username", "tester");
      await page.fill("#password", "secret");
      await page.click("#loginButton");
      await page.waitForURL("**/form");
    };

    const branchFlow: FlowProfile = {
      id: "branch-flow",
      name: "Branch",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "cond", type: "condition", name: "Check path", value: "${runtimeInputs.path} === 'A'" },
        { id: "fillA", type: "fill", name: "Fill A", locator: { strategy: "id", value: "firstName" }, value: "FromA" },
        { id: "fillB", type: "fill", name: "Fill B", locator: { strategy: "id", value: "firstName" }, value: "FromB" },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "e1", source: "start", target: "cond", type: "success" },
        { id: "e2", source: "cond", target: "fillA", type: "conditional" },
        { id: "e3", source: "cond", target: "fillB", type: "failure" },
        { id: "e4", source: "fillA", target: "end", type: "success" },
        { id: "e5", source: "fillB", target: "end", type: "success" }
      ]
    };

    for (const [path, expected] of [["A", "FromA"], ["B", "FromB"]] as const) {
      const page = await browser.newPage();
      await gotoForm(page);
      const ctx = { ...(await makeContext("branch-flow")), runtimeInputs: { path } };
      const flowExec = new FlowExecutor(new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx));
      const result = await flowExec.executeFlow(branchFlow, ctx);
      const value = await page.inputValue("#firstName");
      check(`conditional routes path=${path} → ${expected}`, result.status === "passed" && value === expected, `status=${result.status} value=${value}`);
      await page.close();
    }

    // Failure-edge recovery routing
    const recoverPage = await browser.newPage();
    await gotoForm(recoverPage);
    const recoverCtx = await makeContext("recover-flow");
    const recoverFlow: FlowProfile = {
      id: "recover-flow",
      name: "Recover",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "bad", type: "click", name: "Bad click", locator: { strategy: "id", value: "doesNotExist" }, timeoutMs: 800, onFailure: { action: "goToFailureEdge", screenshot: false } },
        { id: "recover", type: "fill", name: "Recover", locator: { strategy: "id", value: "firstName" }, value: "Recovered" },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "r1", source: "start", target: "bad", type: "success" },
        { id: "r2", source: "bad", target: "recover", type: "failure" },
        { id: "r3", source: "recover", target: "end", type: "success" }
      ]
    };
    const recoverExec = new FlowExecutor(new StepExecutor(recoverPage, new LocatorFactory(recoverPage), new ValueResolver(recoverCtx), recoverCtx));
    const recoverResult = await recoverExec.executeFlow(recoverFlow, recoverCtx);
    const recoveredValue = await recoverPage.inputValue("#firstName");
    check("failure edge routes to recovery step", recoverResult.status === "passed" && recoveredValue === "Recovered", `status=${recoverResult.status} value=${recoveredValue}`);
    await recoverPage.close();

    // ── Enhanced Connectors (Phase 1) ────────────────────────────────────────
    console.log("Enhanced Connectors (Phase 1):");
    const runFlowOnForm = async (flow: FlowProfile, extra?: Partial<InstanceExecutionContext>) => {
      const page = await browser.newPage();
      await page.goto(`${BASE}/form`);
      const ctx = { ...(await makeContext(flow.id)), ...extra } as InstanceExecutionContext;
      const flowExec = new FlowExecutor(new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx));
      const result = await flowExec.executeFlow(flow, ctx);
      const value = await page.inputValue("#firstName").catch(() => "");
      await page.close();
      return { result, value };
    };
    const ran = (r: FlowExecutionResult, stepId: string) => r.steps.filter((s) => s.stepId === stepId).length;

    // 1. Multi-conditional: two edges match; the FIRST wins, the second never fires.
    const multiCond: FlowProfile = {
      id: "multi-cond",
      name: "Multi conditional",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "router", type: "scroll", name: "Router", config: { scrollDirection: "down", scrollAmount: 10 } },
        { id: "t1", type: "fill", name: "T1", locator: { strategy: "id", value: "firstName" }, value: "First" },
        { id: "t2", type: "fill", name: "T2", locator: { strategy: "id", value: "firstName" }, value: "Second" },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "e1", source: "start", target: "router", type: "success" },
        { id: "e2", source: "router", target: "t1", type: "conditional", condition: { expression: "${runtimeInputs.pick} === 'x'" } },
        { id: "e3", source: "router", target: "t2", type: "conditional", condition: { expression: "${runtimeInputs.pick} === 'x'" } },
        { id: "e4", source: "t1", target: "end", type: "success" },
        { id: "e5", source: "t2", target: "end", type: "success" }
      ]
    };
    const mc = await runFlowOnForm(multiCond, { runtimeInputs: { pick: "x" } });
    check(
      "multi-conditional: first matching edge wins",
      mc.result.status === "passed" && mc.value === "First" && ran(mc.result, "t1") === 1 && ran(mc.result, "t2") === 0,
      `status=${mc.result.status} value=${mc.value}`
    );

    // 2. Outcome-based: route on the step's OWN result output (${stepResult.xxx}).
    const outcomeFlow: FlowProfile = {
      id: "outcome-flow",
      name: "Outcome routing",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "seed", type: "fill", name: "Seed", locator: { strategy: "id", value: "firstName" }, value: "Alice" },
        { id: "assert", type: "assertText", name: "Assert", locator: { strategy: "id", value: "firstName" }, config: { assertionType: "value", comparisonOperator: "equals", expectedValue: "Alice" } },
        { id: "good", type: "fill", name: "Good", locator: { strategy: "id", value: "firstName" }, value: "OutcomeYes" },
        { id: "bad", type: "fill", name: "Bad", locator: { strategy: "id", value: "firstName" }, value: "OutcomeNo" },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "o1", source: "start", target: "seed", type: "success" },
        { id: "o2", source: "seed", target: "assert", type: "success" },
        { id: "o3", source: "assert", target: "good", type: "outcome", condition: { expression: "${stepResult.assertionResult} === true" } },
        { id: "o4", source: "assert", target: "bad", type: "outcome", condition: { expression: "${stepResult.assertionResult} === false" } },
        { id: "o5", source: "good", target: "end", type: "success" },
        { id: "o6", source: "bad", target: "end", type: "success" }
      ]
    };
    const oc = await runFlowOnForm(outcomeFlow);
    check(
      "outcome edge routes on the step's own output",
      oc.result.status === "passed" && oc.value === "OutcomeYes" && ran(oc.result, "good") === 1 && ran(oc.result, "bad") === 0,
      `status=${oc.result.status} value=${oc.value}`
    );

    // 3 & 4. Loop-back: unconditional back-edge gated by maxLoopCount.
    const loopBackFlow = (max: number): FlowProfile => ({
      id: `loopback-${max}`,
      name: "Loop back",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "A", type: "scroll", name: "A", config: { scrollDirection: "down", scrollAmount: 5 } },
        { id: "B", type: "scroll", name: "B", config: { scrollDirection: "up", scrollAmount: 5 } }
      ],
      edges: [
        { id: "lb1", source: "start", target: "A", type: "success" },
        { id: "lb2", source: "A", target: "B", type: "success" },
        { id: "lb3", source: "B", target: "A", type: "loopBack", maxLoopCount: max }
      ]
    });
    const lb2 = await runFlowOnForm(loopBackFlow(2));
    check(
      "loopBack (max=2) runs A three times without a cycle error",
      lb2.result.status === "passed" && ran(lb2.result, "A") === 3,
      `status=${lb2.result.status} A-runs=${ran(lb2.result, "A")}`
    );
    const lb1 = await runFlowOnForm(loopBackFlow(1));
    check(
      "loopBack (max=1) runs A twice then stops",
      lb1.result.status === "passed" && ran(lb1.result, "A") === 2,
      `status=${lb1.result.status} A-runs=${ran(lb1.result, "A")}`
    );

    // 5. Parallel: A fans out to B and C, then follows its success edge to D.
    const parallelFlow: FlowProfile = {
      id: "parallel-flow",
      name: "Parallel",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "A", type: "scroll", name: "A", config: { scrollDirection: "down", scrollAmount: 5 } },
        { id: "B", type: "scroll", name: "B", config: { scrollDirection: "down", scrollAmount: 5 } },
        { id: "C", type: "scroll", name: "C", config: { scrollDirection: "down", scrollAmount: 5 } },
        { id: "D", type: "fill", name: "D", locator: { strategy: "id", value: "firstName" }, value: "AfterParallel" },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "p1", source: "start", target: "A", type: "success" },
        { id: "p2", source: "A", target: "B", type: "parallel" },
        { id: "p3", source: "A", target: "C", type: "parallel" },
        { id: "p4", source: "A", target: "D", type: "success" },
        { id: "p5", source: "D", target: "end", type: "success" }
      ]
    };
    const par = await runFlowOnForm(parallelFlow);
    check(
      "parallel edges run all fan-out targets then continue",
      par.result.status === "passed" && ran(par.result, "B") === 1 && ran(par.result, "C") === 1 && ran(par.result, "D") === 1 && par.value === "AfterParallel",
      `status=${par.result.status} B=${ran(par.result, "B")} C=${ran(par.result, "C")} D=${ran(par.result, "D")}`
    );

    // ── Structured Connectors (Checkpoint B) ────────────────────────────────
    console.log("Structured Connectors (Checkpoint B):");

    // Conditional connector routes on node status; higher priority wins.
    const condFlow: FlowProfile = {
      id: "b-cond",
      name: "Structured conditional",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "router", type: "scroll", name: "Router", config: { scrollDirection: "down", scrollAmount: 5 } },
        { id: "good", type: "fill", name: "Good", locator: { strategy: "id", value: "firstName" }, value: "CondYes" },
        { id: "bad", type: "fill", name: "Bad", locator: { strategy: "id", value: "firstName" }, value: "CondNo" },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "c1", source: "start", target: "router", type: "success" },
        { id: "c2", source: "router", target: "good", type: "conditional", kind: "conditional", conditional: { sourceField: "status", operator: "equals", expectedValue: "passed", priority: 5 } },
        { id: "c3", source: "router", target: "bad", type: "conditional", kind: "conditional", conditional: { sourceField: "status", operator: "equals", expectedValue: "passed", priority: 1 } },
        { id: "c4", source: "good", target: "end", type: "success" },
        { id: "c5", source: "bad", target: "end", type: "success" }
      ]
    };
    const condRes = await runFlowOnForm(condFlow);
    check(
      "structured conditional routes by config; higher priority wins",
      condRes.result.status === "passed" && condRes.value === "CondYes" && ran(condRes.result, "good") === 1 && ran(condRes.result, "bad") === 0,
      `status=${condRes.result.status} value=${condRes.value}`
    );

    // Conditional with no match falls through to a safe stop (no success edge).
    const noMatchFlow: FlowProfile = {
      id: "b-cond-none",
      name: "Conditional no match",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "router", type: "scroll", name: "Router", config: { scrollAmount: 5 } },
        { id: "x", type: "fill", name: "X", locator: { strategy: "id", value: "firstName" }, value: "ShouldNotRun" },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "n1", source: "start", target: "router", type: "success" },
        { id: "n2", source: "router", target: "x", type: "conditional", kind: "conditional", conditional: { sourceField: "status", operator: "equals", expectedValue: "failed" } },
        { id: "n3", source: "x", target: "end", type: "success" }
      ]
    };
    const noMatchStructured = await runFlowOnForm(noMatchFlow);
    check(
      "structured conditional with no match stops the branch safely",
      noMatchStructured.result.status === "passed" && ran(noMatchStructured.result, "x") === 0,
      `status=${noMatchStructured.result.status} x=${ran(noMatchStructured.result, "x")}`
    );

    // Parallel waitAny stops after the first successful branch.
    const waitAnyFlow: FlowProfile = {
      id: "b-parallel-any",
      name: "Parallel waitAny",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "A", type: "scroll", name: "A", config: { scrollAmount: 5 } },
        { id: "B", type: "scroll", name: "B", config: { scrollAmount: 5 } },
        { id: "C", type: "scroll", name: "C", config: { scrollAmount: 5 } },
        { id: "D", type: "fill", name: "D", locator: { strategy: "id", value: "firstName" }, value: "AfterAny" },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "pa1", source: "start", target: "A", type: "success" },
        { id: "pa2", source: "A", target: "B", type: "parallel", kind: "parallel", parallel: { joinMode: "waitAny", failMode: "failFast" } },
        { id: "pa3", source: "A", target: "C", type: "parallel", kind: "parallel", parallel: { joinMode: "waitAny", failMode: "failFast" } },
        { id: "pa4", source: "A", target: "D", type: "success" },
        { id: "pa5", source: "D", target: "end", type: "success" }
      ]
    };
    const anyRes = await runFlowOnForm(waitAnyFlow);
    check(
      "parallel waitAny stops after first success (C skipped), then continues",
      anyRes.result.status === "passed" && ran(anyRes.result, "B") === 1 && ran(anyRes.result, "C") === 0 && ran(anyRes.result, "D") === 1,
      `B=${ran(anyRes.result, "B")} C=${ran(anyRes.result, "C")} D=${ran(anyRes.result, "D")}`
    );

    // Parallel failFast fails the flow on the first failing branch (second not run).
    const failFastFlow: FlowProfile = {
      id: "b-parallel-fail",
      name: "Parallel failFast",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "A", type: "scroll", name: "A", config: { scrollAmount: 5 } },
        { id: "B", type: "click", name: "B", locator: { strategy: "id", value: "doesNotExist" }, timeoutMs: 600 },
        { id: "C", type: "scroll", name: "C", config: { scrollAmount: 5 } },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "pf1", source: "start", target: "A", type: "success" },
        { id: "pf2", source: "A", target: "B", type: "parallel", kind: "parallel", parallel: { joinMode: "waitAll", failMode: "failFast" } },
        { id: "pf3", source: "A", target: "C", type: "parallel", kind: "parallel", parallel: { joinMode: "waitAll", failMode: "failFast" } },
        { id: "pf4", source: "A", target: "end", type: "success" }
      ]
    };
    const failFastRes = await runFlowOnForm(failFastFlow);
    check(
      "parallel failFast fails on first failure and skips the rest",
      failFastRes.result.status === "failed" && ran(failFastRes.result, "C") === 0,
      `status=${failFastRes.result.status} C=${ran(failFastRes.result, "C")}`
    );

    // Parallel collectErrors runs all branches then fails with aggregated errors.
    const collectFlow: FlowProfile = {
      id: "b-parallel-collect",
      name: "Parallel collectErrors",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "A", type: "scroll", name: "A", config: { scrollAmount: 5 } },
        { id: "B", type: "click", name: "B", locator: { strategy: "id", value: "doesNotExist" }, timeoutMs: 600 },
        { id: "C", type: "scroll", name: "C", config: { scrollAmount: 5 } },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "pc1", source: "start", target: "A", type: "success" },
        { id: "pc2", source: "A", target: "B", type: "parallel", kind: "parallel", parallel: { joinMode: "waitAll", failMode: "collectErrors" } },
        { id: "pc3", source: "A", target: "C", type: "parallel", kind: "parallel", parallel: { joinMode: "waitAll", failMode: "collectErrors" } },
        { id: "pc4", source: "A", target: "end", type: "success" }
      ]
    };
    const collectRes = await runFlowOnForm(collectFlow);
    check(
      "parallel collectErrors runs all branches then fails",
      collectRes.result.status === "failed" && ran(collectRes.result, "B") === 1 && ran(collectRes.result, "C") === 1,
      `status=${collectRes.result.status} B=${ran(collectRes.result, "B")} C=${ran(collectRes.result, "C")}`
    );

    // Loop connector — count mode injects 1..N into a runtimeInput the target reads.
    // Point 4: loop connectors are self-loops (L → L); the node's other outgoing connector
    // must be Conditional (Point 3) — here an unconditional "always" exit once the loop ends.
    const loopCountFlow: FlowProfile = {
      id: "b-loop-count",
      name: "Loop count",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "A", type: "scroll", name: "A", config: { scrollAmount: 5 } },
        { id: "L", type: "fill", name: "L", locator: { strategy: "id", value: "firstName" }, valueSource: { type: "runtimeInput", key: "item" } },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "lc1", source: "start", target: "A", type: "success" },
        { id: "lc2", source: "A", target: "L", type: "success" },
        { id: "lc3", source: "L", target: "L", type: "loop", kind: "loop", loop: { mode: "count", maxIterations: 3, parameterName: "item" } },
        { id: "lc4", source: "L", target: "end", type: "conditional", kind: "conditional", conditional: { sourceField: "status", operator: "always" } }
      ]
    };
    const loopCountRes = await runFlowOnForm(loopCountFlow);
    check(
      "loop connector (count, self-loop) runs the node N times with injected parameter",
      loopCountRes.result.status === "passed" && ran(loopCountRes.result, "L") === 3 && loopCountRes.value === "3",
      `status=${loopCountRes.result.status} L=${ran(loopCountRes.result, "L")} value=${loopCountRes.value}`
    );

    // Loop connector — static list binds each value in order.
    const loopStaticFlow: FlowProfile = {
      id: "b-loop-static",
      name: "Loop static",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "A", type: "scroll", name: "A", config: { scrollAmount: 5 } },
        { id: "L", type: "fill", name: "L", locator: { strategy: "id", value: "firstName" }, valueSource: { type: "runtimeInput", key: "item" } },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "ls1", source: "start", target: "A", type: "success" },
        { id: "ls2", source: "A", target: "L", type: "success" },
        { id: "ls3", source: "L", target: "L", type: "loop", kind: "loop", loop: { mode: "staticList", maxIterations: 5, parameterName: "item", staticValues: ["alpha", "beta"] } },
        { id: "ls4", source: "L", target: "end", type: "conditional", kind: "conditional", conditional: { sourceField: "status", operator: "always" } }
      ]
    };
    const loopStaticRes = await runFlowOnForm(loopStaticFlow);
    check(
      "loop connector (static list, self-loop) runs once per value in order",
      loopStaticRes.result.status === "passed" && ran(loopStaticRes.result, "L") === 2 && loopStaticRes.value === "beta",
      `status=${loopStaticRes.result.status} L=${ran(loopStaticRes.result, "L")} value=${loopStaticRes.value}`
    );

    // Loop connector — whileCondition is bounded by maxIterations.
    const loopWhileFlow: FlowProfile = {
      id: "b-loop-while",
      name: "Loop while",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "A", type: "scroll", name: "A", config: { scrollAmount: 5 } },
        { id: "L", type: "scroll", name: "L", config: { scrollAmount: 5 } },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "lw1", source: "start", target: "A", type: "success" },
        { id: "lw2", source: "A", target: "L", type: "success" },
        { id: "lw3", source: "L", target: "L", type: "loop", kind: "loop", loop: { mode: "whileCondition", maxIterations: 2, condition: { sourceField: "status", operator: "equals", expectedValue: "passed" } } },
        { id: "lw4", source: "L", target: "end", type: "conditional", kind: "conditional", conditional: { sourceField: "status", operator: "always" } }
      ]
    };
    const loopWhileRes = await runFlowOnForm(loopWhileFlow);
    check(
      "loop connector (whileCondition, self-loop) is bounded by maxIterations",
      loopWhileRes.result.status === "passed" && ran(loopWhileRes.result, "L") === 2,
      `status=${loopWhileRes.result.status} L=${ran(loopWhileRes.result, "L")}`
    );

    // Point 4 runtime safeguard: a loop connector between two different nodes must fail safely.
    const invalidLoopFlow: FlowProfile = {
      id: "b-loop-invalid-cross-node",
      name: "Invalid cross-node loop",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "A", type: "scroll", name: "A", config: { scrollAmount: 5 } },
        { id: "B", type: "scroll", name: "B", config: { scrollAmount: 5 } },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "il1", source: "start", target: "A", type: "success" },
        { id: "il2", source: "A", target: "B", type: "loop", kind: "loop", loop: { mode: "count", maxIterations: 2 } },
        { id: "il3", source: "B", target: "end", type: "success" }
      ]
    };
    const invalidLoopRes = await runFlowOnForm(invalidLoopFlow);
    check(
      "a loop connector between two different nodes fails safely before executing",
      invalidLoopRes.result.status === "failed" && !!invalidLoopRes.result.error?.includes("same node"),
      `status=${invalidLoopRes.result.status} error=${invalidLoopRes.result.error}`
    );

    // Point 2 runtime safeguard: two standard outgoing connectors from one node fail safely.
    const invalidDuplicateFlow: FlowProfile = {
      id: "b-duplicate-normal",
      name: "Invalid duplicate normal connectors",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "A", type: "scroll", name: "A", config: { scrollAmount: 5 } },
        { id: "B", type: "scroll", name: "B", config: { scrollAmount: 5 } },
        { id: "C", type: "scroll", name: "C", config: { scrollAmount: 5 } }
      ],
      edges: [
        { id: "id1", source: "start", target: "A", type: "success" },
        { id: "id2", source: "A", target: "B", type: "success" },
        { id: "id3", source: "A", target: "C", type: "success" }
      ]
    };
    const invalidDuplicateRes = await runFlowOnForm(invalidDuplicateFlow);
    check(
      "two standard outgoing connectors from one node fail safely before executing",
      invalidDuplicateRes.result.status === "failed" && !!invalidDuplicateRes.result.error?.includes("standard outgoing"),
      `status=${invalidDuplicateRes.result.status} error=${invalidDuplicateRes.result.error}`
    );

    // Connector events reach the live-progress reporter.
    const evPage = await browser.newPage();
    await evPage.goto(`${BASE}/form`);
    const evCtx = await makeContext("b-events");
    const capturedEvents: string[] = [];
    const reporter = { report: (e: { message?: string }) => e.message && capturedEvents.push(e.message) } as any;
    const evExec = new FlowExecutor(new StepExecutor(evPage, new LocatorFactory(evPage), new ValueResolver(evCtx), evCtx), undefined, reporter);
    await evExec.executeFlow(loopCountFlow, evCtx);
    await evPage.close();
    check(
      "connector events are emitted to the live-progress reporter",
      capturedEvents.some((m) => m.includes("Loop iteration")),
      capturedEvents.slice(0, 3).join(" | ")
    );

    // Isolated concurrent parallel branches — each runs on its own page in a shared context.
    const isoCtx = await browser.newContext();
    const isoFlowCtx = await makeContext("b-iso-parallel");
    const isoBranchFactory = async () => {
      const p = await isoCtx.newPage();
      const ex = new StepExecutor(p, new LocatorFactory(p), new ValueResolver(isoFlowCtx), isoFlowCtx);
      return { execute: (s: FlowStep) => ex.execute(s), close: () => p.close() };
    };
    const isoMain = await isoCtx.newPage();
    await isoMain.goto(`${BASE}/form`);
    const isoStepExec = new StepExecutor(isoMain, new LocatorFactory(isoMain), new ValueResolver(isoFlowCtx), isoFlowCtx);
    const isoFlow: FlowProfile = {
      id: "b-iso-parallel",
      name: "Isolated parallel",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "A", type: "scroll", name: "A", config: { scrollAmount: 5 } },
        { id: "B", type: "goto", name: "B", url: `${BASE}/form` },
        { id: "C", type: "goto", name: "C", url: `${BASE}/login` },
        { id: "D", type: "scroll", name: "D", config: { scrollAmount: 5 } },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "i1", source: "start", target: "A", type: "success" },
        { id: "i2", source: "A", target: "B", type: "parallel", kind: "parallel", parallel: { joinMode: "waitAll", failMode: "failFast", isolation: "isolatedPage", maxConcurrency: 2 } },
        { id: "i3", source: "A", target: "C", type: "parallel", kind: "parallel", parallel: { joinMode: "waitAll", failMode: "failFast", isolation: "isolatedPage", maxConcurrency: 2 } },
        { id: "i4", source: "A", target: "D", type: "success" },
        { id: "i5", source: "D", target: "end", type: "success" }
      ]
    };
    const isoRes = await new FlowExecutor(isoStepExec, undefined, undefined, isoBranchFactory).executeFlow(isoFlow, isoFlowCtx);
    await isoCtx.close();
    check(
      "isolated concurrent parallel branches all run on their own pages",
      isoRes.status === "passed" && ran(isoRes, "B") === 1 && ran(isoRes, "C") === 1 && ran(isoRes, "D") === 1,
      `status=${isoRes.status} B=${ran(isoRes, "B")} C=${ran(isoRes, "C")} D=${ran(isoRes, "D")}`
    );

    // ── Auto Secure Login & Reuse Session (Phases 2-3, mocked service) ───────
    console.log("Auto Secure Login & Reuse Session:");
    const aslPage = await browser.newPage();
    const aslCtx = await makeContext("asl-flow");
    const restartCalls: Array<{ closeOnly?: boolean; newUserDataDir?: string }> = [];
    const restarter = async (opts?: { closeOnly?: boolean; newUserDataDir?: string }) => {
      restartCalls.push(opts ?? {});
    };
    const readyProfile = (id: string, url?: string) => ({ id, name: id, profileDir: `/tmp/${id}`, targetUrl: url, createdAt: "", status: "ready" });

    // A) Reuses an existing ready session for the URL (no capture, no restart).
    const existingSvc = {
      list: async () => [readyProfile("s1", "https://app.example/login")],
      startCapture: async () => ({ active: true, status: "running", sessionId: "sX" }),
      getStatus: () => ({ active: false, status: "closed" }),
      getById: async () => null,
      markUsed: async () => undefined
    } as any;
    const aslSkipExec = new StepExecutor(aslPage, new LocatorFactory(aslPage), new ValueResolver(aslCtx), aslCtx, undefined, undefined, undefined, undefined, restarter, existingSvc);
    const skipRes = await aslSkipExec.execute({ id: "asl", type: "autoSecureLogin", name: "asl", value: "https://app.example/login" });
    check(
      "autoSecureLogin reuses an existing ready session (sessionSkipped)",
      skipRes.status === "passed" && skipRes.outputs.sessionSkipped === true && restartCalls.length === 0,
      `status=${skipRes.status} outputs=${JSON.stringify(skipRes.outputs)}`
    );

    // B) Captures a new session when none exists, then resumes automation.
    restartCalls.length = 0;
    const captureSvc = {
      list: async () => [],
      startCapture: async () => ({ active: true, status: "running", sessionId: "s2" }),
      getStatus: () => ({ active: false, status: "closed" }),
      getById: async () => readyProfile("s2", "https://app.example/login"),
      markUsed: async () => undefined
    } as any;
    const aslCapExec = new StepExecutor(aslPage, new LocatorFactory(aslPage), new ValueResolver(aslCtx), aslCtx, undefined, undefined, undefined, undefined, restarter, captureSvc);
    const capRes = await aslCapExec.execute({ id: "asl2", type: "autoSecureLogin", name: "asl2", value: "https://app.example/login", timeoutMs: 5000 });
    check(
      "autoSecureLogin captures + resumes when no session exists",
      capRes.status === "passed" &&
        capRes.outputs.sessionCaptured === true &&
        capRes.outputs.sessionId === "s2" &&
        restartCalls.some((c) => c.closeOnly) &&
        restartCalls.some((c) => c.newUserDataDir === "/tmp/s2"),
      `status=${capRes.status} calls=${JSON.stringify(restartCalls)}`
    );

    // C) Reuse Session swaps the browser profile + marks the session used.
    restartCalls.length = 0;
    let marked = "";
    const reuseSvc = {
      list: async () => [],
      startCapture: async () => ({ active: false, status: "closed" }),
      getStatus: () => ({ active: false, status: "closed" }),
      getById: async () => readyProfile("s3"),
      markUsed: async (id: string) => {
        marked = id;
      }
    } as any;
    const reuseExec = new StepExecutor(aslPage, new LocatorFactory(aslPage), new ValueResolver(aslCtx), aslCtx, undefined, undefined, undefined, undefined, restarter, reuseSvc);
    const reuseRes = await reuseExec.execute({ id: "rs", type: "reuseSession", name: "rs", config: { reuseSessionId: "s3" } });
    check(
      "reuseSession loads the chosen profile + marks used",
      reuseRes.status === "passed" && reuseRes.outputs.sessionLoaded === true && restartCalls.some((c) => c.newUserDataDir === "/tmp/s3") && marked === "s3",
      `status=${reuseRes.status} calls=${JSON.stringify(restartCalls)} marked=${marked}`
    );

    // D) Reuse Session (selected) fails clearly when nothing is selected.
    const reuseNoId = await reuseExec.execute({ id: "rs2", type: "reuseSession", name: "rs2", config: { reuseSessionMode: "selected" } });
    check("reuseSession (selected) fails without a selected session", reuseNoId.status === "failed", reuseNoId.status);

    // E) Auto Secure Login matches a saved session by normalized ORIGIN (different path).
    const originExec = new StepExecutor(aslPage, new LocatorFactory(aslPage), new ValueResolver(aslCtx), aslCtx, undefined, undefined, undefined, undefined, restarter, existingSvc);
    const originRes = await originExec.execute({ id: "asl3", type: "autoSecureLogin", name: "asl3", value: "https://app.example/dashboard" });
    check(
      "autoSecureLogin matches saved session by normalized origin (different path)",
      originRes.status === "passed" && originRes.outputs.sessionAlreadyExists === true && originRes.outcome === "sessionAlreadyExists",
      `status=${originRes.status} outcome=${originRes.outcome}`
    );

    // F) Reuse Session auto-detect finds a ready session by origin (no explicit id).
    let marked2 = "";
    const autoSvc = {
      list: async () => [readyProfile("s5", "https://shop.example/account")],
      startCapture: async () => ({ active: false, status: "closed" }),
      getStatus: () => ({ active: false, status: "closed" }),
      getById: async () => null,
      markUsed: async (id: string) => {
        marked2 = id;
      }
    } as any;
    const autoExec = new StepExecutor(aslPage, new LocatorFactory(aslPage), new ValueResolver(aslCtx), aslCtx, undefined, undefined, undefined, undefined, restarter, autoSvc);
    const autoRes = await autoExec.execute({ id: "rs3", type: "reuseSession", name: "rs3", value: "https://shop.example/cart", config: { reuseSessionMode: "autoDetect" } });
    check(
      "reuseSession auto-detect finds a session by origin",
      autoRes.status === "passed" && autoRes.outputs.sessionLoaded === true && autoRes.outcome === "sessionLoaded" && marked2 === "s5",
      `status=${autoRes.status} marked=${marked2}`
    );

    // G) Reuse Session auto-detect fails clearly when no origin matches.
    const noMatchRes = await autoExec.execute({ id: "rs4", type: "reuseSession", name: "rs4", value: "https://none.example", config: { reuseSessionMode: "autoDetect" } });
    check("reuseSession auto-detect fails when no origin matches", noMatchRes.status === "failed" && noMatchRes.outputs.sessionNotFound === true, noMatchRes.status);
    await aslPage.close();

    // H & I) Engine-level restart guard for Auto Secure Login (via FlowExecutor).
    const aslFlow: FlowProfile = {
      id: "asl-restart",
      name: "Auto login restart",
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "asl", type: "autoSecureLogin", name: "ASL", value: "https://bank.example/login" },
        { id: "reuse", type: "reuseSession", name: "Reuse", config: { reuseSessionMode: "selected", reuseSessionId: "sC" } },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "a1", source: "start", target: "asl", type: "success" },
        { id: "a2", source: "asl", target: "reuse", type: "success" },
        { id: "a3", source: "reuse", target: "end", type: "success" }
      ]
    };

    // H) Capture on first pass, then restart-from-start finds the session and completes.
    const restartPage = await browser.newPage();
    let captured = false;
    const restartCalls2: Array<{ closeOnly?: boolean; newUserDataDir?: string }> = [];
    const restarter2 = async (opts?: { closeOnly?: boolean; newUserDataDir?: string }) => {
      restartCalls2.push(opts ?? {});
    };
    const engineSvc = {
      list: async () => (captured ? [readyProfile("sC", "https://bank.example/login")] : []),
      startCapture: async () => ({ active: true, status: "running", sessionId: "sC" }),
      getStatus: () => {
        captured = true;
        return { active: false, status: "closed" };
      },
      getById: async () => readyProfile("sC", "https://bank.example/login"),
      markUsed: async () => undefined
    } as any;
    const engStepExec = new StepExecutor(restartPage, new LocatorFactory(restartPage), new ValueResolver(aslCtx), aslCtx, undefined, undefined, undefined, undefined, restarter2, engineSvc);
    const engRes = await new FlowExecutor(engStepExec).executeFlow(aslFlow, aslCtx);
    check(
      "engine restarts flow after capture; 2nd pass skips ASL and completes",
      engRes.status === "passed" && ran(engRes, "asl") === 2 && ran(engRes, "reuse") === 1 && restartCalls2.some((c) => c.newUserDataDir === "/tmp/sC"),
      `status=${engRes.status} asl=${ran(engRes, "asl")} reuse=${ran(engRes, "reuse")}`
    );
    await restartPage.close();

    // I) Restart guard prevents an infinite loop when the session never becomes reusable.
    const loopPage2 = await browser.newPage();
    const neverSvc = {
      list: async () => [], // session never appears
      startCapture: async () => ({ active: true, status: "running", sessionId: "sZ" }),
      getStatus: () => ({ active: false, status: "closed" }),
      getById: async () => readyProfile("sZ", "https://bank.example/login"),
      markUsed: async () => undefined
    } as any;
    const guardExec = new StepExecutor(loopPage2, new LocatorFactory(loopPage2), new ValueResolver(aslCtx), aslCtx, undefined, undefined, undefined, undefined, restarter, neverSvc);
    const guardRes = await new FlowExecutor(guardExec).executeFlow(aslFlow, aslCtx);
    check(
      "restart guard fails safely after the max restart count",
      guardRes.status === "failed" && (guardRes.error ?? "").includes("could not reuse it after restart") && ran(guardRes, "asl") === 2,
      `status=${guardRes.status} asl=${ran(guardRes, "asl")}`
    );
    await loopPage2.close();

    // ── Route Change node (switch to a newly opened tab) ─────────────────────
    console.log("Route Change node:");
    const rcPage = await browser.newPage();
    const rcCtx = await makeContext("rc-flow");
    const rcExec = new StepExecutor(rcPage, new LocatorFactory(rcPage), new ValueResolver(rcCtx), rcCtx);
    await rcPage.goto(`${BASE}/form`);
    ok("click opens new tab", await rcExec.execute({ id: "open", type: "click", name: "open", locator: { strategy: "id", value: "openNewTabButton" } }));
    ok("routeChange switchToLatestTab", await rcExec.execute({ id: "route", type: "routeChange", name: "route", timeoutMs: 10_000, config: { routeMode: "switchToLatestTab", routeWaitUntil: "load" } }));
    const rcTitle = await rcExec.execute({ id: "title", type: "assertText", name: "title", locator: { strategy: "id", value: "routeChangeTargetTitle" }, config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "Details" } });
    check("later steps target the switched tab", rcTitle.status === "passed", rcTitle.error);
    ok("fill on switched tab", await rcExec.execute({ id: "fill", type: "fill", name: "fill", locator: { strategy: "id", value: "routeChangeTargetInput" }, value: "REF-123" }));
    ok("click on switched tab", await rcExec.execute({ id: "save", type: "click", name: "save", locator: { strategy: "id", value: "routeChangeTargetSubmit" } }));
    ok("assert result on switched tab", await rcExec.execute({ id: "assert", type: "assertText", name: "assert", locator: { strategy: "id", value: "routeChangeResult" }, config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "REF-123" } }));
    for (const p of rcPage.context().pages()) await p.close().catch(() => undefined);

    // ── Save Session node ────────────────────────────────────────────────────
    console.log("Save Session node:");
    const ssPage = await browser.newPage();
    const ssCtx = await makeContext("ss-flow");
    const ssExec = new StepExecutor(ssPage, new LocatorFactory(ssPage), new ValueResolver(ssCtx), ssCtx);
    await ssPage.goto(`${BASE}/login`);
    const ssResult = await ssExec.execute({ id: "save", type: "saveSession", name: "save", config: { sessionName: "verify-session", overwriteSession: true } });
    ok("saveSession", ssResult);
    check("session storageState file written", typeof ssResult.outputs.sessionPath === "string" && existsSync(ssResult.outputs.sessionPath as string), String(ssResult.outputs.sessionPath));
    const ssNoName = await ssExec.execute({ id: "save2", type: "saveSession", name: "save2", config: {} });
    check("saveSession fails without a session name", ssNoName.status === "failed", ssNoName.status);
    const ssNoOverwrite = await ssExec.execute({ id: "save3", type: "saveSession", name: "save3", config: { sessionName: "verify-session", overwriteSession: false } });
    check("saveSession fails when file exists and overwrite is off", ssNoOverwrite.status === "failed", ssNoOverwrite.status);
    await ssPage.close();

    // ── Protected Login Handoff node ─────────────────────────────────────────
    console.log("Protected Login Handoff node:");
    const plPage = await browser.newPage();
    const plCtx = await makeContext("pl-flow");
    const plHandoff = new ManualHandoffController();
    const plExec = new StepExecutor(plPage, new LocatorFactory(plPage), new ValueResolver(plCtx), plCtx, plHandoff);
    await plPage.goto(`${BASE}/login`);
    const plPromise = plExec.execute({ id: "pl", type: "protectedLoginHandoff", name: "pl", config: { handoffMode: "pauseAndAsk", handoffInstructions: "Log in manually." } });
    for (let i = 0; i < 20 && !plHandoff.getPending(plCtx.executionId, plCtx.instanceId); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const pendingHandoff = plHandoff.getPending(plCtx.executionId, plCtx.instanceId);
    check("protectedLoginHandoff pauses without closing the flow", Boolean(pendingHandoff), "no pending handoff");
    plHandoff.resume(plCtx.executionId, plCtx.instanceId);
    const plResult = await plPromise;
    check("protectedLoginHandoff continues in place after resume", plResult.status === "passed", plResult.status);
    check("auto-detect does not pause normal mock pages", (await plExec.execute({ id: "navok", type: "goto", name: "navok", url: `${BASE}/form` })).status === "passed");
    await plPage.close();

    // ── Connector routing (workflow-level) ───────────────────────────────────
    console.log("Connector routing (workflow-level):");
    const instanceConfig: InstanceConfig = {
      id: "i1",
      name: "i1",
      browser: "chromium",
      headless: true,
      isolationMode: "browserContext",
      timeoutMs: 30_000,
      viewport: { width: 1280, height: 800 }
    };
    const resourcesRoot = join(process.cwd(), "resources");
    const failurePolicy = { stopOnRequiredFlowFailure: true, continueOnOptionalFlowFailure: true, takeScreenshotOnFailure: false };

    const manualResumeFlow = simpleFlow("manualResume", [
      { id: "goto", type: "goto", name: "goto", url: `${BASE}/login` },
      { id: "handoff", type: "manualHandoff", name: "handoff", message: "Complete the manual step." },
      { id: "after", type: "fill", name: "after", locator: { strategy: "id", value: "username" }, value: "after-resume" }
    ]);
    const manualResumeScenario: ScenarioProfile = {
      id: "sc-manual-resume",
      name: "Manual resume",
      executionMode: "sequential",
      maxParallelFlows: 1,
      flows: [{ order: 1, flowId: "manualResume", required: true }],
      links: [],
      failurePolicy
    };
    const manualController = new ManualHandoffController();
    const manualRunner = new PlaywrightRunner({ flows: [manualResumeFlow], productionOffline: false, resourcesRoot, manualHandoffController: manualController });
    const manualContext = await makeContext("manualResume");
    const manualPromise = manualRunner.executeScenario(manualResumeScenario, manualContext, instanceConfig);
    for (let i = 0; i < 20 && !manualController.getPending(manualContext.executionId, manualContext.instanceId); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    check("manual handoff pauses the runner without finishing the scenario", Boolean(manualController.getPending(manualContext.executionId, manualContext.instanceId)));
    manualController.resume(manualContext.executionId, manualContext.instanceId);
    const manualResult = await manualPromise;
    check(
      "manual handoff resumes in place and runs the next browser step",
      manualResult.status === "passed" && manualResult.flows[0]?.steps.some((step) => step.stepId === "after" && step.status === "passed"),
      `status=${manualResult.status} steps=${manualResult.flows[0]?.steps.map((step) => `${step.stepId}:${step.status}`).join(",")}`
    );

    const flowA = simpleFlow("flowA", [
      { id: "goto", type: "goto", name: "goto", url: `${BASE}/login` },
      { id: "u", type: "fill", name: "u", locator: { strategy: "id", value: "username" }, value: "tester" },
      { id: "p", type: "fill", name: "p", locator: { strategy: "id", value: "password" }, value: "secret" },
      { id: "login", type: "click", name: "login", locator: { strategy: "id", value: "loginButton" } }
    ]);
    const flowB = simpleFlow("flowB", [{ id: "fb", type: "fill", name: "fb", locator: { strategy: "id", value: "firstName" }, value: "ViaB" }]);
    const flowC = simpleFlow("flowC", [{ id: "fc", type: "fill", name: "fc", locator: { strategy: "id", value: "username" }, value: "Recovered" }]);
    const flowAbad = simpleFlow("flowAbad", [
      { id: "goto", type: "goto", name: "goto", url: `${BASE}/login` },
      { id: "bad", type: "click", name: "bad", locator: { strategy: "id", value: "doesNotExist" }, timeoutMs: 800 }
    ]);

    const successScenario: ScenarioProfile = {
      id: "sc-success",
      name: "Success routing",
      executionMode: "conditional",
      maxParallelFlows: 1,
      flows: [
        { order: 1, flowId: "flowA", required: true },
        { order: 2, flowId: "flowB", required: false },
        { order: 3, flowId: "flowC", required: false }
      ],
      links: [{ id: "l1", sourceFlowId: "flowA", targetFlowId: "flowB", type: "success" }],
      failurePolicy
    };

    const successRunner = new PlaywrightRunner({ flows: [flowA, flowB, flowC], productionOffline: false, resourcesRoot });
    const successResult = await successRunner.executeScenario(successScenario, await makeContext("flowA"), instanceConfig);
    const successRan = successResult.flows.map((f) => f.flowId);
    check(
      "success link runs flowB and skips flowC",
      successResult.status === "passed" && successRan.includes("flowA") && successRan.includes("flowB") && !successRan.includes("flowC"),
      `status=${successResult.status} ran=${successRan.join(",")}`
    );

    const failureScenario: ScenarioProfile = {
      id: "sc-failure",
      name: "Failure routing",
      executionMode: "conditional",
      maxParallelFlows: 1,
      flows: [
        { order: 1, flowId: "flowAbad", required: true },
        { order: 2, flowId: "flowB", required: false },
        { order: 3, flowId: "flowC", required: false }
      ],
      links: [{ id: "l4", sourceFlowId: "flowAbad", targetFlowId: "flowC", type: "failure" }],
      failurePolicy
    };

    const failureRunner = new PlaywrightRunner({ flows: [flowAbad, flowB, flowC], productionOffline: false, resourcesRoot });
    const failureResult = await failureRunner.executeScenario(failureScenario, await makeContext("flowAbad"), instanceConfig);
    const failureRan = failureResult.flows.map((f) => f.flowId);
    check(
      "failure link runs flowC (recovery) and skips flowB",
      failureRan.includes("flowAbad") && failureRan.includes("flowC") && !failureRan.includes("flowB"),
      `status=${failureResult.status} ran=${failureRan.join(",")}`
    );

    // ── Run Another Flow recursion guard ─────────────────────────────────────
    const connectorOrchestrator = new ScenarioOrchestrator();
    const invalidMultipleStandard: ScenarioProfile = {
      ...successScenario,
      id: "sc-invalid-multiple-standard",
      links: [
        { id: "std1", sourceFlowId: "flowA", targetFlowId: "flowB", type: "success" },
        { id: "std2", sourceFlowId: "flowA", targetFlowId: "flowC", type: "failure" }
      ]
    };
    const invalidMultiplePlan = connectorOrchestrator.createExecutionPlan(invalidMultipleStandard);
    check(
      "workflow runtime validation blocks multiple standard outgoing links",
      invalidMultiplePlan.validationIssues.some((issue) => issue.severity === "error" && issue.message.includes("multiple standard outgoing")),
      invalidMultiplePlan.validationIssues.map((issue) => issue.message).join(" | ")
    );

    const invalidCrossLoop: ScenarioProfile = {
      ...successScenario,
      id: "sc-invalid-cross-loop",
      links: [{ id: "loop1", sourceFlowId: "flowA", targetFlowId: "flowB", type: "loop" }]
    };
    const invalidCrossLoopPlan = connectorOrchestrator.createExecutionPlan(invalidCrossLoop);
    check(
      "workflow runtime validation blocks cross-flow loop links",
      invalidCrossLoopPlan.validationIssues.some((issue) => issue.severity === "error" && issue.message.includes("must return to the same flow")),
      invalidCrossLoopPlan.validationIssues.map((issue) => issue.message).join(" | ")
    );

    const validLoopWithConditionalExit: ScenarioProfile = {
      ...successScenario,
      id: "sc-valid-loop-exit",
      links: [
        { id: "loop2", sourceFlowId: "flowA", targetFlowId: "flowA", type: "loop" },
        { id: "cond-exit", sourceFlowId: "flowA", targetFlowId: "flowB", type: "conditional", condition: { expression: "${runtimeInputs.done} === true" } }
      ]
    };
    const validLoopPlan = connectorOrchestrator.createExecutionPlan(validLoopWithConditionalExit);
    check(
      "workflow runtime validation allows self-loop with conditional exit",
      validLoopPlan.validationIssues.every((issue) => issue.severity !== "error"),
      validLoopPlan.validationIssues.map((issue) => issue.message).join(" | ")
    );

    const invalidLoopExit: ScenarioProfile = {
      ...successScenario,
      id: "sc-invalid-loop-exit",
      links: [
        { id: "loop3", sourceFlowId: "flowA", targetFlowId: "flowA", type: "loop" },
        { id: "success-exit", sourceFlowId: "flowA", targetFlowId: "flowB", type: "success" }
      ]
    };
    const invalidLoopExitPlan = connectorOrchestrator.createExecutionPlan(invalidLoopExit);
    check(
      "workflow runtime validation blocks non-conditional loop exits",
      invalidLoopExitPlan.validationIssues.some((issue) => issue.severity === "error" && issue.message.includes("must be Conditional")),
      invalidLoopExitPlan.validationIssues.map((issue) => issue.message).join(" | ")
    );

    console.log("Run Another Flow recursion guard:");
    const soloScenario = (flowId: string): ScenarioProfile => ({
      id: `sc-${flowId}`,
      name: flowId,
      executionMode: "sequential",
      maxParallelFlows: 1,
      flows: [{ order: 1, flowId, required: true }],
      links: [],
      failurePolicy
    });
    const runScenario = async (flows: FlowProfile[], entry: string) => {
      const runner = new PlaywrightRunner({ flows, productionOffline: false, resourcesRoot });
      const result = await runner.executeScenario(soloScenario(entry), await makeContext(entry), instanceConfig);
      const logsText = result.logs.map((l) => l.message).join(" | ");
      const errorsText = result.flows.map((f) => f.error ?? "").join(" | ");
      return { status: result.status, text: `${logsText} | ${errorsText}` };
    };

    // Direct: A → A
    const recA = simpleFlow("recA", [{ id: "call", type: "runFlow", name: "call", flowId: "recA" }]);
    const direct = await runScenario([recA], "recA");
    check("direct self-call fails with recursion error", direct.status === "failed" && direct.text.includes("Recursive flow call detected"), direct.text.slice(0, 120));

    // Indirect: A → B → A
    const indA = simpleFlow("indA", [{ id: "call", type: "runFlow", name: "call", flowId: "indB" }]);
    const indB = simpleFlow("indB", [{ id: "call", type: "runFlow", name: "call", flowId: "indA" }]);
    const indirect = await runScenario([indA, indB], "indA");
    check("indirect recursion fails with recursion error", indirect.status === "failed" && indirect.text.includes("Recursive flow call detected"), indirect.text.slice(0, 120));

    // Max depth: d1 → d2 → … → d6 (guard trips at depth 5)
    const depthFlows: FlowProfile[] = [];
    for (let i = 1; i <= 5; i += 1) depthFlows.push(simpleFlow(`d${i}`, [{ id: "call", type: "runFlow", name: "call", flowId: `d${i + 1}` }]));
    depthFlows.push(simpleFlow("d6", []));
    const depth = await runScenario(depthFlows, "d1");
    check("max nested depth guard trips with clear error", depth.status === "failed" && depth.text.includes("Maximum nested flow depth"), depth.text.slice(0, 120));
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
