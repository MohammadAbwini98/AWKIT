/**
 * Live verification of the Recorder's hover-dependency capture AND deterministic replay
 * (Increment 5 / awkit-aui.5). Run with: npm run verify:recorder-hover
 *
 * Unlike a capture-only check, this drives the REAL execution path — records against the mock site,
 * builds the flow with `buildRecordedFlow`, then replays the built `hover`/`click` steps through the
 * production `StepExecutor` + `LocatorFactory` on FRESH pages. It proves the recorder chose the
 * VISIBLE hover trigger (never the hidden revealed surface), that replay is deterministic, and that
 * the previously-broken hidden-surface locator does NOT replay. Negative cases guard against
 * fabricating hover steps for async self-reveals or when no stable trigger can be attributed.
 */
import { chromium } from "playwright";
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
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";

const PORT = 4402;
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/recorder-lab`;

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
  const dir = await mkdtemp(join(tmpdir(), "wfs-hover-"));
  return {
    executionId: "exec-hover",
    instanceId: "inst-1",
    scenarioId: "scen-1",
    flowId: "flow-hover",
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
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Mock site did not start");
}

let recorderScript: string;

/** Record a fresh session: inject the recorder, run `interact`, return the captured actions. */
async function recordActions(browser: Browser, interact: (page: Page) => Promise<void>): Promise<RecordedAction[]> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL);
  const actions: RecordedAction[] = [];
  await page.exposeBinding("__awtkit_recordAction", (_s, a) => {
    actions.push(a as RecordedAction);
  });
  await page.exposeBinding("__awtkit_recordSignal", () => {});
  await page.evaluate(recorderScript);
  await page.waitForTimeout(500); // let the silent baseline scan record rest-state visibility
  await interact(page);
  await page.waitForTimeout(300);
  await ctx.close();
  return actions;
}

/** A fresh execution page + a StepExecutor wired to the real LocatorFactory/ValueResolver. */
async function freshExecutor(browser: Browser): Promise<{ page: Page; exec: StepExecutor; close: () => Promise<void> }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL);
  const context = await makeContext();
  const exec = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(context), context);
  return { page, exec, close: () => ctx.close() };
}

const hoverStepOf = (p: FlowProfile) => p.nodes.find((s) => s.type === "hover");
const clickStepOf = (p: FlowProfile, name: string) => p.nodes.find((s) => s.type === "click" && s.locator?.name === name);

async function main() {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore"
  });
  await waitForServer();
  recorderScript = await getRecorderInitScriptContent();
  const browser = await chromium.launch();

  try {
    // ── [1] Positive: capture the hover-gated click ──────────────────────────────────────────
    console.log("\n[1] Capture hover-gated click:");
    const actions = await recordActions(browser, async (p) => {
      await p.hover('[data-testid="hover-trigger"]');
      await p.waitForTimeout(250);
      await p.locator(".hover-gated-btn").click();
    });
    const clickAction = actions.find((a) => a.type === "click" && a.locator?.name === "Click me");
    check("recorded the click on the hover-gated button", !!clickAction);
    check("interaction flagged requiresHover", clickAction?.locator?.interaction?.requiresHover === true);
    const container = clickAction?.locator?.interaction?.hoverContainer as { strategy?: string; value?: string } | undefined;
    check("captured a hoverContainer (trigger) locator", !!container);
    check(
      "trigger locator is the VISIBLE trigger, not the revealed surface",
      container?.value === "hover-trigger" && container?.strategy === "testId",
      `got ${container?.strategy}=${container?.value}`
    );
    check(
      "trigger locator does NOT target the hidden revealed surface",
      !(typeof container?.value === "string" && container.value.includes("revealed-surface"))
    );

    // ── [2] Build the flow: explicit hover precedes click ────────────────────────────────────
    console.log("\n[2] Build flow — hover precedes click:");
    const profile = buildRecordedFlow("Hover Positive", actions);
    const hoverStep = hoverStepOf(profile);
    const clickStep = clickStepOf(profile, "Click me");
    check("a hover step was generated", !!hoverStep);
    check("hover step resolution is 'resolved'", hoverStep?.locator?.resolution === "resolved");
    if (hoverStep && clickStep) {
      const hi = profile.nodes.findIndex((s) => s.id === hoverStep.id);
      const ci = profile.nodes.findIndex((s) => s.id === clickStep.id);
      check("hover step is immediately before the click step", hi === ci - 1, `hover@${hi} click@${ci}`);
    }

    // ── [3] Trigger identity: hover locator resolves to the trigger element ───────────────────
    console.log("\n[3] Hover locator resolves to the trigger element (fresh page):");
    {
      const { page, exec, close } = await freshExecutor(browser);
      try {
        const factory = new LocatorFactory(page);
        const resolved = await factory.resolve(hoverStep as FlowStep);
        const tid = await resolved.getAttribute("data-testid");
        check("hover locator resolves to data-testid=hover-trigger", tid === "hover-trigger", `got ${tid}`);
        check("hover locator does NOT resolve to hover-revealed-surface", tid !== "hover-revealed-surface");
        void exec;
      } finally {
        await close();
      }
    }

    // ── [4] Deterministic replay across TWO fresh pages ──────────────────────────────────────
    console.log("\n[4] Deterministic Hover→Click replay (2 fresh pages):");
    for (let run = 1; run <= 2; run += 1) {
      const { page, exec, close } = await freshExecutor(browser);
      try {
        const hiddenBefore = !(await page.locator(".hover-gated-btn").isVisible());
        check(`run ${run}: target hidden before hover`, hiddenBefore);
        const hr = await exec.execute(hoverStep as FlowStep);
        check(`run ${run}: hover step executed`, hr.status === "passed", hr.error);
        const visibleAfter = await page.locator(".hover-gated-btn").isVisible();
        check(`run ${run}: target became visible after hover`, visibleAfter);
        const cr = await exec.execute(clickStep as FlowStep);
        check(`run ${run}: click step executed`, cr.status === "passed", cr.error);
        const result = (await page.getByTestId("hover-click-result").textContent()) ?? "";
        check(`run ${run}: post-click state is 'hover-click-ok'`, result.includes("hover-click-ok"), result);
      } finally {
        await close();
      }
    }

    // ── [5] Negative: without the hover step, the click fails (actionability) ─────────────────
    console.log("\n[5] Removing the hover step makes the click fail:");
    {
      const { exec, close } = await freshExecutor(browser);
      try {
        const clickOnly = { ...(clickStep as FlowStep), timeoutMs: 3500 };
        const cr = await exec.execute(clickOnly);
        check("click alone fails when the target is hover-gated", cr.status === "failed", `status=${cr.status}`);
      } finally {
        await close();
      }
    }

    // ── [6] Regression: the previously-broken hidden-surface locator does NOT replay ─────────
    console.log("\n[6] The old hidden-surface hover locator fails (regression guard):");
    {
      const { exec, close } = await freshExecutor(browser);
      try {
        const brokenHover: FlowStep = {
          id: "broken-hover",
          type: "hover",
          name: "Hover revealed surface (broken)",
          timeoutMs: 3500,
          locator: { strategy: "css", value: '[data-testid="hover-revealed-surface"]', resolution: "resolved" }
        };
        const hr = await exec.execute(brokenHover);
        check("hovering the hidden revealed surface fails to replay", hr.status === "failed", `status=${hr.status}`);
      } finally {
        await close();
      }
    }

    // ── [7] Negative: an async self-reveal does NOT generate a hover step ─────────────────────
    console.log("\n[7] Async self-reveal produces no hover step:");
    {
      const asyncActions = await recordActions(browser, async (p) => {
        await p.locator('[data-testid="async-appear-btn"]').waitFor({ state: "visible" });
        await p.locator('[data-testid="async-appear-btn"]').click();
      });
      const asyncClick = asyncActions.find((a) => a.type === "click");
      check("recorded the async click", !!asyncClick);
      check("async click is NOT flagged requiresHover", asyncClick?.locator?.interaction?.requiresHover !== true);
      const asyncProfile = buildRecordedFlow("Async", asyncActions);
      check("no hover step generated for the async reveal", !hoverStepOf(asyncProfile));
    }

    // ── [8] Repeated hover over one trigger yields exactly one hover step ─────────────────────
    console.log("\n[8] Repeated hovering yields a single hover step:");
    {
      const repActions = await recordActions(browser, async (p) => {
        await p.hover('[data-testid="hover-trigger"]');
        await p.mouse.move(5, 5); // move away → dropdown hides
        await p.waitForTimeout(120);
        await p.hover('[data-testid="hover-trigger"]');
        await p.waitForTimeout(120);
        await p.locator(".hover-gated-btn").click();
      });
      const repProfile = buildRecordedFlow("Repeat", repActions);
      const hoverCount = repProfile.nodes.filter((s) => s.type === "hover").length;
      const clickCount = repProfile.nodes.filter((s) => s.type === "click" && s.locator?.name === "Click me").length;
      check("exactly one hover step for one click", hoverCount === 1, `hover=${hoverCount}`);
      check("exactly one click step", clickCount === 1, `click=${clickCount}`);
    }

    // ── [9] A fast hover→click sequence is still detected ─────────────────────────────────────
    console.log("\n[9] Fast hover-and-click remains detectable:");
    {
      const fastActions = await recordActions(browser, async (p) => {
        await p.hover('[data-testid="hover-trigger"]');
        await p.locator(".hover-gated-btn").click();
      });
      const fastClick = fastActions.find((a) => a.type === "click" && a.locator?.name === "Click me");
      check("fast click still flagged requiresHover", fastClick?.locator?.interaction?.requiresHover === true);
      check("fast case still generates a hover step", !!hoverStepOf(buildRecordedFlow("Fast", fastActions)));
    }

    // ── [10] No stable trigger → the click is left needs-review (no fabricated hover) ─────────
    console.log("\n[10] No stable trigger → needs-review, no fabricated hover step:");
    {
      const reviewActions = await recordActions(browser, async (p) => {
        await p.hover(".review-label"); // pointer lands on the inner label, never the nav landmark exactly
        await p.waitForTimeout(250);
        await p.locator(".review-gated-btn").click();
      });
      const reviewClick = reviewActions.find((a) => a.type === "click" && a.locator?.name === "Review Click");
      check("recorded the review-case click", !!reviewClick);
      check("review click flagged requiresHover", reviewClick?.locator?.interaction?.requiresHover === true);
      check("review click flagged hoverUnresolved", reviewClick?.locator?.interaction?.hoverUnresolved === true);
      const reviewProfile = buildRecordedFlow("Review", reviewActions);
      check("no hover step fabricated for the review case", !hoverStepOf(reviewProfile));
      const rc = clickStepOf(reviewProfile, "Review Click");
      check("review click step left needs-review", rc?.locator?.resolution === "needs-review", rc?.locator?.resolution);
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("verify-recorder-hover crashed", e);
  process.exit(1);
});
