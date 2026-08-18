/**
 * Guarded-positional locator acceptance gate (awkit-65g Phase B).
 *
 * Run with: npm run verify:locator-guard
 *
 * Drives the REAL responsible layers — recorderInitScript (in-page capture + fingerprint), buildRecordedFlow
 * (guard hashing + sensitivity policy), FlowValidator preflight, LocatorFactory.resolveGuardedPositional and
 * StepExecutor — against live pages. A SENSITIVE step (dangerousMutation/externalCommit) whose only unique
 * locator is positional must re-prove the recorded target identity before acting and abort with
 * SENSITIVE_TARGET_IDENTITY_CHANGED when the target's identity changed — never falling back to another
 * sibling. The "unchanged → passes" case is also the end-to-end fingerprint-parity check (capture-time
 * in-page fingerprint vs runtime evaluate).
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory, type LocatorRecoveryEvent } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { validateFlowDefinition, hasActivePathError, executionBlockingErrorsOf } from "@src/validation/FlowValidator";
import { hasPositionalIdentityGuard, isPositionalLocator } from "@src/profiles/locatorApproval";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { PageBlueprint } from "@src/runner/LocatorBlueprintStore";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";

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

// Four identical Delete controls in a stable container — the recorder can only distinguish them by
// position, so a sensitive click on one produces a guarded-positional locator.
const FIXTURE = `<!doctype html><html><body>
  <div id="danger-zone">
    <button>Delete</button>
    <button>Delete</button>
    <button>Delete</button>
    <button>Delete</button>
  </div>
  <output id="gp-result"></output>
  <script>
    document.getElementById('danger-zone').addEventListener('click', function (e) {
      var buttons = Array.prototype.slice.call(document.querySelectorAll('#danger-zone button'));
      var button = e.target.closest && e.target.closest('button');
      if (button) document.getElementById('gp-result').textContent = 'clicked-' + buttons.indexOf(button);
    });
  </script>
</body></html>`;

// Two form controls that share a label ("Recipient account"), so the recorder can only distinguish them
// by position — a SENSITIVE positional FILL captures a labelContent precondition alongside the fingerprint.
const FILL_FIXTURE = `<!doctype html><html><body>
  <div id="pay-form">
    <div class="row"><label>Recipient account <input class="acct" /></label></div>
    <div class="row"><label>Recipient account <input class="acct" /></label></div>
  </div>
  <output id="fill-result"></output>
  <script>
    document.getElementById('pay-form').addEventListener('input', function (e) {
      var inputs = Array.prototype.slice.call(document.querySelectorAll('#pay-form input'));
      if (e.target && e.target.tagName === 'INPUT') {
        document.getElementById('fill-result').textContent = 'filled-' + inputs.indexOf(e.target) + '=' + e.target.value;
      }
    });
  </script>
</body></html>`;

async function makeContext(): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "wfs-guard-"));
  return {
    executionId: "exec-guard",
    instanceId: "inst-1",
    scenarioId: "scen-1",
    flowId: "flow-guard",
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

let recorderScript: string;
let fixtureUrl: string;

/**
 * Record a real click on the fixture's button `index`; return the raw recorded click action. The
 * Recorder capture only installs on a real navigation (not `setContent`), so the fixture is served
 * over a local HTTP origin.
 */
async function captureClick(browser: Browser, index: number): Promise<RecordedAction> {
  const ctx = await browser.newContext();
  await ctx.addInitScript({ content: recorderScript });
  const page = await ctx.newPage();
  const actions: RecordedAction[] = [];
  await page.exposeBinding("__awtkit_recordAction", (_s, a) => actions.push(a as RecordedAction));
  await page.exposeBinding("__awtkit_recordSignal", () => {});
  await page.goto(fixtureUrl);
  await page.waitForTimeout(400);
  await page.locator("#danger-zone button").nth(index).click();
  await page.waitForTimeout(250);
  await ctx.close();
  const click = actions.find((a) => a.type === "click");
  if (!click) throw new Error("no click captured");
  return click;
}

