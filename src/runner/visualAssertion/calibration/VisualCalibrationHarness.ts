/**
 * The N6.6 calibration harness (Phase N, awkit-vra.15.6; VA-12, VA-16). It MEASURES only: one fresh real Chromium
 * launch per trial, the real `VisualAssertionStep` adapter (the guarded N0 element capture, VA-15 policy, the N6.2
 * policy, the real keyed store) against the mock-site Visual Assertion Lab. It never issues a grant: the calibration
 * root decides with `evaluateCalibrationCell` and issues only for a qualified cell.
 *
 * Used only by `app/main/calibration/visualCalibrationRoot.ts`, which runs in the main process of the NON-PACKAGED
 * acceptance build (it refuses a packaged app) and is built to `out/calibration-main/`, excluded from packaging. No
 * IPC channel, setting, flow or workflow run reaches it.
 */

import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright";
import type { FlowStep } from "../../../profiles/FlowProfile";
import { LocatorFactory } from "../../LocatorFactory";
import { VisualAssertionStep, visualAssertionGrantEnvironment } from "../VisualAssertionStep";
import type { VisualBaselineStore } from "../VisualBaselineStore";
import { VisualAssertionCandidates } from "../visualAssertionCandidates";
import { VISUAL_ASSERTION_DEADLINE_MS, type VisualAssertionRunInitiator } from "../visualAssertionContract";
import type {
  VisualCalibrationCellKey,
  VisualCalibrationEnvironment,
  VisualCalibrationFixture,
  VisualCalibrationLaunch,
  VisualCalibrationTrial
} from "./visualCalibrationCriteria";

export const VISUAL_CALIBRATION_FLOW_ID = "awkit-n6-calibration";
const VIEWPORT = { width: 800, height: 600 };
/** A browser or page that does not close in this time is abandoned so the session keeps going. */
const CLOSE_LIMIT_MS = 10_000;

/** Close without ever hanging the session on a stuck browser or page. */
function closeWithin(close: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    close().catch(() => undefined),
    new Promise<void>((resolve) => (timer = setTimeout(resolve, CLOSE_LIMIT_MS)))
  ]).finally(() => clearTimeout(timer));
}

const assertStep = (id: string, testId: string): FlowStep =>
  ({ id, name: `Calibration ${id}`, type: "assertVisual", mode: "observe", locator: { strategy: "testId", value: testId } }) as unknown as FlowStep;

/** The calibration flow's steps. Approvals bind these step ids and their content digest. */
export const VISUAL_CALIBRATION_STEPS = {
  card: assertStep("cal-card", "va-card"),
  button: assertStep("cal-button", "va-button"),
  clipped: assertStep("cal-clipped", "va-clipped"),
  sensitive: assertStep("cal-sensitive", "va-card-number")
} as const;

export interface VisualCalibrationHarnessOptions {
  store: VisualBaselineStore;
  appVersion: string;
  /** The local operator running the calibration (the Windows account), recorded as run user and approver. */
  operator: VisualAssertionRunInitiator;
  sessionId: string;
  labUrl: string;
  launch: (renderMode: "headed" | "headless") => Promise<Browser>;
}

export class VisualCalibrationHarness {
  private readonly candidates = new VisualAssertionCandidates();
  private launchSeq = 0;

  constructor(private readonly options: VisualCalibrationHarnessOptions) {}

  /** The environment of a launched browser, exactly as a grant binds it. */
  environmentOf(browser: Browser): VisualCalibrationEnvironment {
    return visualAssertionGrantEnvironment(browser.version(), this.options.appVersion);
  }

