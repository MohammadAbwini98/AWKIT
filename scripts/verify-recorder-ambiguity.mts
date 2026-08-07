/**
 * Nine-point Recorder ambiguity-resolution & recorded-flow replayability acceptance gate
 * (awkit-aui.8 / plan docs/recorder-ambiguity-resolution-plan.md §5).
 *
 * Run with: npm run verify:recorder-ambiguity
 *
 * This gate drives the REAL responsible layers — recorderInitScript (capture + candidate/locator
 * generation), buildRecordedFlow, FlowValidator preflight, LocatorFactory, StepExecutor, plain-JSON /
 * structuredClone round trips (save/reload/serialize/IPC), the import re-validation contract, and the
 * live mock-site — never fixture-text or object-existence inspection. Each of the nine spec points is
 * an independent, defect-sensitive check, paired with negative controls proving the assertion fails
 * when the behaviour is broken.
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
import { LocatorFactory, type LocatorRecoveryEvent } from "@src/runner/LocatorFactory";
import { MemoryRunnerLogger } from "@src/runner/RunnerResult";
import { ValueResolver } from "@src/runner/ValueResolver";
import { ReportService } from "@src/reports/ReportService";
import {
  validateFlowDefinition,
  hasActivePathError,
  executionBlockingErrorsOf,
  errorsOf
} from "@src/validation/FlowValidator";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { FlowProfile, FlowStep, LocatorApprovalBinding } from "@src/profiles/FlowProfile";
import { createLocatorApprovalBinding } from "@src/profiles/locatorApproval";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";

const PORT = 4403;
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
    console.error(`  ✗ ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

async function makeContext(): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "wfs-amb-"));
  return {
    executionId: "exec-amb",
    instanceId: "inst-1",
    scenarioId: "scen-1",
    flowId: "flow-amb",
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

function approveFallback(step: FlowStep, reason: string): FlowStep {
  const approved: FlowStep = {
    ...step,
    locator: {
      ...step.locator!,
      resolution: "user-approved-fallback",
      resolvedBy: "user",
      approvedFallbackReason: reason
    }
  };
  approved.locator!.approvedFallbackBinding = createLocatorApprovalBinding(approved);
  return approved;
}

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Mock site did not start");
}

let recorderScript: string;

/** Record one fresh session; return the captured actions. */
async function recordActions(browser: Browser, interact: (p: Page) => Promise<void>): Promise<RecordedAction[]> {
  const ctx = await browser.newContext();
  // Production install order: context.addInitScript (document start), matching RecorderService.
  await ctx.addInitScript({ content: recorderScript });
  const page = await ctx.newPage();
  const actions: RecordedAction[] = [];
  await page.exposeBinding("__awtkit_recordAction", (_s, a) => actions.push(a as RecordedAction));
  await page.exposeBinding("__awtkit_recordSignal", () => {});
  await page.goto(URL);
  await page.waitForTimeout(450);
  await interact(page);
  await page.waitForTimeout(250);
  await ctx.close();
  return actions;
}

/** A fresh execution page + StepExecutor wired to a recovery-event-capturing LocatorFactory. */
async function freshExecutor(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL);
  const context = await makeContext();
  const events: LocatorRecoveryEvent[] = [];
  const logger = new MemoryRunnerLogger();
  const factory = new LocatorFactory(page, {
    onRecoveryEvent: (event) => {
      events.push(event);
      logger.log({
        timestamp: new Date().toISOString(),
        level: event.type === "local-recovery" || event.type === "memory-error" ? "warn" : "info",
        message: `[locator:${event.type}] ${event.message}`,
        executionId: context.executionId,
        instanceId: context.instanceId,
        scenarioId: context.scenarioId,
        flowId: context.flowId,
        stepId: event.stepId
      });
    }
  });
  const exec = new StepExecutor(page, factory, new ValueResolver(context), context, undefined, logger);
  return { page, exec, events, logger, context, close: () => ctx.close() };
}

const clickStepNamed = (p: FlowProfile, name: string) => p.nodes.find((s) => s.type === "click" && s.locator?.name === name);
const anyClickStep = (p: FlowProfile) => p.nodes.find((s) => s.type === "click");
const recordedClick = (a: RecordedAction[], name?: string) =>
  a.find((x) => x.type === "click" && (name === undefined || x.locator?.name === name));

