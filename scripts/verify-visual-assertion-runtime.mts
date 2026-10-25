/**
 * verify:visual-assertion-runtime — Phase N, N6.4 (awkit-vra.15.4): the `assertVisual` step in real Chromium, through
 * the REAL `FlowExecutor` retry loop over a REAL `StepExecutor`, the lazily loaded `VisualAssertionStep` adapter and a
 * real `VisualBaselineStore` (temporary runtime root), against the mock-site Visual Assertion Lab
 * (`/visual-intelligence/assertion`).
 *
 * Cases:
 *   M  the flag x step mode x build matrix through the executor: flag off never loads the adapter or captures; the
 *      packaged build fails every enforce step `enforce-unavailable-in-production` and never reads a grant; observe
 *      steps always pass; dev enforce needs flag enforce and a valid grant;
 *   B  baselines: no-baseline -> candidate -> approval -> identical; restyle, text and swap differ; a wider box is
 *      size-differs; a move is position-changed; other conditions; integrity unavailable; a clipped target;
 *      enforce outcomes with a grant; the step is never retried and fails as an ordinary step error;
 *   C  refusals that capture nothing: handed off, protected surface, sensitive field, duplicates, missing, hidden;
 *      offscreen is refused by N0;
 *   I  interaction state: hover and focus are inconclusive and never moved by the step;
 *   D  VA-15 stillness: an animated card is identical across runs, and the same capture without the policy is not;
 *   E  the deadline, cancellation and a closed page: one settlement, no late candidate;
 *   F  neutrality: a flow without assertVisual gives the same results with the feature on, and never loads the adapter;
 *   G  candidates are memory only, single use, and their renderer view carries no digest, token or pixels;
 *   H  enablement pins.
 *
 * The grants used here are verifier fixtures in a temporary runtime root, issued through the store's dev-only issuer;
 * they are not calibration evidence and qualify nothing. The key protector is the verifier-only AES test protector
 * (`scripts/lib/visualBaselineKit.mts`); the production protector is Electron safeStorage, checked live separately.
 *
 * Mutation contract (run 2026-10-24 by temporary source edits, each observed red and reverted): R1 the adapter ignores
 * `handedOff` (C handed-off red); R2 the capture without `stillness` (D 0/3 red); R3 the late-candidate guard removed
 * is EQUIVALENT while every await is bounded by the abort race, so R3b also drops that race (E late work red); R4 the
 * VA-2 retry rule removed (B attempts=3 red, once the step's safety is explicitly retryable); R5 the executor evaluates
 * with the flag off (M red).
 * Review follow-up (2026-10-24), also by temporary source edits, each red and reverted: J1 the assertVisual page resolved
 * outside the step deadline again (J page-delay and alias cases red, 6 checks); K1 a placeholder run user when no
 * initiator is bound (K red, 3 checks); E1 the epoch token read after the capture point (K stale-epoch case red).
 *
 * Run: npm run verify:visual-assertion-runtime
 */