  private async context(browser: Browser, cell: VisualCalibrationCellKey): Promise<BrowserContext> {
    return browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: cell.devicePixelRatio });
  }

  private async page(context: BrowserContext, variant?: string): Promise<Page> {
    const page = await context.newPage();
    await page.goto(this.options.labUrl);
    await page.getByTestId("va-card").waitFor();
    if (variant) await page.evaluate((v) => (window as unknown as { __assertionLab: { setVariant(n: string): void } }).__assertionLab.setVariant(v), variant);
    return page;
  }

  private async assess(
    page: Page,
    step: FlowStep,
    cell: VisualCalibrationCellKey,
    fixture: VisualCalibrationFixture,
    handedOff = false
  ): Promise<VisualCalibrationTrial & { candidateId?: string }> {
    let captures = 0;
    const adapter = new VisualAssertionStep({
      store: this.options.store,
      appVersion: this.options.appVersion,
      candidates: this.candidates,
      initiator: this.options.operator,
      probe: { onCapture: () => (captures += 1) }
    });
    const spec = step.locator!;
    const assessment = await adapter.assess({
      step,
      flowId: VISUAL_CALIBRATION_FLOW_ID,
      executionId: this.options.sessionId,
      instanceId: `launch-${this.launchSeq}`,
      page,
      target: () => new LocatorFactory(page).locateCandidate({ strategy: spec.strategy, value: spec.value }, spec.context),
      handedOff,
      renderMode: cell.renderMode,
      readGrant: false,
      deadlineMs: VISUAL_ASSERTION_DEADLINE_MS,
      limitScreenshot: (work) => work()
    });
    return {
      fixture,
      verdict: assessment.verdict,
      code: assessment.code,
      durationMs: assessment.durationMs,
      captures,
      ...(assessment.candidateId ? { candidateId: assessment.candidateId } : {})
    };
  }

  /** Approve one candidate exactly as N6.5 will: bound fields, consumed once, re-checked in the lane. */
  private async approve(candidateId: string): Promise<string | null> {
    const c = this.candidates.take(candidateId);
    if (!c) return "candidate-missing";
    const r = await this.options.store.approveUnchecked({
      flowId: c.flowId,
      stepId: c.stepId,
      stepContentDigest: c.stepContentDigest,
      conditions: { ...c.conditions },
      epoch: c.epoch,
      width: c.width,
      height: c.height,
      contentDigest: c.contentDigest,
      geometry: { ...c.geometry },
      boundEpoch: c.epoch,
      boundKeyGeneration: c.keyGeneration,
      approver: this.options.operator.userId,
      runUser: c.initiator.userId,
      runId: c.executionId,
      appVersion: this.options.appVersion
    });
    return r.ok ? null : r.refusal;
  }

  /**
   * The baseline launch: a SEPARATE launch that approves the card and button baselines for this cell when they are
   * missing. Returns the reason when a baseline could not be approved (the cell then records no trial).
   */
  async ensureBaselines(cell: VisualCalibrationCellKey): Promise<string | null> {
    this.launchSeq += 1;
    const browser = await this.options.launch(cell.renderMode);
    try {
      const context = await this.context(browser, cell);
      for (const step of [VISUAL_CALIBRATION_STEPS.card, VISUAL_CALIBRATION_STEPS.button]) {
        const page = await this.page(context);
        const trial = await this.assess(page, step, cell, "primary");
        await closeWithin(() => page.close());
        if (trial.verdict === "passed") continue;
        if (!trial.candidateId) return `${step.id}: ${trial.code}`;
        const refused = await this.approve(trial.candidateId);
        if (refused) return `${step.id}: ${refused}`;
      }
      return null;
    } finally {
      await closeWithin(() => browser.close());
    }
  }

  /** One independent trial launch: the primary fixture first, then (when asked) every other fixture. */
  async runLaunch(cell: VisualCalibrationCellKey, withFixtures: boolean): Promise<VisualCalibrationLaunch> {
    this.launchSeq += 1;
    const startedAt = new Date().toISOString();
    const browser = await this.options.launch(cell.renderMode);
    const trials: VisualCalibrationTrial[] = [];
    const created: string[] = [];
    const strip = ({ candidateId, ...trial }: VisualCalibrationTrial & { candidateId?: string }): VisualCalibrationTrial => {
      if (candidateId) created.push(candidateId);
      return trial;
    };
    try {
      const environment = this.environmentOf(browser);
      // Proof of a fresh browser: nothing was open in it before this trial's own context.
      const contextsAtStart = browser.contexts().length;
      const context = await this.context(browser, cell);
      const run = async (fixture: VisualCalibrationFixture, step: FlowStep, setup?: (page: Page) => Promise<void>, variant?: string, handedOff = false) => {
        const page = await this.page(context, variant);
        await setup?.(page);
        trials.push(strip(await this.assess(page, step, cell, fixture, handedOff)));
        await closeWithin(() => page.close());
      };
      await run("primary", VISUAL_CALIBRATION_STEPS.card);
      if (withFixtures) {
        for (const variant of ["restyle", "swap", "text", "size"] as const) await run(variant, VISUAL_CALIBRATION_STEPS.card, undefined, variant);
        await run("moved", VISUAL_CALIBRATION_STEPS.card, undefined, "move");
        await run("clipped", VISUAL_CALIBRATION_STEPS.clipped);
        await run("hovered", VISUAL_CALIBRATION_STEPS.button, (page) => page.getByTestId("va-button").hover());
        await run("focused", VISUAL_CALIBRATION_STEPS.button, (page) => page.getByTestId("va-button").focus());
        await run("protected", VISUAL_CALIBRATION_STEPS.card, (page) =>
          page.evaluate(() => (window as unknown as { __assertionLab: { injectProtected(): void } }).__assertionLab.injectProtected())
        );
        await run("handoff", VISUAL_CALIBRATION_STEPS.card, undefined, undefined, true);
        await run("sensitive", VISUAL_CALIBRATION_STEPS.sensitive);
      }
      return { launchId: randomUUID(), contextsAtStart, sessionId: this.options.sessionId, cell, environment, startedAt, trials };
    } finally {
      // A trial launch never approves: its own leftover candidates are discarded (never another lane's).
      for (const id of created) this.candidates.discard(id);
      await closeWithin(() => browser.close());
    }
  }
}
