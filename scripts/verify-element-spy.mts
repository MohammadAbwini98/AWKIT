/**
 * verify:element-spy — Phase L L2 Element Spy and capture-time upgrade context, end to end.
 *
 * Drives the REAL RecorderService (its own Recorder browser, bindings and injected page script) against
 * the Feature Test Lab page /recorder-lab/element-spy:
 *   A  recording: upgrade context captured at the interaction, bounded, bound-value markers, memory-only
 *      (absent from the draft file and from buildRecordedFlow), TTL; inspect toggle during a recording
 *      neither performs nor records the inspected click
 *   B  independent inspect-only session (no recording): identity, candidates, counts, quality class,
 *      clicks/submits/links/popups intercepted, navigation and popup lifecycle, frame + open shadow,
 *      explicit "Use in action" with frame/interaction preservation, rejections (duplicate, positional,
 *      shadow, other frame, other page, non-element step, expired), protected-login refusal, cleanup
 *   C  the applied locator survives save/reload and replays through the production StepExecutor
 *   D  legacy step and guarded-positional step compatibility
 *   E  main-process permission wiring for every inspection IPC channel, role registry, preload surface
 *   F  the Recorder's result panel rendered (SSR) from the real inspection
 *   G  protected-login detection during a recording turns inspection off and clears the result
 *   H  "Find stronger locator with AI" (L3 §1): the product's bounded loop, compiler, intent guard and
 *      browser proof on the live Spy page with a scripted provider — only a proven proposal is shown, a
 *      wrong element, a typed value and a T3 element are refused, Cancel ends the job, nothing is written
 *      (its IPC wiring is asserted in E and its panel rendered in F)
 *   I  owner decisions D1 (A+B) and D2 (U1), 2026-09-24. D1: a duplicate control scoped by its
 *      container's stable test id or authored name is proven on the live page; unscoped it stays
 *      non-unique; a sibling, invented, record-keyed or row-text scope is refused before the browser
 *      (and by gates B/C on their own); the request never carries a row's text, a record-keyed id or
 *      sensitive container content; INV-2002 stays refused. U1: a proven proposal attaches only to the
 *      chosen step and only after main proves it again there; refusals for every stale, cancelled,
 *      foreign, T3, needs-review or AI-off case write nothing; the step keeps its own locator; save
 *      takes main's candidates only (a forged or retargeted one is dropped); reload, Designer re-save
 *      and export/import keep it; real replays earn proof with no model call and never execute it;
 *      the existing promotion writes the only audit record, and revert restores the recorded locator
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecorderService } from "@src/recorder/RecorderService";
import { buildRecordedFlow, buildRecordedStep } from "@src/recorder/buildRecordedFlow";
import { classifyLocatorQuality } from "@src/recorder/LocatorQualityClass";
import type { ElementInspection, ElementInspectionState, RecordedAction, RecordedActionLocator } from "@src/recorder/RecorderTypes";
import { boundValueSources } from "@src/recorder/upgradeContext";
import type { FlowProfile, FlowStep, StepLocator } from "@src/profiles/FlowProfile";
import { createLocatorApprovalBinding, locatorBindingMatches } from "@src/profiles/locatorApproval";
import { effectivePermissions, Permission } from "@src/security/authz/Permissions";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { StepExecutor } from "@src/runner/StepExecutor";
import { ValueResolver } from "@src/runner/ValueResolver";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import { AiActionStore } from "@src/ai/AiActionStore";
import { revertAiAction } from "@src/ai/AiRevert";
import type { AiStatusView, InspectionLocatorView } from "@src/ai/contracts/AiApi";
import type { AiJobOutcome, AiJobRequest } from "@src/ai/AiService";
import { promoteLocatorUpgrade } from "@src/ai/locatorPromotion";
import { locatorAttemptJob } from "@src/ai/locatorUpgradeAttempts";
import { evaluatePendingUpgrade, pendingUpgradeDigests } from "@src/ai/pendingUpgrade";
import { proveLocatorPlan } from "@src/runner/locatorProof";
import { JsonProfileStore } from "@src/storage/ProfileStore";
import { abortInspectionLocator, attachInspectionProposal, proposeInspectionLocator, type InspectionAttachDeps, type InspectionTarget } from "../app/main/ai/aiAssist";
import { toDesignerDocument, toFlowProfile } from "../app/renderer/components/workflow/flowProfileMapping";
import type { AiAssistPhase } from "../app/renderer/components/shared/useAiAssistJob";

const PORT = 4389;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/recorder-lab/element-spy`;
let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` — ${detail.slice(0, 600)}` : ""}`);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Poll a condition (never a fixed sleep); returns null on timeout so the caller's check fails visibly. */
async function until<T>(probe: () => T | null | undefined | Promise<T | null | undefined>, timeoutMs = 10_000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null && value !== undefined && value !== false) return value as T;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function waitForMockSite(): Promise<void> {
  let last = "not started";
  const ok = await until(async () => {
    try {
      const response = await fetch(LAB);
      last = `HTTP ${response.status}`;
      return response.ok ? true : null;
    } catch (error) {
      last = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
      return null;
    }
  }, 15_000);
  if (!ok) throw new Error(`Mock Site did not serve ${LAB}: ${last}`);
}

function replayContext(): InstanceExecutionContext {
  return {
    executionId: "spy-exec",
    instanceId: "spy-instance",
    scenarioId: "spy-scenario",
    flowId: "spy-flow",
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: "", screenshots: "", logs: "", reports: "", sessions: "" }
  };
}

const text = async (page: Page, testId: string): Promise<string> => (await page.getByTestId(testId).textContent()) ?? "";