import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { ManualHandoffController } from "@src/runner/ManualHandoffController";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { StepExecutionResult } from "@src/runner/RunnerResult";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { VISUAL_ASSERTION_CAPTURE_POLICY, VisualAssertionStep, type VisualAssertionProbe } from "@src/runner/visualAssertion/VisualAssertionStep";
import { VisualAssertionCandidates } from "@src/runner/visualAssertion/visualAssertionCandidates";
import {
  VISUAL_ASSERTION_DEADLINE_MS,
  visualAssertionFlag,
  visualAssertionOsBuild,
  type VisualAssertionAppMode,
  type VisualAssertionAssessor,
  type VisualAssertionFlag,
  type VisualAssertionRecord,
  type VisualAssertionRunInitiator
} from "@src/runner/visualAssertion/visualAssertionContract";
import { VISUAL_CALIBRATION_SUITE_VERSION, VisualBaselineStore, type VisualGrantCell, type VisualGrantEnvironment } from "@src/runner/visualAssertion/VisualBaselineStore";
import { RetryPolicy } from "@src/runner/runtime/RetryPolicy";
import { validateFlowDefinition } from "@src/validation/FlowValidator";
import { NODE_CATALOG } from "@src/testing/random/NodeCatalog";
import { actionNodeWeights, blockedNodeTypes, resolveConstraints } from "@src/testing/random/GenerationConstraints";
import { captureElement, VISUAL_FINGERPRINT_VERSION, fingerprintVisualImage } from "@src/visual";
import { makeEnv, type Env } from "./lib/visualBaselineKit.mts";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const PORT = 4611;
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/visual-intelligence/assertion`;
const FLOW_ID = "assertion-flow";
const APP_VERSION = "0.1.53";
let browser: Browser | undefined;
let executionSeq = 0;

/** Counts grant reads, so the packaged build is proven never to read one. */
class CountingStore extends VisualBaselineStore {
  grantReads = 0;
  override grantStatus(...args: Parameters<VisualBaselineStore["grantStatus"]>): ReturnType<VisualBaselineStore["grantStatus"]> {
    this.grantReads += 1;
    return super.grantStatus(...args);
  }
}

const card = (id: string, extra: Record<string, unknown> = {}): FlowStep =>
  ({ id, name: `Assert ${id}`, type: "assertVisual", locator: { strategy: "testId", value: "va-card" }, ...extra }) as unknown as FlowStep;
const at = (testId: string) => ({ strategy: "testId", value: testId });

const STEPS = {
  observe: card("s-observe"),
  // Explicitly retryable read-only safety, so only the VA-2 rule can stop a retry.
  enforce: card("s-enforce", { mode: "enforce", retry: { count: 2, delayMs: 1 }, safety: { sideEffectLevel: "read", retryable: true } }),
  button: card("s-button", { locator: at("va-button") }),
  animated: card("s-animated", { locator: at("va-animated") }),
  clipped: card("s-clipped", { locator: at("va-clipped") }),
  offscreen: card("s-offscreen", { locator: at("va-offscreen") }),
  dupe: card("s-dupe", { locator: at("va-dupe") }),
  hidden: card("s-hidden", { locator: at("va-hidden") }),
  missing: card("s-missing", { locator: at("va-nowhere") }),
  sensitive: card("s-sensitive", { locator: at("va-card-number") }),
  sensitiveWrapper: card("s-sensitive-wrapper", { locator: at("va-payment") }),
  sensitiveShadow: card("s-sensitive-shadow", { locator: at("va-otp-host") }),
  sensitiveLabel: card("s-sensitive-label", { locator: at("va-labelled") }),
  sensitiveFrame: card("s-sensitive-frame", { locator: at("va-frame-host") }),
  sensitiveSnake: card("s-sensitive-snake", { locator: at("va-camel") })
};

interface World {
  env: Env;
  store: CountingStore;
  candidates: VisualAssertionCandidates;
}

async function world(mode: "dev" | "packaged" = "dev", root?: string): Promise<World> {
  const env = makeEnv({ mode, Store: CountingStore, ...(root ? { root } : {}) });
  await env.flows.create({ id: FLOW_ID, name: "Assertion flow", version: 1, nodes: Object.values(STEPS), edges: [] } as never).catch(() => undefined);
  return { env, store: env.store as CountingStore, candidates: new VisualAssertionCandidates() };
}

async function freshLab(variant = "baseline", viewport = { width: 800, height: 600 }): Promise<Page> {
  const page = await browser!.newPage({ viewport });
  await page.goto(LAB);
  await page.getByTestId("va-card").waitFor();
  if (variant !== "baseline") await setVariant(page, variant);
  return page;
}

const setVariant = (page: Page, variant: string) =>
  page.evaluate((v) => (window as unknown as { __assertionLab: { setVariant(n: string): void } }).__assertionLab.setVariant(v), variant);

interface Harness {
  records: VisualAssertionRecord[];
  loads: { count: number };
  captures: { count: number };
  run: (step: FlowStep) => Promise<StepExecutionResult>;
}

interface HarnessOptions {
  appMode?: VisualAssertionAppMode;
  flag?: VisualAssertionFlag;
  handedOff?: boolean;
  probe?: VisualAssertionProbe;
  /** No runtime wired at all (the executor's own default). */
  unwired?: boolean;
  /** Replace the adapter loader (J: a slow or hanging load, or a hanging assessment). */
  assessor?: () => Promise<VisualAssertionAssessor | undefined>;
  /** Delay the step's page resolution (J: a popup alias that waits on popup identity). */
  pageDelayMs?: number;
  /** The run's authenticated initiator; `null` runs unattributed (K). */
  initiator?: VisualAssertionRunInitiator | null;
}

const RUNNER: VisualAssertionRunInitiator = { userId: "user-runner-1", username: "runner.one" };

function harness(page: Page, w: World, options: HarnessOptions = {}): Harness {
  const context: InstanceExecutionContext = {
    executionId: `exec-${(executionSeq += 1)}`,
    instanceId: "inst-1",
    scenarioId: "n6-4",
    flowId: FLOW_ID,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: w.env.root, screenshots: join(w.env.root, "evidence"), logs: w.env.root, reports: w.env.root }
  };
  const records: VisualAssertionRecord[] = [];
  const loads = { count: 0 };
  const captures = { count: 0 };
  const initiator = options.initiator === undefined ? RUNNER : options.initiator;
  const adapter = new VisualAssertionStep({
    store: w.store,
    appVersion: APP_VERSION,
    candidates: w.candidates,
    ...(initiator ? { initiator } : {}),
    probe: {
      ...options.probe,
      onCapture: () => {
        captures.count += 1;
        options.probe?.onCapture?.();
      }
    }
  });
  const stepExecutor = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(context), context, new ManualHandoffController());
  if (!options.unwired) {
    stepExecutor.setVisualAssertion({
      appMode: options.appMode ?? "dev",
      flag: options.flag ?? "observe",
      renderMode: "headless",
      assessor: async () => {
        loads.count += 1;
        return options.assessor ? options.assessor() : adapter;
      },
      handedOff: () => options.handedOff === true,
      onRecord: (record) => records.push(record)
    });
  }
  if (options.pageDelayMs !== undefined) {
    // The executor's own page resolution, held: it stands in for a popup alias waiting on popup identity.
    const executor = stepExecutor as unknown as { resolveStepPage(step: FlowStep): Promise<Page> };
    const original = executor.resolveStepPage.bind(executor);
    executor.resolveStepPage = async (step) => {
      await new Promise((r) => setTimeout(r, options.pageDelayMs));
      return original(step);
    };
  }
  const flowExecutor = new FlowExecutor(stepExecutor, undefined, undefined, undefined, false);
  return {
    records,
    loads,
    captures,
    run: (step) => (flowExecutor as unknown as { executeWithRetry(s: FlowStep, c: InstanceExecutionContext): Promise<StepExecutionResult> }).executeWithRetry(step, context)
  };
}

const harnessAdapter = (w: World): VisualAssertionAssessor => new VisualAssertionStep({ store: w.store, appVersion: APP_VERSION, candidates: w.candidates, initiator: RUNNER });

/** Run one step on a fresh lab page; returns its result and single record. */
async function assertOnce(
  w: World,
  step: FlowStep,
  options: HarnessOptions & { variant?: string; viewport?: { width: number; height: number }; setup?: (page: Page) => Promise<void> } = {}
): Promise<{ result: StepExecutionResult; record: VisualAssertionRecord | undefined; h: Harness; page: Page }> {
  const page = await freshLab(options.variant, options.viewport);
  await options.setup?.(page);
  const h = harness(page, w, options);
  const result = await h.run(step);
  await page.close();
  return { result, record: h.records[0], h, page };
}

/** Approve the newest candidate for a step, exactly as N6.5 will (bound fields, consumed once). */
async function approveLatest(w: World, stepId: string): Promise<boolean> {
  const summary = w.candidates.summaries().filter((c) => c.stepId === stepId).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!summary) return false;
  const c = w.candidates.take(summary.candidateId);
  if (!c) return false;
  const r = await w.store.approveUnchecked({
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
    approver: "author-1",
    runUser: c.initiator.userId,
    runId: c.executionId,
    appVersion: APP_VERSION
  });
  return r.ok;
}

let browserVersion = "";
const grantEnvironment = (): VisualGrantEnvironment => ({
  browserVersion,
  appVersion: APP_VERSION,
  osBuild: visualAssertionOsBuild(),
  capturePolicy: VISUAL_ASSERTION_CAPTURE_POLICY,
  fingerprintVersion: VISUAL_FINGERPRINT_VERSION,
  assertionPolicyVersion: 1,
  calibrationSuiteVersion: VISUAL_CALIBRATION_SUITE_VERSION
});
const CELL: VisualGrantCell = { renderMode: "headless", devicePixelRatio: 1 };

const describe = (r: StepExecutionResult, rec?: VisualAssertionRecord): string =>
  `${r.status} attempts=${r.attemptCount} ${rec ? `${rec.status}/${rec.failureClass ?? "-"}/${rec.code} verdict=${rec.verdict ?? "-"}:${rec.verdictCode ?? "-"} cand=${rec.candidate}` : "no record"} ${r.error ?? ""}`;

function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(path);
    }
  };
  walk(root);
  return out;
}

async function main(): Promise<void> {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  try {
    for (let attempt = 0; attempt < 80 && !(await fetch(LAB).then((r) => r.ok, () => false)); attempt += 1) await new Promise((r) => setTimeout(r, 100));
    browser = await chromium.launch();
    browserVersion = browser.version();

    // ── M. The matrix through the executor ─────────────────────────────────────────────────────
    console.log("M. Flag x step mode x build, through the real executor");
    {
      const w = await world("dev");
      for (const appMode of ["dev", "packaged"] as const) {
        const o = await assertOnce(w, STEPS.observe, { appMode, flag: "off" });
        check(`[${appMode}] flag off: an observe step passes 'disabled' and nothing is loaded or captured`, o.result.status === "passed" && o.record?.code === "disabled" && o.h.loads.count === 0 && o.h.captures.count === 0, describe(o.result, o.record));
        const e = await assertOnce(w, STEPS.enforce, { appMode, flag: "off" });
        const expected = appMode === "packaged" ? "enforce-unavailable-in-production" : "disabled";
        check(
          `[${appMode}] flag off: an enforce step fails visual-unverified/${expected}, nothing loaded or captured`,
          e.result.status === "failed" && e.record?.failureClass === "visual-unverified" && e.record.code === expected && e.h.loads.count === 0 && e.h.captures.count === 0 && (e.result.error ?? "").includes(`visual-unverified/${expected}`),
          describe(e.result, e.record)
        );
      }
      const unwiredObserve = await assertOnce(w, STEPS.observe, { unwired: true });
      const unwiredEnforce = await assertOnce(w, STEPS.enforce, { unwired: true });
      check(
        "an executor with no visual assertion runtime decides as the packaged build with the flag off",
        unwiredObserve.result.status === "passed" && unwiredEnforce.result.status === "failed" && (unwiredEnforce.result.error ?? "").includes("enforce-unavailable-in-production"),
        `${describe(unwiredObserve.result)} | ${describe(unwiredEnforce.result)}`
      );
    }
    {
      const packaged = await world("packaged");
      for (const flag of ["observe", "enforce"] as const) {
        const before = packaged.store.grantReads;
        const e = await assertOnce(packaged, STEPS.enforce, { appMode: "packaged", flag });
        check(
          `[packaged] flag ${flag}: an enforce step fails visual-unverified/enforce-unavailable-in-production and no grant is read`,
          e.result.status === "failed" && e.record?.failureClass === "visual-unverified" && e.record.code === "enforce-unavailable-in-production" && packaged.store.grantReads === before,
          `${describe(e.result, e.record)} grantReads=${packaged.store.grantReads - before}`
        );
        const o = await assertOnce(packaged, STEPS.observe, { appMode: "packaged", flag });
        check(
          `[packaged] flag ${flag}: an observe step is evaluated (observe-only) and passes with the policy's code`,
          o.result.status === "passed" && o.record?.verdict === "inconclusive" && o.record.code === "no-baseline" && o.h.captures.count === 1,
          describe(o.result, o.record)
        );
      }
    }
    {
      const w = await world("dev");
      const notEnabled = await assertOnce(w, STEPS.enforce, { flag: "observe" });
      check(
        "[dev] flag observe: an enforce step fails visual-unverified/enforce-not-enabled without reading a grant",
        notEnabled.result.status === "failed" && notEnabled.record?.code === "enforce-not-enabled" && w.store.grantReads === 0,
        describe(notEnabled.result, notEnabled.record)
      );
      const unqualified = await assertOnce(w, STEPS.enforce, { flag: "enforce" });
      check(
        "[dev] flag enforce, no grant: an enforce step fails visual-unverified/cell-not-qualified (the grant was read)",
        unqualified.result.status === "failed" && unqualified.record?.failureClass === "visual-unverified" && unqualified.record.code === "cell-not-qualified" && w.store.grantReads === 1,
        describe(unqualified.result, unqualified.record)
      );
    }

    // ── B. Baselines ───────────────────────────────────────────────────────────────────────────
    console.log("\nB. Baselines, candidates and outcomes");
    const w = await world("dev");
    {
      const first = await assertOnce(w, STEPS.observe);
      check(
        "a first run passes observe with no-baseline and makes one pending candidate",
        first.result.status === "passed" && first.record?.verdictCode === "no-baseline" && first.record.candidate === true && w.candidates.size() === 1,
        describe(first.result, first.record)
      );
      check("the candidate's approval succeeds (bound epoch, content and key generation)", await approveLatest(w, STEPS.observe.id));
      const again = await assertOnce(w, STEPS.observe);
      check(
        "the approved card is identical-to-baseline and makes no candidate",
        again.record?.verdict === "passed" && again.record.verdictCode === "identical-to-baseline" && again.record.candidate === false,
        describe(again.result, again.record)
      );
      for (const [variant, code, verdict] of [
        ["restyle", "differs-from-baseline", "failed"],
        ["text", "differs-from-baseline", "failed"],
        ["swap", "differs-from-baseline", "failed"],
        ["size", "size-differs-from-baseline", "failed"],
        ["move", "position-changed", "inconclusive"]
      ] as const) {
        const r = await assertOnce(w, STEPS.observe, { variant });
        check(
          `${variant}: observe records ${verdict}/${code} and the observe step still passes`,
          r.result.status === "passed" && r.record?.verdict === verdict && r.record.verdictCode === code && r.record.candidate === false,
          describe(r.result, r.record)
        );
      }
      const wider = await assertOnce(w, STEPS.observe, { viewport: { width: 900, height: 600 } });
      check(
        "another viewport is baseline-other-conditions and makes a candidate for those conditions",
        wider.record?.verdictCode === "baseline-other-conditions" && wider.record.candidate === true,
        describe(wider.result, wider.record)
      );
      const clipped = await assertOnce(w, STEPS.clipped);
      check("a target across the fold is target-clipped and never a candidate", clipped.record?.verdictCode === "target-clipped" && clipped.record.candidate === false, describe(clipped.result, clipped.record));
    }
    {
      // Enforce with a valid verifier grant: the policy decides, and only a proven difference is a mismatch.
      const enforceWorld = await world("dev");
      await assertOnce(enforceWorld, STEPS.enforce, { flag: "observe" });
      check("[enforce] the enforce step's baseline is approved", await approveLatest(enforceWorld, STEPS.enforce.id));
      const issued = await enforceWorld.store.issueGrantUnchecked({ cell: CELL, environment: grantEnvironment(), evidenceDigest: "a".repeat(64), issuedAt: new Date(Date.now() - 1000) });
      check("[enforce] a verifier grant is issued for the headless DPR 1 cell", issued.ok, JSON.stringify(issued));
      const pass = await assertOnce(enforceWorld, STEPS.enforce, { flag: "enforce" });
      check("[enforce] identical with a valid grant passes", pass.result.status === "passed" && pass.record?.code === "identical-to-baseline", describe(pass.result, pass.record));
      const mismatch = await assertOnce(enforceWorld, STEPS.enforce, { flag: "enforce", variant: "restyle" });
      check(
        "[enforce] a restyle fails visual-mismatch/differs-from-baseline, as an ordinary step error, attempted once despite retry.count 2",
        mismatch.result.status === "failed" &&
          mismatch.record?.failureClass === "visual-mismatch" &&
          mismatch.record.code === "differs-from-baseline" &&
          mismatch.result.attemptCount === 1 &&
          (mismatch.result.error ?? "").includes("visual-mismatch/differs-from-baseline"),
        describe(mismatch.result, mismatch.record)
      );
      const size = await assertOnce(enforceWorld, STEPS.enforce, { flag: "enforce", variant: "size" });
      check("[enforce] a wider box fails visual-mismatch/size-differs-from-baseline", size.record?.failureClass === "visual-mismatch" && size.record.code === "size-differs-from-baseline", describe(size.result, size.record));
      const moved = await assertOnce(enforceWorld, STEPS.enforce, { flag: "enforce", variant: "move" });
      check(
        "[enforce] a move is never a mismatch: it fails visual-unverified/position-changed, attempted once",
        moved.result.status === "failed" && moved.record?.failureClass === "visual-unverified" && moved.record.code === "position-changed" && moved.result.attemptCount === 1,
        describe(moved.result, moved.record)
      );
      const decision = new RetryPolicy().decide({ step: STEPS.enforce as never, error: "Visual assertion failed (visual-mismatch/differs-from-baseline)", attempt: 0 });
      check(
        "[enforce] the retry policy refuses assertVisual by type (VA-2), even with retries and a retryable read-only safety",
        decision.retry === false && decision.reason === "assertVisual is non-retryable (VA-2)",
        decision.reason
      );
      const control = new RetryPolicy().decide({ step: { ...(STEPS.enforce as object), type: "assertVisible" } as never, error: "Element is not visible.", attempt: 0 });
      check("CONTROL: the same configuration on another assertion step is retried", control.retry === true, control.reason);
    }
    {
      const keyless = await world("dev");
      await assertOnce(keyless, STEPS.observe);
      await approveLatest(keyless, STEPS.observe.id);
      keyless.env.protector.state.available = false;
      const r = await assertOnce(keyless, STEPS.observe);
      check(
        "an unavailable keystore is integrity-unavailable and makes no candidate",
        r.record?.verdictCode === "integrity-unavailable" && r.record.candidate === false && keyless.candidates.size() === 0,
        describe(r.result, r.record)
      );
    }

    // ── C. Refusals that capture nothing ───────────────────────────────────────────────────────
    console.log("\nC. Refusals before any capture");
    {
      const r = await world("dev");
      const cases: Array<[string, FlowStep, string, HarnessOptions & { setup?: (page: Page) => Promise<void> }]> = [
        ["a handed-off page", STEPS.observe, "handoff-active", { handedOff: true }],
        [
          "a protected sign-in surface",
          STEPS.observe,
          "protected-surface",
          { setup: (page) => page.evaluate(() => (window as unknown as { __assertionLab: { injectProtected(): void } }).__assertionLab.injectProtected()) }
        ],
        ["a card-number field", STEPS.sensitive, "sensitive-step", {}],
        // N6.8 security finding 1: a container is refused when any field inside it is sensitive by name, id or label.
        ["a wrapper around a name=cvv field with no autocomplete", STEPS.sensitiveWrapper, "sensitive-step", {}],
        ["a wrapper whose open shadow root holds an id=otp field", STEPS.sensitiveShadow, "sensitive-step", {}],
        ["a wrapper whose field is named only by its label text (CVV)", STEPS.sensitiveLabel, "sensitive-step", {}],
        [
          "a wrapper around an embedded frame (a hosted card field)",
          STEPS.sensitiveFrame,
          "sensitive-step",
          { setup: (page) => page.evaluate(() => (window as unknown as { __assertionLab: { injectFrameField(): void } }).__assertionLab.injectFrameField()) }
        ],
        ["a wrapper whose field is named only card_cvv2", STEPS.sensitiveSnake, "sensitive-step", {}],
        ["two matches", STEPS.dupe, "target-not-unique", {}],
        ["no match", STEPS.missing, "target-not-found", {}],
        ["a hidden target", STEPS.hidden, "target-hidden", {}]
      ];
      for (const [label, step, code, options] of cases) {
        const o = await assertOnce(r, step, options);
        check(`${label}: inconclusive/${code}, zero captures, no candidate`, o.record?.verdictCode === code && o.h.captures.count === 0 && o.record.candidate === false, describe(o.result, o.record));
      }
      const off = await assertOnce(r, STEPS.offscreen);
      check("a target below the fold: N0 refuses it target-offscreen, no candidate", off.record?.verdictCode === "target-offscreen" && off.record.candidate === false, describe(off.result, off.record));
      check("no refusal left a candidate", r.candidates.size() === 0, String(r.candidates.size()));
      const enforcedRefusal = await assertOnce(r, { ...STEPS.observe, mode: "enforce" } as FlowStep, { flag: "enforce", handedOff: true });
      check("an enforce step on a handed-off page fails visual-unverified (never a mismatch)", enforcedRefusal.record?.failureClass === "visual-unverified", describe(enforcedRefusal.result, enforcedRefusal.record));
    }

    // ── I. Interaction state ───────────────────────────────────────────────────────────────────
    console.log("\nI. Interaction state is read, never changed");
    {
      const iw = await world("dev");
      await assertOnce(iw, STEPS.button);
      check("the button's baseline is approved", await approveLatest(iw, STEPS.button.id));
      const same = await assertOnce(iw, STEPS.button);
      check("an untouched button is identical", same.record?.verdictCode === "identical-to-baseline", describe(same.result, same.record));
      for (const [label, act] of [
        ["hovered", (page: Page) => page.getByTestId("va-button").hover()],
        ["focused", (page: Page) => page.getByTestId("va-button").focus()]
      ] as const) {
        const o = await assertOnce(iw, STEPS.button, {
          setup: async (page) => {
            await act(page);
          }
        });
        check(`a ${label} button is inconclusive/interaction-state-changed`, o.record?.verdictCode === "interaction-state-changed", describe(o.result, o.record));
      }
      const page = await freshLab();
      await page.getByTestId("va-button").focus();
      const h = harness(page, iw);
      await h.run(STEPS.button);
      const stillFocused = await page.getByTestId("va-button").evaluate((n) => document.activeElement === n);
      const scroll = await page.evaluate(() => [window.scrollX, window.scrollY].join(","));
      check("the step leaves focus where it was and does not scroll", stillFocused && scroll === "0,0", `focused=${stillFocused} scroll=${scroll}`);
      await page.close();
    }

    // ── D. VA-15 stillness ─────────────────────────────────────────────────────────────────────
    console.log("\nD. VA-15 capture policy");
    {
      const dw = await world("dev");
      await assertOnce(dw, STEPS.animated);
      check("the animated card's baseline is approved", await approveLatest(dw, STEPS.animated.id));
      let identical = 0;
      for (let run = 0; run < 3; run += 1) {
        const o = await assertOnce(dw, STEPS.animated);
        if (o.record?.verdictCode === "identical-to-baseline") identical += 1;
      }
      check("an infinitely animated card is identical in 3 of 3 later runs (animations disabled, caret hidden)", identical === 3, `${identical}/3`);
      const page = await freshLab();
      const digest = async (stillness: boolean) => {
        const shot = await captureElement(page, page.getByTestId("va-animated"), { contextPaddingCss: 0, stillness, timeoutMs: 5000 });
        if (!shot.ok) return `fail:${shot.code}`;
        const fp = fingerprintVisualImage(shot.value.element.image);
        return fp.ok ? fp.value.contentDigest : `fail:${fp.code}`;
      };
      let differed = false;
      for (let tries = 0; tries < 5 && !differed; tries += 1) {
        const a = await digest(false);
        await page.waitForTimeout(130);
        differed = a !== (await digest(false));
      }
      const still = [await digest(true), await digest(true)];
      check("CONTROL: the same card captured without the policy changes between captures", differed);
      check("the same card captured with the policy does not", still[0] === still[1] && !still[0].startsWith("fail"), still.join(" "));
      await page.close();
    }

    // ── E. Deadline, cancellation, closed page ─────────────────────────────────────────────────
    console.log("\nE. Deadline, cancellation and a closed page");
    {
      const ew = await world("dev");
      const held = (stage: "before-capture" | "after-capture"): VisualAssertionProbe => ({
        hold: async (at) => {
          if (at === stage) await new Promise((r) => setTimeout(r, VISUAL_ASSERTION_DEADLINE_MS + 600));
        }
      });
      const started = Date.now();
      const before = await assertOnce(ew, STEPS.observe, { probe: held("before-capture") });
      const ms = Date.now() - started;
      check(
        "held before the capture: budget-exhausted within the deadline, zero captures, no candidate",
        before.record?.verdictCode === "budget-exhausted" && before.h.captures.count === 0 && before.record.candidate === false && (before.record.durationMs ?? 9999) <= VISUAL_ASSERTION_DEADLINE_MS + 250,
        `${describe(before.result, before.record)} wall=${ms}ms`
      );
      const after = await assertOnce(ew, STEPS.observe, { probe: held("after-capture") });
      await new Promise((r) => setTimeout(r, 1200));
      check(
        "held after the capture: budget-exhausted, and the late work never adds a candidate",
        after.record?.verdictCode === "budget-exhausted" && after.record.candidate === false && ew.candidates.size() === 0,
        `${describe(after.result, after.record)} candidates=${ew.candidates.size()}`
      );
      const page = await freshLab();
      const adapter = new VisualAssertionStep({ store: ew.store, appVersion: APP_VERSION, candidates: ew.candidates });
      const controller = new AbortController();
      controller.abort();
      const request = {
        step: STEPS.observe,
        flowId: FLOW_ID,
        executionId: "exec-cancel",
        instanceId: "inst-1",
        page,
        target: async () => page.getByTestId("va-card"),
        handedOff: false,
        renderMode: "headless" as const,
        readGrant: false,
        deadlineMs: VISUAL_ASSERTION_DEADLINE_MS,
        limitScreenshot: <T,>(work: () => Promise<T>) => work()
      };
      const cancelled = await adapter.assess({ ...request, signal: controller.signal });
      check("a cancelled run is inconclusive/cancelled with no candidate", cancelled.code === "cancelled" && !cancelled.candidateId, JSON.stringify(cancelled));
      const closing = new VisualAssertionStep({
        store: ew.store,
        appVersion: APP_VERSION,
        candidates: ew.candidates,
        probe: { hold: async (at) => (at === "before-capture" ? void (await page.close()) : undefined) }
      });
      const closed = await closing.assess(request);
      check("a page closed before the capture is inconclusive/page-closed with no candidate", closed.code === "page-closed" && !closed.candidateId, JSON.stringify(closed));
    }

    // ── J. One deadline for the whole step ─────────────────────────────────────────────────────
    console.log("\nJ. The executor's whole-step deadline, an unresolvable page and the failure class");
    {
      const jw = await world("dev");
      const timed = async (step: FlowStep, options: Parameters<typeof assertOnce>[2]) => {
        const started = Date.now();
        const o = await assertOnce(jw, step, options);
        return { ...o, ms: Date.now() - started };
      };
      const BOUND = VISUAL_ASSERTION_DEADLINE_MS + 400;
      const never = () => new Promise<never>(() => undefined);
      const slowLoad = () => new Promise<VisualAssertionAssessor | undefined>((resolve) => setTimeout(() => resolve(undefined), VISUAL_ASSERTION_DEADLINE_MS + 1500));
      const hangingAssess = async (): Promise<VisualAssertionAssessor> => ({ assess: never });
      const cases: Array<[string, HarnessOptions]> = [
        ["an adapter load that outlives the deadline", { assessor: slowLoad }],
        ["a page resolution that outlives the deadline", { pageDelayMs: VISUAL_ASSERTION_DEADLINE_MS + 1500 }],
        ["a load and a page resolution that together outlive it", { assessor: () => new Promise((r) => setTimeout(() => r(undefined as never), 1200)).then(() => harnessAdapter(jw)), pageDelayMs: 1200 }],
        ["an assessment that never settles", { assessor: hangingAssess }]
      ];
      for (const [label, options] of cases) {
        const o = await timed(STEPS.observe, options);
        check(
          `observe, ${label}: passes inconclusive/budget-exhausted within the step deadline`,
          o.result.status === "passed" && o.record?.verdictCode === "budget-exhausted" && o.ms <= BOUND + 600,
          `${describe(o.result, o.record)} wall=${o.ms}ms`
        );
        const e = await timed(STEPS.enforce, { ...options, flag: "enforce" });
        check(
          `enforce, ${label}: fails visual-unverified/budget-exhausted (not cell-not-qualified), attempted once despite retries`,
          e.result.status === "failed" &&
            e.record?.failureClass === "visual-unverified" &&
            e.record.code === "budget-exhausted" &&
            e.result.attemptCount === 1 &&
            (e.result.error ?? "").startsWith("Visual assertion unverified (visual-unverified/budget-exhausted)"),
          `${describe(e.result, e.record)} wall=${e.ms}ms`
        );
      }
      const alias = { pageAlias: "popup-that-never-opened" };
      const observeAlias = await timed({ ...STEPS.observe, ...alias } as FlowStep, {});
      check(
        "observe, an unresolvable page alias: passes inconclusive/capture-unavailable instead of failing with a page error",
        observeAlias.result.status === "passed" && observeAlias.record?.verdictCode === "capture-unavailable" && observeAlias.h.captures.count === 0,
        describe(observeAlias.result, observeAlias.record)
      );
      const enforceAlias = await timed({ ...STEPS.enforce, ...alias, onFailure: { action: "continue", screenshot: false } } as FlowStep, { flag: "enforce" });
      check(
        "enforce, an unresolvable page alias: fails visual-unverified/capture-unavailable, once, with its onFailure policy kept",
        enforceAlias.result.status === "failed" &&
          enforceAlias.record?.failureClass === "visual-unverified" &&
          enforceAlias.record.code === "capture-unavailable" &&
          enforceAlias.result.attemptCount === 1 &&
          enforceAlias.result.failurePolicy === "continue" &&
          !(enforceAlias.result.error ?? "").includes("popup-that-never-opened"),
        describe(enforceAlias.result, enforceAlias.record)
      );
      const failingLoad = await timed(STEPS.enforce, { flag: "enforce", assessor: () => Promise.reject(new Error("load failed")) });
      check(
        "enforce, an adapter that fails to load: fails visual-unverified/evaluation-unavailable, once",
        failingLoad.result.status === "failed" && failingLoad.record?.code === "evaluation-unavailable" && failingLoad.result.attemptCount === 1,
        describe(failingLoad.result, failingLoad.record)
      );
      const mismatchPolicy = await timed({ ...STEPS.enforce, onFailure: { action: "goToFailureEdge", screenshot: false } } as FlowStep, { flag: "enforce" });
      check(
        "the step's own onFailure action is reported unchanged on a visual failure",
        mismatchPolicy.result.status === "failed" && mismatchPolicy.result.failurePolicy === "goToFailureEdge",
        describe(mismatchPolicy.result, mismatchPolicy.record)
      );
    }

    // ── F. Neutrality ──────────────────────────────────────────────────────────────────────────
    console.log("\nF. Flows without assertVisual are unchanged");
    {
      const fw = await world("dev");
      const plain: FlowStep[] = [
        { id: "p-visible", name: "Card visible", type: "assertVisible", locator: at("va-card") } as unknown as FlowStep,
        { id: "p-click", name: "Continue", type: "click", locator: at("va-button") } as unknown as FlowStep,
        { id: "p-missing", name: "Missing", type: "click", locator: at("va-nowhere"), timeoutMs: 300 } as unknown as FlowStep
      ];
      const outcomes = async (options: HarnessOptions) => {
        const page = await freshLab();
        const h = harness(page, fw, options);
        const results = [];
        for (const step of plain) results.push(await h.run(step));
        await page.close();
        return { shape: results.map((r) => `${r.stepId}:${r.status}:${r.attemptCount}:${(r.error ?? "").split("\n")[0]}`), loads: h.loads.count, records: h.records.length };
      };
      const off = await outcomes({ unwired: true });
      const on = await outcomes({ flag: "enforce" });
      check("the same steps give the same status, attempts and first error line with the feature unwired and at enforce", JSON.stringify(off.shape) === JSON.stringify(on.shape), `${off.shape.join(" | ")} vs ${on.shape.join(" | ")}`);
      check("a flow without assertVisual never loads the adapter or records anything", on.loads === 0 && on.records === 0);
    }

    // ── G. Candidates ──────────────────────────────────────────────────────────────────────────
    console.log("\nG. Candidates are memory only and single use");
    {
      const gw = await world("dev");
      await assertOnce(gw, STEPS.observe);
      const [summary] = gw.candidates.summaries();
      check("a candidate exists and its renderer view has exactly the safe fields", !!summary && JSON.stringify(Object.keys(summary).sort()) === JSON.stringify(["candidateId", "createdAt", "expiresAt", "flowId", "mode", "reason", "stepId"]));
      const full = summary ? gw.candidates.peek(summary.candidateId) : undefined;
      check(
        "the candidate is frozen and bound (epoch, step digest, key generation 0 before the first key, the run's authenticated initiator)",
        !!full &&
          Object.isFrozen(full) &&
          Object.isFrozen(full.initiator) &&
          /^[0-9a-f]{32}$/.test(full.epoch) &&
          /^[0-9a-f]{64}$/.test(full.stepContentDigest) &&
          full.keyGeneration === 0 &&
          full.initiator.userId === RUNNER.userId &&
          full.initiator.username === RUNNER.username
      );
      const digestHex = full?.contentDigest.replace(/^sha256:/, "") ?? "missing";
      const leaked = filesUnder(gw.env.root).filter((file) => readFileSync(file).includes(digestHex) || readFileSync(file).includes(full?.stepContentDigest ?? "missing"));
      check("no file on disk holds the candidate's content digest or step digest (memory only)", leaked.length === 0, leaked.join(", "));
      const taken = summary ? gw.candidates.take(summary.candidateId) : undefined;
      check("take consumes it once: a second take finds nothing", !!taken && (summary ? gw.candidates.take(summary.candidateId) : 1) === undefined);
    }

    // ── K. Run-user provenance ─────────────────────────────────────────────────────────────────
    console.log("\nK. A candidate needs the run's authenticated initiator");
    {
      const kw = await world("dev");
      const unattributed = await assertOnce(kw, STEPS.observe, { initiator: null });
      check(
        "a run with no authenticated initiator makes no candidate and says why (run-unattributed), the step still observes",
        unattributed.result.status === "passed" &&
          unattributed.record?.verdictCode === "no-baseline" &&
          unattributed.record.candidate === false &&
          unattributed.record.candidateWithheld === "run-unattributed" &&
          kw.candidates.size() === 0,
        describe(unattributed.result, unattributed.record)
      );
      const attributed = await assertOnce(kw, STEPS.observe);
      check(
        "the same run with an initiator makes one candidate and no withheld reason",
        attributed.record?.candidate === true && attributed.record.candidateWithheld === undefined && kw.candidates.size() === 1
      );
      const refused = await assertOnce(kw, STEPS.dupe, { initiator: null });
      check("an ineligible refusal reports no withheld candidate (nothing was eligible)", refused.record?.candidateWithheld === undefined);
      // VA-13 / I1: the epoch is bound before the capture, so an identical re-import while the capture runs makes the
      // candidate stale: it can never be approved against the re-imported flow.
      const rw = await world("dev");
      let reimported = false;
      await assertOnce(rw, STEPS.observe, {
        probe: {
          hold: async (at) => {
            if (at !== "before-capture" || reimported) return;
            reimported = true;
            const current = await rw.env.flows.get(FLOW_ID);
            if (current) await rw.env.flows.import(current);
          }
        }
      });
      const staleOk = await approveLatest(rw, STEPS.observe.id);
      check("a candidate whose capture overlapped an identical re-import is refused (stale epoch)", reimported && !staleOk);
      await assertOnce(rw, STEPS.observe);
      check("CONTROL: a capture after the re-import is approved", await approveLatest(rw, STEPS.observe.id));
      const sources = ["src/runner/visualAssertion/VisualAssertionStep.ts", "src/runner/visualAssertion/visualAssertionCandidates.ts", "src/runner/ExecutionEngine.ts"].map((f) => readFileSync(f, "utf8"));
      check("no runtime source substitutes an unattributed or placeholder run user", sources.every((text) => !/"unattributed"/.test(text)));
      const ipc = readFileSync("app/main/ipc/execution.ipc.ts", "utf8");
      check(
        "the run and repeat channels bind the initiator from the actor their own permission check returned",
        /initiator = runInitiatorOf\(actor\)/.test(ipc) &&
          /runWorkflow\(request, browserLaunchSnapshot, initiator\)/.test(ipc) &&
          /const repeater = await assertSenderPermission\(event, Permission\.WORKFLOW_EXECUTE\)/.test(ipc) &&
          /repeatInstance\(instanceId, runInitiatorOf\(repeater\)\)/.test(ipc) &&
          !/request\.(initiator|runUser|userId)/.test(ipc)
      );
    }

    // ── H. Enablement pins ─────────────────────────────────────────────────────────────────────
    console.log("\nH. Enablement");
    check("AWKIT_VISUAL_ASSERTIONS defaults to off", visualAssertionFlag({}) === "off");
    check("only the exact values observe and enforce enable it", visualAssertionFlag({ AWKIT_VISUAL_ASSERTIONS: "observe" }) === "observe" && visualAssertionFlag({ AWKIT_VISUAL_ASSERTIONS: "enforce" }) === "enforce" && visualAssertionFlag({ AWKIT_VISUAL_ASSERTIONS: "ENFORCE" }) === "off" && visualAssertionFlag({ AWKIT_VISUAL_ASSERTIONS: "on" }) === "off");
    {
      const flowWith = (node: Record<string, unknown>) =>
        ({
          id: "v",
          name: "V",
          version: 1,
          nodes: [
            { id: "start", type: "start", name: "Start" },
            { id: "a", name: "A", locator: at("va-card"), ...node },
            { id: "end", type: "end", name: "End" }
          ],
          edges: [
            { id: "e1", source: "start", target: "a" },
            { id: "e2", source: "a", target: "end" }
          ]
        }) as never;
      const codes = (node: Record<string, unknown>) => validateFlowDefinition(flowWith(node)).issues.filter((i) => i.nodeId === "a").map((i) => i.code);
      check("the validator accepts assertVisual with no mode, observe or enforce", ["observe", "enforce", undefined].every((mode) => codes({ type: "assertVisual", ...(mode ? { mode } : {}) }).length === 0));
      check("the validator refuses an unknown assertVisual mode", codes({ type: "assertVisual", mode: "strict" }).includes("unsupportedConfiguration"));
      check("the validator refuses an assertVisual with no locator", codes({ type: "assertVisual", locator: undefined }).includes("missingRequiredLocator"));
      // Even a campaign that weights it explicitly and opts into its gate cannot generate one.
      const campaign = resolveConstraints({ seed: "n6-4", nodeTypeWeights: { assertVisual: 50 }, allowedGates: ["neverGenerated"] });
      check(
        "the random Test Lab never generates assertVisual, even weighted and gate-opted, and reports it blocked",
        NODE_CATALOG.assertVisual.gate === "neverGenerated" &&
          !actionNodeWeights(campaign).some((w) => w.value === "assertVisual") &&
          blockedNodeTypes(campaign).some((b) => b.type === "assertVisual")
      );
    }
    const runnerText = readFileSync("src/runner/PlaywrightRunner.ts", "utf8");
    check("the runner loads the adapter lazily, only through a dynamic import", /import\("\.\/visualAssertion\/VisualAssertionStep"\)/.test(runnerText) && !/^import \{[^}]*VisualAssertionStep\b[^}]*\} from/m.test(runnerText));
    const engineText = readFileSync("src/runner/ExecutionEngine.ts", "utf8");
    check("the engine wires every run's visual assertions from the flag and the injected services", /visualAssertions: this\.visualAssertionOptions\(this\.instanceInitiators\.get\(instance\.instanceId\), \(record\) =>/.test(engineText) && /flag: visualAssertionFlag\(\)/.test(engineText));
    const ipcText = readFileSync("app/main/ipc/execution.ipc.ts", "utf8");
    check("the main process injects the safeStorage-backed services", /setVisualAssertionServices\(visualAssertionServices\(\)\)/.test(ipcText) && readFileSync("app/main/visualAssertion/visualAssertionServices.ts", "utf8").includes("safeStorageVisualKeyProtector"));
  } finally {
    await browser?.close().catch(() => undefined);
    server.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