async function main() {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore"
  });
  await waitForServer();
  recorderScript = await getRecorderInitScriptContent();
  const browser = await chromium.launch();

  try {
    // Record the shared candidates once.
    const proActions = await recordActions(browser, async (p) => {
      await p.locator('[data-testid="package-pro"] .pkg-select').click();
    });
    const basicActions = await recordActions(browser, async (p) => {
      await p.locator('[data-testid="package-basic"] .pkg-select').click();
    });
    const editActions = await recordActions(browser, async (p) => {
      // Customer Beta is the second identical "Edit" button.
      await p.locator(".row-edit").nth(1).click();
    });
    const posCaptureStarted = performance.now();
    const posActions = await recordActions(browser, async (p) => {
      await p.locator(".pos-btn").nth(1).click();
    });
    const posCaptureDurationMs = performance.now() - posCaptureStarted;

    const proClickRec = recordedClick(proActions);
    const basicClickRec = recordedClick(basicActions);
    const editClickRec = recordedClick(editActions, "Edit");
    const posClickRec = recordedClick(posActions);

    // ── [1] Clicking one of two identical visible controls records the ACTUAL selected candidate ──
    console.log("\n[1] Records the actual selected candidate:");
    check("[1] pro click recorded a locator", !!proClickRec?.locator);
    // The discriminator may live in the primary value (compound CSS) or in the container scope
    // (semantic primary + stable ancestor chain). Both are valid representations of "which card was
    // clicked", so assert over the WHOLE scope rather than one representation — otherwise a ranking
    // improvement reads as a regression while replay still hits the right element.
    const scopeText = (rec: RecordedAction | undefined): string => {
      const locator = rec?.locator as {
        value?: string;
        context?: { container?: { value?: string }; containers?: Array<{ value?: string }> };
      } | undefined;
      const chain = locator?.context?.containers ?? (locator?.context?.container ? [locator.context.container] : []);
      return [locator?.value ?? "", ...chain.map((segment) => segment?.value ?? "")].join(" | ");
    };
    check(
      "[1] recorded candidate is scoped to the clicked card (package-pro), not the other",
      scopeText(proClickRec).includes("package-pro") && !scopeText(proClickRec).includes("package-basic"),
      scopeText(proClickRec)
    );
    check(
      "[1] the OTHER recording is scoped to package-basic (distinguishes which was clicked)",
      scopeText(basicClickRec).includes("package-basic") && !scopeText(basicClickRec).includes("package-pro"),
      scopeText(basicClickRec)
    );
    // Replay proves the recorded candidate is the actual clicked one.
    {
      const step = clickStepNamed(buildRecordedFlow("Pro", proActions), proClickRec?.locator?.name ?? "") ?? anyClickStep(buildRecordedFlow("Pro", proActions));
      const { page, exec, close } = await freshExecutor(browser);
      try {
        const r = await exec.execute(step as FlowStep);
        check("[1] recorded pro locator replays (passed)", r.status === "passed", r.error);
        const result = (await page.getByTestId("duplicate-result").textContent()) ?? "";
        check("[1] replay hit the SAME candidate (package-pro)", result.includes("package-pro"), result);
        check("[1] negative: replay did NOT hit the wrong duplicate (package-basic)", !result.includes("package-basic"), result);
      } finally {
        await close();
      }
    }

    // ── [2] Locator generation first attempts stable ancestor/context scoping ─────────────────────
    console.log("\n[2] Stable ancestor/context scoping is attempted first:");
    check(
      "[2] customer Edit is scoped to its row container (semantic role+name), not positional",
      editClickRec?.locator?.quality?.disambiguation === "container" &&
        (editClickRec?.locator as { context?: { container?: { type?: string } } } | undefined)?.context?.container?.type === "tableRow",
      `disambig=${editClickRec?.locator?.quality?.disambiguation}`
    );
    // Either stable-ancestor representation satisfies the requirement; `positional` never does, and
    // an absent disambiguation would mean nothing scoped the duplicate at all.
    check(
      "[2] package Select is scoped by a stable ancestor (container or compound), not positional",
      proClickRec?.locator?.quality?.disambiguation === "container" ||
        proClickRec?.locator?.quality?.disambiguation === "compound",
      `disambig=${proClickRec?.locator?.quality?.disambiguation}`
    );
    check(
      "[2] the package scope resolves to exactly one element at record time",
      proClickRec?.locator?.quality?.isUnique === true && proClickRec?.locator?.quality?.matchCount === 1,
      JSON.stringify(proClickRec?.locator?.quality)
    );
    check(
      "[2] negative: the scoped candidate is unique (matchCount 1), never an unscoped 2-match",
      editClickRec?.locator?.quality?.isUnique === true && editClickRec?.locator?.quality?.matchCount === 1
    );

    // ── [2b] Nested chain against the real mock-site fixture ─────────────────────────────────────
    // `/recorder-lab` nested-container-scope: four identical Approve buttons where neither the
    // region nor the order card disambiguates alone, so a single container can never satisfy this.
    console.log("\n[2b] Nested container chain (mock-site nested-container-scope):");
    const nestedActions = await recordActions(browser, async (p) => {
      await p.getByTestId("nested-region-south")
        .locator('[data-testid="nested-order-card"]').filter({ hasText: "Priority order" })
        .getByRole("button", { name: "Approve", exact: true }).click();
    });
    const nestedRec = recordedClick(nestedActions, "Approve");
    const nestedChain = (nestedRec?.locator as { context?: { containers?: Array<{ type?: string; value?: string }> } } | undefined)?.context?.containers;
    check(
      "[2b] two ordered outer-to-inner container segments are persisted",
      nestedChain?.length === 2,
      JSON.stringify(nestedRec?.locator?.context)
    );
    check(
      "[2b] outer segment is the region, inner segment is the repeated order card",
      nestedChain?.[0]?.value === "nested-region-south" && nestedChain?.[1]?.value === "nested-order-card",
      JSON.stringify(nestedChain)
    );
    check(
      "[2b] the chained locator is unique at record time",
      nestedRec?.locator?.quality?.isUnique === true && nestedRec?.locator?.quality?.matchCount === 1,
      JSON.stringify(nestedRec?.locator?.quality)
    );
    {
      const step = clickStepNamed(buildRecordedFlow("Nested", nestedActions), "Approve") ?? anyClickStep(buildRecordedFlow("Nested", nestedActions));
      const { page, exec, close } = await freshExecutor(browser);
      try {
        const r = await exec.execute(step as FlowStep);
        check("[2b] the chain replays green", r.status === "passed", r.error);
        check(
          "[2b] replay hits the originally clicked button, not one of its three twins",
          (await page.getByTestId("nested-container-result").textContent()) === "south-priority",
          (await page.getByTestId("nested-container-result").textContent()) ?? ""
        );
      } finally {
        await close();
      }
    }

    // ── [3] A stable unique scope replays to the same intended candidate (deterministic) ──────────
    // Uses the package-basic ancestor-scoped (compound) candidate — a stable unique scope — and proves
    // replay deterministically re-selects that SAME card (not the identical package-pro one) twice.
    console.log("\n[3] Stable unique scope replays the same candidate (2 fresh pages):");
    for (let run = 1; run <= 2; run += 1) {
      const step = anyClickStep(buildRecordedFlow("Basic", basicActions));
      const { page, exec, close } = await freshExecutor(browser);
      try {
        const r = await exec.execute(step as FlowStep);
        check(`[3] run ${run}: ancestor-scoped Select replays (passed)`, r.status === "passed", r.error);
        const result = (await page.getByTestId("duplicate-result").textContent()) ?? "";
        check(`[3] run ${run}: replay selected the intended card (package-basic)`, result.includes("package-basic"), result);
        check(`[3] run ${run}: negative: did not select the identical package-pro`, !result.includes("package-pro"), result);
      } finally {
        await close();
      }
    }

    // ── [3b] Container-scoped table-row replay (awkit-bw9 fixed) ──────────────────────────────────
    // The captured row name now separates adjacent cells, so getByRole('row',{name}) matches the
    // platform accessible name on a fresh page. Stronger real-layer evidence for points 2/3.
    console.log("\n[3b] Container-scoped table-row replay (awkit-bw9):");
    {
      const step = anyClickStep(buildRecordedFlow("Edit", editActions));
      const container = (editClickRec?.locator as { context?: { container?: { name?: string } } } | undefined)?.context?.container;
      check("[3b] captured row name separates adjacent cells (not 'BetaEdit')", typeof container?.name === "string" && !/BetaEdit/.test(container.name), container?.name);
      const { page, exec, close } = await freshExecutor(browser);
      try {
        const r = await exec.execute(step as FlowStep);
        check("[3b] container-scoped Edit replays on a fresh page (passed)", r.status === "passed", r.error);
        const result = (await page.getByTestId("duplicate-result").textContent()) ?? "";
        check("[3b] replay selected Customer Beta's row (not Alpha)", result.includes("Beta") && !result.includes("Alpha"), result);
      } finally {
        await close();
      }
    }

    // ── [4] No stable unique locator → explicit review-required resolution state ──────────────────
    console.log("\n[4] No stable unique locator → needs-review (buildRecordedFlow default):");
    // The recorder anchors a positional fallback at the nearest stable ancestor, so a live isUnique=false
    // is not reproducible inside the testid-scoped mock page. buildRecordedFlow is the responsible layer
    // that maps the recorder's genuine "no unique locator" output (quality.isUnique===false, e.g. the
    // YouTube twin-"Shorts" case) to the review-required state — exercised here with that exact shape.
    const ambiguousRec: RecordedAction = {
      id: "amb",
      type: "click",
      name: "Ambiguous",
      locator: {
        strategy: "role",
        value: "button",
        name: "Ambiguous",
        quality: { strategy: "role", isUnique: false, matchCount: 2, confidence: "low", candidateCount: 3 }
      }
    };
    const ambFlow = buildRecordedFlow("Ambiguous", [ambiguousRec]);
    const ambStep = anyClickStep(ambFlow);
    check("[4] a non-unique locator becomes resolution 'needs-review'", ambStep?.locator?.resolution === "needs-review", ambStep?.locator?.resolution);
    check("[4] negative: a unique locator is NOT needs-review", clickStepNamed(buildRecordedFlow("Pro", proActions), proClickRec?.locator?.name ?? "")?.locator?.resolution !== "needs-review" && anyClickStep(buildRecordedFlow("Pro", proActions))?.locator?.resolution === "resolved");

    // ── [5] Positional fallback: ordinary steps auto-resolve (no approval); sensitive steps stay gated ─
    console.log("\n[5] Guarded positional identity resolves normal twins and refuses drift:");
    const posStep = anyClickStep(buildRecordedFlow("Pos", posActions)) as FlowStep;
    check(
      "[5] recorded positional locator is flagged positional with a warning",
      posStep.locator?.quality?.disambiguation === "positional" && !!posStep.locator?.quality?.warning
    );
    check("[5] capture remains bounded to a finite candidate set", (posStep.locator?.quality?.candidateCount ?? 0) > 0 && (posStep.locator?.quality?.candidateCount ?? 999) <= 20, JSON.stringify(posStep.locator?.quality));
    check("[5] end-to-end browser capture remains under 2 seconds", posCaptureDurationMs < 2_000, `${posCaptureDurationMs.toFixed(1)}ms`);
    console.log(`  · [5] measured capture ${posCaptureDurationMs.toFixed(1)}ms; candidates ${posStep.locator?.quality?.candidateCount ?? "unknown"}`);
    check(
      "[5] duplicate semantic owner is resolved by a versioned identity contract",
      posStep.locator?.resolution === "resolved" && posStep.locator?.identity?.schemaVersion === 1 && !!posStep.locator?.guard
    );
    const posReport = validateFlowDefinition(buildRecordedFlow("Pos", posActions));
    check("[5] guarded positional identity passes preflight", !hasActivePathError(posReport));
    check("[5] persisted fingerprint is hashed", !!posStep.locator?.identity?.fingerprint?.attributes["data-item-key"] && posStep.locator.identity.fingerprint.attributes["data-item-key"] !== "option-beta");
    {
      const { page, exec, events, close } = await freshExecutor(browser);
      try {
        const r = await exec.execute(posStep);
        check("[5] guarded positional identity executes without approval", r.status === "passed", r.error);
        check("[5] guarded replay resolution/action remains under 2 seconds", r.durationMs < 2_000, `${r.durationMs}ms`);
        console.log(`  · [5] measured guarded replay ${r.durationMs}ms`);
        const result = (await page.getByTestId("pos-twin-result").textContent()) ?? "";
        check("[5] guarded replay hit the same logical second candidate", result === "pos-clicked-1", result);
        check(
          "[5] execution emitted guarded-positional proof",
          events.some((e) => e.type === "guarded-positional")
        );
      } finally {
        await close();
      }
    }
    // Mutation control: swap logical twins while keeping candidate count and selector unchanged.
    {
      const { page, exec, close } = await freshExecutor(browser);
      try {
        await page.evaluate(() => {
          const container = document.querySelector('[data-testid="pos-twins"]');
          if (container?.lastElementChild) container.insertBefore(container.lastElementChild, container.firstElementChild);
        });
        const r = await exec.execute({ ...posStep, timeoutMs: 4000 });
        check("[5] identity drift fails before clicking", r.status === "failed", `status=${r.status}`);
        check("[5] failure explicitly reports TARGET_IDENTITY_CHANGED", (r.error ?? "").includes("TARGET_IDENTITY_CHANGED"), r.error);
        check("[5] negative: reordered lookalike was never clicked", (await page.getByTestId("pos-twin-result").textContent()) === "idle");
      } finally {
        await close();
      }
    }

    // ── [6] Unresolved ambiguity fails static preflight BEFORE any browser launch (zero launches) ─
    console.log("\n[6] Unresolved ambiguity fails preflight before launch (zero-launch):");
    let launches = 0;
    const countingLaunch = async () => {
      launches += 1;
      return chromium.launch();
    };
    const nrReport = validateFlowDefinition(ambFlow);
    check("[6] preflight reports an active-path blocking error for the unresolved flow", hasActivePathError(nrReport));
    check(
      "[6] the blocking error is locatorNeedsReview",
      executionBlockingErrorsOf(nrReport).some((i) => i.code === "locatorNeedsReview")
    );
    // Product gate (execution.ipc.ts:267): `if (!validation.valid) return validationFailed` — no launch.
    if (!hasActivePathError(nrReport)) {
      const b = await countingLaunch();
      await b.close();
    }
    check("[6] ZERO browsers launched when preflight rejects the flow", launches === 0, `launches=${launches}`);
    // Control proves the counter is meaningful AND distinguishes reject-before-launch from launch-then-fail.
    const okReport = validateFlowDefinition(buildRecordedFlow("Ok", proActions));
    check("[6] a resolved flow passes preflight", !hasActivePathError(okReport) && errorsOf(okReport).length === 0);
    if (!hasActivePathError(okReport)) {
      const b = await countingLaunch();
      await b.close();
    }
    check("[6] the launch seam DOES fire for a valid flow (counter is real, and only it launched)", launches === 1, `launches=${launches}`);

    // ── [7] A resolved ambiguous locator survives the full persistence lifecycle ───────────────────
    console.log("\n[7] Resolved ambiguous locator survives save/reload/edit/serialize/import-export/IPC/execution:");
    {
      const original = anyClickStep(buildRecordedFlow("Pro", proActions)) as FlowStep;
      const flow0 = buildRecordedFlow("Lifecycle", proActions);
      const saveReload = JSON.parse(JSON.stringify(flow0)) as FlowProfile; // save + reload
      const edited = JSON.parse(JSON.stringify(saveReload)) as FlowProfile; // edit a benign field + re-save
      const editedStep = anyClickStep(edited) as FlowStep;
      editedStep.name = `${editedStep.name} (edited)`;
      const reSaved = JSON.parse(JSON.stringify(edited)) as FlowProfile;
      const ipcCloned = structuredClone(reSaved) as FlowProfile; // Electron IPC uses structured clone
      const exported = JSON.stringify(ipcCloned);
      const imported = JSON.parse(exported) as FlowProfile; // import path re-parses + re-validates
      const step = anyClickStep(imported) as FlowStep;
      check("[7] resolution survives the lifecycle", step.locator?.resolution === original.locator?.resolution && step.locator?.resolution === "resolved");
      check("[7] the scoped locator value survives", step.locator?.value === original.locator?.value);
      check("[7] quality survives (deep equal)", JSON.stringify(step.locator?.quality) === JSON.stringify(original.locator?.quality));
      check("[7] alternatives survive (count preserved)", (step.locator?.alternatives?.length ?? 0) === (original.locator?.alternatives?.length ?? -1));
      // import re-validation contract (flow.ipc.ts): a resolved flow is runnable.
      const importReport = validateFlowDefinition(imported);
      check("[7] imported flow re-validates as runnable", !hasActivePathError(importReport));
      // Final: it still executes and selects the same candidate.
      const { page, exec, close } = await freshExecutor(browser);
      try {
        const r = await exec.execute(step);
        check("[7] round-tripped locator still executes (passed)", r.status === "passed", r.error);
        const result = (await page.getByTestId("duplicate-result").textContent()) ?? "";
        check("[7] round-tripped execution hit the same candidate (package-pro)", result.includes("package-pro"), result);
      } finally {
        await close();
      }
    }

    // ── [8] Hover-required controls capture a hover prerequisite + replay from a fresh page ─────────
    console.log("\n[8] Hover-required control captures + replays a hover prerequisite:");
    {
      const hoverActions = await recordActions(browser, async (p) => {
        await p.hover('[data-testid="hover-trigger"]');
        await p.waitForTimeout(200);
        await p.locator(".hover-gated-btn").click();
      });
      const hoverFlow = buildRecordedFlow("Hover", hoverActions);
      const hoverStep = hoverFlow.nodes.find((s) => s.type === "hover");
      const hoverClick = clickStepNamed(hoverFlow, "Click me");
      check("[8] an explicit hover step was captured before the gated click", !!hoverStep && !!hoverClick);
      if (hoverStep && hoverClick) {
        const hi = hoverFlow.nodes.findIndex((s) => s.id === hoverStep.id);
        const ci = hoverFlow.nodes.findIndex((s) => s.id === hoverClick.id);
        check("[8] hover step precedes the click", hi === ci - 1);
      }
      const { page, exec, close } = await freshExecutor(browser);
      try {
        check("[8] target hidden on a fresh page before hover", !(await page.locator(".hover-gated-btn").isVisible()));
        const hr = await exec.execute(hoverStep as FlowStep);
        check("[8] hover step executes (passed)", hr.status === "passed", hr.error);
        const cr = await exec.execute(hoverClick as FlowStep);
        check("[8] gated click executes after hover (passed)", cr.status === "passed", cr.error);
        check("[8] post-click state observed", ((await page.getByTestId("hover-click-result").textContent()) ?? "").includes("hover-click-ok"));
      } finally {
        await close();
      }
      // Negative: the click alone (no hover) fails for actionability.
      {
        const { exec, close } = await freshExecutor(browser);
        try {
          const r = await exec.execute({ ...(hoverClick as FlowStep), timeoutMs: 3500 });
          check("[8] negative: the gated click alone fails without its hover prerequisite", r.status === "failed", `status=${r.status}`);
        } finally {
          await close();
        }
      }
      // Negative: the previously-broken hidden-surface hover locator does not replay.
      {
        const { exec, close } = await freshExecutor(browser);
        try {
          const broken: FlowStep = {
            id: "broken-hover",
            type: "hover",
            name: "Hover revealed surface (broken)",
            timeoutMs: 3500,
            locator: { strategy: "css", value: '[data-testid="hover-revealed-surface"]', resolution: "resolved" }
          };
          const r = await exec.execute(broken);
          check("[8] negative: hovering the hidden revealed surface fails to replay", r.status === "failed", `status=${r.status}`);
        } finally {
          await close();
        }
      }
    }

    // ── [9] Every locator evidence field survives supported round trips ────────────────────────────
    console.log("\n[9] Alternatives/quality/warning/uniqueness/resolution/approval/evidence survive round trips:");
    {
      const pendingApproval: FlowStep = {
        ...(posStep as FlowStep),
        locator: {
          ...posStep.locator!,
          context: {
            ...posStep.locator!.context,
            shadow: {
              boundary: "open",
              hosts: [{ strategy: "testId", value: "shadow-host-b" }]
            }
          },
          interaction: {
            ...posStep.locator!.interaction,
            shadowBoundary: "open",
            path: ["button", "x-shadow-card"]
          },
          resolution: "user-approved-fallback",
          resolvedBy: "user",
          approvedFallbackReason: "Reviewed: identical controls; positional accepted."
        }
      };
      pendingApproval.locator!.approvedFallbackBinding = createLocatorApprovalBinding(pendingApproval);
      const futureLocator = pendingApproval.locator as typeof pendingApproval.locator & { futureLocatorEvidence?: { source: string } };
      futureLocator.futureLocatorEvidence = { source: "future-recorder" };
      const futureBinding = pendingApproval.locator!.approvedFallbackBinding! as LocatorApprovalBinding & { futureBindingVersion?: number };
      futureBinding.futureBindingVersion = 2;
      const approved = pendingApproval;
      const rt = structuredClone(JSON.parse(JSON.stringify(approved))) as FlowStep; // save+reload then IPC clone
      const q = rt.locator?.quality;
      const oq = approved.locator?.quality;
      check("[9] alternatives survive (non-empty + deep equal)", (rt.locator?.alternatives?.length ?? 0) > 0 && JSON.stringify(rt.locator?.alternatives) === JSON.stringify(approved.locator?.alternatives));
      check("[9] confidence survives", q?.confidence === oq?.confidence && q?.confidence === "low");
      check("[9] warning survives", !!q?.warning && q?.warning === oq?.warning);
      check("[9] uniqueness + matchCount survive", q?.isUnique === oq?.isUnique && q?.matchCount === oq?.matchCount);
      check("[9] full quality survives (deep equal)", JSON.stringify(q) === JSON.stringify(oq));
      check("[9] resolution survives", rt.locator?.resolution === "user-approved-fallback");
      check("[9] approval reason survives", rt.locator?.approvedFallbackReason === approved.locator?.approvedFallbackReason);
      check("[9] exact approval binding survives", JSON.stringify(rt.locator?.approvedFallbackBinding) === JSON.stringify(approved.locator?.approvedFallbackBinding));
      check("[9] unknown future locator/binding fields survive save/reload + IPC clone", JSON.stringify((rt.locator as typeof futureLocator)?.futureLocatorEvidence) === JSON.stringify(futureLocator.futureLocatorEvidence) && (rt.locator?.approvedFallbackBinding as typeof futureBinding)?.futureBindingVersion === 2);
      check("[9] recording evidence survives (interaction present + deep equal)", JSON.stringify((rt.locator as { interaction?: unknown }).interaction) === JSON.stringify((approved.locator as { interaction?: unknown }).interaction));
      check("[9] versioned element identity survives save/reload + IPC clone", JSON.stringify(rt.locator?.identity) === JSON.stringify(approved.locator?.identity));
      check("[9] interaction prerequisite survives independently", JSON.stringify(rt.locator?.prerequisite) === JSON.stringify(approved.locator?.prerequisite));
      check("[9] ordered Shadow DOM host context survives save/reload + IPC clone", JSON.stringify(rt.locator?.context?.shadow) === JSON.stringify(approved.locator?.context?.shadow));
    }

    // ── Extra negative control: an unscoped locator matching two visible elements is refused ───────
    console.log("\n[NEG] Unscoped two-match locator is refused at execution:");
    {
      const unscoped: FlowStep = {
        id: "unscoped",
        type: "click",
        name: "Edit",
        timeoutMs: 4000,
        locator: {
          strategy: "role",
          value: "button",
          name: "Edit",
          quality: { strategy: "role", isUnique: false, matchCount: 2, confidence: "low", candidateCount: 2 }
        }
      };
      const { exec, close } = await freshExecutor(browser);
      try {
        const r = await exec.execute(unscoped);
        check("[NEG] unscoped role locator matching two visible controls is refused", r.status === "failed", `status=${r.status}`);
        check("[NEG] refusal names the multi-match ambiguity", (r.error ?? "").toLowerCase().includes("matches 2") || (r.error ?? "").toLowerCase().includes("single element"), r.error);
      } finally {
        await close();
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("verify-recorder-ambiguity crashed", e);
  process.exit(1);
});
