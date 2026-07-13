/**
 * Real Electron walkthrough for Instance Monitor workflow summaries, drill-down, and bulk stop.
 * Uses an isolated temporary LOCALAPPDATA profile and a slow loopback-only workflow.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-instance-monitor-"));
const localAppData = path.join(tempRoot, "LocalAppData");
const runtimeRoot = path.join(localAppData, "WebFlow Studio");
const port = 4412;
const base = `http://127.0.0.1:${port}`;
const results = [];

function check(name, pass, detail = "") {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function writeJson(directory, fileName, value) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Mock site did not start.");
}

const now = new Date().toISOString();
writeJson(path.join(runtimeRoot, "flows"), "mock-instance-slow-flow.json", {
  id: "mock-instance-slow-flow",
  name: "Mock — Slow Instance Summary Flow",
  description: "Loopback-only delayed navigation for Instance Monitor verification.",
  version: 1,
  createdAt: now,
  updatedAt: now,
  nodes: [
    { id: "start", type: "start", name: "Start" },
    {
      id: "open-local-page",
      type: "goto",
      name: "Open local test page",
      url: `${base}/`,
      valueSource: { type: "static", value: `${base}/` },
      timeoutMs: 30000
    },
    {
      id: "slow-wait",
      type: "wait",
      name: "Keep instance active for stop verification",
      valueSource: { type: "static", value: "15000" },
      config: { waitType: "time" },
      timeoutMs: 15000
    },
    { id: "end", type: "end", name: "End" }
  ],
  edges: [
    { id: "edge-start", source: "start", target: "open-local-page", type: "success" },
    { id: "edge-wait", source: "open-local-page", target: "slow-wait", type: "success" },
    { id: "edge-end", source: "slow-wait", target: "end", type: "success" }
  ]
});
writeJson(path.join(runtimeRoot, "workflows"), "mock-instance-summary-workflow.json", {
  id: "mock-instance-summary-workflow",
  name: "Mock — Instance Summary Workflow",
  description: "Four local-only instances for workflow summary and stop-all verification.",
  version: 1,
  createdAt: now,
  updatedAt: now,
  nodes: [
    {
      id: "slow-flow-ref",
      type: "flowRef",
      flowId: "mock-instance-slow-flow",
      alias: "Slow local flow",
      order: 1,
      required: true,
      inputBindings: {},
      retryPolicy: { count: 0, delayMs: 0 },
      failurePolicy: "stop",
      position: { x: 0, y: 0 }
    }
  ],
  edges: [],
  runtimeInputs: [],
  execution: { mode: "sequential", maxConcurrentInstances: 2, stopOnRequiredFlowFailure: true }
});

const server = spawn(process.execPath, ["mock-site/server.mjs"], {
  cwd: root,
  env: { ...process.env, MOCK_SITE_PORT: String(port) },
  stdio: "ignore"
});

let app;
try {
  await waitForServer();
  const env = {
    ...process.env,
    LOCALAPPDATA: localAppData,
    APPDATA: path.join(tempRoot, "AppData"),
    PRODUCTION_OFFLINE: "true"
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [root], cwd: root, env });
  const win = await app.firstWindow();
  const consoleErrors = [];
  const pageErrors = [];
  win.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
  win.on("pageerror", (error) => pageErrors.push(error.message));
  await win.waitForLoadState("domcontentloaded");
  await win.getByRole("button", { name: "Instances", exact: true }).click();

  const card = win.locator('article[aria-label="Workflow Mock — Instance Summary Workflow"]');
  await card.waitFor({ state: "visible" });
  await card.focus();
  await card.getByLabel("Total runs").fill("4");
  await card.getByLabel("Concurrent").fill("2");
  await card.getByRole("button", { name: "Run workflow" }).click();

  const runRecord = win.getByTestId("workflow-run-record");
  await runRecord.waitFor({ state: "visible", timeout: 10000 });
  check("Workflow execution appears as one clickable summary record", (await runRecord.count()) === 1);
  const recordText = (await runRecord.textContent()) ?? "";
  check("Workflow summary shows all four instances", /4 instances/i.test(recordText), recordText.replace(/\s+/g, " ").trim());
  const stopEnabled = await win.locator("#im-stop-all").isEnabled();
  check("Stop Pending & Running is enabled while work is active", stopEnabled);

  await runRecord.click();
  const modal = win.getByTestId("workflow-instances-modal");
  await modal.waitFor({ state: "visible" });
  check("Clicking the workflow record opens the detail modal", await modal.isVisible());
  check("Workflow detail modal receives focus on open", await modal.evaluate((element) => document.activeElement === element));
  await win.keyboard.press("Shift+Tab");
  check("Workflow detail modal traps keyboard focus", await modal.evaluate((element) => element.contains(document.activeElement)));
  check("Workflow detail modal lists every instance", (await modal.getByTestId("workflow-instance-detail-row").count()) === 4);
  check("Workflow detail modal exposes per-instance report actions", (await modal.getByRole("button", { name: /Open report for/ }).count()) === 4);
  if (process.env.AWKIT_INSTANCE_MONITOR_EVIDENCE) {
    await win.screenshot({ path: process.env.AWKIT_INSTANCE_MONITOR_EVIDENCE });
  }
  if (!stopEnabled) {
    const instanceDetails = await modal.getByTestId("workflow-instance-detail-row").allTextContents();
    await modal.getByRole("button", { name: /Open report for/ }).first().click();
    const report = win.locator(".report-modal");
    await report.waitFor({ state: "visible" });
    throw new Error(`Slow verification workflow terminated before bulk stop. Instances=${JSON.stringify(instanceDetails)} Report=${JSON.stringify((await report.textContent()) ?? "")}`);
  }
  await modal.getByRole("button", { name: "Close workflow instance details" }).click();

  await win.locator("#im-stop-all").click();
  const confirm = win.getByRole("alertdialog");
  await confirm.waitFor({ state: "visible" });
  check("Bulk stop requires confirmation", /4 pending or running instances/i.test((await confirm.textContent()) ?? ""));
  await confirm.getByRole("button", { name: "Stop instances" }).click();
  await win.getByText(/Stop requested for 4 pending or running instances/i).waitFor({ timeout: 10000 });
  await win.waitForFunction(() => {
    const pills = [...document.querySelectorAll(".instance-table tbody .state-pill")];
    return pills.length === 4 && pills.every((pill) => pill.textContent?.trim() === "Cancelled");
  }, undefined, { timeout: 15000 });
  check("Bulk stop cancels running and queued instances", (await win.locator(".instance-table tbody .state-pill", { hasText: "Cancelled" }).count()) === 4);
  check("Bulk stop disables after no cancellable work remains", await win.locator("#im-stop-all").isDisabled());
  check("Instance Monitor emits no renderer errors", pageErrors.length === 0 && consoleErrors.length === 0, JSON.stringify({ pageErrors, consoleErrors }));

  const passed = results.filter((result) => result.pass).length;
  console.log(`\n${passed}/${results.length} Instance Monitor GUI checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.error("Instance Monitor GUI verification failed:", error);
  process.exitCode = 2;
} finally {
  if (app) await app.close().catch(() => undefined);
  if (server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  const resolvedTemp = path.resolve(tempRoot);
  if (resolvedTemp.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolvedTemp, { recursive: true, force: true });
}
