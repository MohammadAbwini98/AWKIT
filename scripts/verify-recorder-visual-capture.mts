/**
 * verify:recorder-visual-capture — Phase N4.2 (awkit-vra.13.2): the Recorder's manual visual-reference capture,
 * end to end, on the REAL RecorderService (its own Recorder browser) against the Visual Intelligence lab
 * (/visual-intelligence).
 *
 *   A  the pure contract: AWKIT_VISUAL_RECORDER=manual only (RV-6), the seven RV-2 step types, the N0 code mapping and
 *      the fixed text of every code (RV-8)
 *   B  real recorded steps: click, check (eligible), fill and select (not eligible), a sensitive Approve, a masked
 *      field, a frame-chain target, a popup target and a below-the-fold target
 *   C  an eligible step captures N2-comparable evidence (version, element kind, size ceiling, binding digest =
 *      stepCandidatesDigest of the step's own locator) on its own live page, including through a frame chain and on a
 *      popup; the page is never clicked, focused or scrolled, and the steps are byte-identical afterwards (RV-0)
 *   D  every refusal is a fixed code decided BEFORE the capture seam is reached where it can be (disabled,
 *      not-recording, handoff-active, action-not-found, not-eligible, sensitive, protected-surface, no-live-page,
 *      not-found, not-unique), or by the capture itself without scrolling (offscreen, RV-7); a protected surface, a
 *      locator edit, a handoff or a closing page DURING the capture refuses and stores nothing
 *   E  memory only: the draft file and the recorded actions never carry evidence (RV-3); deleteAction, clearActions,
 *      applyInspection, startRecording and cancelRecording drop it; a locator edit reads `stale`
 *   F  every result is a code and fixed text, or `captured` (RV-8)
 *
 * Mutation contract (each run against RecorderService before this suite was committed, then reverted; the red checks
 * are the ones observed):
 *   M1  store the evidence straight after the screenshot, skipping the post-capture recheck — red: the protected
 *       surface, locator edit, handoff and popup close during the capture (8 checks) and the fourteen-answer pin.
 *   M2  drop the `count !== 1` refusal — SURVIVED: `LocatorFactory.resolve` already refuses the duplicated test id
 *       (resolve → null → not-unique), so this branch is defence in depth this lab cannot reach. Recorded, not hidden.
 *   M2b a failed re-proof falls back to the recorded test id's first match — red: the two-element not-unique case
 *       (captured, and it replaced the held reference) and the fourteen-answer pin.
 *   M3  deleteAction keeps the deleted step's reference — red: "deleting the step drops its reference".
 *   M4  the masked-field refusal disabled — red: the PIN-named check captured.
 *   M5  the detector pass before the screenshot skipped — red: the OTP surface reached the capture (the post-capture
 *       recheck still refused and stored nothing).
 *   verify:visual-isolation carries the third-edge mutation (the Recorder service importing src/visual directly).
 *
 * Run: npm run verify:recorder-visual-capture
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { RecorderService } from "@src/recorder/RecorderService";
import { buildRecordedStep } from "@src/recorder/buildRecordedFlow";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import {
  RECORDER_VISUAL_CAPTURE_MESSAGES,
  RECORDER_VISUAL_ELIGIBLE_STEPS,
  recorderVisualCaptureMode,
  recorderVisualCodeFor,
  type RecorderVisualCaptureCode,
  type RecorderVisualCaptureResult
} from "@src/recorder/visual/recorderVisualCaptureCodes";
import type { RecorderVisualCaptureOutcome, RecorderVisualCaptureRequest } from "@src/recorder/visual/RecorderVisualCapture";
import { stepCandidatesDigest } from "@src/runner/LocatorRecoveryStore";
import { VISUAL_EVIDENCE_MAX_BYTES, VISUAL_EVIDENCE_VERSION, type VisualEvidence } from "@src/visual/visualEvidence";

const PORT = 4471;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence`;
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
      last = error instanceof Error ? error.message : String(error);
      return null;
    }
  }, 15_000);
  if (!ok) throw new Error(`Mock Site did not serve ${LAB}: ${last}`);
}

interface PendingView {
  evidence: VisualEvidence;
  bindingDigest: string;
  capturedAt: string;
}

const results: RecorderVisualCaptureResult[] = [];

async function main(): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), "awkit-recorder-visual-"));
  const draftPath = join(work, "recorder-draft.json");
  const recorder = new RecorderService();
  const internal = recorder as any;
  recorder.configureDraftStorage(draftPath);
  recorder.configureUrlStorage(join(work, "recorder-urls.json"));
  const previousFlag = process.env.AWKIT_VISUAL_RECORDER;

  // The production capture, wrapped: every call is counted, and a scripted change can be made right after the real
  // screenshot (the moment between the capture and the post-capture recheck).
  const production = internal.captureVisual as (request: RecorderVisualCaptureRequest) => Promise<RecorderVisualCaptureOutcome>;
  let seamCalls = 0;
  let afterShot: ((request: RecorderVisualCaptureRequest) => Promise<void>) | undefined;
  internal.captureVisual = async (request: RecorderVisualCaptureRequest): Promise<RecorderVisualCaptureOutcome> => {
    seamCalls += 1;
    const outcome = await production(request);
    if (afterShot) await afterShot(request);
    return outcome;
  };
  const capture = async (actionId: string): Promise<RecorderVisualCaptureResult> => {
    const result = await recorder.captureVisualReference(actionId);
    results.push(result);
    return result;
  };
  const codeOf = (result: RecorderVisualCaptureResult): string => (result.ok ? result.status : result.code);
  const pending = (actionId: string): PendingView | undefined => internal.visualPending.get(actionId);
  /** A refusal decided before the capture seam: the code, nothing stored, the seam never reached. */
  const refusedBefore = async (label: string, actionId: string, code: RecorderVisualCaptureCode): Promise<void> => {
    const calls = seamCalls;
    const hadPending = pending(actionId);
    const result = await capture(actionId);
    check(`${label}: ${code}, decided before the capture`, codeOf(result) === code && seamCalls === calls, `${codeOf(result)}, seam calls ${seamCalls - calls}`);
    check(`${label}: nothing stored`, pending(actionId) === hadPending);
  };

  try {
    // ── A: the pure contract ──────────────────────────────────────────────────────────────────────
    console.log("A  The capture contract (RV-2, RV-6, RV-8)");
    check("AWKIT_VISUAL_RECORDER=manual turns it on", recorderVisualCaptureMode({ AWKIT_VISUAL_RECORDER: "manual" }) === "manual");
    const offValues = [undefined, "", "off", "MANUAL", "on", "1", "true", " manual"];
    check(
      `every other value, or none, is off (${offValues.length})`,
      offValues.every((value) => recorderVisualCaptureMode({ AWKIT_VISUAL_RECORDER: value }) === "off") && offValues.length === 8
    );
    const rv2 = ["click", "dblclick", "contextMenu", "clickAndHold", "check", "uncheck", "radio"];
    check(
      "the eligible step types are exactly the seven RV-2 types",
      RECORDER_VISUAL_ELIGIBLE_STEPS.size === 7 && rv2.every((type) => RECORDER_VISUAL_ELIGIBLE_STEPS.has(type)),
      [...RECORDER_VISUAL_ELIGIBLE_STEPS].join(", ")
    );
    check("fill, select, hover, press and goto are not eligible", ["fill", "select", "hover", "press", "goto"].every((type) => !RECORDER_VISUAL_ELIGIBLE_STEPS.has(type)));
    const mapping: Array<[string, RecorderVisualCaptureCode]> = [
      ["TARGET_NOT_UNIQUE", "not-unique"],
      ["TARGET_STALE", "stale"],
      ["TARGET_OFFSCREEN", "offscreen"],
      ["PROTECTED_SURFACE", "protected-surface"],
      ["FRAME_MAPPING_FAILED", "frame-mapping-failed"],
      ["PAGE_CLOSED", "page-closed"],
      ["BUDGET_EXHAUSTED", "timeout"],
      ["CANCELLED", "timeout"],
      ["CAPTURE_STALE", "stale"],
      ["CAPTURE_UNAVAILABLE", "capture-unavailable"],
      ["INVALID_BOUNDS", "capture-unavailable"],
      ["FINGERPRINT_FAILED", "capture-failed"],
      ["SOMETHING_NEW", "capture-failed"]
    ];
    const wrong = mapping.filter(([visual, code]) => recorderVisualCodeFor(visual) !== code).map(([visual]) => visual);
    check(`every N0 code maps to its Recorder code, an unknown one to capture-failed (${mapping.length})`, wrong.length === 0 && mapping.length === 13, wrong.join(", "));
    const messages = Object.entries(RECORDER_VISUAL_CAPTURE_MESSAGES);
    check(
      "17 codes, each with fixed non-empty text and no placeholder",
      messages.length === 17 && messages.every(([, text]) => text.length > 10 && !/[${}<>]/.test(text)),
      String(messages.length)
    );

    // ── B: record real steps ──────────────────────────────────────────────────────────────────────
    console.log("\nB  Recording the lab's steps");
    process.env.AWKIT_VISUAL_RECORDER = "manual";
    await refusedBefore("before any recording", "no-such-action", "not-recording");
    await waitForMockSite();
    await recorder.startRecording(LAB, { executablePath: chromium.executablePath(), captureSmartWaits: false, captureWaitTime: false });
    const rec: Page = internal.page;
    const find = (predicate: (action: RecordedAction) => boolean) => until(() => recorder.getActions().find(predicate));
    const byTestId = (testId: string) => (action: RecordedAction) => action.locator?.value === testId || JSON.stringify(action.locator ?? {}).includes(`"${testId}"`);

    await rec.getByTestId("vi-row-1-open").click();
    const rowOne = await find((a) => a.type === "click" && byTestId("vi-row-1-open")(a));
    await rec.getByTestId("vi-approve-primary").click();
    const approve = await find((a) => a.type === "click" && byTestId("vi-approve-primary")(a));
    await rec.frameLocator('[data-testid="vi-frame"]').getByTestId("vi-frame-target").click();
    const framed = await find((a) => a.type === "click" && Boolean(a.locator?.context?.frameChain?.length));
    // Controls for the non-click types, added without navigating (so the Recorder's own load-time detection never runs).
    await rec.evaluate(() => {
      const box = document.createElement("div");
      box.setAttribute("data-testid", "n4-controls");
      box.style.cssText = "position: absolute; left: 20px; top: 140px; display: flex; gap: 8px; align-items: center";
      box.innerHTML =
        '<input data-testid="n4-note" aria-label="Note">' +
        '<input type="checkbox" data-testid="n4-agree" aria-label="Agree">' +
        '<select data-testid="n4-size" aria-label="Size"><option>Small</option><option>Medium</option></select>' +
        '<input type="checkbox" data-testid="n4-badge" name="pin" aria-label="Badge">';
      document.body.appendChild(box);
    });
    await rec.getByTestId("n4-note").fill("hello");
    await rec.getByTestId("n4-agree").click();
    const checked = await find((a) => a.type === "check" && byTestId("n4-agree")(a));
    const filled = await find((a) => a.type === "fill" && byTestId("n4-note")(a));
    await rec.getByTestId("n4-size").selectOption("Medium");
    const selected = await find((a) => a.type === "select" && byTestId("n4-size")(a));
    await rec.getByTestId("n4-badge").click();
    // A click on a text field is not recorded as a click, so the masked field is an eligible `check` on a PIN-named input.
    const masked = await find((a) => a.type === "check" && byTestId("n4-badge")(a));
    // Playwright scrolls to click below the fold; the page goes back to the top before anything is captured.
    await rec.getByTestId("vi-offscreen").click();
    const below = await find((a) => a.type === "click" && byTestId("vi-offscreen")(a));
    await rec.evaluate(() => window.scrollTo(0, 0));
    const popupOpened = rec.waitForEvent("popup");
    await rec.getByTestId("vi-open-popup").click();
    const popup = await popupOpened;
    await popup.waitForLoadState();
    await until(() => (internal.popupPages as Map<string, Page>).size > 0 || null);
    await popup.getByTestId("vi-popup-target").click();
    const popupStep = await find((a) => a.type === "click" && byTestId("vi-popup-target")(a));
    const recorded = { rowOne, approve, framed, checked, filled, selected, masked, below, popupStep };
    const missing = Object.entries(recorded).filter(([, action]) => !action).map(([name]) => name);
    check("the Recorder recorded all nine steps", missing.length === 0, `missing: ${missing.join(", ")}; got ${JSON.stringify(recorder.getActions().map((a) => [a.type, a.name]))}`);
    if (missing.length) throw new Error("cannot continue without the recorded steps");
    check("the popup step belongs to the popup page, not main", Boolean(popupStep!.pageAlias) && popupStep!.pageAlias !== "main", popupStep!.pageAlias);

    // ── C: eligible steps capture ─────────────────────────────────────────────────────────────────
    console.log("\nC  Eligible steps capture N2-comparable evidence without touching the page");
    const pageState = () => rec.evaluate(() => ({ interactions: (window as any).__visualLab.interactions as number, scrollY: window.scrollY, focus: document.activeElement?.tagName ?? "" }));
    await rec.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const actionsBefore = JSON.stringify(recorder.getActions());
    const stateBefore = await pageState();
    const callsBefore = seamCalls;
    const rowResult = await capture(rowOne!.id);
    const stateAfter = await pageState();
    check("a recorded click captures", rowResult.ok && rowResult.status === "captured", JSON.stringify(rowResult));
    check("the capture reached the production capture exactly once", seamCalls === callsBefore + 1, String(seamCalls - callsBefore));
    check(
      "the page was not clicked, focused or scrolled (RV-7)",
      stateAfter.interactions === stateBefore.interactions && stateAfter.scrollY === 0 && stateBefore.scrollY === 0 && stateAfter.focus === stateBefore.focus,
      `${JSON.stringify(stateBefore)} -> ${JSON.stringify(stateAfter)}`
    );
    check("the recorded steps are byte-identical after the capture (RV-0)", JSON.stringify(recorder.getActions()) === actionsBefore);
    const rowPending = pending(rowOne!.id);
    const rowStep = buildRecordedStep(rowOne!);
    check(
      "the evidence is the N0 element evidence, version and size ceiling included",
      rowPending?.evidence.version === VISUAL_EVIDENCE_VERSION && rowPending.evidence.kind === "element" && Boolean(rowPending.evidence.bounds) && JSON.stringify(rowPending.evidence).length <= VISUAL_EVIDENCE_MAX_BYTES,
      JSON.stringify(rowPending?.evidence)?.slice(0, 300)
    );
    check(
      "the binding digest is the step's own N2 candidate digest",
      Boolean(rowStep?.locator) && rowPending?.bindingDigest === stepCandidatesDigest(rowStep!.locator!) && !Number.isNaN(Date.parse(rowPending?.capturedAt ?? "")),
      rowPending?.bindingDigest
    );
    check("its status reads captured", recorder.visualReferenceStatus(rowOne!.id) === "captured");
    check("a step without a reference reads none", recorder.visualReferenceStatus(approve!.id) === "none");

    // Refusals DURING the capture, each on a step that holds no reference yet, before its successful capture.
    console.log("\nD  Refusals during the capture store nothing");
    {
      afterShot = async () => {
        await rec.evaluate(() => (window as any).__visualLab.injectProtected("otp"));
      };
      const result = await capture(checked!.id);
      afterShot = undefined;
      await rec.evaluate(() => (window as any).__visualLab.removeProtected());
      check("a protected surface that appears during the capture refuses: protected-surface", codeOf(result) === "protected-surface", codeOf(result));
      check("…and nothing is stored", pending(checked!.id) === undefined && recorder.visualReferenceStatus(checked!.id) === "none");
    }
    {
      const original = structuredClone(checked!.locator);
      afterShot = async () => {
        const live = recorder.getActions().find((a) => a.id === checked!.id)!;
        live.locator = { ...live.locator!, value: "n4-agree-edited" };
      };
      const result = await capture(checked!.id);
      afterShot = undefined;
      recorder.getActions().find((a) => a.id === checked!.id)!.locator = original;
      check("the step's locator edited during the capture refuses: stale", codeOf(result) === "stale", codeOf(result));
      check("…and nothing is stored", pending(checked!.id) === undefined);
    }
    {
      const previous = internal.handoff;
      afterShot = async () => {
        internal.handoff = { ...(previous ?? {}), active: true };
      };
      const result = await capture(checked!.id);
      afterShot = undefined;
      internal.handoff = previous;
      check("a protected-login handoff that starts during the capture refuses: handoff-active", codeOf(result) === "handoff-active", codeOf(result));
      check("…and nothing is stored", pending(checked!.id) === undefined);
    }
    {
      const result = await capture(checked!.id);
      check("a recorded check step captures once the page is clear (a non-click RV-2 type)", result.ok, codeOf(result));
    }
    {
      const result = await capture(framed!.id);
      const evidence = pending(framed!.id)?.evidence;
      check("a step inside an iframe captures through its frame chain", result.ok && evidence?.kind === "element", codeOf(result));
    }
    {
      const result = await capture(popupStep!.id);
      check("a popup step captures on its own live popup page", result.ok, codeOf(result));
    }
    {
      const held = pending(popupStep!.id);
      afterShot = async () => {
        await popup.close();
      };
      const result = await capture(popupStep!.id);
      afterShot = undefined;
      check("its popup closing during a second capture refuses: page-closed", codeOf(result) === "page-closed", codeOf(result));
      check("…and the reference it already held is untouched", held !== undefined && pending(popupStep!.id) === held);
    }

    console.log("\nD  Refusals before the capture, and the offscreen refusal");
    await refusedBefore("an unknown step", "no-such-action", "action-not-found");
    await refusedBefore("a fill step (RV-2)", filled!.id, "not-eligible");
    await refusedBefore("a select step (RV-2)", selected!.id, "not-eligible");
    await refusedBefore("an Approve click (dangerous mutation)", approve!.id, "sensitive");
    await refusedBefore("a check on a masked field (a PIN-named input)", masked!.id, "sensitive");
    {
      const previous = internal.handoff;
      internal.handoff = { ...(previous ?? {}), active: true };
      await refusedBefore("an active protected-login handoff", rowOne!.id, "handoff-active");
      internal.handoff = previous;
    }
    await rec.evaluate(() => (window as any).__visualLab.injectProtected("otp"));
    await refusedBefore("a protected OTP surface on the page", framed!.id, "protected-surface");
    await rec.evaluate(() => (window as any).__visualLab.removeProtected());
    await rec.evaluate(() => {
      const twin = document.querySelector("[data-testid='vi-row-2-open']");
      twin?.setAttribute("data-testid", "vi-row-1-open");
      twin?.setAttribute("data-n4-twin", "1");
    });
    await refusedBefore("the step's locator matching two elements", rowOne!.id, "not-unique");
    await rec.evaluate(() => document.querySelector("[data-n4-twin]")?.setAttribute("data-testid", "vi-row-2-open"));
    await rec.evaluate(() => {
      const target = document.querySelector("[data-testid='vi-row-1-open']") as HTMLElement | null;
      if (target) target.style.display = "none";
    });
    await refusedBefore("the step's element hidden", rowOne!.id, "not-found");
    await rec.evaluate(() => {
      const target = document.querySelector("[data-testid='vi-row-1-open']") as HTMLElement | null;
      if (target) target.style.display = "";
    });
    {
      const before = await pageState();
      const calls = seamCalls;
      const result = await capture(below!.id);
      const after = await pageState();
      check("a below-the-fold step refuses: offscreen (RV-7, decided by the capture)", codeOf(result) === "offscreen" && seamCalls === calls + 1, `${codeOf(result)}, seam calls ${seamCalls - calls}`);
      check("…and the page was never scrolled to it", before.scrollY === 0 && after.scrollY === 0 && after.interactions === before.interactions, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      check("…and nothing is stored", pending(below!.id) === undefined);
    }
    {
      const previousPopup = popupStep!;
      const popupPending = pending(previousPopup.id);
      check("the popup is closed", popup.isClosed());
      await refusedBefore("the popup step after its popup closed", previousPopup.id, "no-live-page");
      check("…and the reference it already holds is untouched", pending(previousPopup.id) === popupPending && recorder.visualReferenceStatus(previousPopup.id) === "captured");
    }
    process.env.AWKIT_VISUAL_RECORDER = "off";
    await refusedBefore("the flag off during a recording", approve!.id, "disabled");
    delete process.env.AWKIT_VISUAL_RECORDER;
    await refusedBefore("the flag unset", approve!.id, "disabled");
    process.env.AWKIT_VISUAL_RECORDER = "manual";

    // ── E: memory only, and the drop rules ────────────────────────────────────────────────────────
    console.log("\nE  Memory only, and every binding change drops or stales the reference");
    await internal.persistDraft();
    const draft = await readFile(draftPath, "utf8");
    const actionsText = JSON.stringify(recorder.getActions());
    // Recorded actions carry their own identity `fingerprint`, so the check looks for the evidence's VALUES.
    const evidenceTokens = [
      rowPending!.bindingDigest,
      rowPending!.evidence.capturedAt,
      rowPending!.capturedAt,
      rowPending!.evidence.fingerprint.grid,
      rowPending!.evidence.fingerprint.edgeGrid,
      "visualPending",
      "bindingDigest"
    ];
    check("the draft file was written and carries no evidence, digest or capture time (RV-3)", draft.includes(rowOne!.id) && evidenceTokens.every((token) => !draft.includes(token)), evidenceTokens.filter((t) => draft.includes(t)).join(", "));
    check("the recorded actions carry no evidence", evidenceTokens.every((token) => !actionsText.includes(token)));
    {
      const live = recorder.getActions().find((a) => a.id === rowOne!.id)!;
      const original = structuredClone(live.locator);
      live.locator = { ...live.locator!, value: "vi-row-3-open" };
      check("a locator edit after the capture reads stale", recorder.visualReferenceStatus(rowOne!.id) === "stale");
      live.locator = original;
      check("…and the original binding reads captured again", recorder.visualReferenceStatus(rowOne!.id) === "captured");
    }
    {
      const state = await recorder.setInspectMode(true);
      check("inspect mode turned on for the applyInspection drop", Boolean(state), JSON.stringify(state));
      await rec.getByTestId("vi-row-3-open").click();
      const inspected = await until(() => recorder.getInspectionState().inspection ?? null);
      const applied = inspected ? await recorder.applyInspection(rowOne!.id, 0) : { ok: false as const, reason: "no inspection" };
      await recorder.setInspectMode(false);
      check("applying an inspected candidate to the step drops its reference", applied.ok && pending(rowOne!.id) === undefined && recorder.visualReferenceStatus(rowOne!.id) === "none", JSON.stringify(applied).slice(0, 300));
    }
    {
      const removed = await recorder.deleteAction(framed!.id);
      check("deleting the step drops its reference", removed.removedIds.includes(framed!.id) && pending(framed!.id) === undefined);
    }
    check("the check step still holds its reference before the clear", pending(checked!.id) !== undefined);
    await recorder.clearActions();
    check("clearing the actions drops every reference", internal.visualPending.size === 0, String(internal.visualPending.size));

    await rec.getByTestId("vi-row-2-open").click();
    const again = await find((a) => a.type === "click" && byTestId("vi-row-2-open")(a));
    const againResult = again ? await capture(again.id) : undefined;
    check("a step recorded after the clear captures", Boolean(againResult?.ok), againResult ? codeOf(againResult) : "not recorded");
    await recorder.cancelRecording();
    check("cancelling the recording drops every reference", internal.visualPending.size === 0, String(internal.visualPending.size));

    await recorder.startRecording(LAB, { executablePath: chromium.executablePath(), captureSmartWaits: false, captureWaitTime: false });
    const rec2: Page = internal.page;
    await rec2.getByTestId("vi-row-1-open").click();
    const fresh = await find((a) => a.type === "click" && byTestId("vi-row-1-open")(a));
    const freshResult = fresh ? await capture(fresh.id) : undefined;
    check("a new recording captures again", Boolean(freshResult?.ok), freshResult ? codeOf(freshResult) : "not recorded");
    await recorder.stopRecording();
    check("stopping keeps the reference for the save (N4.3)", Boolean(fresh) && recorder.visualReferenceStatus(fresh!.id) === "captured" && internal.visualPending.size === 1);
    await refusedBefore("a capture after the recording stopped", fresh?.id ?? "", "not-recording");
    await recorder.startRecording(LAB, { executablePath: chromium.executablePath(), captureSmartWaits: false, captureWaitTime: false });
    check("starting the next recording drops every reference from the last one", internal.visualPending.size === 0, String(internal.visualPending.size));
    {
      const rec3: Page = internal.page;
      await rec3.getByTestId("vi-row-1-open").click();
      const last = await find((a) => a.type === "click" && byTestId("vi-row-1-open")(a));
      const lastResult = last ? await capture(last.id) : undefined;
      check("a step in the restarted recording captures", Boolean(lastResult?.ok), lastResult ? codeOf(lastResult) : "not recorded");
      await recorder.discardDraft();
      check("discarding the draft drops every reference", internal.visualPending.size === 0, String(internal.visualPending.size));
    }

    // ── F: RV-8 ───────────────────────────────────────────────────────────────────────────────────
    console.log("\nF  Every answer is a code and fixed text (RV-8)");
    const shapes = results.map((result) =>
      result.ok
        ? JSON.stringify(Object.keys(result)) === '["ok","status"]' && result.status === "captured"
        : JSON.stringify(Object.keys(result)) === '["ok","code","message"]' && result.message === RECORDER_VISUAL_CAPTURE_MESSAGES[result.code]
    );
    const codes = new Set(results.map(codeOf));
    check(
      `every result (${results.length}) is { ok, status: captured } or { ok, code, message } with the code's own text`,
      results.length === 26 && shapes.every(Boolean),
      `${results.length} results; ${results.filter((_, index) => !shapes[index]).map((r) => JSON.stringify(r)).join("; ")}`
    );
    const expected = [
      "captured",
      "not-recording",
      "disabled",
      "handoff-active",
      "action-not-found",
      "not-eligible",
      "sensitive",
      "protected-surface",
      "no-live-page",
      "not-found",
      "not-unique",
      "offscreen",
      "stale",
      "page-closed"
    ];
    check(
      `the run produced exactly the fourteen expected answers (${codes.size})`,
      codes.size === expected.length && expected.every((code) => codes.has(code)),
      [...codes].join(", ")
    );
  } finally {
    if (previousFlag === undefined) delete process.env.AWKIT_VISUAL_RECORDER;
    else process.env.AWKIT_VISUAL_RECORDER = previousFlag;
    await recorder.cancelRecording().catch(() => undefined);
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

const serverProcess = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
main()
  .catch((error) => {
    failed += 1;
    failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
    console.error(error);
  })
  .finally(() => {
    serverProcess.kill();
    console.log(`\nverify:recorder-visual-capture ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error(failures.map((failure) => `  - ${failure}`).join("\n"));
      process.exitCode = 1;
    }
    setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
  });