/** A fresh fixture page + StepExecutor (with recovery events), for a runtime scenario. */
async function freshRun(browser: Browser, mutate?: (page: import("playwright").Page) => Promise<void>, content: string = FIXTURE) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent(content);
  if (mutate) await mutate(page);
  const context = await makeContext();
  const events: LocatorRecoveryEvent[] = [];
  const factory = new LocatorFactory(page, { onRecoveryEvent: (event) => events.push(event) });
  const exec = new StepExecutor(page, factory, new ValueResolver(context), context);
  return { page, exec, events, close: () => ctx.close() };
}

/** Record a real FILL on the fill fixture's input `index`; return the raw recorded fill action. */
async function captureFill(browser: Browser, index: number, value: string): Promise<RecordedAction> {
  const ctx = await browser.newContext();
  await ctx.addInitScript({ content: recorderScript });
  const page = await ctx.newPage();
  const actions: RecordedAction[] = [];
  await page.exposeBinding("__awtkit_recordAction", (_s, a) => actions.push(a as RecordedAction));
  await page.exposeBinding("__awtkit_recordSignal", () => {});
  await page.goto(`${fixtureUrl}fill`);
  await page.waitForTimeout(400);
  await page.locator("#pay-form input").nth(index).fill(value);
  await page.locator("#pay-form input").nth(index).blur();
  await page.waitForTimeout(250);
  await ctx.close();
  const fill = actions.find((a) => a.type === "fill");
  if (!fill) throw new Error("no fill captured");
  return fill;
}

function clickStep(flow: FlowProfile): FlowStep {
  const step = flow.nodes.find((n) => n.type === "click");
  if (!step) throw new Error("no click step in built flow");
  return step;
}

