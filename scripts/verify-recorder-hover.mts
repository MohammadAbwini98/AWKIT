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

    // ── [12c] Boundary: a REMOTE (non-adjacent) hover reveal is deliberately not attributed ─────
    //
    // The pointer is on the trigger at the exact moment the reveal happens, so reveal-moment evidence
    // is satisfied in full — only the adjacency requirement stops this being attributed. Without that
    // requirement the recorder would pin a trigger from nothing more than "a hover coincided with a
    // reveal somewhere on the page", which is the fabrication the whole path is built to avoid. This
    // is a KNOWN LIMITATION pinned as behaviour, not an endorsement: a genuine remote hover
    // dependency is left for the user to add, and is tracked separately.
    console.log("\n[12c] Remote (non-adjacent) hover reveal stays unattributed (documented boundary):");
    {
      const remoteActions = await recordActions(browser, async (p) => {
        await p.hover(".remote-trigger-j5w1");
        await p.locator(".remote-gated-j5w1").waitFor({ state: "visible" });
        await p.locator(".remote-gated-j5w1").click();
      });
      const remoteClick = remoteActions.find((a) => a.type === "click" && a.locator?.name === "Remote target");
      check("recorded the remote-revealed click", !!remoteClick);
      check(
        "remote reveal is NOT attributed to the distant trigger",
        remoteClick?.locator?.interaction?.requiresHover !== true,
        JSON.stringify(remoteClick?.locator?.interaction?.hoverContainer)
      );
      check("no hover step fabricated for the remote reveal", !hoverStepOf(buildRecordedFlow("Remote", remoteActions)));
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
