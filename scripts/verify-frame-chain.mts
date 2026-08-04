/**
 * Cross-origin frame-chain acceptance gate (awkit-65g Phase C1 / awkit-y1p).
 *
 * Run with: npm run verify:frame-chain
 *
 * Drives the REAL responsible layers — recorderInitScript capture, the shared frameChainCapture
 * (Playwright Frame graph, cross-origin safe), buildRecordedFlow, FlowValidator, and
 * LocatorFactory.buildRoot -> resolveFrameChain / StepExecutor — against live cross-origin pages
 * (two 127.0.0.1 ports are mutually cross-origin). The recorded target lives inside one or more
 * iframes; replay must resolve each frame boundary in order and act inside the final frame, and must
 * FAIL deterministically (never enter a sibling frame) when the recorded frame identity is gone.
 *
 * The verifier fails if the frame chain is dropped, reordered, ignored, or replaced with a main-frame locator.
 */
import { chromium } from "playwright";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import { buildFrameChain } from "@src/recorder/frameChainCapture";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { validateFlowDefinition, hasActivePathError } from "@src/validation/FlowValidator";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { FlowProfile, FlowStep, LocatorContext } from "@src/profiles/FlowProfile";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";

const PA = 4414; // OUTER origin
const PB = 4415; // INNER origin (cross-origin to OUTER)
const OUTER = `http://127.0.0.1:${PA}`;
const INNER = `http://127.0.0.1:${PB}`;

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

// A leaf page whose button posts its identity (frame name, else the `l` query) to window.top on click.
const leaf = (buttonId: string, buttonName: string): string => `<!doctype html><html><body>
  <button id="${buttonId}">${buttonName}</button>
  <script>
    function q(n){ try { return new URL(location.href).searchParams.get(n); } catch (e) { return null; } }
    document.getElementById(${JSON.stringify(buttonId)}).addEventListener('click', function () {
      try { window.top.postMessage({ awtkitClick: window.name || q('l') || 'leaf' }, '*'); } catch (e) {}
    });
  </script>
</body></html>`;

// A top page that records the last posted click identity in window.__lastClick.
const topPage = (body: string): string => `<!doctype html><html><body>
  ${body}
  <script>
    window.__lastClick = "";
    window.addEventListener('message', function (e) { if (e.data && e.data.awtkitClick) window.__lastClick = e.data.awtkitClick; });
  </script>
</body></html>`;

const ROUTES_OUTER: Record<string, string> = {
  "/single": topPage(`<iframe id="fx" src="${INNER}/leaf?l=single"></iframe>`),
  "/nested": topPage(`<iframe id="fouter" src="${INNER}/mid"></iframe>`),
  "/same": topPage(`<iframe id="fsame" src="${OUTER}/leafsame?l=same"></iframe>`),
  "/dup": topPage(`<iframe name="left" src="${INNER}/leaf"></iframe><iframe name="right" src="${INNER}/leaf"></iframe>`),
  "/navigate": topPage(`<iframe id="fnav" src="${INNER}/leafnav"></iframe>`),
  "/deep": leaf("confirm", "Confirm order"),
  "/leafsame": leaf("go", "Submit order")
};

const ROUTES_INNER: Record<string, string> = {
  "/leaf": leaf("go", "Submit order"),
  "/mid": `<!doctype html><html><body><iframe id="finner" src="${OUTER}/deep?l=deep"></iframe></body></html>`,
  // Navigates itself once, after attachment, to prove the iframe ELEMENT identity (not the child URL) drives resolution.
  "/leafnav": `<!doctype html><html><body>${leaf("go", "Submit order")}<script>if(!/navigated/.test(location.search)){setTimeout(function(){location.search='?navigated=1';},80);}</script></body></html>`
};

function serve(routes: Record<string, string>, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];
    const html = routes[path];
    res.setHeader("content-type", "text/html");
    res.end(html ?? "<!doctype html><html><body>not found</body></html>");
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

async function makeContext(): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "wfs-frame-"));
  return {
    executionId: "exec-frame", instanceId: "inst-1", scenarioId: "scen-1", flowId: "flow-frame",
    instanceOrderNumber: 1, totalInstances: 1, runtimeInputs: {}, instanceInputs: {}, flowOutputs: {},
    paths: { downloads: join(dir, "d"), screenshots: join(dir, "s"), logs: join(dir, "l"), reports: join(dir, "r"), sessions: join(dir, "se") }
  };
}

