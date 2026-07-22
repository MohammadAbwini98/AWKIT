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
import { CancellationTokenSource } from "@src/runner/concurrency/CancellationToken";
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
    await page.goto("about:blank");
    await page.setContent(html, { waitUntil: "load" });
    const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx);
    const start = Date.now();
    const result = await exec.execute(step);
    return { status: result.status, error: result.error, ms: Date.now() - start };
  }

  // Runs a step with a cancellation token that fires mid-wait, so we can prove Stop interrupts
  // immediately (the step ends far before the wait's own timeout).
  async function runCancellable(html: string, step: FlowStep, cancelAfterMs: number): Promise<{ status: string; error?: string; ms: number }> {
    await page.goto("about:blank");
    await page.setContent(html, { waitUntil: "load" });
    const source = new CancellationTokenSource();
    const exec = new StepExecutor(
      page, new LocatorFactory(page), new ValueResolver(ctx), ctx,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, source.token
    );
    const start = Date.now();
    const pending = exec.execute(step);
    const timer = setTimeout(() => void source.cancel("stopped by test"), cancelAfterMs);
    const result = await pending;
    clearTimeout(timer);
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

  // 6. Stale recorder response waits on a successful navigation are treated as optional hints.
  {
    const { status } = await run(`<div>before</div>`, {
      id: "s5b",
      type: "goto",
      name: "Navigate with stale recorded response wait",
      url: "data:text/html,<title>navigated</title><main>ready</main>",
      afterWaits: [
        {
          type: "response",
          method: "POST",
          urlContains: "/api/old-bootstrap",
          armBeforeAction: true,
          timeoutMs: 250,
          reason: "Recorder-observed bootstrap response that may not repeat after session reuse"
        }
      ]
    });
    check("goto skips stale recorded response wait after successful navigation", status === "passed", status);
  }

  // 7. A stale response wait after a non-navigation action still fails.
  {
    const { status, error } = await run(`<button id="b">Save</button>`, {
      id: "s5c",
      type: "click",
      name: "Click without response",
      locator: { strategy: "id", value: "b" },
      afterWaits: [
        {
          type: "response",
          method: "POST",
          urlContains: "/api/missing",
          armBeforeAction: true,
          timeoutMs: 250,
          reason: "Recorder-observed response that should remain required for clicks"
        }
      ]
    });
    check("non-goto stale response wait still fails", status === "failed", status);
    check("non-goto stale response diagnostic remains intact", /Wait type: response/.test(error ?? ""), error);
  }

  // 8. loaderHidden waits for a visible spinner to disappear.
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

  // 9. elementEnabled waits until a disabled control becomes enabled.
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

  // 10. tableHasRows waits until rows are rendered.
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

  // 11. urlChanged waits after the action changes the URL (hash change).
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

  // 12. fixedDelay fallback actually delays.
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

  // 13. Timeout produces a clear diagnostic.
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

  // 14. An immediate HTTP 500 is reported by status, NOT as a generic timeout (async-awareness).
  {
    await page.route("**/api/orders", (route) => route.fulfill({ status: 500, contentType: "text/plain", body: "err" }));
    const html = `<button id="b" onclick="fetch('http://awtkit.test/api/orders',{method:'POST',mode:'no-cors'})">Order</button>`;
    const { status, error } = await run(html, {
      id: "s12",
      type: "click",
      name: "Submit order",
      locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "response", method: "POST", urlContains: "/api/orders", statusRange: [200, 299], armBeforeAction: true, timeoutMs: 5000 }]
    });
    check("HTTP 500 fails the step", status === "failed", status);
    check("HTTP 500 reported by status (contains 'HTTP 500')", /HTTP 500/.test(error ?? ""), error);
    check("HTTP 500 NOT reported as a timeout", !/timed out|Timeout:/i.test(error ?? ""), error);
    check("HTTP 500 names it a status error", /status error/i.test(error ?? "") || /Unexpected API status/i.test(error ?? ""), error);
    await page.unroute("**/api/orders");
  }

  // 15. A matched endpoint with an acceptable status still passes (regression for the refactor).
  {
    await page.route("**/api/ok", (route) => setTimeout(() => route.fulfill({ status: 201, contentType: "text/plain", body: "created" }), 100));
    const html = `<button id="b" onclick="fetch('http://awtkit.test/api/ok',{method:'POST',mode:'no-cors'})">Create</button>`;
    const { status } = await run(html, {
      id: "s13",
      type: "click",
      name: "Create",
      locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "response", method: "POST", urlContains: "/api/ok", statusRange: [200, 299], armBeforeAction: true, timeoutMs: 5000 }]
    });
    check("HTTP 201 within expected range still passes", status === "passed", status);
    await page.unroute("**/api/ok");
  }

  // ── Loader lifecycle (awkit-62o) ───────────────────────────────────────────
  console.log("Loader lifecycle:");
  // 16. Loader already visible → appearance seen immediately, then completes on hide.
  {
    const html = `<div id="sp" class="spinner">loading…</div>
      <button id="b" onclick="setTimeout(function(){document.getElementById('sp').style.display='none';},150)">Go</button>`;
    const { status } = await run(html, {
      id: "L1", type: "click", name: "Go", locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "loaderHidden", locator: { strategy: "css", value: "#sp" }, appearanceGraceMs: 1000, mustAppear: true, completion: "hidden", timeoutMs: 3000 }]
    });
    check("loader already visible → lifecycle passes", status === "passed", status);
  }
  // 17. Loader appears ~500ms after the action (must not be skipped).
  {
    const html = `<div id="sp" class="spinner" style="display:none">loading…</div>
      <button id="b" onclick="var s=document.getElementById('sp');setTimeout(function(){s.style.display='';},500);setTimeout(function(){s.style.display='none';},900)">Go</button>`;
    const { status } = await run(html, {
      id: "L2", type: "click", name: "Go", locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "loaderHidden", locator: { strategy: "css", value: "#sp" }, appearanceGraceMs: 1500, mustAppear: true, timeoutMs: 3000 }]
    });
    check("loader appearing after 500ms is caught then completes", status === "passed", status);
  }
  // 18. Loader appears and disappears quickly, optional → safely classified (passes either way).
  {
    const html = `<div id="sp" class="spinner" style="display:none">x</div>
      <button id="b" onclick="var s=document.getElementById('sp');s.style.display='';setTimeout(function(){s.style.display='none';},50)">Go</button>`;
    const { status } = await run(html, {
      id: "L3", type: "click", name: "Go", locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "loaderHidden", locator: { strategy: "css", value: "#sp" }, appearanceGraceMs: 1000, mustAppear: false, timeoutMs: 3000 }]
    });
    check("very fast loader flash (optional) is safely classified as complete", status === "passed", status);
  }
  // 19. Optional loader never appears → does not block.
  {
    const html = `<div id="sp" class="spinner" style="display:none">x</div><button id="b">Go</button>`;
    const { status, ms } = await run(html, {
      id: "L4", type: "click", name: "Go", locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "loaderHidden", locator: { strategy: "css", value: "#sp" }, appearanceGraceMs: 300, mustAppear: false, timeoutMs: 5000 }]
    });
    check("optional loader never appears → passes (does not block)", status === "passed", status);
    check("optional missing loader returns after ~grace, not the full timeout", ms < 2000, `${ms}ms`);
  }
  // 20. Required loader never appears → precise diagnostic.
  {
    const html = `<div id="sp" class="spinner" style="display:none">x</div><button id="b">Go</button>`;
    const { status, error } = await run(html, {
      id: "L5", type: "click", name: "Go", locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "loaderHidden", locator: { strategy: "css", value: "#sp" }, appearanceGraceMs: 300, mustAppear: true, timeoutMs: 5000 }]
    });
    check("required loader never appears → fails", status === "failed", status);
    check("required-missing-loader diagnostic is precise", /never appeared/.test(error ?? "") && /Loader lifecycle/.test(error ?? ""), error);
  }
  // 21. Loader appears but never disappears → clear failure.
  {
    const html = `<div id="sp" class="spinner" style="display:none">x</div>
      <button id="b" onclick="document.getElementById('sp').style.display=''">Go</button>`;
    const { status, error } = await run(html, {
      id: "L6", type: "click", name: "Go", locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "loaderHidden", locator: { strategy: "css", value: "#sp" }, appearanceGraceMs: 1000, mustAppear: true, completion: "hidden", timeoutMs: 400 }]
    });
    check("loader that never disappears → fails", status === "failed", status);
    check("never-disappears diagnostic names the completion signal", /did not reach 'hidden'/.test(error ?? ""), error);
  }
  // 22. aria-busy transitions from true to false → completes.
  {
    const html = `<div id="sp" class="spinner" aria-busy="true" style="display:none">x</div>
      <button id="b" onclick="var s=document.getElementById('sp');s.style.display='';setTimeout(function(){s.setAttribute('aria-busy','false');},200)">Go</button>`;
    const { status } = await run(html, {
      id: "L7", type: "click", name: "Go", locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "loaderHidden", locator: { strategy: "css", value: "#sp" }, appearanceGraceMs: 1000, mustAppear: true, completion: "ariaBusyFalse", timeoutMs: 3000 }]
    });
    check("aria-busy true→false completes the loader", status === "passed", status);
  }

  // ── Completion policies + API/UI consistency (awkit-62o) ────────────────────
  console.log("Completion policies + consistency:");
  // 23. networkThenUi: API succeeds but the required UI outcome never appears → consistency failure.
  {
    await page.route("**/api/save", (route) => setTimeout(() => route.fulfill({ status: 200, contentType: "text/plain", body: "ok" }), 100));
    const html = `<button id="b" onclick="fetch('http://awtkit.test/api/save',{method:'POST',mode:'no-cors'})">Save</button>`;
    const { status, error } = await run(html, {
      id: "C1", type: "click", name: "Save", locator: { strategy: "id", value: "b" },
      completionMode: "networkThenUi",
      afterWaits: [
        { type: "response", method: "POST", urlContains: "/api/save", statusRange: [200, 299], armBeforeAction: true, timeoutMs: 3000 },
        { type: "textVisible", text: "Saved successfully", timeoutMs: 600 }
      ]
    });
    check("networkThenUi: API ok but missing UI outcome → fails", status === "failed", status);
    check("consistency msg: API completed but UI outcome did not appear", /required UI outcome did not appear/.test(error ?? ""), error);
    await page.unroute("**/api/save");
  }
  // 24. networkThenUi: required API fails (500) but the UI mutated → inconsistency reported.
  {
    await page.route("**/api/orders", (route) => setTimeout(() => route.fulfill({ status: 500, contentType: "text/plain", body: "err" }), 100));
    const html = `<button id="b" onclick="fetch('http://awtkit.test/api/orders',{method:'POST',mode:'no-cors'});var d=document.createElement('div');d.textContent='Changed';document.body.appendChild(d)">Order</button>`;
    const { status, error } = await run(html, {
      id: "C2", type: "click", name: "Order", locator: { strategy: "id", value: "b" },
      completionMode: "networkThenUi",
      afterWaits: [
        { type: "response", method: "POST", urlContains: "/api/orders", statusRange: [200, 299], armBeforeAction: true, timeoutMs: 3000 },
        { type: "textVisible", text: "Changed", timeoutMs: 3000 }
      ]
    });
    check("networkThenUi: required API fails but UI changed → fails", status === "failed", status);
    check("consistency msg: API failed but UI changed", /required API request failed, but the UI changed/.test(error ?? ""), error);
    await page.unroute("**/api/orders");
  }
  // 25. allRequired: two required conditions pass, one optional fails → step still passes.
  {
    const html = `<button id="b" onclick="setTimeout(function(){var d=document.createElement('div');d.textContent='Done';document.body.appendChild(d);},100)">Go</button>`;
    const { status } = await run(html, {
      id: "C3", type: "click", name: "Go", locator: { strategy: "id", value: "b" },
      afterWaits: [
        { type: "textVisible", text: "Done", timeoutMs: 2000 },
        { type: "elementVisible", locator: { strategy: "id", value: "b" }, timeoutMs: 2000 },
        { type: "textVisible", text: "NeverShows", optional: true, timeoutMs: 300 }
      ]
    });
    check("allRequired: optional failure does not fail the step", status === "passed", status);
  }
  // 26. quietPeriod: one request then silence (next poll is far away) → completes during the gap.
  {
    await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "ok" }));
    const html = `<button id="b" onclick="fetch('http://awtkit.test/api/first',{mode:'no-cors'});setInterval(function(){fetch('http://awtkit.test/api/poll',{mode:'no-cors'});},2500)">Go</button>`;
    const { status, ms } = await run(html, {
      id: "C4", type: "click", name: "Go", locator: { strategy: "id", value: "b" },
      completionMode: "quietPeriod",
      afterWaits: []
    });
    check("quietPeriod: completes once the network is quiet", status === "passed", status);
    check("quietPeriod: waits the quiet window but not the next poll", ms >= 600 && ms < 2400, `${ms}ms`);
    await page.unroute("**/api/**");
  }
  // 27. Valid empty result: an empty-state UI outcome passes (not treated as missing table rows).
  {
    await page.route("**/api/search", (route) => setTimeout(() => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }), 100));
    const html = `<button id="b" onclick="fetch('http://awtkit.test/api/search',{mode:'no-cors'}).then(function(){var d=document.createElement('div');d.textContent='No results';document.body.appendChild(d);})">Search</button>`;
    const { status } = await run(html, {
      id: "C5", type: "click", name: "Search", locator: { strategy: "id", value: "b" },
      completionMode: "networkThenUi",
      afterWaits: [
        { type: "response", method: "GET", urlContains: "/api/search", statusRange: [200, 299], armBeforeAction: true, timeoutMs: 3000 },
        { type: "textVisible", text: "No results", timeoutMs: 3000 }
      ]
    });
    check("valid empty result: empty-state outcome passes (no forced rows)", status === "passed", status);
    await page.unroute("**/api/search");
  }

  // ── Grouped completion: A AND (B OR C) (awkit-y24) ──────────────────────────
  // The empty-result contract: API success AND (tableHasRows OR emptyStateVisible), under
  // allRequired. The required anyOf group is one afterWait; the API resolving first must NOT satisfy
  // the step while both UI branches are missing.
  console.log("Grouped completion (awkit-y24) — API success AND (rows OR empty-state):");
  const groupWaits = (branchTimeout: number): FlowStep["afterWaits"] => [
    { type: "response", method: "GET", urlContains: "/api/results", statusRange: [200, 299], armBeforeAction: true, timeoutMs: 3000 },
    {
      type: "anyOf",
      timeoutMs: branchTimeout,
      conditions: [
        { type: "tableHasRows", tableLocator: { strategy: "id", value: "t" }, minRows: 1, timeoutMs: branchTimeout },
        { type: "elementVisible", locator: { strategy: "css", value: "[data-testid=empty-state]" }, timeoutMs: branchTimeout }
      ]
    }
  ];
  // 27b. API ok AND the table gains rows → the rows branch satisfies the group.
  {
    await page.route("**/api/results", (route) => setTimeout(() => route.fulfill({ status: 200, contentType: "application/json", body: "[{}]" }), 100));
    const html = `<table id="t"></table><button id="b" onclick="fetch('http://awtkit.test/api/results',{mode:'no-cors'}).then(function(){document.getElementById('t').insertRow().insertCell().textContent='row';})">Go</button>`;
    const { status } = await run(html, {
      id: "G1", type: "click", name: "Results", locator: { strategy: "id", value: "b" },
      completionMode: "allRequired", afterWaits: groupWaits(2500)
    });
    check("group: API ok AND rows present → passes", status === "passed", status);
    await page.unroute("**/api/results");
  }
  // 27c. API ok AND the empty-state appears (no rows) → the OTHER branch satisfies the group.
  {
    await page.route("**/api/results", (route) => setTimeout(() => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }), 100));
    const html = `<table id="t"></table><button id="b" onclick="fetch('http://awtkit.test/api/results',{mode:'no-cors'}).then(function(){var d=document.createElement('div');d.setAttribute('data-testid','empty-state');d.textContent='No results';document.body.appendChild(d);})">Go</button>`;
    const { status } = await run(html, {
      id: "G2", type: "click", name: "Results", locator: { strategy: "id", value: "b" },
      completionMode: "allRequired", afterWaits: groupWaits(2500)
    });
    check("group: API ok AND empty-state present → passes (OR branch)", status === "passed", status);
    await page.unroute("**/api/results");
  }
  // 27d. API ok but NEITHER rows nor empty-state → the required group fails, so the STEP fails.
  //      This is the core contract: a successful API status alone must not override a missing UI outcome.
  {
    await page.route("**/api/results", (route) => setTimeout(() => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }), 100));
    const html = `<table id="t"></table><button id="b" onclick="fetch('http://awtkit.test/api/results',{mode:'no-cors'})">Go</button>`;
    const { status, error } = await run(html, {
      id: "G3", type: "click", name: "Results", locator: { strategy: "id", value: "b" },
      completionMode: "allRequired", afterWaits: groupWaits(700)
    });
    check("group: API ok but NEITHER branch → fails (API alone cannot pass)", status === "failed", status);
    check("group failure names the OR-group branches", /OR-group branches were satisfied/.test(error ?? ""), error);
    await page.unroute("**/api/results");
  }

  // ── 202 → poll-to-terminal (awkit-4km C1) ───────────────────────────────────
  // The runner observes the page's own repeated status responses and completes only when one is
  // terminal — never treating an in-progress 202 as done.
  console.log("API polling (awkit-4km C1) — 202 → terminal:");
  // P1. Status-based: two 202 "processing" polls, then a terminal 200 → passes.
  {
    let calls = 0;
    await page.route("**/api/job", (route) => {
      calls += 1;
      route.fulfill({ status: calls <= 2 ? 202 : 200, contentType: "application/json", body: JSON.stringify({ status: calls <= 2 ? "processing" : "succeeded" }) });
    });
    const html = `<button id="b" onclick="setInterval(function(){fetch('http://awtkit.test/api/job',{mode:'no-cors'});},150)">Go</button>`;
    const { status } = await run(html, {
      id: "P1", type: "click", name: "Job", locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "apiPolling", urlContains: "/api/job", pollingStatus: 202, terminalStatusRange: [200, 299], maxAttempts: 10, timeoutMs: 5000 }]
    });
    check("apiPolling: polls past 202 and completes on terminal 200", status === "passed", status);
    await page.unroute("**/api/job");
  }
  // P2. Field-based: status is always HTTP 200; the JSON `status` field flips to "succeeded" → passes.
  {
    let calls = 0;
    await page.route("**/api/job2", (route) => {
      calls += 1;
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: calls >= 3 ? "succeeded" : "processing" }) });
    });
    const html = `<button id="b" onclick="setInterval(function(){fetch('http://awtkit.test/api/job2',{mode:'no-cors'});},150)">Go</button>`;
    const { status } = await run(html, {
      id: "P2", type: "click", name: "Job2", locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "apiPolling", urlContains: "/api/job2", responseField: "status", terminalValues: ["succeeded", "failed"], maxAttempts: 10, timeoutMs: 5000 }]
    });
    check("apiPolling: field-based terminal (status=succeeded) completes", status === "passed", status);
    await page.unroute("**/api/job2");
  }
  // P3. Never terminal (always 202) → fails after maxAttempts, with a clear diagnostic.
  {
    await page.route("**/api/job3", (route) => route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ status: "processing" }) }));
    const html = `<button id="b" onclick="setInterval(function(){fetch('http://awtkit.test/api/job3',{mode:'no-cors'});},120)">Go</button>`;
    const { status, error } = await run(html, {
      id: "P3", type: "click", name: "Job3", locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "apiPolling", urlContains: "/api/job3", pollingStatus: 202, maxAttempts: 3, timeoutMs: 3000 }]
    });
    check("apiPolling: never terminal → fails after maxAttempts", status === "failed", status);
    check("apiPolling failure names the terminal-state miss", /did not reach a terminal state/.test(error ?? ""), error);
    await page.unroute("**/api/job3");
  }

  // ── Cancellation interrupts every wait phase immediately (awkit-62o) ─────────
  console.log("Cancellation interrupts waits:");
  // 28a. Cancel during a UI-outcome wait.
  {
    const { status, ms } = await runCancellable(`<button id="b">Go</button>`, {
      id: "X1", type: "click", name: "Go", locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "elementVisible", locator: { strategy: "css", value: ".never" }, timeoutMs: 8000 }]
    }, 150);
    check("cancel during UI wait ends fast", status === "failed" && ms < 2000, `${status}/${ms}ms`);
  }
  // 28b. Cancel during an armed API wait.
  {
    const { status, ms } = await runCancellable(`<button id="b" onclick="void 0">Go</button>`, {
      id: "X2", type: "click", name: "Go", locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "response", method: "POST", urlContains: "/api/never", armBeforeAction: true, timeoutMs: 8000 }]
    }, 150);
    check("cancel during API wait ends fast", status === "failed" && ms < 2000, `${status}/${ms}ms`);
  }
  // 28c. Cancel during a loader completion wait.
  {
    const html = `<div id="sp" class="spinner" style="display:none">x</div>
      <button id="b" onclick="document.getElementById('sp').style.display=''">Go</button>`;
    const { status, ms } = await runCancellable(html, {
      id: "X3", type: "click", name: "Go", locator: { strategy: "id", value: "b" },
      afterWaits: [{ type: "loaderHidden", locator: { strategy: "css", value: "#sp" }, appearanceGraceMs: 1000, mustAppear: true, timeoutMs: 8000 }]
    }, 250);
    check("cancel during loader wait ends fast", status === "failed" && ms < 2000, `${status}/${ms}ms`);
  }
  // 28d. Cancel during a quiet-period wait (continuous polling → never quiet on its own).
  {
    const html = `<button id="b" onclick="setInterval(function(){fetch('http://awtkit.test/api/poll',{mode:'no-cors'});},50)">Go</button>`;
    await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "ok" }));
    const { status, ms } = await runCancellable(html, {
      id: "X4", type: "click", name: "Go", locator: { strategy: "id", value: "b" },
      completionMode: "quietPeriod",
      afterWaits: []
    }, 250);
    check("cancel during quiet-period wait ends fast", status === "failed" && ms < 2000, `${status}/${ms}ms`);
    await page.unroute("**/api/**");
  }

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