async function main(): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), "awkit-element-spy-"));
  const draftPath = join(work, "recorder-draft.json");
  let server: ChildProcess | undefined;
  const recorder = new RecorderService();
  const internal = recorder as any;
  recorder.configureDraftStorage(draftPath);
  recorder.configureUrlStorage(join(work, "recorder-urls.json"));
  try {
    server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
    await waitForMockSite();
    const executablePath = chromium.executablePath();

    // ── A: recording + capture-time upgrade context ──────────────────────────────────────────────
    console.log("A  Recording: capture-time upgrade context and in-recording inspect");
    await recorder.startRecording(LAB, { executablePath, captureSmartWaits: false, captureWaitTime: false });
    const rec: Page = internal.page;
    const actionCount = () => recorder.getActions().length;
    const lastAction = async (predicate: (action: RecordedAction) => boolean) => until(() => recorder.getActions().find(predicate));

    await rec.getByTestId("spy-save-profile").click();
    const saveAction = await lastAction((a) => a.type === "click" && a.locator?.value === "spy-save-profile");
    await rec.getByTestId("spy-display-name").fill("INV-2002");
    const fillAction = await lastAction((a) => a.type === "fill");
    await rec.getByRole("row", { name: /INV-2002/ }).getByRole("button", { name: "Edit" }).click();
    const editAction = await lastAction((a) => a.type === "click" && a.name.includes("Edit"));
    await rec.getByRole("button", { name: "Remove" }).nth(1).click();
    const twinAction = await lastAction((a) => a.type === "click" && a.name.includes("Remove"));
    await rec.frameLocator('[data-testid="spy-frame"]').getByTestId("spy-frame-approve").click();
    const frameAction = await lastAction((a) => a.type === "click" && Boolean(a.locator?.context?.frameChain?.length));
    check("recording captured the save, fill, row Edit, twin and frame steps", Boolean(saveAction && fillAction && editAction && twinAction && frameAction), JSON.stringify(recorder.getActions().map((a) => a.name)));
    check("recorded clicks were performed in the page (recording is not inspecting)", (await text(rec, "spy-clicks")) === "3", await text(rec, "spy-clicks"));

    const saveContext = saveAction ? recorder.getUpgradeContext(saveAction.id) : undefined;
    check("upgrade context: target role, name and tag captured at the interaction", saveContext?.target.role === "button" && saveContext.target.name === "Save profile" && saveContext.target.tag === "button", JSON.stringify(saveContext?.target));
    check("upgrade context: nearest heading", saveContext?.heading === "Account settings", saveContext?.heading);
    check("upgrade context: candidate summaries with counts", Boolean(saveContext?.candidates.some((c) => c.strategy === "testId" && c.count === 1)), JSON.stringify(saveContext?.candidates));
    check("upgrade context: page key without query and top frame", saveContext?.pageKey === LAB && saveContext.frame === "top" && saveContext.frameDepth === 0, `${saveContext?.pageKey} ${saveContext?.frame}`);
    check("upgrade context: in-page fingerprint kept in memory", Boolean(saveContext?.fingerprint && typeof saveContext.fingerprint === "object"));
    const editContext = editAction ? recorder.getUpgradeContext(editAction.id) : undefined;
    const rowIndex = editContext?.containers.findIndex((c) => c.kind === "row") ?? -1;
    check("upgrade context: row container identity", rowIndex >= 0 && /INV-2002/.test(editContext!.containers[rowIndex].name), JSON.stringify(editContext?.containers));
    check("upgrade context: sibling action names", Boolean(editContext?.siblingActions.includes("Void")), JSON.stringify(editContext?.siblingActions));
    check(
      "upgrade context: the row text typed in an earlier step is marked as a bound value (field only, never the value)",
      Boolean(editContext?.boundValues.some((m) => m.field === `containers.${rowIndex}.name` && m.source === "earlier-input")) && !JSON.stringify(editContext?.boundValues).includes("INV-2002"),
      JSON.stringify(editContext?.boundValues)
    );
    const frameContext = frameAction ? recorder.getUpgradeContext(frameAction.id) : undefined;
    check("upgrade context: frame identity for a child-frame target", frameContext?.frame === "child" && frameContext.frameDepth === 1, JSON.stringify({ frame: frameContext?.frame, depth: frameContext?.frameDepth }));
    // Context is read at the interaction boundary, so an action that removes its own row or closes its
    // own dialog still leaves the neighbourhood it happened in.
    await rec.getByRole("button", { name: "Archive" }).click();
    const archiveAction = await lastAction((a) => a.type === "click" && a.name.includes("Archive"));
    const archiveContext = archiveAction ? recorder.getUpgradeContext(archiveAction.id) : undefined;
    check("row removed by its action: the row was really removed", (await rec.getByTestId("spy-row-2003").count()) === 0);
    check("row removed by its action: the row context was still captured", Boolean(archiveContext?.containers.some((c) => c.kind === "row" && /INV-2003/.test(c.name))), JSON.stringify(archiveContext?.containers));
    await rec.getByTestId("spy-dialog").getByRole("button", { name: "Apply" }).click();
    const applyAction = await lastAction((a) => a.type === "click" && a.name.includes("Apply"));
    const applyContext = applyAction ? recorder.getUpgradeContext(applyAction.id) : undefined;
    check("dialog closed by its action: the dialog really closed", !(await rec.getByTestId("spy-dialog").isVisible()));
    check(
      "dialog closed by its action: dialog context, heading and sibling names were still captured",
      Boolean(applyContext?.containers.some((c) => c.kind === "dialog" && c.name === "Confirm discount")) && applyContext?.heading === "Apply discount" && Boolean(applyContext?.siblingActions.includes("Keep")),
      JSON.stringify({ containers: applyContext?.containers, heading: applyContext?.heading, siblings: applyContext?.siblingActions })
    );
    const fillContext = fillAction ? recorder.getUpgradeContext(fillAction.id) : undefined;
    check("upgrade context never carries a form value", Boolean(fillContext) && !JSON.stringify(fillContext).includes("INV-2002"), JSON.stringify(fillContext?.target));
    check("recorded actions carry no upgrade context", !JSON.stringify(recorder.getActions()).includes("upgradeContext"));

    // D1 (owner decision A+B, 2026-09-24): the same Call button in four list items, told apart only by
    // the item's own identity. Recorded here so section I can attach AI candidates to real draft steps.
    const calls = () => recorder.getActions().filter((a) => a.type === "click" && a.name.includes("Call"));
    await rec.getByTestId("slot-primary").getByRole("button", { name: "Call" }).click();
    await until(() => (calls().length === 1 ? true : null));
    await rec.getByRole("listitem", { name: "Night shift" }).getByRole("button", { name: "Call" }).click();
    await until(() => (calls().length === 2 ? true : null));
    await rec.getByTestId("contact-2004").getByRole("button", { name: "Call" }).click();
    await until(() => (calls().length === 3 ? true : null));
    const [callPrimary, callNight, callDan] = calls();
    check("recording captured the three Call steps", Boolean(callPrimary && callNight && callDan), JSON.stringify(calls().map((a) => a.name)));
    const containerOf = (action: RecordedAction | undefined, kind: string) => (action ? recorder.getUpgradeContext(action.id)?.containers.find((c) => c.kind === kind) : undefined);
    const primaryItem = containerOf(callPrimary, "listItem");
    const nightItem = containerOf(callNight, "listItem");
    const danItem = containerOf(callDan, "listItem");
    const contactsRegion = containerOf(callPrimary, "landmark");
    check("D1 A: a list item's stable test id is captured and offered; its computed name is not", primaryItem?.testId === "slot-primary" && primaryItem.authoredName === undefined, JSON.stringify(primaryItem));
    check("D1 B: a list item's authored name is offered; its record-keyed test id is not", nightItem?.authoredName === true && nightItem.name === "Night shift" && nightItem.testId === undefined, JSON.stringify(nightItem));
    check("D1: an item whose name carries an email and whose test id a record number offers neither", Boolean(danItem) && danItem?.authoredName === undefined && danItem?.testId === undefined, JSON.stringify(danItem));
    check("D1 B: a region named through aria-labelledby is offered with its stable test id", contactsRegion?.authoredName === true && contactsRegion.name === "On-call contacts" && contactsRegion.testId === "spy-contacts", JSON.stringify(contactsRegion));
    const invoiceRow = editContext?.containers[rowIndex];
    const archivedRow = archiveContext?.containers.find((c) => c.kind === "row");
    check("D1: a table row's computed name (its cells) is never offered, nor a row-number test id", Boolean(invoiceRow && archivedRow) && !invoiceRow?.authoredName && !archivedRow?.authoredName && archivedRow?.testId === undefined, JSON.stringify({ invoiceRow, archivedRow }));
    const requestFor = (action: RecordedAction | null | undefined): string => {
      const step = action ? buildRecordedStep(action) : undefined;
      const upgradeContext = action ? recorder.getUpgradeContext(action.id) : undefined;
      return step && upgradeContext ? locatorAttemptJob({ requestId: "d1", step, boundValues: boundValueSources(recorder.getActions()), upgradeContext, userRequested: true }, [], "d1.a1").prompt.fields[0].text ?? "" : "";
    };
    const primaryRequest = requestFor(callPrimary);
    check("D1 A: the request offers the item's test id as a ready scope and never its text", primaryRequest.includes('scope {"kind":"listItem","strategy":"testId","value":"slot-primary"}') && !primaryRequest.includes("Alice Smith"), primaryRequest);
    const nightRequest = requestFor(callNight);
    check(
      "D1 B: the request offers the authored name as a ready scope, never the record-keyed test id or the record's text",
      nightRequest.includes('scope {"kind":"listItem","strategy":"label","value":"Night shift"}') && !nightRequest.includes("contact-carol-white") && !nightRequest.includes("Carol White"),
      nightRequest
    );
    check("D1: nothing sensitive or record-keyed about Dan's item reaches a request", !/dan@example\.com|contact-2004|Dan Brown/.test(requestFor(callDan)), requestFor(callDan));
    check("D1: the removed INV-2003 row's text and its row-number test id never reach a request", !/INV-2003|spy-row-2003/.test(requestFor(archiveAction)), requestFor(archiveAction));

    // In-recording inspect: the click is inspected, never performed and never recorded.
    const beforeInspect = actionCount();
    const clicksBefore = await text(rec, "spy-clicks");
    let state: ElementInspectionState = await recorder.setInspectMode(true);
    check("inspect mode turns on during a recording", state.inspecting && !state.session, JSON.stringify(state));
    await rec.getByRole("row", { name: /INV-2001/ }).getByRole("button", { name: "Void" }).click();
    const voidInspection = await until(() => recorder.getInspectionState().inspection?.owner.name === "Void" ? recorder.getInspectionState().inspection : null);
    check("in-recording inspection reports the element", Boolean(voidInspection), JSON.stringify(recorder.getInspectionState()));
    await recorder.setInspectMode(false);
    await rec.getByTestId("spy-save-profile").click();
    await until(() => actionCount() === beforeInspect + 1);
    check("the inspected click was not recorded (only the next, normal click was)", actionCount() === beforeInspect + 1 && recorder.getActions().at(-1)?.locator?.value === "spy-save-profile", JSON.stringify(recorder.getActions().slice(beforeInspect).map((a) => a.name)));
    check("the inspected click was not performed (only the next, normal click was)", (await text(rec, "spy-clicks")) === String(Number(clicksBefore) + 1), await text(rec, "spy-clicks"));

    const recorded = await recorder.stopRecording();
    const draftText = await readFile(draftPath, "utf8");
    check("the persisted draft carries no upgrade context or inspection", !draftText.includes("upgradeContext") && !draftText.includes("siblingActions") && !draftText.includes("inspectedAt"));
    const builtText = JSON.stringify(buildRecordedFlow("Spy capture", recorded));
    check("buildRecordedFlow output carries no upgrade context", !builtText.includes("upgradeContext") && !builtText.includes("siblingActions") && !builtText.includes("boundValues"));
    check("stopping the recording closes the browser and ends inspection", internal.context === null && !recorder.getInspectionState().inspecting);
    if (saveAction) internal.upgradeContexts.get(saveAction.id).at = Date.now() - 11 * 60_000;
    check("upgrade context expires after its TTL", saveAction ? recorder.getUpgradeContext(saveAction.id) === undefined : false);

    // ── B: independent inspect-only session ──────────────────────────────────────────────────────
    console.log("B  Independent Element Spy session (no recording)");
    const draftBeforeSpy = await readFile(draftPath, "utf8");
    const recordedCount = recorder.getActions().length;
    state = await recorder.startInspection(LAB, { executablePath });
    check("an inspect-only session opens without recording", state.session && state.inspecting && !recorder.getStatus().isRecording, JSON.stringify({ state, status: recorder.getStatus() }));
    const spy: Page = internal.page;
    const inspect = async (click: () => Promise<void>, name: string): Promise<ElementInspection | null> => {
      const previous = recorder.getInspectionState().inspection?.inspectedAt;
      await click();
      return until(() => {
        const current = recorder.getInspectionState().inspection;
        return current && current.inspectedAt !== previous && current.owner.name === name ? current : null;
      });
    };

    const save = await inspect(() => spy.getByTestId("spy-save-profile").click(), "Save profile");
    check("identity: tag, role, accessible name", save?.owner.tag === "button" && save.owner.role === "button" && save.owner.name === "Save profile", JSON.stringify(save?.owner));
    check("unique semantic candidates with match and visible counts", Boolean(save?.candidates.some((c) => c.strategy === "testId" && c.count === 1 && c.visibleCount === 1) && save?.candidates.some((c) => c.strategy === "role" && c.name === "Save profile" && c.count === 1)), JSON.stringify(save?.candidates));
    const saveClass = save ? classifyLocatorQuality(save.locator) : undefined;
    check("quality class with human-readable reasons", saveClass?.class === "strong-semantic" && (saveClass.reasons.length ?? 0) > 0 && saveClass.reasons.every((r) => r.detail.length > 0), JSON.stringify(saveClass));
    check("inspection carries the bounded upgrade context", save?.upgradeContext?.heading === "Account settings", JSON.stringify(save?.upgradeContext?.heading));
    check("the inspected click was not performed", (await text(spy, "spy-clicks")) === "0", await text(spy, "spy-clicks"));

    const twin = await inspect(() => spy.getByRole("button", { name: "Remove" }).nth(1).click(), "Remove");
    const dupIndex = twin?.candidates.findIndex((c) => c.strategy === "role" && c.name === "Remove") ?? -1;
    check("duplicate candidate reports its real match count", dupIndex >= 0 && twin!.candidates[dupIndex].count === 2, JSON.stringify(twin?.candidates));
    check("the twin's own locator is positional (guarded or review), never a false unique", ["guarded-positional", "review-required"].includes(String(twin && classifyLocatorQuality(twin.locator)?.class)), JSON.stringify(twin?.locator));
    const twinBefore = JSON.stringify(recorder.getActions().find((a) => a.id === twinAction?.id)?.locator);
    let applied = twinAction ? await recorder.applyInspection(twinAction.id, dupIndex) : { ok: false as const, reason: "no twin" };
    check("a non-unique candidate is refused with a reason", !applied.ok && /unique, non-positional/.test(applied.reason), JSON.stringify(applied));
    const positionalIndex = twin?.candidates.findIndex((c) => c.fallback) ?? -1;
    if (positionalIndex >= 0 && twinAction) {
      applied = await recorder.applyInspection(twinAction.id, positionalIndex);
      check("a positional candidate is refused", !applied.ok, JSON.stringify(applied));
    }
    check("a refused apply leaves the step's locator untouched", JSON.stringify(recorder.getActions().find((a) => a.id === twinAction?.id)?.locator) === twinBefore);

    await inspect(() => spy.getByTestId("spy-submit-order").click(), "Place order");
    check("a form submit is intercepted (no navigation)", spy.url() === LAB, spy.url());
    await inspect(() => spy.getByTestId("spy-next-link").click(), "Next page");
    check("a link is intercepted (no navigation)", spy.url() === LAB, spy.url());
    const pagesBefore = internal.context.pages().length;
    await inspect(() => spy.getByTestId("spy-open-popup").click(), "Open popup");
    check("a popup opener is intercepted (no new page)", internal.context.pages().length === pagesBefore, String(internal.context.pages().length));
    check("no intercepted click reached the page", (await text(spy, "spy-clicks")) === "0", await text(spy, "spy-clicks"));

    const shadow = await inspect(() => spy.getByTestId("spy-shadow-button").click(), "Shadow action");
    check("open shadow root context is reported", shadow?.locator.context?.shadow?.boundary === "open", JSON.stringify(shadow?.locator.context?.shadow));
    const shadowUnique = shadow?.candidates.findIndex((c) => c.count === 1 && !c.fallback) ?? -1;
    applied = saveAction && shadowUnique >= 0 ? await recorder.applyInspection(saveAction.id, shadowUnique) : { ok: false as const, reason: `no unique shadow candidate (${shadowUnique})` };
    check("a shadow-root candidate is refused with an explanation", !applied.ok && /shadow/i.test(applied.reason), JSON.stringify(applied));

    const frame = await inspect(() => spy.frameLocator('[data-testid="spy-frame"]').getByTestId("spy-frame-approve").click(), "Approve in frame");
    check("frame identity comes from the Frame graph", frame?.topDocument === false && frame.frameChain?.length === 1, JSON.stringify(frame?.frameChain));
    check("the in-frame click was not performed", (await text(spy.frameLocator('[data-testid="spy-frame"]') as unknown as Page, "spy-frame-clicks")) === "0");
    const frameUnique = frame?.candidates.findIndex((c) => c.strategy === "role" && c.count === 1) ?? -1;
    applied = saveAction && frameUnique >= 0 ? await recorder.applyInspection(saveAction.id, frameUnique) : { ok: false as const, reason: "no frame candidate" };
    check("a frame candidate is refused for a top-document step", !applied.ok && /different frame/.test(applied.reason), JSON.stringify(applied));
    const frameStepBefore = recorder.getActions().find((a) => a.id === frameAction?.id)?.locator;
    applied = frameAction && frameUnique >= 0 ? await recorder.applyInspection(frameAction.id, frameUnique) : { ok: false as const, reason: "no frame step" };
    const frameStepAfter = recorder.getActions().find((a) => a.id === frameAction?.id)?.locator;
    check("a frame candidate applies to the step in the same frame chain", applied.ok && frameStepAfter?.strategy === "role" && frameStepAfter.resolvedBy === "user", JSON.stringify(applied.ok ? frameStepAfter : applied));
    check(
      "the frame chain and interaction evidence of the step are preserved",
      JSON.stringify(frameStepAfter?.context?.frameChain) === JSON.stringify(frameStepBefore?.context?.frameChain) && JSON.stringify(frameStepAfter?.interaction) === JSON.stringify(frameStepBefore?.interaction),
      JSON.stringify({ before: frameStepBefore?.context?.frameChain, after: frameStepAfter?.context?.frameChain })
    );

    // Explicit apply on a top-document step; nothing is replaced until the user applies.
    const save2 = await inspect(() => spy.getByTestId("spy-save-profile").click(), "Save profile");
    const roleIndex = save2?.candidates.findIndex((c) => c.strategy === "role" && c.name === "Save profile") ?? -1;
    check("inspection alone never changes a recorded step", recorder.getActions().find((a) => a.id === saveAction?.id)?.locator?.strategy === "testId");
    applied = await recorder.applyInspection("goto-or-missing", roleIndex);
    check("an unknown or non-element step is refused", !applied.ok, JSON.stringify(applied));
    const gotoStep = recorder.getActions().find((a) => a.type === "goto");
    applied = gotoStep ? await recorder.applyInspection(gotoStep.id, roleIndex) : { ok: false as const, reason: "" };
    check("a navigation step is refused", !applied.ok && /element step/.test(applied.reason), JSON.stringify(applied));
    applied = saveAction ? await recorder.applyInspection(saveAction.id, roleIndex) : { ok: false as const, reason: "no save step" };
    const saveAfter = recorder.getActions().find((a) => a.id === saveAction?.id)?.locator;
    check("\"Use in action\" replaces the step's locator with the chosen unique candidate", applied.ok && saveAfter?.strategy === "role" && saveAfter.name === "Save profile" && saveAfter.resolution === "resolved" && saveAfter.resolvedBy === "user", JSON.stringify(saveAfter));
    check("the applied locator drops the previous target's identity and guard", !saveAfter?.identity && !saveAfter?.guard && !saveAfter?.alternatives);
    const draftAfterApplyText = await readFile(draftPath, "utf8");
    const draftAfterApply = JSON.parse(draftAfterApplyText) as { actions: RecordedAction[] };
    check("the draft changed only because of the explicit apply", draftAfterApplyText !== draftBeforeSpy);
    check("the applied locator is persisted to the draft", draftAfterApply.actions.find((a) => a.id === saveAction?.id)?.locator?.strategy === "role");
    check("the spy session recorded nothing", recorder.getActions().length === recordedCount && recorder.getActions().every((a) => a.name !== "Void"), String(recorder.getActions().length));

    // ── H: "Find stronger locator with AI" (L3 §1, owner's limited L1 GO) ────────────────────────
    console.log("H  Element Spy AI proposal: proven on the live page, shown only");
    const jobs: AiJobRequest[] = [];
    const plans: unknown[] = [];
    let hanging: ((outcome: AiJobOutcome) => void) | null = null;
    // A scripted provider in place of the model; the loop, compiler, intent guard and browser proof are the product's.
    const fakeAi = {
      submit: async (job: AiJobRequest): Promise<AiJobOutcome> => {
        jobs.push(job);
        const plan = plans.shift();
        if (plan === "hang") return new Promise<AiJobOutcome>((resolve) => (hanging = resolve));
        return { status: "ok", value: plan, modelId: "test-fake", usage: { promptTokens: 0, outputTokens: 0, firstTokenMs: 0, generationMs: 0 }, yields: 0 };
      },
      cancel: () => {
        const settle = hanging;
        hanging = null;
        settle?.({ status: "cancelled", yields: 0 });
        return settle !== null;
      }
    };
    /** Let a hanging attempt answer now, with `value`. */
    const answerHanging = (value: unknown): boolean => {
      const settle = hanging;
      hanging = null;
      settle?.({ status: "ok", value, modelId: "test-fake", usage: { promptTokens: 0, outputTokens: 0, firstTokenMs: 0, generationMs: 0 }, yields: 0 });
      return settle !== null;
    };
    // The same wiring as ai.ipc.ts's inspectionTarget (asserted in E): the Recorder's live target, the product's proof.
    const spyTarget = (): InspectionTarget | null => {
      const live = recorder.getInspectionTarget();
      if (!live) return null;
      const { inspection, page, boundValues } = live;
      return {
        inspection,
        boundValues,
        prove: (step, plan) => proveLocatorPlan(page, step, plan, { boundValues, ...(inspection.upgradeContext ? { upgradeContext: inspection.upgradeContext } : {}) })
      };
    };
    let askCount = 0;
    const ask = (enabled = true) => proposeInspectionLocator(7, { requestId: `h-${(askCount += 1)}` }, { policy: async () => ({ enabled }), ai: fakeAi, target: spyTarget });
    const rolePlan = (name: string, scopes: unknown[] = []) => ({ version: 1, target: { strategy: "role", value: "button", name, exact: true }, scopes });
    const testIdPlan = (value: string) => ({ version: 1, target: { strategy: "testId", value }, scopes: [] });
    const actionsBeforeAi = JSON.stringify(recorder.getActions());
    const candidatesBeforeAi = JSON.stringify(recorder.getInspectionState().inspection?.candidates);

    check("a malformed request is refused before anything runs", (await proposeInspectionLocator(7, { requestId: "not valid!" }, { policy: async () => ({ enabled: true }), ai: fakeAi, target: spyTarget })).code === "INVALID_REQUEST" && jobs.length === 0);
    let proposal = await ask(false);
    check("local AI switched off: DISABLED and no model call", proposal.code === "DISABLED" && proposal.proposal === null && jobs.length === 0, JSON.stringify(proposal));

    plans.push(rolePlan("Save profile"));
    proposal = await ask();
    check(
      "a plan that reaches the inspected element is returned as proven, with its compiled locator",
      proposal.ok && proposal.code === "OK" && proposal.proposal?.candidate.strategy === "role" && proposal.proposal.candidate.name === "Save profile" && proposal.modelId === "test-fake",
      JSON.stringify(proposal)
    );
    check("the answer names the inspection it belongs to", proposal.inspectedAt === save2?.inspectedAt, `${proposal.inspectedAt} vs ${save2?.inspectedAt}`);
    check("the job is the L3 upgrade feature, interactive, as a user request", jobs[0]?.feature === "locatorSemanticUpgrade" && jobs[0].priority === "interactive" && jobs.length === 1, JSON.stringify(jobs.map((j) => [j.feature, j.priority])));
    const provenView = proposal;

    plans.push(testIdPlan("spy-submit-order"), testIdPlan("spy-next-link"));
    proposal = await ask();
    check("plans that reach a different element are refused in the browser, and nothing is shown", !proposal.ok && proposal.code === "NOT_PROVEN" && proposal.proposal === null && proposal.attemptsUsed === 2, JSON.stringify(proposal));
    check("the proof only observed: no refused candidate was clicked", (await text(spy, "spy-clicks")) === "0", await text(spy, "spy-clicks"));

    const edit = await inspect(() => spy.getByRole("row", { name: /INV-2002/ }).getByRole("button", { name: "Edit" }).click(), "Edit");
    const jobsBeforeEdit = jobs.length;
    const rowScope = { kind: "tableRow", strategy: "role", value: "row", hasText: "INV-2002" };
    plans.push(rolePlan("Edit", [rowScope]), rolePlan("Edit", [{ ...rowScope, hasText: "inv-2002" }]));
    proposal = await ask();
    check("a scope on text typed earlier in the recording is refused by the intent guard", Boolean(edit) && proposal.code === "NOT_PROVEN" && proposal.proposal === null && proposal.attemptsUsed === 2, JSON.stringify(proposal));
    check("the model was never shown that typed value", jobs.length === jobsBeforeEdit + 2 && !JSON.stringify(jobs.slice(jobsBeforeEdit).map((j) => j.prompt)).toLowerCase().includes("inv-2002"));

    const approve = await inspect(() => spy.frameLocator('[data-testid="spy-frame"]').getByTestId("spy-frame-approve").click(), "Approve in frame");
    const jobsBeforeT3 = jobs.length;
    proposal = await ask();
    check("a sensitive element (T3) is refused before any model call", Boolean(approve) && proposal.code === "PROTECTED" && jobs.length === jobsBeforeT3, JSON.stringify(proposal));

    await inspect(() => spy.getByTestId("spy-save-profile").click(), "Save profile");
    plans.push("hang");
    const pendingAsk = ask();
    await until(() => (hanging ? true : null));
    const cancelled = abortInspectionLocator(`assist.7.h-${askCount}`);
    proposal = await pendingAsk;
    check("Cancel reaches the in-flight model job and ends it", cancelled && proposal.code === "CANCELLED" && proposal.proposal === null, JSON.stringify(proposal));
    check("a finished job can no longer be aborted", !abortInspectionLocator(`assist.7.h-${askCount}`));

    // The inspected document is replaced: the proof would find the same button in the NEW document.
    await inspect(() => spy.getByTestId("spy-save-profile").click(), "Save profile");
    plans.push("hang");
    const pendingReload = ask();
    await until(() => (hanging ? true : null));
    await spy.reload();
    check("(precondition) the answer arrives after the reload", answerHanging(rolePlan("Save profile")));
    proposal = await pendingReload;
    check("an answer that arrives after the inspected document was reloaded is withheld", proposal.code === "NOT_FOUND" && proposal.proposal === null, JSON.stringify(proposal));
    const jobsAfterReload = jobs.length;
    proposal = await ask();
    check("...and the old inspection is no longer an AI target, so nothing is asked", recorder.getInspectionTarget() === null && proposal.code === "NOT_FOUND" && jobs.length === jobsAfterReload, JSON.stringify(proposal));
    check("...while the Spy still shows that inspection", recorder.getInspectionState().inspection !== null);

    check("proposals wrote nothing: recorded steps unchanged", JSON.stringify(recorder.getActions()) === actionsBeforeAi);
    check("proposals wrote nothing: the draft file unchanged", (await readFile(draftPath, "utf8")) === draftAfterApplyText);
    check("proposals never join the Spy's own candidates", JSON.stringify(recorder.getInspectionState().inspection?.candidates) === candidatesBeforeAi);

    // Expired inspection.
    internal.inspection.inspectedAt = new Date(Date.now() - 6 * 60_000).toISOString();
    applied = saveAction ? await recorder.applyInspection(saveAction.id, roleIndex) : { ok: false as const, reason: "" };
    check("an expired inspection cannot be applied", !applied.ok && /expired/.test(applied.reason) && recorder.getInspectionState().inspection === null, JSON.stringify(applied));
    const jobsBeforeExpired = jobs.length;
    proposal = await ask();
    check("with no current inspection a proposal is NOT_FOUND and nothing is asked", proposal.code === "NOT_FOUND" && jobs.length === jobsBeforeExpired, JSON.stringify(proposal));

    // Mode off: clicks are performed again, still nothing is recorded.
    state = await recorder.setInspectMode(false);
    await spy.getByTestId("spy-save-profile").click();
    check("with inspecting paused the click is performed (negative control)", Boolean(await until(async () => ((await text(spy, "spy-clicks")) === "1" ? true : null))), await text(spy, "spy-clicks"));
    check("…and still not recorded in the independent session", recorder.getActions().length === recordedCount);
    check("…and the draft was not rewritten by the session", (await readFile(draftPath, "utf8")) === draftAfterApplyText);

    // Popup lifecycle: a popup opened while paused picks up the mode when inspection resumes.
    await spy.getByTestId("spy-open-popup").click();
    const popup = await until(() => internal.context.pages().find((p: Page) => p !== spy) as Page | undefined);
    await popup?.waitForLoadState("domcontentloaded");
    await until(() => [...internal.popupPages.values()].includes(popup));
    await recorder.setInspectMode(true);
    const popupInspection = popup ? await inspect(() => popup.getByTestId("spy-next-confirm").click(), "Confirm next") : null;
    check("a popup document is inspected under its own page alias", Boolean(popupInspection && popupInspection.pageAlias !== "main"), popupInspection?.pageAlias);
    const popupUnique = popupInspection?.candidates.findIndex((c) => c.count === 1 && !c.fallback) ?? -1;
    applied = editAction ? await recorder.applyInspection(editAction.id, popupUnique) : { ok: false as const, reason: "" };
    check("a candidate from another page is refused for a main-page step", !applied.ok && /different page/.test(applied.reason), JSON.stringify(applied));
    await popup?.close();
    check("the popup lifecycle did not rewrite the draft", (await readFile(draftPath, "utf8")) === draftAfterApplyText);

    // Navigation lifecycle: a new document asks for the mode.
    await spy.goto(`${BASE}/recorder-lab/element-spy/next`);
    const nextInspection = await inspect(() => spy.getByTestId("spy-next-confirm").click(), "Confirm next");
    check("a newly loaded document is inspected (mode survives navigation)", Boolean(nextInspection));

    // Protected login: inspection turns off, the result is cleared, and it cannot be re-enabled into it.
    await spy.goto(`${BASE}/mock/protected-login`);
    const refused = await until(() => (recorder.getInspectionState().refused === "protected-login" ? recorder.getInspectionState() : null));
    check("protected-login detection turns inspection off and clears the result", Boolean(refused && !refused.inspecting && refused.inspection === null), JSON.stringify(recorder.getInspectionState()));
    await recorder.setInspectMode(true);
    await spy.locator("button, input[type=submit]").first().click().catch(() => undefined);
    const stillRefused = await until(() => (recorder.getInspectionState().refused === "protected-login" ? true : null), 3_000);
    check("re-enabling on a protected page still yields no inspection", Boolean(stillRefused) && recorder.getInspectionState().inspection === null, JSON.stringify(recorder.getInspectionState()));

    state = await recorder.stopInspection();
    check("closing the Spy clears the session, mode and result and closes its browser", !state.session && !state.inspecting && state.inspection === null && internal.context === null, JSON.stringify(state));

    // Close Spy, then Open Element Spy at once. Closing fires the liveness watch's own close, and one
    // finishing late must not reset the session opened since (it left that browser ownerless).
    const reopened = await recorder.startInspection(LAB);
    const reopenedPage = internal.page as Page | null;
    const reinspected = reopenedPage ? await inspect(() => reopenedPage.getByTestId("spy-save-profile").click(), "Save profile") : null;
    check(
      "reopening the Spy at once keeps the new session, its browser and its inspection",
      reopened.session && reopened.inspecting && Boolean(reinspected) && recorder.getInspectionState().session && internal.context !== null && recorder.getInspectionTarget() !== null,
      JSON.stringify({ reopened, now: recorder.getInspectionState().session, context: internal.context !== null })
    );
    state = await recorder.stopInspection();
    check("...and that session closes cleanly too", !state.session && internal.context === null, JSON.stringify(state));

    // ── I: owner decisions D1 (A+B) and D2 (U1), 2026-09-24, on the live Spy page ─────────────────
    console.log("I  D1 container identity on the live page, then U1: a proven proposal attached as a pending candidate");
    state = await recorder.startInspection(LAB, { executablePath });
    const live: Page = internal.page;
    let liveProofs = 0;
    const provingTarget = (): InspectionTarget | null => {
      const target = spyTarget();
      return target && { ...target, prove: (step, plan) => ((liveProofs += 1), target.prove(step, plan)) };
    };
    let liveAsks = 0;
    const askLive = () => proposeInspectionLocator(7, { requestId: `i-${(liveAsks += 1)}` }, { policy: async () => ({ enabled: true }), ai: fakeAi, target: provingTarget });
    const lastAsk = () => `i-${liveAsks}`;
    const lastPrompt = () => jobs.at(-1)?.prompt.fields[0]?.text ?? "";
    const spyStep = (): FlowStep => {
      const inspection = recorder.getInspectionState().inspection!;
      return { id: "element-spy", type: "click", name: inspection.owner.name, locator: inspection.locator };
    };
    const proveNow = (plan: unknown) => spyTarget()!.prove(spyStep(), plan);
    const callIn = (scope?: Record<string, unknown>) => rolePlan("Call", scope ? [scope] : []);
    const slot = (value: string) => ({ kind: "listItem", strategy: "testId", value });
    // What the request offers for an item with an authored name and no explicit role.
    const nightScope = { kind: "listItem", strategy: "label", value: "Night shift" };
    const inspectPrimary = () => inspect(() => live.getByTestId("slot-primary").getByRole("button", { name: "Call" }).click(), "Call");
    const inspectNight = () => inspect(() => live.getByRole("listitem", { name: "Night shift" }).getByRole("button", { name: "Call" }).click(), "Call");

    const primaryInspection = await inspectPrimary();
    plans.push(callIn(slot("slot-primary")));
    let answer = await askLive();
    const provenForOldInspection = lastAsk();
    check("D1 A: a duplicate Call scoped by its item's stable test id is proven on the live page", Boolean(primaryInspection) && answer.ok && answer.proposal?.context?.containers?.[0]?.value === "slot-primary", JSON.stringify(answer));
    check("...the model was offered that scope, never the item's text", lastPrompt().includes('"strategy":"testId","value":"slot-primary"') && !lastPrompt().includes("Alice Smith"), lastPrompt());
    plans.push(callIn(), { version: 1, target: { strategy: "text", value: "Call", exact: true }, scopes: [] });
    const unscoped = await askLive();
    const refusedAsk = lastAsk();
    check("D1: unscoped, the same Call stays non-unique and nothing is shown", unscoped.code === "NOT_PROVEN" && unscoped.attemptsUsed === 2 && (await proveNow(callIn())).code === "CANDIDATE_NOT_UNIQUE", JSON.stringify(unscoped));
    let proofsBefore = liveProofs;
    plans.push(callIn(slot("slot-backup")), callIn(slot("slot-tertiary")));
    const sibling = await askLive();
    check("D1: a sibling item's scope and an invented one are refused before the browser (never offered)", sibling.code === "NOT_PROVEN" && sibling.attemptsUsed === 2 && liveProofs === proofsBefore, JSON.stringify(sibling));
    check(
      "...and the browser proof refuses them on its own: gate C (WRONG_ELEMENT) and gate B (CANDIDATE_NO_MATCH)",
      (await proveNow(callIn(slot("slot-backup")))).code === "WRONG_ELEMENT" && (await proveNow(callIn(slot("slot-tertiary")))).code === "CANDIDATE_NO_MATCH"
    );

    const nightInspection = await inspectNight();
    plans.push(callIn(nightScope));
    answer = await askLive();
    check("D1 B: a duplicate Call scoped by its item's authored name is proven on the live page", Boolean(nightInspection) && answer.ok && answer.proposal?.context?.containers?.[0]?.value === "Night shift", JSON.stringify(answer));
    check("...offered that name, never the item's record-keyed test id or text", lastPrompt().includes('"strategy":"label","value":"Night shift"') && !lastPrompt().includes("contact-carol-white") && !lastPrompt().includes("Carol White"), lastPrompt());
    proofsBefore = liveProofs;
    plans.push(callIn(slot("contact-carol-white")), callIn({ ...slot("contact-carol-white"), kind: "card" }));
    const keyed = await askLive();
    check("D1 A: the record-keyed test id is refused when proposed, before the browser", keyed.code === "NOT_PROVEN" && liveProofs === proofsBefore, JSON.stringify(keyed));
    check("...although the page would prove it: only the D1 rule keeps it out", (await proveNow(callIn(slot("contact-carol-white")))).code === "PROVEN");

    await inspect(() => live.getByTestId("contact-2004").getByRole("button", { name: "Call" }).click(), "Call");
    plans.push(callIn(), callIn());
    await askLive();
    check("D1: an item whose name carries an email and whose test id a record number reaches the model with neither", !/dan@example\.com|contact-2004|Dan Brown/.test(lastPrompt()), lastPrompt());

    const inv2001 = await inspect(() => live.getByRole("row", { name: /INV-2001/ }).getByRole("button", { name: "Edit" }).click(), "Edit");
    const rowText = { kind: "tableRow", strategy: "role", value: "row", hasText: "INV-2001" };
    proofsBefore = liveProofs;
    plans.push(rolePlan("Edit", [rowText]), rolePlan("Edit", [{ ...rowText, hasText: "Invoice INV-2001" }]));
    const rowAnswer = await askLive();
    check("C is not approved: a row-text scope is refused before the browser", Boolean(inv2001) && rowAnswer.code === "NOT_PROVEN" && liveProofs === proofsBefore, JSON.stringify(rowAnswer));
    check("...although the page would prove it: the mechanics exist, the policy refuses them", (await proveNow(rolePlan("Edit", [rowText]))).code === "PROVEN");
    check("...and the request carried neither the row's text nor its computed name", !lastPrompt().includes("INV-2001"), lastPrompt());
    const inv2002 = await inspect(() => live.getByRole("row", { name: /INV-2002/ }).getByRole("button", { name: "Edit" }).click(), "Edit");
    const invoicesScope = { kind: "landmark", strategy: "testId", value: "spy-duplicates" };
    plans.push(rolePlan("Edit"), rolePlan("Edit", [invoicesScope]));
    const invAnswer = await askLive();
    check(
      "INV-2002 stays refused: its rows carry no identity D1 may offer, so no plan is unique",
      Boolean(inv2002) && invAnswer.code === "NOT_PROVEN" && invAnswer.attemptsUsed === 2 && (await proveNow(rolePlan("Edit", [invoicesScope]))).code === "CANDIDATE_NOT_UNIQUE",
      JSON.stringify(invAnswer)
    );

    // U1: main holds the proven proposal; the renderer names it and a step, nothing else.
    const attachDeps: InspectionAttachDeps = {
      policy: async () => ({ enabled: true }),
      target: spyTarget,
      draftAction: (id) => recorder.getDraftAction(id),
      attach: (id, pending) => recorder.attachPendingUpgrade(id, pending)
    };
    const attach = (requestId: string, actionId: string | undefined, deps: InspectionAttachDeps = attachDeps) => attachInspectionProposal(7, { requestId, actionId: actionId ?? "missing" }, deps);
    const draftBytes = () => readFile(draftPath, "utf8");
    const actionById = (id: string | undefined) => recorder.getActions().find((a) => a.id === id);
    const primaryBefore = structuredClone(actionById(callPrimary?.id)?.locator);

    await inspectPrimary();
    check("(precondition) a proposal proven for an earlier inspection cannot be attached", (await attach(provenForOldInspection, callPrimary?.id)).code === "NOT_FOUND");
    plans.push(callIn(slot("slot-primary")));
    answer = await askLive();
    const r1 = lastAsk();
    check("(precondition) a proven proposal for the inspected Call", answer.ok, JSON.stringify(answer));
    const bytesBefore = await draftBytes();
    let attached = await attach("not valid!", callPrimary?.id);
    check("a malformed attach request is refused", attached.code === "INVALID_REQUEST" && attached.actions === null);
    check("a request with no proven proposal behind it is refused", (await attach("never-asked", callPrimary?.id)).code === "NOT_FOUND");
    check("...and so is one whose proposal was refused, which main never held", (await attach(refusedAsk, callPrimary?.id)).code === "NOT_FOUND");
    attached = await attach(r1, callNight?.id);
    check("attaching to a step whose element is not the proposal's is refused by the re-proof", attached.code === "NOT_APPLICABLE" && /does not reach the element/.test(attached.message ?? ""), JSON.stringify(attached));
    attached = await attach(r1, recorder.getActions().find((a) => a.type === "goto")?.id);
    check("a non-element step is refused", attached.code === "NOT_APPLICABLE", JSON.stringify(attached));
    attached = await attach(r1, frameAction?.id);
    check("a step in another frame is refused", attached.code === "NOT_APPLICABLE" && /different frame/.test(attached.message ?? ""), JSON.stringify(attached));
    check("with local AI switched off it is refused", (await attach(r1, callPrimary?.id, { ...attachDeps, policy: async () => ({ enabled: false }) })).code === "DISABLED");
    // A sensitive step and a needs-review step over the same element: draft fixtures, removed again below.
    internal.actions.push(
      { ...structuredClone(callPrimary!), id: "u1-sensitive", name: "Delete account" },
      { ...structuredClone(callPrimary!), id: "u1-review", locator: { ...structuredClone(callPrimary!.locator!), resolution: "needs-review", reviewReason: "fixture" } }
    );
    check("a sensitive (T3) step is refused before any proof", (await attach(r1, "u1-sensitive")).code === "PROTECTED");
    check("a step that needs review is refused", (await attach(r1, "u1-review")).code === "NOT_APPLICABLE");
    internal.actions = internal.actions.filter((a: RecordedAction) => a.id !== "u1-sensitive" && a.id !== "u1-review");
    check("no refused attach wrote the draft", (await draftBytes()) === bytesBefore);

    attached = await attach(r1, callPrimary?.id);
    const primaryAfter = actionById(callPrimary?.id)?.locator;
    const onDraft = primaryAfter?.pendingUpgrade;
    check("the proven proposal attaches to the step the person chose", attached.ok && attached.code === "OK" && Boolean(onDraft), JSON.stringify(attached));
    const { pendingUpgrade: _attached, ...primaryActive } = primaryAfter ?? ({} as RecordedActionLocator);
    check("...leaving the step's own locator exactly as recorded, so it is still the one that runs", JSON.stringify(primaryActive) === JSON.stringify(primaryBefore));
    check(
      "...as a capture-proven candidate, proven again against that step",
      onDraft?.proof === "capture-proven" && onDraft.proofEvidence?.code === "PROVEN" && onDraft.proofEvidence.sameElement === "pass" && onDraft.candidate.name === "Call",
      JSON.stringify(onDraft)
    );
    const primaryBuilt = callPrimary ? buildRecordedStep(actionById(callPrimary.id)!) : undefined;
    check("...bound to the step the finalizer builds, which is what saving persists", Boolean(primaryBuilt) && locatorBindingMatches(onDraft?.binding, primaryBuilt!));
    // The binding mirrors the step's own recorded locator and context, as every pending binding does
    // (DECISIONS 2026-09-19), so only what the AI path adds is checked for page text.
    check(
      "...its candidate and evidence carry no page text or typed value, and nothing in it carries a fingerprint",
      !/fingerprint/.test(JSON.stringify(onDraft)) && !/Alice|INV-2002/.test(JSON.stringify({ candidate: onDraft?.candidate, context: onDraft?.context, evidence: onDraft?.proofEvidence })),
      JSON.stringify(onDraft)
    );
    check("...and nothing was added to alternatives, which the runner would execute", JSON.stringify(primaryAfter?.alternatives) === JSON.stringify(primaryBefore?.alternatives));
    check("...persisted with the draft", Boolean((JSON.parse(await draftBytes()) as { actions: RecordedAction[] }).actions.find((a) => a.id === callPrimary?.id)?.locator?.pendingUpgrade));
    check("...and returned to the renderer for its step list", Boolean(attached.actions?.find((a) => a.id === callPrimary?.id)?.locator?.pendingUpgrade));

    plans.push("hang");
    const running = askLive();
    await until(() => (hanging ? true : null));
    check("a job still running has nothing to attach", (await attach(lastAsk(), callPrimary?.id)).code === "NOT_FOUND");
    abortInspectionLocator(`assist.7.${lastAsk()}`);
    await running;

    plans.push(callIn(slot("slot-primary")));
    await askLive();
    const r2 = lastAsk();
    plans.push(callIn(slot("slot-primary")));
    await askLive();
    const r3 = lastAsk();
    attached = await attach(r3, callPrimary?.id);
    check("a newer proven proposal replaces the attached candidate", attached.ok && actionById(callPrimary?.id)?.locator?.pendingUpgrade?.createdAt !== onDraft?.createdAt, JSON.stringify(attached));
    attached = await attach(r2, callPrimary?.id);
    check("an older one cannot replace the newer candidate", attached.code === "NOT_APPLICABLE" && /newer/.test(attached.message ?? ""), JSON.stringify(attached));

    await inspectNight();
    check("a new inspection makes the earlier proposal unattachable", (await attach(r3, callPrimary?.id)).code === "NOT_FOUND");
    plans.push(callIn(nightScope));
    await askLive();
    const beforeReload = lastAsk();
    await live.reload();
    check("a reload of the inspected document makes its proposal unattachable", (await attach(beforeReload, callNight?.id)).code === "NOT_FOUND");
    await inspectNight();
    plans.push(callIn(nightScope));
    await askLive();
    attached = await attach(lastAsk(), callNight?.id);
    check("inspected again on the new document, the authored-name proposal attaches to its own step", attached.ok && Boolean(actionById(callNight?.id)?.locator?.pendingUpgrade), JSON.stringify(attached));
    await inspectPrimary();
    plans.push(callIn(slot("slot-primary")));
    await askLive();
    const heldAtClose = lastAsk();
    state = await recorder.stopInspection();
    check("after Close Spy a held proposal is unattachable", (await attach(heldAtClose, callPrimary?.id)).code === "NOT_FOUND");
    const trusted = recorder.draftPendingUpgrades();
    check("...while the two attached candidates stay with the draft", trusted.size === 2 && trusted.has(callPrimary!.id) && trusted.has(callNight!.id));
    const restarted = new RecorderService();
    restarted.configureDraftStorage(draftPath);
    await restarted.ensureDraftLoaded();
    check(
      "a restarted Recorder restores them from its draft",
      JSON.stringify([...restarted.draftPendingUpgrades()].map(([id, pending]) => [id, pending.createdAt])) === JSON.stringify([...trusted].map(([id, pending]) => [id, pending.createdAt]))
    );

    // Save: only main's own candidates, each on the step built from its own action.
    const stepIdOf = (actions: RecordedAction[], id: string) => `step-${actions.filter((a) => a.type !== "start" && a.type !== "end").findIndex((a) => a.id === id) + 1}`;
    const rendererCopy = structuredClone(recorder.getActions());
    const forgedOn = rendererCopy.find((a) => a.id === editAction?.id)!;
    forgedOn.locator!.pendingUpgrade = { ...structuredClone(trusted.get(callPrimary!.id)!), binding: createLocatorApprovalBinding(buildRecordedStep(forgedOn)!)! };
    rendererCopy.find((a) => a.id === callDan?.id)!.locator!.locatorProvenance = { schemaVersion: 1, source: "ai-semantic-upgrade", tier: "T1", actionId: "forged", modelId: "x", proof: "replay-proven", appliedAt: new Date().toISOString(), binding: forgedOn.locator!.pendingUpgrade!.binding, previous: { strategy: "css", value: "#x" } };
    const savedFlowDraft = buildRecordedFlow("Spy U1", rendererCopy, [], { pendingUpgrades: trusted });
    const carrying = savedFlowDraft.nodes.filter((node) => node.locator?.pendingUpgrade).map((node) => node.id);
    check(
      "at save only main's own candidates are attached, each to the step built from its own action",
      JSON.stringify(carrying) === JSON.stringify([stepIdOf(rendererCopy, callPrimary!.id), stepIdOf(rendererCopy, callNight!.id)]),
      JSON.stringify(carrying)
    );
    check("...so a candidate the renderer forged on another step is dropped", !savedFlowDraft.nodes.find((node) => node.id === stepIdOf(rendererCopy, editAction!.id))?.locator?.pendingUpgrade);
    check("...and so is provenance the renderer sent", !JSON.stringify(savedFlowDraft).includes("locatorProvenance"));
    const retargetedCopy = structuredClone(recorder.getActions());
    retargetedCopy.find((a) => a.id === callPrimary!.id)!.locator!.value = "link";
    check(
      "a step the renderer retargeted before save loses its candidate (its binding no longer matches)",
      buildRecordedFlow("x", retargetedCopy, [], { pendingUpgrades: trusted }).nodes.filter((node) => node.locator?.pendingUpgrade).length === 1
    );
    const legacyNodes = JSON.stringify(buildRecordedFlow("x", structuredClone(recorder.getActions())).nodes);
    check("a save without main's candidates carries none, although the draft actions do", !legacyNodes.includes("pendingUpgrade"));
    check("...and it is exactly a save with none attached, so legacy saves are unchanged", legacyNodes === JSON.stringify(buildRecordedFlow("x", structuredClone(recorder.getActions()), undefined, { pendingUpgrades: new Map() }).nodes));

    const flowStore = new JsonProfileStore<FlowProfile>({ folder: join(work, "flows") });
    await flowStore.create(savedFlowDraft);
    const savedFlow = (await flowStore.get(savedFlowDraft.id))!;
    const savedCall = savedFlow.nodes.find((node) => node.id === stepIdOf(rendererCopy, callPrimary!.id))!;
    check("the saved step keeps its recorded locator as the active one", savedCall.locator?.strategy === primaryBuilt?.locator?.strategy && savedCall.locator?.value === primaryBuilt?.locator?.value && JSON.stringify(savedCall.locator?.context) === JSON.stringify(primaryBuilt?.locator?.context));
    check("...and its candidate survives save and reload, still bound to it", locatorBindingMatches(savedCall.locator?.pendingUpgrade?.binding, savedCall) && !/fingerprint/.test(JSON.stringify(savedCall.locator?.pendingUpgrade)));
    const designerTrip = (profile: FlowProfile): FlowProfile => {
      const doc = toDesignerDocument(profile);
      return toFlowProfile(doc.nodes, doc.edges, profile.id, profile.name, { description: profile.description, version: profile.version });
    };
    const edited = designerTrip({ ...savedFlow, name: "Spy U1 (edited)" });
    await flowStore.update(savedFlow.id, edited);
    const resavedFlow = (await flowStore.get(savedFlow.id))!;
    check("an edit and re-save in the Flow Designer keeps the candidate", JSON.stringify(resavedFlow.nodes.find((node) => node.id === savedCall.id)?.locator?.pendingUpgrade) === JSON.stringify(savedCall.locator?.pendingUpgrade));
    const exported = await flowStore.export(savedFlow.id);
    const imported = await flowStore.import({ ...JSON.parse(JSON.stringify(exported)), id: "spy-u1-imported" });
    check("export and import keep it", JSON.stringify(imported.nodes.find((node) => node.id === savedCall.id)?.locator?.pendingUpgrade) === JSON.stringify(savedCall.locator?.pendingUpgrade));

    // Replay: the step runs on its own locator; passing runs earn proof. No model is involved.
    const recovery = new FileLocatorRecoveryStore(join(work, "memory"));
    const u1Browser = await chromium.launch({ headless: true });
    const audit = new AiActionStore(join(work, "ai-actions.json"));
    try {
      const runSaved = async (step: FlowStep, row: unknown, flowId = savedFlow.id) => {
        const context = await u1Browser.newContext();
        const page = await context.newPage();
        await page.goto(LAB, { waitUntil: "domcontentloaded" });
        const execution = { ...replayContext(), scenarioId: "spy-u1", flowId, currentRow: row };
        const factory = new LocatorFactory(page, { recoveryStore: recovery, scope: { scenarioId: execution.scenarioId, flowId } });
        const result = await new StepExecutor(page, factory, new ValueResolver(execution), execution).execute(step);
        const last = await text(page, "spy-last");
        await context.close();
        return { result, last };
      };
      const scopeKey = (flowId: string, stepId: string) => ["spy-u1", flowId, stepId].join(String.fromCharCode(0));
      const jobsBeforeReplay = jobs.length;
      const replays: Array<Awaited<ReturnType<typeof runSaved>>> = [];
      for (const row of [{ id: 1 }, { id: 2 }, { id: 2 }]) replays.push(await runSaved(savedCall, row));
      check("each run acts through the step's own locator on the recorded element", replays.every((run) => run.result.status === "passed" && run.last === "call-primary"), JSON.stringify(replays.map((run) => [run.result.status, run.result.error, run.last])));
      const tally = await recovery.getReplayProof(scopeKey(savedFlow.id, savedCall.id));
      check("3 passing replays over 2 data rows are tallied as the candidate's replay proof", tally?.proven === 3 && tally.dataRowKeys.length === 2 && tally.rejected === 0, JSON.stringify(tally));
      check("...with no model call anywhere in replay", jobs.length === jobsBeforeReplay);
      check("...so the existing evidence selection reads it as eligible", Boolean(tally) && evaluatePendingUpgrade(savedCall, tally, pendingUpgradeDigests(savedCall)!).state === "eligible");

      const decoyPending = { ...savedCall.locator!.pendingUpgrade!, context: { ...savedCall.locator!.pendingUpgrade!.context, containers: [{ type: "listItem" as const, strategy: "testId" as const, value: "slot-backup" }] } };
      const decoy: FlowStep = { ...savedCall, id: "u1-decoy", locator: { ...savedCall.locator!, pendingUpgrade: decoyPending } };
      const decoyRun = await runSaved(decoy, { id: 1 }, "u1-decoy-flow");
      check("a pending candidate never executes: one pointing at Bob's Call leaves the step calling the recorded element", decoyRun.result.status === "passed" && decoyRun.last === "call-primary", JSON.stringify([decoyRun.result.status, decoyRun.last]));
      const decoyTally = await recovery.getReplayProof(scopeKey("u1-decoy-flow", "u1-decoy"));
      check("...and replay records that candidate as refused", decoyTally?.rejected === 1 && decoyTally.lastCode === "WRONG_ELEMENT", JSON.stringify(decoyTally));

      // Promotion is the existing, person-approved path; the audit record is written by it and only by it.
      check("no audit record exists after attach, save or replay: none of them applied a change", (await audit.snapshot()).records.length === 0);
      const proofs = await recovery.listReplayProofs();
      const promote = async (mode: "auto" | "user-approved", actionId: string) => {
        let code = "FLOW_NOT_FOUND";
        let record: unknown = null;
        await flowStore.updateWith(savedFlow.id, (current) => {
          if (!current) return undefined;
          const outcome = promoteLocatorUpgrade(current, savedCall.id, {
            createdAt: savedCall.locator!.pendingUpgrade!.createdAt,
            mode,
            actionId,
            nowIso: new Date().toISOString(),
            replayProofs: proofs,
            policy: { enabled: true },
            editorDirty: false
          });
          code = outcome.ok ? "OK" : outcome.code;
          record = outcome.ok ? outcome.record : null;
          return outcome.ok ? outcome.profile : undefined;
        });
        if (record) await audit.append(record as Parameters<AiActionStore["append"]>[0]);
        return code;
      };
      check("automatic promotion stays refused (thresholds uncommitted)", (await promote("auto", "act-u1-auto")) === "THRESHOLDS_PROVISIONAL");
      check("a person's explicit apply promotes it through the existing path", (await promote("user-approved", "act-u1")) === "OK");
      const promoted = (await flowStore.get(savedFlow.id))!.nodes.find((node) => node.id === savedCall.id)!;
      const expectedPrevious: Record<string, unknown> = { ...savedCall.locator };
      delete expectedPrevious.pendingUpgrade;
      check(
        "...making the candidate the locator and keeping the recorded one as the revert target",
        promoted.locator?.strategy === savedCall.locator!.pendingUpgrade!.candidate.strategy && !promoted.locator?.pendingUpgrade && JSON.stringify(promoted.locator?.locatorProvenance?.previous) === JSON.stringify(expectedPrevious),
        JSON.stringify(promoted.locator)
      );
      const records = (await audit.snapshot()).records;
      check("exactly one audit record, for the applied change, with its replay counts", records.length === 1 && records[0].id === "act-u1" && records[0].target.stepId === savedCall.id && records[0].proof.replays === 3, JSON.stringify(records));
      const promotedRun = await runSaved(promoted, { id: 3 });
      check("the promoted locator acts on the same element", promotedRun.result.status === "passed" && promotedRun.last === "call-primary", JSON.stringify([promotedRun.result.status, promotedRun.result.error, promotedRun.last]));
      const reverted = await revertAiAction("act-u1", { audit, flows: flowStore });
      const afterRevert = (await flowStore.get(savedFlow.id))!.nodes.find((node) => node.id === savedCall.id)!;
      check("revert restores the recorded locator exactly", reverted.code === "OK" && JSON.stringify(afterRevert.locator) === JSON.stringify(expectedPrevious), JSON.stringify(afterRevert.locator));
    } finally {
      await u1Browser.close();
    }

    // ── C: save, reload, edit, re-save and replay ─────────────────────────────────────────────────
    console.log("C  Save, reload and replay after locator replacement");
    const flow = JSON.parse(JSON.stringify(buildRecordedFlow("Spy applied", recorder.getActions())));
    const savedSave = flow.nodes.find((node: FlowStep) => node.type === "click" && node.locator?.name === "Save profile") as FlowStep | undefined;
    check("the applied locator survives build + save/reload", savedSave?.locator?.strategy === "role" && savedSave.locator.resolution === "resolved", JSON.stringify(savedSave?.locator));
    const savedFrame = flow.nodes.find((node: FlowStep) => node.type === "click" && node.locator?.context?.frameChain?.length) as FlowStep | undefined;
    check("the applied frame step keeps its frame chain after save/reload", savedFrame?.locator?.strategy === "role" && savedFrame.locator.context?.frameChain?.length === 1, JSON.stringify(savedFrame?.locator));
    const resaved = JSON.parse(JSON.stringify({ ...flow, name: "Spy applied (edited)" }));
    check("an edited re-save keeps the applied locator", JSON.stringify(resaved.nodes.find((n: FlowStep) => n.id === savedSave?.id)?.locator) === JSON.stringify(savedSave?.locator));
    const replayBrowser = await chromium.launch({ headless: true });
    try {
      const replayPage = await replayBrowser.newPage();
      await replayPage.goto(LAB, { waitUntil: "domcontentloaded" });
      const executionContext = replayContext();
      const executor = new StepExecutor(replayPage, new LocatorFactory(replayPage), new ValueResolver(executionContext), executionContext);
      const saveReplay = savedSave ? await executor.execute(savedSave) : { status: "failed", error: "missing" };
      check("the replaced locator replays through StepExecutor", saveReplay.status === "passed" && (await text(replayPage, "spy-last")) === "save-profile", `${saveReplay.status} ${saveReplay.error ?? ""} last=${await text(replayPage, "spy-last")}`);
      const frameReplay = savedFrame ? await executor.execute(savedFrame) : { status: "failed", error: "missing" };
      const frameClicks = await replayPage.frameLocator('[data-testid="spy-frame"]').getByTestId("spy-frame-clicks").textContent();
      check("the replaced in-frame locator replays inside its frame", frameReplay.status === "passed" && frameClicks === "1", `${frameReplay.status} ${frameReplay.error ?? ""} clicks=${frameClicks}`);
    } finally {
      await replayBrowser.close();
    }

    // ── D: legacy and guarded-positional compatibility ───────────────────────────────────────────
    console.log("D  Legacy and guarded-positional compatibility");
    const legacy: RecordedAction = { id: "legacy-save", type: "click", name: "Legacy save", locator: { strategy: "text", value: "Save profile" } };
    const legacyFlow = buildRecordedFlow("Legacy", [legacy]);
    check("a legacy step without capture metadata still builds unchanged", (legacyFlow.nodes.find((n) => n.type === "click") as FlowStep | undefined)?.locator?.value === "Save profile");
    const twinBuilt = buildRecordedFlow("Twin", recorder.getActions()).nodes.find((n) => n.type === "click" && (n as FlowStep).name?.includes("Remove")) as FlowStep | undefined;
    check("the guarded-positional twin step stays resolved and runnable", twinBuilt?.locator?.resolution !== "needs-review" && twinBuilt?.locator?.resolution !== "invalid", JSON.stringify(twinBuilt?.locator?.resolution));
    check("the twin step's locator was never modified by the Spy", JSON.stringify(recorder.getActions().find((a) => a.id === twinAction?.id)?.locator) === twinBefore);

    // ── E: permission wiring ─────────────────────────────────────────────────────────────────────
    console.log("E  Main-process permission wiring");
    const ipcSource = await readFile("app/main/ipc/recorder.ipc.ts", "utf8");
    const handlerBody = (channel: string): string => {
      const start = ipcSource.indexOf(`ipcMain.handle("${channel}"`);
      if (start < 0) return "";
      const next = ipcSource.indexOf("ipcMain.handle(", start + 10);
      return ipcSource.slice(start, next < 0 ? undefined : next);
    };
    const channels = ["recorder:startInspection", "recorder:stopInspection", "recorder:setInspectMode", "recorder:getInspection", "recorder:applyInspection"];
    check("all five inspection channels are registered", channels.every((c) => handlerBody(c).length > 0));
    for (const channel of channels) {
      const body = handlerBody(channel);
      const gate = body.indexOf("assertSenderPermission(event, Permission.RECORDER_ELEMENT_SPY)");
      const call = body.indexOf("recorderService.");
      const page = Math.max(body.indexOf("assertSenderPermission(event, Permission.PAGE_RECORDER)"), body.indexOf("resolveRecorderBrowser(event"));
      check(`${channel} asserts recorder.elementSpy and the Recorder page before touching the service`, gate >= 0 && page >= 0 && call > gate && call > page, `gate=${gate} page=${page} call=${call}`);
    }
    const resolver = ipcSource.slice(ipcSource.indexOf("const resolveRecorderBrowser"), ipcSource.indexOf('ipcMain.handle("recorder:start"'));
    check("the shared browser resolver authorizes the Recorder page (Super User for installed Chrome)", /assertSenderPermission\(event, Permission\.PAGE_RECORDER\)/.test(resolver) && /assertSenderSuperUser\(event, Permission\.PAGE_RECORDER/.test(resolver));
    const preload = await readFile("app/main/preload.ts", "utf8");
    check("the preload exposes exactly the inspection channels", channels.every((c) => preload.includes(`invoke("${c}"`)));
    const viewer = effectivePermissions({ roles: ["Viewer"] });
    const operator = effectivePermissions({ roles: ["Operator"] });
    check("a role without recorder.elementSpy is denied; Operator is granted", !viewer.has(Permission.RECORDER_ELEMENT_SPY) && operator.has(Permission.RECORDER_ELEMENT_SPY), `viewer=${viewer.has(Permission.RECORDER_ELEMENT_SPY)} operator=${operator.has(Permission.RECORDER_ELEMENT_SPY)}`);
    const recorderPage = await readFile("app/renderer/pages/Recorder.tsx", "utf8");
    check("the renderer shows the Spy and polls it only with the permission", /\{canSpy \? \(/.test(recorderPage) && /if \(canSpy\) \{\s*window\.playwrightFlowStudio\.recorder\.getInspection\(\)/.test(recorderPage));
    const aiIpc = await readFile("app/main/ipc/ai.ipc.ts", "utf8");
    const proposeStart = aiIpc.indexOf('ipcMain.handle("ai:proposeInspectionLocator"');
    const proposeBody = proposeStart < 0 ? "" : aiIpc.slice(proposeStart, aiIpc.indexOf("ipcMain.handle(", proposeStart + 10));
    const proposeCall = proposeBody.indexOf("proposeInspectionLocator(event.sender.id");
    const gates = ["Permission.AI_USE", "Permission.PAGE_RECORDER", "Permission.RECORDER_ELEMENT_SPY"].map((gate) => proposeBody.indexOf(gate));
    check("ai:proposeInspectionLocator authorizes AI_USE, the Recorder page and recorder.elementSpy before it runs", proposeCall > 0 && gates.every((at) => at > 0 && at < proposeCall), `gates=${gates} call=${proposeCall}`);
    check(
      "main proves on the Spy's own live page with the Recorder's typed values and capture context",
      /recorderService\.getInspectionTarget\(\)/.test(aiIpc) && /proveLocatorPlan\(page, step, plan, \{ boundValues, \.\.\.\(inspection\.upgradeContext \? \{ upgradeContext: inspection\.upgradeContext \} : \{\}\) \}\)/.test(aiIpc)
    );
    check("Cancel reaches an Element Spy job before the plain service cancel", /abortInspectionLocator\(jobId\) \|\| getAiService\(\)\.cancel\(jobId\)/.test(aiIpc));
    check("the preload exposes the proposal channel", preload.includes('invoke("ai:proposeInspectionLocator"'));
    const attachStart = aiIpc.indexOf('ipcMain.handle("ai:attachInspectionProposal"');
    const attachBody = attachStart < 0 ? "" : aiIpc.slice(attachStart, aiIpc.indexOf("ipcMain.handle(", attachStart + 10));
    const attachCall = attachBody.indexOf("attachInspectionProposal(event.sender.id");
    const attachGates = ["Permission.AI_USE", "Permission.PAGE_RECORDER", "Permission.RECORDER_ELEMENT_SPY"].map((gate) => attachBody.indexOf(gate));
    check("U1: ai:attachInspectionProposal authorizes AI_USE, the Recorder page and recorder.elementSpy before it runs", attachCall > 0 && attachGates.every((at) => at > 0 && at < attachCall), `gates=${attachGates} call=${attachCall}`);
    check(
      "U1: it reads main's own inspection, draft and compare-and-swap, never a candidate from the request",
      /target: inspectionTarget/.test(attachBody) && /recorderService\.getDraftAction\(actionId\)/.test(attachBody) && /recorderService\.attachPendingUpgrade\(actionId, pending\)/.test(attachBody)
    );
    check("U1: the preload exposes it with ids only", /attachInspectionProposal: \(request: InspectionAttachRequest\) => invoke\("ai:attachInspectionProposal", request\)/.test(preload));
    check(
      "U1: saving passes main's own candidates to the finalizer, never the renderer's",
      /buildRecordedFlow\(name, actions, blueprints, \{ pendingUpgrades: recorderService\.draftPendingUpgrades\(\) \}\)/.test(await readFile("app/main/ipc/recorder.ipc.ts", "utf8"))
    );

    // ── F: result panel rendered from a real inspection ──────────────────────────────────────────
    console.log("F  Result panel rendered from the real inspection");
    const { ElementSpyResult, ElementSpyAiPanel } = await import("../app/renderer/pages/Recorder.tsx");
    const ready: AiStatusView = {
      enabled: true,
      state: "available",
      reason: null,
      holdReason: null,
      queueDepth: 0,
      modelPack: { status: "installed", reason: null, modelId: "test-fake", displayName: "Test" }
    };
    const panel = (status: AiStatusView | null, phase: AiAssistPhase<InspectionLocatorView>) =>
      renderToStaticMarkup(createElement(ElementSpyAiPanel, { status, phase, onPropose: () => undefined, onCancel: () => undefined }));
    const idleHtml = panel(ready, { kind: "idle" });
    check("AI panel: the proposal button is offered when local AI is ready", /data-testid="element-spy-ai-propose"(?![^>]*disabled)/.test(idleHtml) && idleHtml.includes("Find stronger locator with AI"));
    const offHtml = panel({ ...ready, enabled: false }, { kind: "idle" });
    check("AI panel: switched off, the button is disabled and says why", /data-testid="element-spy-ai-propose"[^>]*disabled/.test(offHtml) && offHtml.includes("Local AI is turned off"));
    const loadingHtml = panel(ready, { kind: "loading" });
    check("AI panel: while asking, only Cancel is offered", loadingHtml.includes('data-testid="element-spy-ai-cancel"') && !loadingHtml.includes('data-testid="element-spy-ai-propose"'));
    const provenHtml = panel(ready, { kind: "done", view: provenView, subject: provenView.inspectedAt ?? "" });
    check(
      "AI panel: a proven proposal is shown labelled as AI, as its compiled locator, and says nothing was applied",
      provenHtml.includes("AI suggestion") && provenHtml.includes("role button &quot;Save profile&quot; (exact)") && provenHtml.includes("Nothing was saved or applied"),
      provenHtml
    );
    const refusedHtml = panel(ready, { kind: "failed", view: { code: "NOT_PROVEN", ok: false, message: "No proposal could be proven on this page, so none is shown." } });
    check("AI panel: an unproven answer shows its reason and no locator", refusedHtml.includes("No proposal could be proven") && !refusedHtml.includes("element-spy-ai-result"));
    const attachPanel = (stepChosen: boolean) =>
      renderToStaticMarkup(
        createElement(ElementSpyAiPanel, { status: ready, phase: { kind: "done", view: provenView, subject: provenView.inspectedAt ?? "" }, onPropose: () => undefined, onCancel: () => undefined, attach: { stepChosen, busy: false, onAttach: () => undefined } })
      );
    check(
      "U1 panel: a proven proposal offers the attach, disabled until a step is chosen, and says it replaces nothing",
      /data-testid="element-spy-ai-attach"[^>]*disabled/.test(attachPanel(false)) && attachPanel(false).includes("Choose the recorded step above first") && attachPanel(false).includes("does not replace the step&#x27;s locator"),
      attachPanel(false)
    );
    check("U1 panel: with a step chosen the attach is enabled", /data-testid="element-spy-ai-attach"(?![^>]*disabled)/.test(attachPanel(true)) && !attachPanel(true).includes("Choose the recorded step above first"));
    check("U1 panel: an unproven answer offers nothing to attach", !panel(ready, { kind: "failed", view: { code: "NOT_PROVEN", ok: false } }).includes("element-spy-ai-attach"));
    if (save2 && twin) {
      const render = (inspection: ElementInspection, candidate: number) =>
        renderToStaticMarkup(createElement(ElementSpyResult, { inspection, candidate, onCandidate: () => undefined, actions: recorder.getActions(), actionId: saveAction?.id ?? "", onAction: () => undefined, busy: false, onApply: () => undefined }));
      const html = render(save2, roleIndex);
      check("panel shows identity, class, reasons and candidates with counts", html.includes("Save profile") && html.includes("Strong semantic") && html.includes("Unique") && html.includes("1 visible") && html.includes("Account settings"), html.slice(0, 300));
      check("panel enables \"Use in action\" for a unique candidate and a chosen step", /data-testid="element-spy-use"(?![^>]*disabled)/.test(html));
      const twinHtml = render(twin, dupIndex);
      check("panel marks duplicates ineligible and keeps \"Use in action\" disabled", twinHtml.includes("2 matches") && /data-testid="element-spy-use"[^>]*disabled/.test(twinHtml) && twinHtml.includes("is-ineligible"));
    } else {
      check("panel render inputs available", false);
    }

    // ── G: protected login during a recording ────────────────────────────────────────────────────
    console.log("G  Protected login during a recording");
    await recorder.startRecording(LAB, { executablePath, captureSmartWaits: false });
    const rec2: Page = internal.page;
    await recorder.setInspectMode(true);
    await inspect(() => rec2.getByTestId("spy-save-profile").click(), "Save profile");
    await rec2.goto(`${BASE}/mock/protected-login`).catch(() => undefined);
    const paused = await until(() => (recorder.getHandoff()?.active && recorder.getInspectionState().refused ? recorder.getInspectionState() : null));
    check("the protected-login pause turns inspection off and clears the result", Boolean(paused && !paused.inspecting && paused.inspection === null), JSON.stringify(recorder.getInspectionState()));
    const reenabled = await recorder.setInspectMode(true);
    check("inspection cannot be re-enabled while the handoff is active", !reenabled.inspecting, JSON.stringify(reenabled));
    await recorder.cancelRecording();
  } finally {
    await recorder.cancelRecording().catch(() => undefined);
    await recorder.stopInspection().catch(() => undefined);
    if (server && !server.killed) server.kill();
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }

  // The run is long enough for a console to truncate its middle; the failures are repeated here whole.
  if (failures.length) console.error(`\nFailed:\n${failures.map((label) => `  ✗ ${label}`).join("\n")}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  if (passed === 0 || failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