let recorderScript: string;

/** Record one click inside a frame; the binding builds the frame chain exactly like RecorderService. */
async function capture(browser: Browser, url: string, click: (page: Page) => Promise<void>): Promise<RecordedAction> {
  const ctx = await browser.newContext();
  await ctx.addInitScript({ content: recorderScript });
  const page = await ctx.newPage();
  const actions: RecordedAction[] = [];
  await page.exposeBinding("__awtkit_recordAction", async (source, a) => {
    const action = a as RecordedAction;
    const frame = source.frame;
    if (frame && frame !== source.page.mainFrame() && action.locator && !action.locator.context?.frameChain?.length) {
      const chain = await buildFrameChain(frame).catch(() => undefined);
      if (chain && chain.length) action.locator.context = { ...(action.locator.context ?? {}), frameChain: chain } as LocatorContext;
    }
    actions.push(action);
  });
  await page.exposeBinding("__awtkit_recordSignal", () => {});
  await page.goto(url);
  await page.waitForTimeout(500);
  await click(page);
  await page.waitForTimeout(300);
  await ctx.close();
  const clickAction = actions.find((x) => x.type === "click");
  if (!clickAction) throw new Error(`no click captured for ${url}`);
  return clickAction;
}

async function freshRun(browser: Browser, url: string, mutate?: (page: Page) => Promise<void>) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(400);
  if (mutate) await mutate(page);
  const context = await makeContext();
  const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(context), context);
  return { page, exec, close: () => ctx.close() };
}

const clickStep = (flow: FlowProfile): FlowStep => {
  const step = flow.nodes.find((n) => n.type === "click");
  if (!step) throw new Error("no click step");
  return step;
};
const lastClick = (page: Page) => page.evaluate(() => (window as unknown as { __lastClick?: string }).__lastClick ?? "");

