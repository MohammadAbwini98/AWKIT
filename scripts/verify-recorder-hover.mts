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
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  // Install the way PRODUCTION does — context.addInitScript, i.e. at document start, before the
  // page's own scripts. Injecting with page.evaluate after `goto` tested an order the product never
  // uses, and hid that the recorder baselined an empty document under the real one (`awkit-a7k`).
  await ctx.addInitScript({ content: recorderScript });
  const page = await ctx.newPage();
  const actions: RecordedAction[] = [];
  await page.exposeBinding("__awtkit_recordAction", (_s, a) => {
    actions.push(a as RecordedAction);
  });
  await page.exposeBinding("__awtkit_recordSignal", () => {});
  await page.goto(URL);
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
    // ── [0] Install order: every recorder verifier must test the order the PRODUCT uses ──────
    //
    // RecorderService injects with `context.addInitScript`, so the recorder runs at document start,
    // before the page's own scripts. Two verifiers used to inject with `page.evaluate` after `goto`,
    // which is a different order with different semantics — it hid that the recorder baselined an
    // empty document, and made the fail-closed saturation guard untestable (`awkit-a7k`). A source
    // guard, because no runtime assertion can notice a harness testing the wrong thing.
    console.log("\n[0] Recorder verifiers install the script the way production does:");
    {
      // NB: this file declares its own `URL` constant, so the global URL constructor is shadowed.
      const dir = dirname(fileURLToPath(import.meta.url));
      const injectors = readdirSync(dir)
        .filter((f) => f.startsWith("verify-recorder") && f.endsWith(".mts"))
        .map((f) => ({ file: f, text: readFileSync(`${dir}/${f}`, "utf8") }))
        .filter((f) => f.text.includes("getRecorderInitScriptContent"));
      // Cardinality first: an empty or truncated scan would satisfy every `.every()` below.
      check("found the recorder verifiers that inject the init script", injectors.length >= 3, `found ${injectors.length}`);
      const evaluators = injectors.filter((f) => /[.]evaluate[(]\s*(recorderScript|initScript|script)\s*[)]/.test(f.text));
      check(
        "none injects the recorder with page.evaluate after load",
        evaluators.length === 0,
        evaluators.map((f) => f.file).join(", ")
      );
      const initScripted = injectors.filter((f) => f.text.includes("addInitScript"));
      check(
        "every one installs via addInitScript (document start)",
        initScripted.length === injectors.length,
        injectors.filter((f) => !f.text.includes("addInitScript")).map((f) => f.file).join(", ")
      );
    }

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

    // ── [4b] Action owner: the trigger is promoted past an unlabelled wrapper (awkit-3vh) ─────
    //
    // The first ancestor VISIBLE AT REST above the revealed surface is `.ao-wrap-h7k2n9` — an
    // unlabelled div whose only class is hash-suffixed, so it is resolvable ONLY positionally. The
    // element that owns the hover is the role=tab above it — a generic interactive role the old
    // `interactiveTarget` selector did not recognize. Before the fix, `resolveHoverTrigger`
    // took the wrapper straight from the composed path and admitted it because `isUnique` alone was
    // the bar, persisting an `nth-child` chain exactly like the reported YouTube capture.
    console.log("\n[4b] Hover trigger is promoted to the action owner, not the wrapper:");
    {
      const aoActions = await recordActions(browser, async (p) => {
        await p.hover(".ao-owner-q7m2x8");
        await p.click(".ao-gated-p9x3k7");
      });
      const aoProfile = buildRecordedFlow("Hover Action Owner", aoActions);
      const aoHover = hoverStepOf(aoProfile);
      const aoClick = aoProfile.nodes.find((s) => s.type === "click");

      check("a hover step was generated for the action-owner fixture", !!aoHover);
      check("action-owner hover step is 'resolved' (not review)", aoHover?.locator?.resolution === "resolved", aoHover?.locator?.resolution);

      // (b) A semantic ancestor outranks a positional descendant.
      check(
        "trigger locator is semantic, not a positional fallback",
        aoHover?.locator?.strategy === "role",
        `strategy=${aoHover?.locator?.strategy} value=${aoHover?.locator?.value}`
      );
      // (d) The assertion that would have caught the defect: no positional chain survived.
      // Requires a PRESENT value — testing an absent value is vacuously clean when no hover step
      // was produced at all, which is exactly how this check passed under mutation on first writing.
      const aoTriggerValue = aoHover?.locator?.value;
      check(
        "trigger locator is present and contains no positional nth selector",
        typeof aoTriggerValue === "string" &&
          aoTriggerValue.length > 0 &&
          !/:nth-(?:child|of-type)\s*\(/.test(aoTriggerValue),
        String(aoTriggerValue)
      );
      check(
        "trigger locator carries the owner's accessible name",
        aoHover?.locator?.name === "Open shorts actions",
        String(aoHover?.locator?.name)
      );

      // (c) The final locator resolves to the SAME actionable control.
      // Guarded: without a hover step the replay block would throw inside LocatorFactory and abort
      // every later section, turning a clean FAIL into a crash that hides the remaining results.
      if (!aoHover || !aoClick) {
        check("action-owner replay could be attempted (hover + click steps exist)", false, "no hover/click step to replay");
      } else {
        const { page, exec, close } = await freshExecutor(browser);
        try {
          const factory = new LocatorFactory(page);
          const resolved = await factory.resolve(aoHover as FlowStep);
          const label = await resolved.getAttribute("aria-label");
          const role = await resolved.getAttribute("role");
          check("trigger resolves to the role=tab action owner", role === "tab" && label === "Open shorts actions", `role=${role} label=${label}`);

          // End-to-end: the promoted trigger still actually reveals and the click still lands.
          const hiddenBefore = !(await page.locator(".ao-gated-p9x3k7").isVisible());
          check("action-owner target hidden before hover", hiddenBefore);
          const hr = await exec.execute(aoHover as FlowStep);
          check("action-owner hover step executed", hr.status === "passed", hr.error);
          check("action-owner target visible after hover", await page.locator(".ao-gated-p9x3k7").isVisible());
          const cr = await exec.execute(aoClick as FlowStep);
          check("action-owner click step executed", cr.status === "passed", cr.error);
          const result = (await page.getByTestId("ao-click-result").textContent()) ?? "";
          check("post-click state is 'ao-click-ok'", result.includes("ao-click-ok"), result);
        } finally {
          await close();
        }
      }
    }

    // ── [4c] Gate: a positional-only trigger is reviewed, never persisted (awkit-3vh) ─────────
    //
    // Same reveal shape, but the visible-at-rest ancestor has no actionable ancestor to promote to
    // and resolves only positionally. `isUnique` alone would admit it — that is precisely the bar
    // that let an `nth-child` chain be saved as a trigger. It must be a review item instead.
    // This section is what fails when the gate is weakened back to `quality.isUnique`; the [4b]
    // fixture cannot catch that, because there promotion always yields a semantic locator.
    console.log("\n[4c] A positional-only trigger is reviewed, not persisted:");
    {
      const npActions = await recordActions(browser, async (p) => {
        await p.hover(".np-outer-m4x8k2");
        await p.click(".np-gated-w2q9d5");
      });
      const npProfile = buildRecordedFlow("Hover No Owner", npActions);
      const npHover = hoverStepOf(npProfile);
      const npClick = npProfile.nodes.find((s) => s.type === "click");

      check("the no-owner click was captured at all (fixture is live)", !!npClick, "no click step recorded");
      check(
        "no hover step is fabricated from a positional-only trigger",
        !npHover,
        `strategy=${npHover?.locator?.strategy} value=${npHover?.locator?.value}`
      );
      check(
        "the no-owner click is left needing review",
        npClick?.locator?.resolution === "needs-review",
        String(npClick?.locator?.resolution)
      );
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

    // ── [11] Adjacent-sibling trigger: `.trigger:hover + .target` (awkit-vot) ─────────────────
    //
    // The trigger is NOT an ancestor of what it reveals, and the revealed surface IS the control, so
    // the composed-path walk finds no hidden ancestor run at all. That case used to return `none`:
    // no hover step, and a recorded click that silently fails replay because the button is hidden
    // until its sibling is hovered. Attribution now comes from the last place the pointer rested
    // before entering the revealed surface.
    console.log("\n[11] Adjacent-sibling hover trigger is attributed:");
    {
      const sibActions = await recordActions(browser, async (p) => {
        await p.hover(".sib-trigger-h3k9");
        await p.waitForTimeout(250);
        await p.locator(".sib-gated-h3k9").click();
      });
      const sibClick = sibActions.find((a) => a.type === "click" && a.locator?.name === "Sibling action");
      check("recorded the sibling-gated click", !!sibClick);
      check("sibling click flagged requiresHover", sibClick?.locator?.interaction?.requiresHover === true);
      check("sibling click is NOT left hoverUnresolved", sibClick?.locator?.interaction?.hoverUnresolved !== true);

      const sibProfile = buildRecordedFlow("Sibling Positive", sibActions);
      const sibHover = hoverStepOf(sibProfile);
      const sibClickStep = clickStepOf(sibProfile, "Sibling action");
      check("a hover step was generated for the sibling reveal", !!sibHover);
      check("sibling hover step is 'resolved' (not review)", sibHover?.locator?.resolution === "resolved", sibHover?.locator?.resolution);
      check(
        "sibling trigger carries the trigger's accessible name",
        sibHover?.locator?.name === "Show sibling action",
        String(sibHover?.locator?.name)
      );
      // The defect this pins is a MISSING step, so every assertion above must also be proved
      // non-vacuous: an absent hover step satisfies "contains no nth selector" perfectly.
      const sibTriggerValue = sibHover?.locator?.value;
      check(
        "sibling trigger locator is present and carries no positional nth selector",
        typeof sibTriggerValue === "string" && sibTriggerValue.length > 0 && !/:nth-(?:child|of-type)\s*\(/.test(sibTriggerValue),
        String(sibTriggerValue)
      );
      check(
        "sibling trigger is not the shared wrapper",
        !(typeof sibTriggerValue === "string" && sibTriggerValue.includes("sib-wrap-h3k9")),
        String(sibTriggerValue)
      );
      check(
        "sibling trigger is not the hidden revealed control itself",
        !(typeof sibTriggerValue === "string" && sibTriggerValue.includes("sib-gated-h3k9")),
        String(sibTriggerValue)
      );
      if (sibHover && sibClickStep) {
        const hi = sibProfile.nodes.findIndex((s) => s.id === sibHover.id);
        const ci = sibProfile.nodes.findIndex((s) => s.id === sibClickStep.id);
        check("sibling hover step is immediately before the click step", hi === ci - 1, `hover@${hi} click@${ci}`);
      }

      // Replay through the real StepExecutor on a fresh page — capture correctness is only half of it.
      if (!sibHover || !sibClickStep) {
        check("sibling replay could run (hover + click steps present)", false, "missing step — replay skipped");
      } else {
        const { page, exec, close } = await freshExecutor(browser);
        try {
          check("sibling target is hidden before the hover", !(await page.locator(".sib-gated-h3k9").isVisible()));
          const hr = await exec.execute(sibHover);
          check("sibling hover step executed", hr.status === "passed", hr.error);
          check("sibling target became visible after the hover", await page.locator(".sib-gated-h3k9").isVisible());
          const cr = await exec.execute(sibClickStep);
          check("sibling click step executed", cr.status === "passed", cr.error);
          const result = (await page.getByTestId("sib-click-result").textContent()) ?? "";
          check("post-click state is 'sib-click-ok'", result.includes("sib-click-ok"), result);
        } finally {
          await close();
        }
      }

      // The hover step must be load-bearing: without it the click cannot succeed.
      {
        const { exec, close } = await freshExecutor(browser);
        try {
          const clickOnly = { ...(sibClickStep as FlowStep), timeoutMs: 3500 };
          const cr = await exec.execute(clickOnly);
          check("sibling click alone fails without the hover step", cr.status === "failed", `status=${cr.status}`);
        } finally {
          await close();
        }
      }
    }

    // ── [12] Adjacent sibling with no stable trigger → needs-review, never a positional locator ──
    console.log("\n[12] Unnamed adjacent sibling → needs-review, no fabricated trigger:");
    {
      const sibNpActions = await recordActions(browser, async (p) => {
        await p.hover(".sibnp-trigger-w8q2");
        await p.waitForTimeout(250);
        await p.locator(".sibnp-gated-w8q2").click();
      });
      const npClick = sibNpActions.find((a) => a.type === "click" && a.locator?.name === "Sibling no-owner");
      check("recorded the unnamed-sibling click", !!npClick);
      check("unnamed-sibling click flagged requiresHover", npClick?.locator?.interaction?.requiresHover === true);
      check("unnamed-sibling click flagged hoverUnresolved", npClick?.locator?.interaction?.hoverUnresolved === true);
      const npProfile = buildRecordedFlow("Sibling No Owner", sibNpActions);
      check("no hover step fabricated for the unnamed sibling", !hoverStepOf(npProfile));
      const npStep = clickStepOf(npProfile, "Sibling no-owner");
      check("unnamed-sibling click left needs-review", npStep?.locator?.resolution === "needs-review", npStep?.locator?.resolution);
    }

    // ── [12b] Sibling trigger resolvable only positionally → review, never a saved nth-child chain ──
    //
    // [12]'s unnamed span is rejected before the stability guard is ever reached (a span carries no
    // recorded rest visibility), so it cannot prove that guard exists — the suite passed with the
    // sibling path accepting positional locators until this case was added. The trigger here is a
    // real button, so rest visibility IS recorded and attribution reaches the stability check with
    // nothing but a positional chain to offer.
    console.log("\n[12b] Positional-only sibling trigger → needs-review:");
    {
      const posActions = await recordActions(browser, async (p) => {
        await p.hover(".sibpos-trigger-q3v7m2");
        await p.waitForTimeout(250);
        await p.locator(".sibpos-gated-q3v7m2").click();
      });
      const posClick = posActions.find((a) => a.type === "click" && a.locator?.name === "Positional sibling");
      check("recorded the positional-sibling click", !!posClick);
      check("positional-sibling click flagged requiresHover", posClick?.locator?.interaction?.requiresHover === true);
      check(
        "positional-sibling click flagged hoverUnresolved",
        posClick?.locator?.interaction?.hoverUnresolved === true,
        JSON.stringify(posClick?.locator?.interaction?.hoverContainer)
      );
      const posProfile = buildRecordedFlow("Sibling Positional", posActions);
      check("no positional sibling trigger was persisted as a hover step", !hoverStepOf(posProfile));
      const posStep = clickStepOf(posProfile, "Positional sibling");
      check("positional-sibling click left needs-review", posStep?.locator?.resolution === "needs-review", posStep?.locator?.resolution);
    }

    // ── [12c] REMOTE (non-adjacent) hover trigger is attributed and replays (awkit-hmt) ───────
    //
    // The trigger is in a different subtree from what it reveals — neither ancestor nor sibling — a
    // relationship CSS cannot express, so it is always JS-driven. `awkit-vot` refused these because
    // reveal-moment evidence then meant only "the pointer was somewhere when this appeared", which
    // any hover coinciding with any reveal satisfies. The discriminator is the pointer's ARRIVAL,
    // already used by the insertion path: the reveal must follow the pointer landing on the trigger
    // inside the causal window. That also closes an asymmetry — a remote hover that INSERTED a
    // control has been attributed since awkit-0vm, while one that merely unhid an existing control
    // was not, on identical evidence.
    console.log("\n[12c] Remote (non-adjacent) hover trigger is attributed:");
    {
      const remoteActions = await recordActions(browser, async (p) => {
        await p.hover(".remote-trigger-j5w1");
        await p.locator(".remote-gated-j5w1").waitFor({ state: "visible" });
        await p.locator(".remote-gated-j5w1").click();
      });
      const remoteClick = remoteActions.find((a) => a.type === "click" && a.locator?.name === "Remote target");
      check("recorded the remote-revealed click", !!remoteClick);
      check(
        "remote reveal is attributed to the distant trigger",
        remoteClick?.locator?.interaction?.requiresHover === true,
        JSON.stringify(remoteClick?.locator?.interaction)
      );
      check("remote attribution is not left unresolved", remoteClick?.locator?.interaction?.hoverUnresolved !== true);

      const remoteProfile = buildRecordedFlow("Remote", remoteActions);
      const remoteHover = hoverStepOf(remoteProfile);
      const remoteStep = clickStepOf(remoteProfile, "Remote target");
      check("a hover step was generated for the remote reveal", !!remoteHover);
      check("remote hover step is 'resolved'", remoteHover?.locator?.resolution === "resolved", remoteHover?.locator?.resolution);
      check(
        "remote trigger carries the trigger's accessible name",
        remoteHover?.locator?.name === "Remote reveal trigger",
        String(remoteHover?.locator?.name)
      );
      // Non-vacuity: the defect this pins is a MISSING step, so an absent locator would satisfy a
      // bare "contains no nth" assertion perfectly.
      const remoteValue = remoteHover?.locator?.value;
      check(
        "remote trigger locator is present and non-positional",
        typeof remoteValue === "string" && remoteValue.length > 0 && !/:nth-(?:child|of-type)\s*\(/.test(remoteValue),
        String(remoteValue)
      );
      check(
        "remote trigger is not the revealed control itself",
        !(typeof remoteValue === "string" && remoteValue.includes("remote-gated")),
        String(remoteValue)
      );
      if (remoteHover && remoteStep) {
        const hi = remoteProfile.nodes.findIndex((s) => s.id === remoteHover.id);
        const ci = remoteProfile.nodes.findIndex((s) => s.id === remoteStep.id);
        check("remote hover step is immediately before the click step", hi === ci - 1, `hover@${hi} click@${ci}`);
      }

      if (!remoteHover || !remoteStep) {
        check("remote replay could run (hover + click present)", false, "missing step — replay skipped");
      } else {
        for (let run = 1; run <= 2; run += 1) {
          const { page, exec, close } = await freshExecutor(browser);
          try {
            check(`run ${run}: remote target hidden before the hover`, !(await page.locator(".remote-gated-j5w1").isVisible()));
            const hr = await exec.execute(remoteHover);
            check(`run ${run}: remote hover step executed`, hr.status === "passed", hr.error);
            check(`run ${run}: the distant trigger revealed the control`, await page.locator(".remote-gated-j5w1").isVisible());
            const cr = await exec.execute(remoteStep);
            check(`run ${run}: remote click step executed`, cr.status === "passed", cr.error);
            const result = (await page.getByTestId("remote-click-result").textContent()) ?? "";
            check(`run ${run}: post-click state is 'remote-click-ok'`, result.includes("remote-click-ok"), result);
          } finally {
            await close();
          }
        }
        const { exec, close } = await freshExecutor(browser);
        try {
          const cr = await exec.execute({ ...remoteStep, timeoutMs: 3500 });
          check("remote click alone fails without the hover step", cr.status === "failed", `status=${cr.status}`);
        } finally {
          await close();
        }
      }
    }

    // ── [13] Adjacency is not causality: a timer reveal beside a hovered sibling stays unattributed ──
    //
    // Structurally identical to [11] — a named, stable, visible-at-rest sibling next to a control
    // hidden at rest — but the reveal comes from a timer. Attribution on adjacency + recency alone
    // cannot tell this apart from [11] and would fabricate a hover step. The pointer is deliberately
    // parked on the sibling well before the reveal (>300ms, the reveal-witness window) and the click
    // still lands inside the 2s sibling-recency window, so ONLY the reveal-moment evidence separates
    // them: this section fails if that evidence is removed.
    console.log("\n[13] A timer reveal next to a hovered sibling is NOT attributed:");
    {
      const coincidence = await recordActions(browser, async (p) => {
        await p.hover(".sibasync-other-v6r4");
        await p.waitForTimeout(500); // park the pointer past the reveal-witness window
        await p.locator(".sibasync-gated-v6r4").waitFor({ state: "visible" });
        await p.locator(".sibasync-gated-v6r4").click();
      });
      const coClick = coincidence.find((a) => a.type === "click" && a.locator?.name === "Timer sibling");
      check("recorded the timer-revealed sibling click", !!coClick);
      check(
        "timer-revealed click is NOT flagged requiresHover",
        coClick?.locator?.interaction?.requiresHover !== true,
        JSON.stringify(coClick?.locator?.interaction)
      );
      const coProfile = buildRecordedFlow("Sibling Coincidence", coincidence);
      check("no hover step fabricated for the timer reveal", !hoverStepOf(coProfile));
      const coStep = clickStepOf(coProfile, "Timer sibling");
      check("timer-revealed click is not forced to needs-review", coStep?.locator?.resolution !== "needs-review", coStep?.locator?.resolution);
    }
    // ═══ Hover-INSERTED controls (awkit-0vm) ══════════════════════════════════════════════════
    //
    // Everything above depends on a hidden-at-rest visibility record. A control that does not exist
    // at the baseline scan has no such record, and ABSENCE IS NOT HIDDENNESS — `visibilityState.get`
    // returns undefined, the hover branch is never entered, and the click is saved with no
    // prerequisite. These sections drive the insertion-evidence path instead: the recorder's own
    // MutationObserver seeing the node arrive, plus where the pointer was and WHEN IT GOT THERE.

    // ── [13b] A remote TIMER reveal under an idly-moving pointer stays unattributed ───────────
    //
    // This isolates the discriminator that justifies attributing remote reveals at all. The pointer
    // keeps MOVING over an unrelated named button, so it keeps producing fresh samples and the
    // reveal-witness freshness gate is satisfied in full — "the pointer was somewhere real when this
    // appeared" is true. What is not true is that the pointer's ARRIVAL explains the reveal: it
    // landed there ~1.6s earlier and a timer did the work. Without the arrival window this section
    // attributes `Idle hover area` as a hover prerequisite for a control it has nothing to do with.
    console.log("\n[13b] Remote timer reveal under a moving pointer → no attribution:");
    {
      const acts = await recordActions(browser, async (p) => {
        // The lab page is long, so the trigger's document coordinates can sit below the viewport.
        // Raw mouse.move to an off-screen point produces no pointer events at all — which silently
        // turns this into a "no witness" case and stops it testing the arrival window.
        await p.locator(".rtimer-trigger-p2q6").scrollIntoViewIfNeeded();
        const box = await p.locator(".rtimer-trigger-p2q6").boundingBox();
        if (!box) throw new Error("rtimer trigger has no box");
        await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        // Keep the pointer DENSELY alive over the same control until the timer fires at ~2.2s. The
        // sampling has to be tight enough that the last sample is always fresh at the reveal moment,
        // otherwise the witness freshness gate refuses this first and the arrival window — the thing
        // under test — never gets a say. (A 100ms loop was not dense enough: round-trip latency
        // pushed some gaps past the freshness window and this section passed for the wrong reason.)
        const deadline = Date.now() + 6000;
        let jiggle = 0;
        while (Date.now() < deadline) {
          jiggle += 1;
          await p.mouse.move(box.x + box.width / 2 + (jiggle % 3), box.y + box.height / 2 + (jiggle % 2));
          if (await p.locator(".rtimer-gated-p2q6").isVisible()) break;
          await p.waitForTimeout(40);
        }
        await p.locator(".rtimer-gated-p2q6").waitFor({ state: "visible" });
        await p.locator(".rtimer-gated-p2q6").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Timer remote target");
      check("recorded the remote timer click", !!click);
      check(
        "a remote timer reveal is NOT attributed to the idly-hovered control",
        click?.locator?.interaction?.requiresHover !== true,
        JSON.stringify(click?.locator?.interaction?.hoverContainer)
      );
      check("no hover step fabricated for the remote timer reveal", !hoverStepOf(buildRecordedFlow("Remote Timer", acts)));
    }

    // ── [14] Hover inserts an adjacent sibling control ────────────────────────────────────────
    console.log("\n[14] Hover-inserted sibling control is attributed and replays:");
    let insSibHover: FlowStep | undefined;
    let insSibClick: FlowStep | undefined;
    {
      const acts = await recordActions(browser, async (p) => {
        await p.hover(".ins-sib-trigger-r4k8");
        await p.locator(".ins-sib-gated-r4k8").waitFor({ state: "visible" });
        await p.locator(".ins-sib-gated-r4k8").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Inserted sibling");
      check("recorded the click on the hover-inserted control", !!click);
      check("inserted click flagged requiresHover", click?.locator?.interaction?.requiresHover === true);
      check(
        "prerequisite is marked as INSERTION evidence, not hidden-at-rest",
        click?.locator?.interaction?.hoverInserted === true,
        JSON.stringify(click?.locator?.interaction)
      );
      check("inserted click is not left unresolved", click?.locator?.interaction?.hoverUnresolved !== true);

      const profile = buildRecordedFlow("Inserted Sibling", acts);
      insSibHover = hoverStepOf(profile);
      insSibClick = clickStepOf(profile, "Inserted sibling");
      check("a hover step was generated for the insertion", !!insSibHover);
      check("inserted hover step is 'resolved'", insSibHover?.locator?.resolution === "resolved", insSibHover?.locator?.resolution);
      check(
        "trigger carries the inserting trigger's accessible name",
        insSibHover?.locator?.name === "Insert sibling action",
        String(insSibHover?.locator?.name)
      );
      const triggerValue = insSibHover?.locator?.value;
      check(
        "trigger locator is present and carries no positional nth selector",
        typeof triggerValue === "string" && triggerValue.length > 0 && !/:nth-(?:child|of-type)\s*\(/.test(triggerValue),
        String(triggerValue)
      );
      check(
        "trigger is not the inserted control itself",
        !(typeof triggerValue === "string" && triggerValue.includes("ins-sib-gated")),
        String(triggerValue)
      );
      if (insSibHover && insSibClick) {
        const hi = profile.nodes.findIndex((s) => s.id === insSibHover!.id);
        const ci = profile.nodes.findIndex((s) => s.id === insSibClick!.id);
        check("hover step is immediately before the click step", hi === ci - 1, `hover@${hi} click@${ci}`);
      }
      check("exactly one hover step for one inserted click", profile.nodes.filter((s) => s.type === "hover").length === 1);

      // Behaviour 12 — the built profile survives a save/reload round trip with its evidence intact,
      // and the ROUND-TRIPPED steps (not the originals) are what gets replayed below.
      const roundTripped = JSON.parse(JSON.stringify(profile)) as FlowProfile;
      const rtHover = hoverStepOf(roundTripped);
      const rtClick = clickStepOf(roundTripped, "Inserted sibling");
      check("hover step survives a profile JSON round trip", !!rtHover && rtHover.type === "hover");
      check(
        "insertion evidence survives the round trip",
        rtClick?.locator?.interaction?.hoverInserted === true && rtClick?.locator?.interaction?.requiresHover === true,
        JSON.stringify(rtClick?.locator?.interaction)
      );
      check(
        "round-tripped hover keeps the trigger locator",
        rtHover?.locator?.value === insSibHover?.locator?.value && rtHover?.locator?.name === insSibHover?.locator?.name
      );

      if (!rtHover || !rtClick) {
        check("inserted replay could run (hover + click present)", false, "missing step — replay skipped");
      } else {
        // Behaviour 13 — two fresh pages, replayed from the round-tripped profile.
        for (let run = 1; run <= 2; run += 1) {
          const { page, exec, close } = await freshExecutor(browser);
          try {
            check(`run ${run}: inserted control does not exist before the hover`, (await page.locator(".ins-sib-gated-r4k8").count()) === 0);
            const hr = await exec.execute(rtHover);
            check(`run ${run}: hover step executed`, hr.status === "passed", hr.error);
            check(`run ${run}: control was inserted by the hover`, (await page.locator(".ins-sib-gated-r4k8").count()) === 1);
            const cr = await exec.execute(rtClick);
            check(`run ${run}: click step executed`, cr.status === "passed", cr.error);
            const result = (await page.getByTestId("ins-sib-result").textContent()) ?? "";
            check(`run ${run}: post-click state is 'ins-sib-ok'`, result.includes("ins-sib-ok"), result);
          } finally {
            await close();
          }
        }
        // …and the hover step is load-bearing: the control never exists without it.
        const { exec, close } = await freshExecutor(browser);
        try {
          const cr = await exec.execute({ ...rtClick, timeoutMs: 3500 });
          check("click alone fails without the hover step", cr.status === "failed", `status=${cr.status}`);
        } finally {
          await close();
        }
      }
    }

    // ── [15] Hover inserts a CONTAINER holding the eventual click target ──────────────────────
    console.log("\n[15] Hover-inserted container holding the click target:");
    {
      const acts = await recordActions(browser, async (p) => {
        await p.hover(".ins-menu-trigger-r4k8");
        await p.locator(".ins-menu-gated-r4k8").waitFor({ state: "visible" });
        await p.locator(".ins-menu-gated-r4k8").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Menu item");
      check("recorded the click inside the inserted container", !!click);
      check("menu click flagged requiresHover + hoverInserted", click?.locator?.interaction?.requiresHover === true && click?.locator?.interaction?.hoverInserted === true);
      const profile = buildRecordedFlow("Inserted Menu", acts);
      const hover = hoverStepOf(profile);
      const clickStep = clickStepOf(profile, "Menu item");
      check("a hover step was generated for the inserted container", !!hover);
      check("trigger is the menu's inserting trigger", hover?.locator?.name === "Insert descendant menu", String(hover?.locator?.name));
      if (hover && clickStep) {
        const { page, exec, close } = await freshExecutor(browser);
        try {
          const hr = await exec.execute(hover);
          check("menu hover step executed", hr.status === "passed", hr.error);
          const cr = await exec.execute(clickStep);
          check("menu click step executed", cr.status === "passed", cr.error);
          const result = (await page.getByTestId("ins-menu-result").textContent()) ?? "";
          check("post-click state is 'ins-menu-ok'", result.includes("ins-menu-ok"), result);
        } finally {
          await close();
        }
      } else {
        check("menu replay could run", false, "missing step");
      }
    }

    // ── [16] One hover inserts THREE controls; the intended click maps to the same trigger ────
    console.log("\n[16] Multiple nodes from one hover → one trigger, one hover step:");
    {
      const acts = await recordActions(browser, async (p) => {
        await p.hover(".ins-multi-trigger-r4k8");
        await p.locator(".ins-multi-b-r4k8").waitFor({ state: "visible" });
        await p.locator(".ins-multi-b-r4k8").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Multi second");
      check("recorded the click on the second inserted control", !!click);
      check("multi click flagged hoverInserted", click?.locator?.interaction?.hoverInserted === true);
      const profile = buildRecordedFlow("Inserted Multi", acts);
      const hover = hoverStepOf(profile);
      check("the intended click maps to the inserting trigger", hover?.locator?.name === "Insert three actions", String(hover?.locator?.name));
      check("three insertions produce exactly one hover step", profile.nodes.filter((s) => s.type === "hover").length === 1);
      const clickStep = clickStepOf(profile, "Multi second");
      if (hover && clickStep) {
        const { page, exec, close } = await freshExecutor(browser);
        try {
          await exec.execute(hover);
          const cr = await exec.execute(clickStep);
          check("multi click step executed after hover", cr.status === "passed", cr.error);
          const result = (await page.getByTestId("ins-multi-result").textContent()) ?? "";
          check("the SECOND control was the one clicked", result.includes("ins-multi-b"), result);
        } finally {
          await close();
        }
      } else {
        check("multi replay could run", false, "missing step");
      }
    }

    // ── [16b] Repeated mutation of the SAME control keeps the first, causal evidence ──────────
    //
    // The control is removed and re-added while the pointer is already on it. A later observation
    // therefore has a witness INSIDE the inserted surface; if it were allowed to overwrite the first,
    // attribution would collapse to "pointer was inside the inserted surface" and the click would be
    // refused. First observation wins, and repeated mutations still yield exactly one prerequisite.
    console.log("\n[16b] Re-inserted control keeps its original attribution (dedup):");
    {
      const acts = await recordActions(browser, async (p) => {
        await p.hover(".ins-redo-trigger-r4k8");
        await p.locator(".ins-redo-gated-r4k8").waitFor({ state: "visible" });
        await p.hover(".ins-redo-gated-r4k8"); // provokes remove + re-add under the pointer
        await p.waitForTimeout(150);
        await p.locator(".ins-redo-gated-r4k8").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Re-added action");
      check("recorded the click on the re-added control", !!click);
      check(
        "re-observation did not overwrite the causal evidence",
        click?.locator?.interaction?.requiresHover === true && click?.locator?.interaction?.hoverUnresolved !== true,
        JSON.stringify(click?.locator?.interaction)
      );
      const profile = buildRecordedFlow("Re-added", acts);
      const hover = hoverStepOf(profile);
      check("attribution still names the original trigger", hover?.locator?.name === "Insert re-added action", String(hover?.locator?.name));
      check("repeated mutations still produce exactly one hover step", profile.nodes.filter((s) => s.type === "hover").length === 1);
    }

    // ── [17] Insertion inside NESTED OPEN shadow roots — the INTERNAL trigger is persisted ────
    //
    // Two things are proved here. First, that the insertion is observed at all: a document-level
    // MutationObserver cannot see a childList change inside a shadow root, so without the bounded
    // per-root observers there is no evidence whatsoever. Second, and the point of this section, that
    // the trigger persisted is the actual shadow-internal control the pointer was on — described
    // through the Increment 6 model (ordered outer-to-inner hosts + a semantic inner locator) — and
    // NOT its host. The fixture geometry makes the difference material: both hosts' action points
    // miss the trigger, and the mouseenter listener is bound to the trigger, so a host locator
    // replays a hover that inserts nothing.
    console.log("\n[17] Nested open-shadow insertion persists the INTERNAL trigger:");
    {
      const acts = await recordActions(browser, async (p) => {
        await p.hover(".ins-shadow-trigger-r4k8"); // Playwright pierces open roots with plain CSS
        await p.locator(".ins-shadow-gated-r4k8").waitFor({ state: "visible" });
        await p.locator(".ins-shadow-gated-r4k8").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Shadow inserted");
      check("recorded the click on the shadow-inserted control", !!click);
      check(
        "the shadow-root insertion was OBSERVED (per-root observer is wired)",
        click?.locator?.interaction?.hoverInserted === true,
        JSON.stringify(click?.locator?.interaction?.hoverReviewReason ?? click?.locator?.interaction)
      );
      check("shadow insertion click flagged requiresHover", click?.locator?.interaction?.requiresHover === true);
      check(
        "the open shadow boundary is recorded",
        click?.locator?.interaction?.shadowBoundary === "open",
        String(click?.locator?.interaction?.shadowBoundary)
      );

      const profile = buildRecordedFlow("Inserted Shadow", acts);
      const hover = hoverStepOf(profile);
      const clickStep = clickStepOf(profile, "Shadow inserted");
      check("a hover step was generated for the shadow insertion", !!hover);
      check("shadow hover step is 'resolved', not review", hover?.locator?.resolution === "resolved", hover?.locator?.resolution);

      // (a) Capture selected the INNER trigger, not a host.
      check(
        "trigger is the internal control, carrying its accessible name",
        hover?.locator?.name === "Insert in shadow",
        `${hover?.locator?.strategy}=${hover?.locator?.value} name=${hover?.locator?.name}`
      );
      check(
        "trigger locator is not a host selector",
        !(typeof hover?.locator?.value === "string" && hover.locator.value.includes("ins-shadow-host")),
        String(hover?.locator?.value)
      );
      check(
        "trigger locator is non-positional",
        typeof hover?.locator?.value === "string" && !/:nth-(?:child|of-type)\s*\(/.test(hover.locator.value),
        String(hover?.locator?.value)
      );

      // (b) Ordered outer-to-inner shadow context is present and correctly ordered.
      const shadowCtx = hover?.locator?.context?.shadow;
      check("hover locator carries open-shadow context", shadowCtx?.boundary === "open", JSON.stringify(shadowCtx));
      check("the host chain has both nested hosts", shadowCtx?.hosts?.length === 2, `hosts=${shadowCtx?.hosts?.length}`);
      check(
        "hosts are ordered OUTER first, then inner",
        typeof shadowCtx?.hosts?.[0]?.value === "string" &&
          shadowCtx.hosts[0].value.includes("ins-shadow-host-r4k8") &&
          typeof shadowCtx?.hosts?.[1]?.value === "string" &&
          shadowCtx.hosts[1].value.includes("ins-shadow-inner-host-r4k8"),
        JSON.stringify(shadowCtx?.hosts?.map((h) => h.value))
      );

      // (c) The ordered context survives profile persistence AND an IPC-shaped structured clone.
      const persisted = JSON.parse(JSON.stringify(profile)) as FlowProfile;
      const ipc = structuredClone(persisted) as FlowProfile;
      const rtHover = hoverStepOf(ipc);
      const rtClick = clickStepOf(ipc, "Shadow inserted");
      check(
        "shadow context survives profile + IPC round trips, still ordered",
        rtHover?.locator?.context?.shadow?.hosts?.length === 2 &&
          rtHover.locator.context.shadow.hosts[0].value === shadowCtx?.hosts?.[0]?.value &&
          rtHover.locator.context.shadow.hosts[1].value === shadowCtx?.hosts?.[1]?.value,
        JSON.stringify(rtHover?.locator?.context?.shadow)
      );
      check("round-tripped hover still names the internal trigger", rtHover?.locator?.name === "Insert in shadow");

      if (!rtHover || !rtClick) {
        check("shadow replay could run", false, "missing step — replay skipped");
      } else {
        // (d) Hover → Click succeeds on TWO fresh pages, replayed from the round-tripped profile.
        for (let run = 1; run <= 2; run += 1) {
          const { page, exec, close } = await freshExecutor(browser);
          try {
            check(`run ${run}: shadow control does not exist before the hover`, (await page.locator(".ins-shadow-gated-r4k8").count()) === 0);
            const hr = await exec.execute(rtHover);
            check(`run ${run}: shadow hover step executed`, hr.status === "passed", hr.error);
            check(`run ${run}: hovering the INTERNAL trigger inserted the control`, (await page.locator(".ins-shadow-gated-r4k8").count()) === 1);
            const cr = await exec.execute(rtClick);
            check(`run ${run}: shadow click step executed`, cr.status === "passed", cr.error);
            const result = (await page.getByTestId("ins-shadow-result").textContent()) ?? "";
            check(`run ${run}: post-click state is 'ins-shadow-ok'`, result.includes("ins-shadow-ok"), result);
          } finally {
            await close();
          }
        }

        // (e) The ordered host chain is load-bearing. A light-DOM decoy shares the internal trigger's
        // accessible name, and Playwright's role engine pierces open roots, so from the document root
        // the trigger locator matches TWO elements and cannot identify the control. Alternatives are
        // stripped alongside the context here on purpose: the recorder's alternative CSS candidate is
        // independently unique and would otherwise recover the element, hiding what is being tested.
        {
          const { exec, close } = await freshExecutor(browser);
          try {
            const stripped = JSON.parse(JSON.stringify(rtHover)) as FlowStep;
            if (stripped.locator?.context) delete stripped.locator.context.shadow;
            if (stripped.locator) delete stripped.locator.alternatives;
            stripped.timeoutMs = 3500;
            const hr = await exec.execute(stripped);
            check(
              "the primary trigger locator is AMBIGUOUS without its host chain",
              hr.status === "failed",
              `status=${hr.status}`
            );
          } finally {
            await close();
          }
        }
        // …and with the chain restored it is unambiguous again (so (e) is about the chain, not the
        // missing alternatives).
        {
          const { exec, close } = await freshExecutor(browser);
          try {
            const noAlternatives = JSON.parse(JSON.stringify(rtHover)) as FlowStep;
            if (noAlternatives.locator) delete noAlternatives.locator.alternatives;
            noAlternatives.timeoutMs = 3500;
            const hr = await exec.execute(noAlternatives);
            check("the same locator WITH its host chain resolves", hr.status === "passed", hr.error);
          } finally {
            await close();
          }
        }

        // (f) THE REGRESSION THIS SECTION EXISTS FOR: substituting the host is not equivalent.
        // Hovering the host's action point succeeds as an action and inserts NOTHING.
        {
          const { page, exec, close } = await freshExecutor(browser);
          try {
            const hostHover: FlowStep = {
              id: "host-substitution",
              type: "hover",
              name: "Hover the outer host (substitution)",
              timeoutMs: 3500,
              locator: { strategy: "css", value: "div.ins-shadow-host-r4k8", resolution: "resolved" }
            };
            const hr = await exec.execute(hostHover);
            check("host hover itself is actionable (so the failure is not a locator error)", hr.status === "passed", hr.error);
            check(
              "hovering the HOST inserts nothing — host substitution is not equivalent",
              (await page.locator(".ins-shadow-gated-r4k8").count()) === 0
            );
          } finally {
            await close();
          }
        }
      }
    }

    // ── [17b] An open-shadow trigger that cannot be represented degrades to needs-review ──────
    //
    // Two identical nameless buttons in one root: the semantic locator is ambiguous and the only
    // classes are hash-suffixed, so no safe inner locator exists. The refusal must be explicit, and
    // must NOT fall back to the host — which would replay a different interaction entirely.
    console.log("\n[17b] Unrepresentable open-shadow trigger → needs-review, no host fallback:");
    {
      const acts = await recordActions(browser, async (p) => {
        await p.hover(".insu-trigger-q8w3n7");
        await p.locator(".insu-gated-q8w3n7").waitFor({ state: "visible" });
        await p.locator(".insu-gated-q8w3n7").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Unsafe shadow inserted");
      check("recorded the click on the unsafe shadow insertion", !!click);
      check("unsafe shadow insertion was observed", click?.locator?.interaction?.hoverInserted === true);
      check("unsafe shadow trigger is refused", click?.locator?.interaction?.hoverUnresolved === true);
      check(
        "the refusal names the shadow representation problem",
        click?.locator?.interaction?.hoverReviewReason === "hover trigger inside open shadow root could not be represented safely",
        String(click?.locator?.interaction?.hoverReviewReason)
      );
      check(
        "no host locator was persisted as a fallback",
        click?.locator?.interaction?.hoverContainer === undefined,
        JSON.stringify(click?.locator?.interaction?.hoverContainer)
      );
      const profile = buildRecordedFlow("Unsafe Shadow", acts);
      check("no hover step fabricated from the host", !hoverStepOf(profile));
      const step = clickStepOf(profile, "Unsafe shadow inserted");
      check("unsafe shadow click left needs-review", step?.locator?.resolution === "needs-review", step?.locator?.resolution);
      check(
        "the review reason reaches the built step",
        step?.locator?.reviewReason === "hover trigger inside open shadow root could not be represented safely",
        String(step?.locator?.reviewReason)
      );
    }

    // ── [18] NEGATIVE: a timer inserts the control while the pointer is parked nearby ─────────
    console.log("\n[18] Timer insertion while the pointer is parked → no attribution:");
    {
      const acts = await recordActions(browser, async (p) => {
        await p.hover(".ins-timer-other-r4k8");
        await p.waitForTimeout(700); // past the causal window between pointer ARRIVAL and insertion
        await p.locator(".ins-timer-gated-r4k8").waitFor({ state: "visible" });
        await p.locator(".ins-timer-gated-r4k8").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Timer inserted");
      check("recorded the timer-inserted click", !!click);
      check(
        "timer insertion is NOT flagged requiresHover",
        click?.locator?.interaction?.requiresHover !== true,
        JSON.stringify(click?.locator?.interaction)
      );
      check("no hover step fabricated for the timer insertion", !hoverStepOf(buildRecordedFlow("Timer Ins", acts)));
    }

    // ── [18b] NEGATIVE: nothing was under the pointer when the node arrived ───────────────────
    //
    // Same timer insertion, but the mouse is not moved at all until AFTER the control exists, so the
    // recorder has no pointer witness for the insertion. The pointer then arrives on a stable named
    // neighbour before the click — everything a trail-based attribution would need. The distinction
    // is that the trail describes where the pointer went afterwards; only the witness says where it
    // was when the node actually appeared, and here the answer is "nowhere".
    console.log("\n[18b] No pointer witness at insertion time → no attribution:");
    {
      const acts = await recordActions(browser, async (p) => {
        await p.locator(".ins-timer-gated-r4k8").waitFor({ state: "visible" }); // no pointer events yet
        await p.hover(".ins-timer-other-r4k8"); // pointer arrives only now, after the insertion
        await p.locator(".ins-timer-gated-r4k8").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Timer inserted");
      check("recorded the click after a witness-less insertion", !!click);
      check(
        "an insertion with no pointer witness is NOT attributed",
        click?.locator?.interaction?.requiresHover !== true,
        JSON.stringify(click?.locator?.interaction?.hoverContainer)
      );
      check("no hover step from a later pointer arrival", !hoverStepOf(buildRecordedFlow("No Witness", acts)));
    }

    // ── [19] NEGATIVE: an unrelated subtree insertion must not attach to another click ────────
    console.log("\n[19] Unrelated subtree insertion → no attribution on a normal click:");
    {
      const acts = await recordActions(browser, async (p) => {
        await p.hover(".ins-unrelated-trigger-r4k8");
        await p.locator(".ins-unrelated-noise-r4k8").waitFor({ state: "attached" });
        await p.locator(".ins-unrelated-plain-r4k8").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Plain control");
      check("recorded the plain click", !!click);
      check(
        "an unrelated insertion does not flag the plain click",
        click?.locator?.interaction?.requiresHover !== true,
        JSON.stringify(click?.locator?.interaction)
      );
      check("no hover step from unrelated churn", !hoverStepOf(buildRecordedFlow("Unrelated Ins", acts)));
    }

    // ── [20] NEGATIVE: a CLICK inserted the control — no hover prerequisite exists ────────────
    console.log("\n[20] Click-driven insertion → no hover attribution and no false review:");
    {
      const acts = await recordActions(browser, async (p) => {
        await p.click(".ins-click-trigger-r4k8");
        await p.locator(".ins-click-gated-r4k8").waitFor({ state: "visible" });
        await p.locator(".ins-click-gated-r4k8").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Click inserted");
      check("recorded the click-inserted click", !!click);
      check(
        "a click-caused insertion is NOT flagged requiresHover",
        click?.locator?.interaction?.requiresHover !== true,
        JSON.stringify(click?.locator?.interaction)
      );
      const profile = buildRecordedFlow("Click Ins", acts);
      check("no hover step for a click-caused insertion", !hoverStepOf(profile));
      const step = clickStepOf(profile, "Click inserted");
      check(
        "a click-caused insertion is not falsely sent to review",
        step?.locator?.resolution !== "needs-review",
        step?.locator?.resolution
      );
    }

    // ── [21] NEGATIVE: positional-only inserting trigger → review with a reason ───────────────
    console.log("\n[21] Positional-only inserting trigger → needs-review:");
    {
      const acts = await recordActions(browser, async (p) => {
        await p.hover(".ins-pos-trigger-k7x2m9");
        await p.locator(".ins-pos-gated-r4k8").waitFor({ state: "visible" });
        await p.locator(".ins-pos-gated-r4k8").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Positional inserted");
      check("recorded the positional-trigger click", !!click);
      check("positional-trigger click flagged requiresHover", click?.locator?.interaction?.requiresHover === true);
      check("positional-trigger click flagged hoverUnresolved", click?.locator?.interaction?.hoverUnresolved === true);
      check(
        "the refusal names the stable-locator requirement",
        typeof click?.locator?.interaction?.hoverReviewReason === "string" &&
          click.locator.interaction.hoverReviewReason.includes("stable"),
        String(click?.locator?.interaction?.hoverReviewReason)
      );
      const profile = buildRecordedFlow("Positional Ins", acts);
      check("no positional trigger persisted as a hover step", !hoverStepOf(profile));
      const step = clickStepOf(profile, "Positional inserted");
      check("positional-trigger click left needs-review", step?.locator?.resolution === "needs-review", step?.locator?.resolution);
      check(
        "the review reason reaches the built step",
        typeof step?.locator?.reviewReason === "string" && step.locator.reviewReason.length > 0,
        String(step?.locator?.reviewReason)
      );
    }

    // ── [22] NEGATIVE: the trigger disappears before the click → review with a reason ─────────
    console.log("\n[22] Trigger removed before the click → needs-review:");
    {
      const acts = await recordActions(browser, async (p) => {
        await p.hover(".ins-vanish-trigger-r4k8");
        await p.locator(".ins-vanish-gated-r4k8").waitFor({ state: "visible" });
        await p.locator(".ins-vanish-trigger-r4k8").waitFor({ state: "detached" });
        await p.locator(".ins-vanish-gated-r4k8").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Vanish inserted");
      check("recorded the vanishing-trigger click", !!click);
      check("vanishing-trigger click flagged requiresHover", click?.locator?.interaction?.requiresHover === true);
      check("vanishing-trigger click flagged hoverUnresolved", click?.locator?.interaction?.hoverUnresolved === true);
      check(
        "the refusal says the trigger left the page",
        typeof click?.locator?.interaction?.hoverReviewReason === "string" &&
          click.locator.interaction.hoverReviewReason.includes("left the page"),
        String(click?.locator?.interaction?.hoverReviewReason)
      );
      const profile = buildRecordedFlow("Vanishing Ins", acts);
      check("no hover step for a trigger that no longer exists", !hoverStepOf(profile));
      check(
        "vanishing-trigger click left needs-review",
        clickStepOf(profile, "Vanish inserted")?.locator?.resolution === "needs-review"
      );
    }

    // ── [23] FAIL-CLOSED: insertion tracking saturated → review, never a silent save ──────────
    //
    // One hover inserts far more nodes than the recorder's insertion-record bound, and the intended
    // control arrives LAST, so it gets no record of its own. The recorder cannot then prove the click
    // is free of a hover dependency, and an unprovable click must not be saved as if it were clean.
    console.log("\n[23] Insertion tracking saturated → fail closed:");
    {
      const acts = await recordActions(browser, async (p) => {
        await p.hover(".ins-flood-trigger-r4k8");
        await p.locator(".ins-flood-gated-r4k8").waitFor({ state: "visible" });
        await p.locator(".ins-flood-gated-r4k8").click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Flood target");
      check("recorded the click after saturation", !!click);
      check("saturated click flagged requiresHover", click?.locator?.interaction?.requiresHover === true);
      check("saturated click flagged hoverUnresolved", click?.locator?.interaction?.hoverUnresolved === true);
      check(
        "the refusal names saturation",
        typeof click?.locator?.interaction?.hoverReviewReason === "string" &&
          click.locator.interaction.hoverReviewReason.includes("saturated"),
        String(click?.locator?.interaction?.hoverReviewReason)
      );
      const profile = buildRecordedFlow("Flood Ins", acts);
      check("no trigger guessed at the bound", !hoverStepOf(profile));
      check(
        "saturated click left needs-review",
        clickStepOf(profile, "Flood target")?.locator?.resolution === "needs-review"
      );
    }
    // Regression: the visibility sampler intentionally omits some valid semantic roles. After
    // unrelated churn exhausts insertion tracking, that omission must not make a role-based action
    // appear newly inserted when the full baseline snapshot proves it was already present.
    console.log("\n[24] Saturation preserves a stable role locator:");
    {
      const acts = await recordActions(browser, async (p) => {
        await p.hover(".ins-flood-trigger-r4k8");
        await p.locator(".ins-flood-gated-r4k8").waitFor({ state: "visible" });
        await p.getByRole("link", { name: "Stable next video" }).click();
      });
      const click = acts.find((a) => a.type === "click" && a.locator?.name === "Stable next video");
      check("recorded the stable role click after saturation", !!click);
      check(
        "stable role locator remains unique and high confidence",
        click?.locator?.strategy === "role" &&
          click.locator.value === "link" &&
          click.locator.quality?.isUnique === true &&
          click.locator.quality?.confidence === "high",
        JSON.stringify(click?.locator)
      );
      check("stable role click does not acquire a hover review", click?.locator?.interaction?.hoverUnresolved !== true, JSON.stringify(click?.locator?.interaction));
      const profile = buildRecordedFlow("Stable role after flood", acts);
      check("stable role click remains resolved", clickStepOf(profile, "Stable next video")?.locator?.resolution !== "needs-review");
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
