/**
 * Instrumented closed-shadow acceptance gate (awkit-65g Phase C2 / awkit-3zf).
 *
 * Run with: npm run verify:closed-shadow
 *
 * Drives the REAL responsible layers — recorderInitScript closed-shadow capture, buildRecordedFlow, and
 * LocatorFactory.resolveClosedShadow (via the closedShadowBridge init script + custom selector engine) /
 * StepExecutor — against live pages whose target lives inside a CLOSED shadow root. Playwright's built-in
 * engines cannot pierce closed roots; the bridge retains them privately (per-process token Symbol) and the
 * engine walks the recorded host chain. A missing/changed host or target, or a missing bridge, must fail
 * deterministically (no false-valid, no side effect). Security boundaries: docs/ai/security-reviews/2026-08-04-closed-shadow-c2.md.
 */
import { chromium } from "playwright";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { closedShadowBridgeScript } from "@src/runner/closedShadowBridge";
import { validateFlowDefinition, hasActivePathError } from "@src/validation/FlowValidator";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";

const PORT = 4418;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

// A page that records the last posted click label, plus a script that builds one or more shadow roots.
const page = (script: string): string => `<!doctype html><html><body>
  <div id="host" style="display:block;width:240px;height:60px"></div>
  <script>
    window.__lastClick = "";
    window.addEventListener('message', function (e) { if (e.data && e.data.cs) window.__lastClick = e.data.cs; });
    ${script}
  </script>
</body></html>`;

// A button (filling its root) as a JS string literal for innerHTML assignment.
const button = (label: string): string => `'<button id="go" style="width:100%;height:100%">Submit ${label}</button>'`;

const ROUTES: Record<string, string> = {
  // Single closed root.
  "/single": page(`
    var root = document.getElementById('host').attachShadow({mode:'closed'});
    root.innerHTML = ${button("single")};
    root.getElementById('go').addEventListener('click', function(){ window.top.postMessage({cs:'single'}, '*'); });
  `),
  // Two nested closed roots.
  "/nested": page(`
    var outer = document.getElementById('host').attachShadow({mode:'closed'});
    outer.innerHTML = '<div id="inner" style="display:block;width:100%;height:100%"></div>';
    var inner = outer.getElementById('inner').attachShadow({mode:'closed'});
    inner.innerHTML = ${button("nested")};
    inner.getElementById('go').addEventListener('click', function(){ window.top.postMessage({cs:'nested'}, '*'); });
  `),
  // Open root inside a closed root.
  "/open-in-closed": page(`
    var outer = document.getElementById('host').attachShadow({mode:'closed'});
    outer.innerHTML = '<div id="inner" style="display:block;width:100%;height:100%"></div>';
    var inner = outer.getElementById('inner').attachShadow({mode:'open'});
    inner.innerHTML = ${button("openInClosed")};
    inner.getElementById('go').addEventListener('click', function(){ window.top.postMessage({cs:'openInClosed'}, '*'); });
  `),
  // Closed root inside an open root.
  "/closed-in-open": page(`
    var outer = document.getElementById('host').attachShadow({mode:'open'});
    outer.innerHTML = '<div id="inner" style="display:block;width:100%;height:100%"></div>';
    var inner = outer.getElementById('inner').attachShadow({mode:'closed'});
    inner.innerHTML = ${button("closedInOpen")};
    inner.getElementById('go').addEventListener('click', function(){ window.top.postMessage({cs:'closedInOpen'}, '*'); });
  `)
};

function serve(): Promise<Server> {
  const server = createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];
    res.setHeader("content-type", "text/html");
    res.end(ROUTES[path] ?? "<!doctype html><html><body>not found</body></html>");
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

async function makeContext(): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "wfs-cs-"));
  return {
    executionId: "exec-cs", instanceId: "inst-1", scenarioId: "scen-1", flowId: "flow-cs",
    instanceOrderNumber: 1, totalInstances: 1, runtimeInputs: {}, instanceInputs: {}, flowOutputs: {},
    paths: { downloads: join(dir, "d"), screenshots: join(dir, "s"), logs: join(dir, "l"), reports: join(dir, "r"), sessions: join(dir, "se") }
  };
}