async function main() {
  recorderScript = getRecorderInitScriptContent();
  const outer = await serve(ROUTES_OUTER, PA);
  const inner = await serve(ROUTES_INNER, PB);
  const browser = await chromium.launch();
  try {
    // ── [1] Single cross-origin frame ────────────────────────────────────────────────────────────
    console.log("\n[1] Single cross-origin frame:");
    const singleFlow = buildRecordedFlow("single", [await capture(browser, `${OUTER}/single`, (p) => p.frameLocator("#fx").locator("#go").click())]);
    const singleStep = clickStep(singleFlow);
    check("[1] captured a one-segment frame chain", singleStep.locator?.context?.frameChain?.length === 1, JSON.stringify(singleStep.locator?.context?.frameChain));
    check("[1] the segment targets the recorded iframe (#fx)", singleStep.locator?.context?.frameChain?.[0]?.selector === "iframe#fx", singleStep.locator?.context?.frameChain?.[0]?.selector);
    check("[1] the step is resolved (not needs-review)", singleStep.locator?.resolution === "resolved", singleStep.locator?.resolution);
    check("[1] preflight admits the frame-chain flow", !hasActivePathError(validateFlowDefinition(singleFlow)));
    {
      const { page, exec, close } = await freshRun(browser, `${OUTER}/single`);
      try {
        const r = await exec.execute({ ...singleStep, timeoutMs: 6000 });
        check("[1] replay resolves into the frame and clicks", r.status === "passed", r.error);
        check("[1] the click landed inside the frame (result posted)", (await lastClick(page)) === "single", await lastClick(page));
      } finally {
        await close();
      }
    }

    // ── [2] Nested cross-origin frames (outer -> inner -> deep) ──────────────────────────────────────
    console.log("\n[2] Nested cross-origin frames:");
    const nestedStep = clickStep(buildRecordedFlow("nested", [await capture(browser, `${OUTER}/nested`, (p) => p.frameLocator("#fouter").frameLocator("#finner").locator("#confirm").click())]));
    const nestedChain = nestedStep.locator?.context?.frameChain ?? [];
    check("[2] captured a two-segment chain, outer->inner", nestedChain.length === 2 && nestedChain[0]?.selector === "iframe#fouter" && nestedChain[1]?.selector === "iframe#finner", JSON.stringify(nestedChain));
    {
      const { page, exec, close } = await freshRun(browser, `${OUTER}/nested`);
      try {
        const r = await exec.execute({ ...nestedStep, timeoutMs: 6000 });
        check("[2] replay descends both frames and clicks the deep button", r.status === "passed", r.error);
        check("[2] the deep click landed (result posted to top)", (await lastClick(page)) === "deep", await lastClick(page));
      } finally {
        await close();
      }
      // Negative: a REORDERED chain must not resolve (proves order is load-bearing).
      const reordered: FlowStep = { ...nestedStep, locator: { ...nestedStep.locator!, context: { ...nestedStep.locator!.context, frameChain: [...nestedChain].reverse() } } };
      const run2 = await freshRun(browser, `${OUTER}/nested`);
      try {
        const r = await run2.exec.execute({ ...reordered, timeoutMs: 4000 });
        check("[2] a REORDERED chain fails to resolve", r.status === "failed", `status=${r.status}`);
      } finally {
        await run2.close();
      }
    }

    // ── [3] Same-origin frame ────────────────────────────────────────────────────────────────────
    console.log("\n[3] Same-origin frame:");
    const sameStep = clickStep(buildRecordedFlow("same", [await capture(browser, `${OUTER}/same`, (p) => p.frameLocator("#fsame").locator("#go").click())]));
    check("[3] captured a frame chain for the same-origin frame", (sameStep.locator?.context?.frameChain?.length ?? 0) >= 1, JSON.stringify(sameStep.locator?.context?.frameChain));
    {
      const { page, exec, close } = await freshRun(browser, `${OUTER}/same`);
      try {
        const r = await exec.execute({ ...sameStep, timeoutMs: 6000 });
        check("[3] same-origin replay clicks inside the frame", r.status === "passed" && (await lastClick(page)) === "same", r.error ?? (await lastClick(page)));
      } finally {
        await close();
      }
    }

    // ── [4] Duplicate iframes (name-distinguished) enter the RIGHT one ───────────────────────────────
    console.log("\n[4] Duplicate iframes — the right one is entered:");
    const dupStep = clickStep(buildRecordedFlow("dup", [await capture(browser, `${OUTER}/dup`, (p) => p.frameLocator('iframe[name="right"]').locator("#go").click())]));
    check("[4] the chain segment selects the named iframe", dupStep.locator?.context?.frameChain?.[0]?.selector === 'iframe[name="right"]', dupStep.locator?.context?.frameChain?.[0]?.selector);
    {
      const { page, exec, close } = await freshRun(browser, `${OUTER}/dup`);
      try {
        const r = await exec.execute({ ...dupStep, timeoutMs: 6000 });
        check("[4] replay enters the RIGHT frame (not left)", r.status === "passed" && (await lastClick(page)) === "right", r.error ?? (await lastClick(page)));
      } finally {
        await close();
      }
    }

    // ── [5] Frame that navigates after attachment still resolves (element identity, not child URL) ──
    console.log("\n[5] Frame navigates after attachment:");
    const navStep = clickStep(buildRecordedFlow("nav", [await capture(browser, `${OUTER}/navigate`, (p) => p.frameLocator("#fnav").locator("#go").click())]));
    {
      const { page, exec, close } = await freshRun(browser, `${OUTER}/navigate`, async (p) => { await p.waitForTimeout(300); /* let the child navigate */ });
      try {
        const r = await exec.execute({ ...navStep, timeoutMs: 6000 });
        check("[5] replay resolves the frame after it navigated and clicks", r.status === "passed", r.error);
      } finally {
        await close();
      }
    }

    // ── [6] The chain is load-bearing: strip it and the main-frame locator cannot reach the target ──
    console.log("\n[6] Dropping the chain (main-frame locator) fails to find the target:");
    {
      const stripped: FlowStep = { ...singleStep, locator: { ...singleStep.locator!, context: { ...singleStep.locator!.context, frameChain: undefined, frame: undefined } } };
      const { page, exec, close } = await freshRun(browser, `${OUTER}/single`);
      try {
        const r = await exec.execute({ ...stripped, timeoutMs: 4000 });
        check("[6] a main-frame-only locator does NOT resolve the in-frame target", r.status === "failed", `status=${r.status}`);
        check("[6] and it clicked nothing", (await lastClick(page)) === "", await lastClick(page));
      } finally {
        await close();
      }
    }

    // ── [7] Deterministic failure when the recorded frame is gone (never a sibling) ─────────────────
    console.log("\n[7] Deterministic failure when the frame identity is gone:");
    {
      const removed = await freshRun(browser, `${OUTER}/single`, async (p) => { await p.evaluate(() => document.getElementById("fx")?.remove()); });
      try {
        const r = await removed.exec.execute({ ...singleStep, timeoutMs: 4000 });
        check("[7] a removed iframe fails deterministically", r.status === "failed", `status=${r.status}`);
        check("[7] the failure is FRAME_IDENTITY_CHANGED", /FRAME_IDENTITY_CHANGED/.test(r.error ?? ""), r.error);
      } finally {
        await removed.close();
      }
      // Identity mismatch: keep an iframe at the selector but change its src origin -> identity fails.
      const dupNoMatch: FlowStep = { ...dupStep, locator: { ...dupStep.locator!, context: { ...dupStep.locator!.context, frameChain: [{ selector: "iframe", index: 0, name: "ghost" }] } } };
      const idRun = await freshRun(browser, `${OUTER}/dup`);
      try {
        const r = await idRun.exec.execute({ ...dupNoMatch, timeoutMs: 4000 });
        check("[7] an unmatched frame identity refuses (never enters a sibling)", r.status === "failed" && /FRAME_IDENTITY_CHANGED/.test(r.error ?? ""), r.error);
        check("[7] and clicked nothing", (await idRun.page.evaluate(() => (window as unknown as { __lastClick?: string }).__lastClick ?? "")) === "");
      } finally {
        await idRun.close();
      }
    }

    // ── [8] Round trip: the frame chain survives save/reload/IPC ────────────────────────────────────
    console.log("\n[8] Frame chain survives the persistence lifecycle:");
    {
      const rt = structuredClone(JSON.parse(JSON.stringify(nestedStep))) as FlowStep;
      check("[8] chain survives save/reload/IPC in order", JSON.stringify(rt.locator?.context?.frameChain) === JSON.stringify(nestedStep.locator?.context?.frameChain) && (rt.locator?.context?.frameChain?.length ?? 0) === 2);
    }

    // ── [9] Feature Test Lab: the same-origin nested mock-site fixture (/iframe-nested) ──────────────
    console.log("\n[9] Mock-site nested frame fixture (/iframe-nested):");
    const MOCK_PORT = 4416;
    const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
    const mock = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(MOCK_PORT) }, stdio: "ignore" });
    try {
      for (let i = 0; i < 100; i += 1) {
        try {
          if ((await fetch(`${MOCK}/iframe-nested`)).ok) break;
        } catch {
          /* not up */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      const mockStep = clickStep(buildRecordedFlow("mock-nested", [await capture(browser, `${MOCK}/iframe-nested`, (p) => p.frameLocator("#frame-outer").frameLocator("#frame-inner").locator("#nested-apply").click())]));
      const mockChain = mockStep.locator?.context?.frameChain ?? [];
      check("[9] the mock-site nested fixture captures a two-segment chain, outer->inner", mockChain.length === 2 && mockChain[0]?.selector === "iframe#frame-outer" && mockChain[1]?.selector === "iframe#frame-inner", JSON.stringify(mockChain));
      const { page, exec, close } = await freshRun(browser, `${MOCK}/iframe-nested`);
      try {
        const r = await exec.execute({ ...mockStep, timeoutMs: 6000 });
        check("[9] replay descends both mock-site frames and clicks the leaf", r.status === "passed", r.error);
        check("[9] the deep click is mirrored to the top document (nested-mirror=yes)", (await page.locator('[data-testid="nested-mirror"]').textContent()) === "yes", await page.locator('[data-testid="nested-mirror"]').textContent());
      } finally {
        await close();
      }
    } finally {
      mock.kill();
    }
  } finally {
    await browser.close();
    await new Promise<void>((r) => outer.close(() => r()));
    await new Promise<void>((r) => inner.close(() => r()));
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