async function main() {
  recorderScript = getRecorderInitScriptContent();
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end((req.url || "/").split("?")[0] === "/fill" ? FILL_FIXTURE : FIXTURE);
  });
  await new Promise<void>((resolve) => server.listen(4411, "127.0.0.1", resolve));
  fixtureUrl = "http://127.0.0.1:4411/";
  const browser = await chromium.launch();
  try {
    const rawClick = await captureClick(browser, 2);

    // ── [1] Capture: a SENSITIVE positional click becomes a guarded-positional resolved locator ──────
    console.log("\n[1] Capture builds a guarded-positional locator for a sensitive step:");
    const sensitiveBlueprints: PageBlueprint[] = [];
    const sensitiveFlow = buildRecordedFlow("Guard", [{ ...rawClick, name: "Delete account" }], sensitiveBlueprints);
    const step = clickStep(sensitiveFlow);
    check("[1] the recorded locator is positional", isPositionalLocator(step.locator));
    check("[1] a runtime identity guard is attached", hasPositionalIdentityGuard(step));
    check("[1] the sensitive guarded-positional locator is RESOLVED (no review, no approval)", step.locator?.resolution === "resolved");
    check("[1] the guard records the candidate set size and index", step.locator?.guard?.siblingCount === 4 && step.locator?.guard?.index === 2, JSON.stringify({ n: step.locator?.guard?.siblingCount, i: step.locator?.guard?.index }));
    check("[1] the guard fingerprint is HASHED, not raw page text", step.locator?.guard?.fingerprint?.name !== "delete" && /^[0-9a-f]{20}$/.test(step.locator?.guard?.fingerprint?.name ?? ""), step.locator?.guard?.fingerprint?.name);
    check("[1] a sensitive recorded step receives no blueprint recovery reference", step.locator?.blueprintId === undefined);
    check("[1] a sensitive recorded step persists no page blueprint", sensitiveBlueprints.length === 0, String(sensitiveBlueprints.length));

    // ── [2] A non-sensitive positional click uses the same deterministic identity proof ─────────────
    console.log("\n[2] Non-sensitive positional persists its identity guard:");
    const nonSensitive = clickStep(buildRecordedFlow("Open", [{ ...rawClick, name: "Open record" }]));
    check("[2] non-sensitive positional is resolved", nonSensitive.locator?.resolution === "resolved");
    check("[2] non-sensitive positional carries a hashed guard", !!nonSensitive.locator?.guard && nonSensitive.locator.guard.fingerprint.name !== "delete");

    // ── [3] A sensitive positional with NO captured guard stays needs-review ─────────────────────────
    console.log("\n[3] Sensitive positional with no usable guard is needs-review:");
    const noGuard = clickStep(buildRecordedFlow("NG", [{ ...rawClick, name: "Delete account", locator: { ...rawClick.locator!, guard: undefined } }]));
    check("[3] sensitive positional with no guard is needs-review", noGuard.locator?.resolution === "needs-review");
    check("[3] and it carries no guard", noGuard.locator?.guard === undefined);

    // ── [4] Preflight: guarded flow is runnable; the bare-positional version is blocked ──────────────
    console.log("\n[4] Preflight admits the guarded flow, blocks the bare-positional one:");
    check("[4] the guarded sensitive flow passes preflight", !hasActivePathError(validateFlowDefinition(sensitiveFlow)));
    const strippedFlow: FlowProfile = {
      ...sensitiveFlow,
      nodes: sensitiveFlow.nodes.map((n) => (n.id === step.id ? { ...n, locator: { ...n.locator!, guard: undefined } } : n))
    };
    const strippedReport = validateFlowDefinition(strippedFlow);
    check("[4] the bare-positional sensitive flow is blocked at preflight", hasActivePathError(strippedReport));
    check("[4] the blocking error is locatorNeedsReview", executionBlockingErrorsOf(strippedReport).some((i) => i.code === "locatorNeedsReview"));

    // ── [5] Round trip: the guard survives save/reload/IPC ───────────────────────────────────────────
    console.log("\n[5] Guard survives the persistence lifecycle:");
    const roundTripped = structuredClone(JSON.parse(JSON.stringify(step))) as FlowStep;
    check("[5] guard survives save/reload/IPC", hasPositionalIdentityGuard(roundTripped) && JSON.stringify(roundTripped.locator?.guard) === JSON.stringify(step.locator?.guard));

    // ── [6] Runtime SUCCESS: unchanged page → verified + clicks the recorded index (parity proof) ────
    console.log("\n[6] Guarded replay passes when the target identity is unchanged:");
    {
      const { page, exec, events, close } = await freshRun(browser);
      try {
        const r = await exec.execute({ ...step, timeoutMs: 4000 });
        check("[6] the guarded step passes unchanged", r.status === "passed", r.error);
        check("[6] it clicked the recorded index (not another sibling)", (await page.locator("#gp-result").textContent()) === "clicked-2", (await page.locator("#gp-result").textContent()) ?? undefined);
        check("[6] the runtime emitted a verified guarded-positional event", events.some((e) => e.type === "guarded-positional"));
      } finally {
        await close();
      }
    }

    // ── [7] Runtime ABORT on candidate-set change (insertion / removal) ──────────────────────────────
    console.log("\n[7] Guarded replay ABORTS when the candidate set changed:");
    for (const [label, mutate] of [
      ["insertion", async (p: import("playwright").Page) => p.evaluate(() => { const b = document.createElement("button"); b.textContent = "Delete"; document.getElementById("danger-zone")!.prepend(b); })],
      ["removal", async (p: import("playwright").Page) => p.evaluate(() => { document.querySelectorAll("#danger-zone button")[0].remove(); })]
    ] as const) {
      const { page, exec, close } = await freshRun(browser, mutate);
      try {
        const r = await exec.execute({ ...step, timeoutMs: 4000 });
        check(`[7] ${label} aborts the sensitive action`, r.status === "failed", `status=${r.status}`);
        check(`[7] ${label} abort is SENSITIVE_TARGET_IDENTITY_CHANGED`, (r.error ?? "").includes("SENSITIVE_TARGET_IDENTITY_CHANGED"), r.error);
        check(`[7] ${label} clicked NOTHING (refused before the side effect)`, (await page.locator("#gp-result").textContent()) === "", (await page.locator("#gp-result").textContent()) ?? undefined);
      } finally {
        await close();
      }
    }

    // ── [8] Runtime ABORT when the element at the recorded index changed identity ────────────────────
    console.log("\n[8] Guarded replay ABORTS when the target's identity changed:");
    {
      const { page, exec, close } = await freshRun(browser, async (p) => {
        // The candidate set size is unchanged, but the recorded target (index 2) is now a different control.
        await p.evaluate(() => { (document.querySelectorAll("#danger-zone button")[2] as HTMLElement).textContent = "Archive"; });
      });
      try {
        const r = await exec.execute({ ...step, timeoutMs: 4000 });
        check("[8] a changed target aborts", r.status === "failed", `status=${r.status}`);
        check("[8] the abort is SENSITIVE_TARGET_IDENTITY_CHANGED", (r.error ?? "").includes("SENSITIVE_TARGET_IDENTITY_CHANGED"), r.error);
        check("[8] clicked NOTHING (no fallback to another sibling)", (await page.locator("#gp-result").textContent()) === "", (await page.locator("#gp-result").textContent()) ?? undefined);
      } finally {
        await close();
      }
    }
    // ── [9] Guarded-positional FILL (non-click): the guard applies to form controls too ─────────────
    console.log("\n[9] Sensitive positional FILL is guarded and captures a labelContent precondition:");
    const fillFlow = buildRecordedFlow("Guard fill", [{ ...(await captureFill(browser, 1, "acct-9001")), name: "Delete recipient account" }]);
    const fillStep = fillFlow.nodes.find((n) => n.type === "fill");
    if (!fillStep) throw new Error("no fill step in built flow");
    check("[9] the fill locator is positional with a runtime identity guard", isPositionalLocator(fillStep.locator) && hasPositionalIdentityGuard(fillStep));
    check("[9] the sensitive guarded fill is RESOLVED (no review, no approval)", fillStep.locator?.resolution === "resolved", fillStep.locator?.resolution);
    check("[9] the guard carries a HASHED labelContent precondition", (fillStep.locator?.guard?.preconditions ?? []).some((p) => p.kind === "labelContent" && p.expected !== "recipient account" && /^[0-9a-f ]+$/.test(p.expected)), JSON.stringify(fillStep.locator?.guard?.preconditions));
    // Unchanged → the guarded fill runs on the recorded input (proving the guard path works for FILL and
    // the new labelContent precondition does not false-abort an unchanged target).
    {
      const { page, exec, close } = await freshRun(browser, undefined, FILL_FIXTURE);
      try {
        const r = await exec.execute({ ...fillStep, timeoutMs: 5000 });
        check("[9] unchanged: the guarded fill executes", r.status === "passed", r.error);
        check("[9] it filled the recorded input (index 1), not the other", (await page.locator("#fill-result").textContent()) === "filled-1=acct-9001", (await page.locator("#fill-result").textContent()) ?? undefined);
      } finally {
        await close();
      }
    }
    // Changed target identity at the recorded index (its label/name) → aborts before any fill.
    {
      const { page, exec, close } = await freshRun(browser, async (p) => {
        await p.evaluate(() => {
          const labels = document.querySelectorAll("#pay-form label");
          if (labels[1] && labels[1].childNodes[0]) labels[1].childNodes[0].textContent = "Different account ";
        });
      }, FILL_FIXTURE);
      try {
        const r = await exec.execute({ ...fillStep, timeoutMs: 4000 });
        check("[9] a changed target identity aborts the sensitive fill", r.status === "failed", `status=${r.status}`);
        check("[9] the abort is SENSITIVE_TARGET_IDENTITY_CHANGED", (r.error ?? "").includes("SENSITIVE_TARGET_IDENTITY_CHANGED"), r.error);
        check("[9] it filled NOTHING (refused before the side effect)", (await page.locator("#fill-result").textContent()) === "", (await page.locator("#fill-result").textContent()) ?? undefined);
      } finally {
        await close();
      }
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