let recorderScript: string;

/** Click the host's centre (which hits the button inside the closed root) and return the recorded action. */
async function capture(browser: Browser, url: string): Promise<RecordedAction> {
  const ctx = await browser.newContext();
  await ctx.addInitScript({ content: recorderScript });
  const p = await ctx.newPage();
  const actions: RecordedAction[] = [];
  await p.exposeBinding("__awtkit_recordAction", (_s, a) => actions.push(a as RecordedAction));
  await p.exposeBinding("__awtkit_recordSignal", () => {});
  await p.goto(url);
  await p.waitForTimeout(300);
  const box = await p.locator("#host").boundingBox();
  if (!box) throw new Error("no host box");
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(250);
  await ctx.close();
  const click = actions.find((a) => a.type === "click");
  if (!click) throw new Error(`no click captured for ${url}`);
  return click;
}

/** A fresh page WITH the closed-shadow bridge installed + a StepExecutor. */
async function freshRun(browser: Browser, url: string, withBridge = true, mutate?: (p: Page) => Promise<void>) {
  const ctx = await browser.newContext();
  if (withBridge) await ctx.addInitScript({ content: closedShadowBridgeScript() });
  const p = await ctx.newPage();
  await p.goto(url);
  await p.waitForTimeout(250);
  if (mutate) await mutate(p);
  const context = await makeContext();
  const exec = new StepExecutor(p, new LocatorFactory(p), new ValueResolver(context), context);
  return { page: p, exec, close: () => ctx.close() };
}

const clickStep = (flow: FlowProfile): FlowStep => {
  const step = flow.nodes.find((n) => n.type === "click");
  if (!step) throw new Error("no click step");
  return step;
};
const lastClick = (p: Page) => p.evaluate(() => (window as unknown as { __lastClick?: string }).__lastClick ?? "");
// postMessage delivery is async; a positive case waits for it (negatives read immediately, expecting "").
const waitLastClick = async (p: Page): Promise<string> => {
  await p.waitForFunction(() => (window as unknown as { __lastClick?: string }).__lastClick !== "", { timeout: 2000 }).catch(() => undefined);
  return lastClick(p);
};

