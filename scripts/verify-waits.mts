/**
 * Live verification of the Smart Wait Engine (Phase 1 — runner execution).
 * Run with: npx tsx scripts/verify-waits.mts
 *
 * Drives `StepExecutor.execute` against crafted pages and asserts that a step's
 * `beforeWaits`/`afterWaits` run around its action, that action-triggered `response` waits are
 * armed before the click, and that failures produce clear diagnostics — while legacy steps
 * (no waits) and the legacy `wait` step node keep working unchanged.
 */
import { chromium } from "playwright";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { StepExecutor } from "@src/runner/StepExecutor";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { FlowStep } from "@src/profiles/FlowProfile";

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

async function makeContext(): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "wfs-waits-"));
  return {
    executionId: "exec-1",
    instanceId: "inst-1",
    scenarioId: "scen-1",
    flowId: "flow-1",
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page: Page = await context.newPage();
  const ctx = await makeContext();

  async function run(html: string, step: FlowStep): Promise<{ status: string; error?: string; ms: number }> {
    await page.setContent(html, { waitUntil: "load" });
    const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx);
    const start = Date.now();
    const result = await exec.execute(step);
    return { status: result.status, error: result.error, ms: Date.now() - start };
  }

  console.log("Smart Wait Engine — Phase 1 (runner execution)");

  // 1. Backward compat: a step with no beforeWaits/afterWaits runs exactly as before.
  {
    const { status } = await run(`<button id="b">Go</button>`, { id: "s1", type: "click", name: "Click Go", locator: { strategy: "id", value: "b" } });
    check("no-waits step still executes", status === "passed", status);
  }

  // 2. Backward compat: the legacy `wait` step node (fixed time) still executes.
  {
    const { status } = await run(`<div>idle</div>`, { id: "s2", type: "wait", name: "Wait", timeoutMs: 50, config: { waitType: "time" } });
    check("legacy wait step node still executes", status === "passed", status);
  }

  // 3. beforeWaits run before the action (element revealed shortly after load).
  {
    const html = `<button id="go" style="display:none">Go</button>
      <script>setTimeout(function(){document.getElementById('go').style.display='';},150)</script>`;
    const { status } = await run(html, {
      id: "s3",
      type: "click",
      name: "Click Go",
      locator: { strategy: "id", value: "go" },
      beforeWaits: [{ type: "elementVisible", locator: { strategy: "id", value: "go" }, timeoutMs: 3000 }]
    });
    check("beforeWaits: elementVisible gate then action passes", status === "passed", status);
  }

  // 4. afterWaits run after the action (text appears after click).
  {
    const html = `<button id="b" onclick="setTimeout(function(){var d=document.createElement('div');d.textContent='Saved successfully';document.body.appendChild(d);},150)">Save</button>`;
    const { status } = await run(html, {
      id: "s4",
      type: "click",
      name: "Click Save",
      locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "textVisible", text: "Saved successfully", timeoutMs: 3000 }]
    });
    check("afterWaits: textVisible after action passes", status === "passed", status);
  }

  // 5. response wait armed BEFORE the click (fast route-fulfilled POST).
  {
    await page.route("**/api/save", (route) => setTimeout(() => route.fulfill({ status: 200, contentType: "text/plain", body: "ok" }), 150));
    const html = `<button id="b" onclick="fetch('http://awtkit.test/api/save',{method:'POST',mode:'no-cors'})">Save</button>`;
    const { status } = await run(html, {
      id: "s5",
      type: "click",
      name: "Click Save",
      locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "response", method: "POST", urlContains: "/api/save", armBeforeAction: true, timeoutMs: 5000 }]
    });
    check("response(armBeforeAction) resolves for action-triggered POST", status === "passed", status);
    await page.unroute("**/api/save");
  }

  // 6. loaderHidden waits for a visible spinner to disappear.
  {
    const html = `<div class="spinner">loading…</div>
      <button id="b" onclick="setTimeout(function(){document.querySelector('.spinner').style.display='none';},150)">Go</button>`;
    const { status } = await run(html, {
      id: "s6",
      type: "click",
      name: "Click Go",
      locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "loaderHidden", locator: { strategy: "css", value: ".spinner" }, timeoutMs: 3000 }]
    });
    check("loaderHidden: waits for visible loader to disappear", status === "passed", status);
  }

  // 7. elementEnabled waits until a disabled control becomes enabled.
  {
    const html = `<button id="c" disabled>Continue</button>
      <button id="b" onclick="setTimeout(function(){document.getElementById('c').disabled=false;},150)">Enable</button>`;
    const { status } = await run(html, {
      id: "s7",
      type: "click",
      name: "Click Enable",
      locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "elementEnabled", locator: { strategy: "id", value: "c" }, timeoutMs: 3000 }]
    });
    check("elementEnabled: waits until control is enabled", status === "passed", status);
  }

  // 8. tableHasRows waits until rows are rendered.
  {
    const html = `<table id="t"><tbody></tbody></table>
      <button id="b" onclick="setTimeout(function(){var r=document.createElement('tr');r.innerHTML='<td>x</td>';document.querySelector('#t tbody').appendChild(r);},150)">Load</button>`;
    const { status } = await run(html, {
      id: "s8",
      type: "click",
      name: "Click Load",
      locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "tableHasRows", tableLocator: { strategy: "id", value: "t" }, minRows: 1, timeoutMs: 3000 }]
    });
    check("tableHasRows: waits until row count reaches minimum", status === "passed", status);
  }

  // 9. urlChanged waits after the action changes the URL (hash change).
  {
    const html = `<button id="b" onclick="location.hash='done'">Submit</button>`;
    const { status } = await run(html, {
      id: "s9",
      type: "click",
      name: "Click Submit",
      locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "urlChanged", urlContains: "#done", timeoutMs: 3000 }]
    });
    check("urlChanged: waits until URL matches after action", status === "passed", status);
  }

  // 10. fixedDelay fallback actually delays.
  {
    const { status, ms } = await run(`<button id="b">Go</button>`, {
      id: "s10",
      type: "click",
      name: "Click Go",
      locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "fixedDelay", delayMs: 200 }]
    });
    check("fixedDelay: fallback delay executes", status === "passed", status);
    check("fixedDelay: actually waited ~>=200ms", ms >= 180, `${ms}ms`);
  }

  // 11. Timeout produces a clear diagnostic.
  {
    const { status, error } = await run(`<button id="b">Go</button>`, {
      id: "s11",
      type: "click",
      name: "Click Go",
      locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "elementVisible", locator: { strategy: "css", value: ".missing" }, timeoutMs: 300, reason: "Missing element diagnostic test" }]
    });
    check("wait timeout fails the step", status === "failed", status);
    check("diagnostic names the wait phase", /Phase: after action/.test(error ?? ""), error);
    check("diagnostic names the wait type", /Wait type: elementVisible/.test(error ?? ""), error);
    check("diagnostic shows the timeout", /Timeout: 300ms/.test(error ?? ""), error);
    check("diagnostic includes sanitized current URL", /Current URL:/.test(error ?? ""), error);
    check("diagnostic includes recorder reason", /Recorded reason: Missing element diagnostic test/.test(error ?? ""), error);
    check("diagnostic includes a suggestion", /Suggestion:/.test(error ?? ""), error);
  }

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
