import { test, expect, chromium, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { StepExecutor } from "@src/runner/StepExecutor";
import type { FlowExecutionResult } from "@src/runner/RunnerResult";
import type { FlowStep } from "@src/profiles/FlowProfile";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";

const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ["mock-site/server.mjs"], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore"
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Mock site did not start");
});

test.afterAll(() => {
  server?.kill();
});

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
      reports: join(dir, "reports")
    }
  };
}

function makeExecutor(page: Page, context: InstanceExecutionContext, runChild?: (id: string) => Promise<FlowExecutionResult>) {
  return new StepExecutor(page, new LocatorFactory(page), new ValueResolver(context), context, undefined, undefined, runChild);
}

const ok = (r: { status: string; error?: string }) => {
  expect(r.error, r.error).toBeUndefined();
  expect(r.status).toBe("passed");
};

test("StepExecutor drives all core node types against the mock site", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const context = await makeContext();
  const exec = makeExecutor(page, context);

  ok(await exec.execute({ id: "goto", type: "goto", name: "Open login", url: `${BASE}/login` }));
  ok(await exec.execute({ id: "u", type: "fill", name: "Username", locator: { strategy: "id", value: "username" }, value: "tester", config: { clearBeforeFill: true } }));
  ok(await exec.execute({ id: "p", type: "fill", name: "Password", locator: { strategy: "id", value: "password" }, value: "secret" }));
  ok(await exec.execute({ id: "rm", type: "check", name: "Remember", locator: { strategy: "id", value: "rememberMe" } }));
  ok(await exec.execute({ id: "login", type: "click", name: "Login", locator: { strategy: "id", value: "loginButton" } }));
  await page.waitForURL("**/form");

  // Wait by selector visible
  ok(await exec.execute({ id: "wsel", type: "wait", name: "Wait field", locator: { strategy: "id", value: "firstName" }, config: { waitType: "selector" } }));
  ok(await exec.execute({ id: "fn", type: "fill", name: "First name", locator: { strategy: "id", value: "firstName" }, value: "Alice" }));
  // Select by index (single) and multiple
  ok(await exec.execute({ id: "country", type: "select", name: "Country", locator: { strategy: "id", value: "country" }, selectionMode: "index", value: "1" }));
  ok(await exec.execute({ id: "skills", type: "select", name: "Skills", locator: { strategy: "id", value: "skills" }, selectionMode: "index", value: "0,1", config: { selectMultiple: true } }));
  ok(await exec.execute({ id: "gender", type: "radio", name: "Gender", locator: { strategy: "id", value: "genderMale" } }));
  ok(await exec.execute({ id: "terms", type: "check", name: "Accept", locator: { strategy: "id", value: "acceptTerms" } }));

  // Assertion: input value equals
  ok(await exec.execute({ id: "assertVal", type: "assertText", name: "Assert first name", locator: { strategy: "id", value: "firstName" }, config: { assertionType: "value", comparisonOperator: "equals", expectedValue: "Alice" } }));

  // Scroll + element screenshot + full-page screenshot
  ok(await exec.execute({ id: "scroll", type: "scroll", name: "Scroll", config: { scrollDirection: "down", scrollAmount: 300 } }));
  const elShot = await exec.execute({ id: "shotEl", type: "screenshot", name: "Shot submit", locator: { strategy: "id", value: "submitButton" }, config: { screenshotName: "submit" } });
  ok(elShot);
  expect(elShot.screenshotPath && existsSync(elShot.screenshotPath)).toBeTruthy();
  const fullShot = await exec.execute({ id: "shotFull", type: "screenshot", name: "Shot form", config: { fullPage: true, screenshotName: "form" } });
  expect(fullShot.screenshotPath && existsSync(fullShot.screenshotPath)).toBeTruthy();

  // Submit and assert success text contains
  ok(await exec.execute({ id: "submit", type: "click", name: "Submit", locator: { strategy: "id", value: "submitButton" } }));
  await page.waitForURL("**/success*");
  ok(await exec.execute({ id: "assertSuccess", type: "assertText", name: "Assert success", locator: { strategy: "id", value: "successMessage" }, config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "successful" } }));

  await browser.close();
});

test("Loop node executes a fixed-count action with guard", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const context = await makeContext();
  const exec = makeExecutor(page, context);

  await page.goto(`${BASE}/login`);
  const loopStep: FlowStep = {
    id: "loop",
    type: "loop",
    name: "Loop fill",
    locator: { strategy: "id", value: "username" },
    value: "x",
    config: { loopType: "fixedCount", iterationCount: 3, loopActionType: "fill", maxIterations: 100, loopStopOnFailure: true }
  };
  const result = await exec.execute(loopStep);
  ok(result);
  expect(result.outputs.iterations).toBe(3);
  await browser.close();
});

test("Run Another Flow passes through child result and fails parent on child failure", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const context = await makeContext();

  const passingChild = async (id: string): Promise<FlowExecutionResult> => ({
    flowId: id,
    status: "passed",
    startedAt: "",
    endedAt: "",
    durationMs: 0,
    steps: [],
    outputs: { "child.value": "ok" }
  });
  const passing = makeExecutor(page, context, passingChild);
  const passed = await passing.execute({ id: "rf", type: "runFlow", name: "Run child", flowId: "flow-child" });
  ok(passed);
  expect(passed.outputs.childFlowStatus).toBe("passed");

  const failingChild = async (id: string): Promise<FlowExecutionResult> => ({
    flowId: id,
    status: "failed",
    startedAt: "",
    endedAt: "",
    durationMs: 0,
    steps: [],
    outputs: {},
    error: "child boom"
  });
  const failing = makeExecutor(page, context, failingChild);
  const failed = await failing.execute({ id: "rf2", type: "runFlow", name: "Run child", flowId: "flow-child", config: { stopParentOnChildFailure: true } });
  expect(failed.status).toBe("failed");

  await browser.close();
});