async function main() {
  recorderScript = getRecorderInitScriptContent();
  const server = await serve();
  const browser = await chromium.launch();
  try {
    // ── [1] Single closed root: captured as instrumented-shadow, replays inside the closed root ──────
    console.log("\n[1] Single closed shadow root:");
    const singleFlow = buildRecordedFlow("single", [await capture(browser, `${BASE}/single`)]);
    const singleStep = clickStep(singleFlow);
    check("[1] captured an instrumented closed-shadow locator", singleStep.locator?.context?.shadow?.boundary === "closed" && singleStep.locator?.context?.shadow?.instrumented === true, JSON.stringify(singleStep.locator?.context?.shadow));
    check("[1] the host chain + target are CSS (host #host, target #go)", singleStep.locator?.context?.shadow?.hosts?.[0]?.value === "#host" && singleStep.locator?.context?.shadow?.target?.value === "#go", JSON.stringify(singleStep.locator?.context?.shadow));
    check("[1] the step is resolved, not needs-review", singleStep.locator?.resolution === "resolved", singleStep.locator?.resolution);
    check("[1] preflight admits the closed-shadow flow", !hasActivePathError(validateFlowDefinition(singleFlow)));
    {
      const { page: p, exec, close } = await freshRun(browser, `${BASE}/single`);
      try {
        const r = await exec.execute({ ...singleStep, timeoutMs: 6000 });
        check("[1] replay clicks the button inside the closed root", r.status === "passed", r.error);
        check("[1] the closed-root click fired (posted to top)", (await waitLastClick(p)) === "single", await lastClick(p));
      } finally {
        await close();
      }
    }

    // ── [2] Nested closed roots ─────────────────────────────────────────────────────────────────────
    console.log("\n[2] Nested closed roots:");
    const nestedStep = clickStep(buildRecordedFlow("nested", [await capture(browser, `${BASE}/nested`)]));
    check("[2] captured a two-host closed-shadow chain", (nestedStep.locator?.context?.shadow?.hosts?.length ?? 0) === 2, JSON.stringify(nestedStep.locator?.context?.shadow?.hosts));
    {
      const { page: p, exec, close } = await freshRun(browser, `${BASE}/nested`);
      try {
        const r = await exec.execute({ ...nestedStep, timeoutMs: 6000 });
        check("[2] replay descends both closed roots and clicks", r.status === "passed" && (await waitLastClick(p)) === "nested", r.error ?? (await lastClick(p)));
      } finally {
        await close();
      }
    }

    // ── [3] Mixed open/closed nesting ───────────────────────────────────────────────────────────────
    console.log("\n[3] Open-in-closed and closed-in-open:");
    for (const [route, label] of [["/open-in-closed", "openInClosed"], ["/closed-in-open", "closedInOpen"]] as const) {
      const step = clickStep(buildRecordedFlow(label, [await capture(browser, `${BASE}${route}`)]));
      const { page: p, exec, close } = await freshRun(browser, `${BASE}${route}`);
      try {
        const r = await exec.execute({ ...step, timeoutMs: 6000 });
        check(`[3] ${label} replays through the mixed chain`, r.status === "passed" && (await waitLastClick(p)) === label, r.error ?? (await lastClick(p)));
      } finally {
        await close();
      }
    }

    // ── [4] Missing instrumentation → deterministic failure, no false-valid, no side effect ─────────
    console.log("\n[4] Missing bridge fails closed (no false-valid):");
    {
      const { page: p, exec, close } = await freshRun(browser, `${BASE}/single`, false);
      try {
        const r = await exec.execute({ ...singleStep, timeoutMs: 3000 });
        check("[4] without the bridge, the closed-shadow target does NOT resolve", r.status === "failed", `status=${r.status}`);
        check("[4] and nothing was clicked", (await lastClick(p)) === "", await lastClick(p));
      } finally {
        await close();
      }
    }

    // ── [5] Changed host / target fails (no wrong element) ──────────────────────────────────────────
    console.log("\n[5] A changed host/target fails deterministically:");
    {
      const removedHost = await freshRun(browser, `${BASE}/single`, true, async (p) => { await p.evaluate(() => document.getElementById("host")?.remove()); });
      try {
        const r = await removedHost.exec.execute({ ...singleStep, timeoutMs: 3000 });
        check("[5] a removed host fails (never a wrong element)", r.status === "failed", `status=${r.status}`);
        check("[5] and clicked nothing", (await lastClick(removedHost.page)) === "", await lastClick(removedHost.page));
      } finally {
        await removedHost.close();
      }
      const badTarget: FlowStep = { ...singleStep, locator: { ...singleStep.locator!, context: { ...singleStep.locator!.context, shadow: { ...singleStep.locator!.context!.shadow!, target: { strategy: "css", value: "#does-not-exist" } } } } };
      const badRun = await freshRun(browser, `${BASE}/single`, true);
      try {
        const r = await badRun.exec.execute({ ...badTarget, timeoutMs: 3000 });
        check("[5] a missing target inside the closed root fails", r.status === "failed", `status=${r.status}`);
        check("[5] and clicked nothing", (await lastClick(badRun.page)) === "", await lastClick(badRun.page));
      } finally {
        await badRun.close();
      }
    }

    // ── [6] Round trip: the instrumented-shadow context survives save/reload/IPC ─────────────────────
    console.log("\n[6] Instrumented-shadow context survives the lifecycle:");
    {
      const rt = structuredClone(JSON.parse(JSON.stringify(nestedStep))) as FlowStep;
      check("[6] closed-shadow chain survives save/reload/IPC", JSON.stringify(rt.locator?.context?.shadow) === JSON.stringify(nestedStep.locator?.context?.shadow) && (rt.locator?.context?.shadow?.hosts?.length ?? 0) === 2);
    }

    // ── [7] Registry privacy: page script cannot reach a closed root without the secret token ───────
    console.log("\n[7] The retained closed roots are not reachable without the secret token:");
    {
      const { page: p, close } = await freshRun(browser, `${BASE}/single`, true);
      try {
        // No named inner functions in this evaluate (esbuild `__name` gotcha in tsx).
        const probe = await p.evaluate(() => {
          const host = document.getElementById("host") as HTMLElement;
          // Roots live in a closure WeakMap — NOT on the host — so reflection over the host yields nothing.
          let hostLeak = 0;
          for (const s of Object.getOwnPropertySymbols(host)) {
            try {
              const v = (host as unknown as Record<symbol, unknown>)[s] as { querySelector?: unknown };
              if (v && typeof v.querySelector === "function") hostLeak += 1;
            } catch { /* ignore */ }
          }
          // The resolver is on a secret-keyed window symbol; calling ANY window function with a GUESSED
          // token must not return a shadow root.
          let leakedViaGuess = false;
          for (const s of Object.getOwnPropertySymbols(window)) {
            const fn = (window as unknown as Record<symbol, unknown>)[s];
            if (typeof fn !== "function") continue;
            try {
              const r = (fn as (t: string, h: Element) => unknown)("guessed-token", host) as { querySelector?: unknown };
              if (r && typeof r.querySelector === "function") leakedViaGuess = true;
            } catch { /* ignore */ }
          }
          return { shadowRoot: (host as unknown as { shadowRoot: unknown }).shadowRoot, hostLeak, leakedViaGuess };
        });
        check("[7] host.shadowRoot stays null (mode not forced open)", probe.shadowRoot === null, String(probe.shadowRoot));
        check("[7] the retained root is NOT reachable via host reflection", probe.hostLeak === 0, String(probe.hostLeak));
        check("[7] a wrong token cannot retrieve the root from the resolver", probe.leakedViaGuess === false);
      } finally {
        await close();
      }
    }

    // ── [8] Feature Test Lab: the mock-site closed-shadow fixture (/closed-shadow-lab) ───────────────
    console.log("\n[8] Mock-site closed-shadow fixture (/closed-shadow-lab):");
    const MOCK_PORT = 4420;
    const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
    const mock = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(MOCK_PORT) }, stdio: "ignore" });
    try {
      for (let i = 0; i < 100; i += 1) {
        try {
          if ((await fetch(`${MOCK}/closed-shadow-lab`)).ok) break;
        } catch {
          /* not up */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      const ctx = await browser.newContext();
      await ctx.addInitScript({ content: recorderScript });
      const cp = await ctx.newPage();
      const actions: RecordedAction[] = [];
      await cp.exposeBinding("__awtkit_recordAction", (_s, a) => actions.push(a as RecordedAction));
      await cp.exposeBinding("__awtkit_recordSignal", () => {});
      await cp.goto(`${MOCK}/closed-shadow-lab`);
      await cp.waitForTimeout(400);
      const wbox = await cp.locator('[data-testid="secret-widget"]').boundingBox();
      if (wbox) await cp.mouse.click(wbox.x + wbox.width / 2, wbox.y + wbox.height / 2);
      await cp.waitForTimeout(250);
      await ctx.close();
      const clickAction = actions.find((a) => a.type === "click");
      const mockStep = clickStep(buildRecordedFlow("mock-cs", clickAction ? [clickAction] : []));
      check("[8] captured an instrumented closed-shadow locator from the mock-site widget", mockStep.locator?.context?.shadow?.instrumented === true && mockStep.locator?.context?.shadow?.hosts?.[0]?.value === '[data-testid="secret-widget"]', JSON.stringify(mockStep.locator?.context?.shadow));
      const { page: rp, exec, close } = await freshRun(browser, `${MOCK}/closed-shadow-lab`);
      try {
        const r = await exec.execute({ ...mockStep, timeoutMs: 6000 });
        check("[8] replay clicks the closed-root control on the mock-site page", r.status === "passed", r.error);
        await rp.waitForFunction(() => (window as unknown as { __csLab?: string }).__csLab === "applied", { timeout: 2000 }).catch(() => undefined);
        check("[8] the closed-root click is reflected (cs-result=applied)", (await rp.locator('[data-testid="cs-result"]').textContent()) === "applied", await rp.locator('[data-testid="cs-result"]').textContent());
      } finally {
        await close();
      }
    } finally {
      mock.kill();
    }
  } finally {
    await browser.close();
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
