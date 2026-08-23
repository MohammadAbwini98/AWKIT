/**
 * Per-node configuration generation for the Randomized Automation Test Lab.
 *
 * Produces the payload of a `FlowStep` — locator, value, value source, waits, type-specific
 * config — from the safe mock-site fixture pool, deterministically from a seeded stream.
 *
 * ## Why `recorderFidelity` exists
 *
 * A Recorder-produced flow carries strictly more information than the Flow Designer can express:
 * locators on nodes the catalog does not mark `requiresLocator`, popup/window metadata, and
 * secret-backed value *references*. With `recorderFidelity` on, the generator emits those fields
 * so Phase 3 can prove — or disprove — that they survive a save/load round trip.
 *
 * Secrets: a `secret` value source is emitted as `{ type: "secret", secretName }` where
 * `secretName` is an opaque reference from `SafeTestData.SECRET_REFERENCES`. No `value` is ever
 * set alongside it, so no plaintext can reach a fixture, snapshot, diff, log or artifact.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type {
  FlowStep,
  LocatorCandidate,
  NodeConfig,
  StepType,
  ValueSource,
  WaitCondition
} from "../../profiles/FlowProfile";
import {
  MOCK_PAGES,
  SAFE_EMAIL_VALUES,
  SAFE_ENV_KEYS,
  SAFE_INSTANCE_VARIABLES,
  SAFE_OUTPUT_KEYS,
  SAFE_RUNTIME_INPUT_KEYS,
  SAFE_TEXT_VALUES,
  SAFE_UPLOAD_FIXTURE,
  SECRET_REFERENCES,
  type MockPageFixture
} from "../fixtures/SafeTestData";
import type { CoverageTracker } from "./CoverageTracker";
import type { ResolvedGenerationConstraints } from "./GenerationConstraints";
import { nodeSpec } from "./NodeCatalog";
import type { SeededRandom } from "./SeededRandom";

/** Everything a generated `FlowStep` carries besides its identity and graph position. */
export type StepPayload = Omit<FlowStep, "id" | "name" | "position" | "next">;

export interface ConfigurationContext {
  readonly constraints: ResolvedGenerationConstraints;
  readonly rng: SeededRandom;
  /** Which mock page this segment of the flow is operating on. */
  readonly page: MockPageFixture;
  /** Flow ids this flow may reference from a `runFlow` node (never itself). */
  readonly referenceableFlowIds: readonly string[];
  readonly coverage?: CoverageTracker;
}

function pickPage(rng: SeededRandom): MockPageFixture {
  return rng.pick(MOCK_PAGES);
}

/**
 * Whether `page` carries a control this step type can actually act on.
 *
 * Types not listed fall back to `assertTargets`, which every page has, so they are supported
 * everywhere. Types that need a specific control (a `<select>`, a radio group, a text input) are
 * only supported on pages that have one — otherwise the generator would emit a locator that
 * resolves to the wrong kind of element and fails much later, during live execution.
 */
function pageSupports(page: MockPageFixture, type: StepType): boolean {
  switch (type) {
    case "select":
      return page.selectTargets.length > 0;
    case "radio":
      return page.radioTargets.length > 0;
    case "check":
    case "uncheck":
      return page.checkTargets.length > 0;
    case "uploadFile":
      return (page.uploadTargets?.length ?? 0) > 0;
    case "downloadFile":
      return (page.downloadTargets?.length ?? 0) > 0;
    case "fill":
      return page.fillTargets.length > 0;
    case "click":
      return page.clickTargets.length > 0;
    default:
      return page.assertTargets.length > 0;
  }
}

/** A page that supports `type`, or `undefined` when the fixture pool has none. */
function pageForType(rng: SeededRandom, type: StepType): MockPageFixture | undefined {
  const candidates = MOCK_PAGES.filter((page) => pageSupports(page, type));
  return candidates.length > 0 ? rng.pick(candidates) : undefined;
}

export { pageForType, pageSupports, pickPage };

/** A locator the mock site can actually resolve, appropriate to what the step does. */
function locatorFor(type: StepType, ctx: ConfigurationContext): LocatorCandidate | undefined {
  const { page, rng } = ctx;
  const pools: Record<string, readonly LocatorCandidate[]> = {
    click: page.clickTargets,
    fill: page.fillTargets,
    check: page.checkTargets,
    uncheck: page.checkTargets,
    readText: page.assertTargets,
    assertText: page.assertTargets,
    assertVisible: page.assertTargets,
  };

  if (type === "uploadFile") {
    const target = page.uploadTargets?.[0];
    return target ? { ...target } : undefined;
  }
  if (type === "downloadFile") {
    const target = page.downloadTargets?.[0];
    return target ? { ...target } : undefined;
  }
  if (type === "select") {
    const target = page.selectTargets[0];
    return target ? { ...target.locator } : undefined;
  }
  if (type === "radio") {
    const target = page.radioTargets[0];
    return target ? { ...target.locator } : undefined;
  }

  const pool = pools[type] ?? page.assertTargets;
  if (pool.length === 0) {
    // Every page has at least one assert target; fall back so a generated step is never locator-less
    // when the catalog says it needs one.
    return page.assertTargets.length > 0 ? { ...(page.assertTargets[0] as LocatorCandidate) } : undefined;
  }
  return { ...rng.pick(pool) };
}

/**
 * A value source. `secret` and `generated` are only emitted under `recorderFidelity`, because both
 * are known-lossy through the designer mapping and would otherwise dominate every round-trip diff.
 */
function valueSourceFor(type: StepType, value: string, ctx: ConfigurationContext): ValueSource | undefined {
  const { rng, constraints, coverage } = ctx;
  // Option A (awkit-9qcz): a `condition` routes ONLY on the literal expression in `step.value`.
  // `FlowExecutor.resolveNext` evaluates it with `evaluateBoolean(step.value ?? "", …)` and never
  // reads `step.valueSource`, so any source attached to a generated condition is inert legacy
  // metadata — never resolved, and never a routing input. A generated condition therefore carries
  // its literal and NO value source. Still consume the same seeded source-generation draws as the
  // former behavior before discarding that source. Otherwise this one-field semantic correction
  // shifts every later choice in a deterministic campaign and makes unrelated nodes change shape.
  const isCondition = type === "condition";
  const kinds: Array<ValueSource["type"]> = ["static", "static", "static", "env", "runtimeInput", "instanceVariable"];
  if (constraints.recorderFidelity) {
    // Preserve the old condition draw pool exactly: it omitted `secret` but included every other
    // fidelity kind. The resulting source is discarded below and is not reported as generated.
    kinds.push(...(isCondition ? [] : (["secret"] as Array<ValueSource["type"]>)), "generated", "flowOutput", "dynamic");
  }
  const kind = rng.pick(kinds);
  if (!isCondition) coverage?.recordGenerated("valueSourceType", kind);

  let source: ValueSource;
  switch (kind) {
    case "env":
      source = { type: "env", envKey: rng.pick(SAFE_ENV_KEYS) };
      break;
    case "runtimeInput":
      source = { type: "runtimeInput", key: rng.pick(SAFE_RUNTIME_INPUT_KEYS) };
      break;
    case "instanceVariable":
      source = { type: "instanceVariable", key: rng.pick(SAFE_INSTANCE_VARIABLES) };
      break;
    case "flowOutput":
      source = { type: "flowOutput", outputKey: rng.pick(SAFE_OUTPUT_KEYS) };
      break;
    case "generated":
      source = { type: "generated", generator: rng.pick(["uuid", "timestamp", "randomEmail", "randomNumber"] as const) };
      break;
    case "dynamic":
      source = {
        type: "dynamic",
        // Mix the discriminators so the "inactive field is still carried" case (RT-13) is exercised,
        // not only the specific/explicit combination in which both ids are active. `dataSourceId`
        // survives even under workflow scope, and `objectId` survives under instanceOrder id mode.
        dataSourceScope: rng.pick(["specific", "workflow"] as const),
        dataSourceId: "lab-data-source-01",
        idMode: rng.pick(["explicit", "instanceOrder"] as const),
        objectId: "lab-object-01",
        keyName: rng.pick(SAFE_TEXT_VALUES)
      };
      break;
    case "secret":
      // Reference only — never a plaintext value, and deliberately no `value` field.
      source = { type: "secret", secretName: rng.pick(SECRET_REFERENCES) };
      break;
    default:
      source = { type: "static", value };
  }
  return isCondition ? undefined : source;
}

/** The literal value a step carries, appropriate to its type and page. */
function valueFor(type: StepType, ctx: ConfigurationContext): string {
  const { rng, page, constraints } = ctx;
  switch (type) {
    case "goto":
      return `${constraints.baseUrl}${page.path}`;
    case "select": {
      const target = page.selectTargets[0];
      return target ? target.option : rng.pick(SAFE_TEXT_VALUES);
    }
    case "radio": {
      const target = page.radioTargets[0];
      return target ? target.value : rng.pick(SAFE_TEXT_VALUES);
    }
    case "fill":
      return rng.bool(0.3) ? rng.pick(SAFE_EMAIL_VALUES) : rng.pick(SAFE_TEXT_VALUES);
    case "uploadFile":
      // Bare filename by design - the live runner rewrites it to a path in the campaign temp dir.
      return SAFE_UPLOAD_FIXTURE.filename;
    case "wait":
      // Bounded low: an unattended campaign must not spend its budget sleeping.
      return String(rng.int(1, 5) * 100);
    case "scroll":
      return String(rng.int(1, 8) * 100);
    case "condition":
      return `outcome === "${rng.pick(["success", "failure"])}"`;
    case "loop":
      return String(rng.int(1, ctx.constraints.maxLoopIterations));
    case "runFlow":
      return ctx.referenceableFlowIds.length > 0 ? rng.pick(ctx.referenceableFlowIds) : "";
    case "assertText":
      return rng.pick(SAFE_TEXT_VALUES);
    default:
      return rng.pick(SAFE_TEXT_VALUES);
  }
}

/** Type-specific `NodeConfig`. Only the fields that type actually uses — no blanket emission. */
function nodeConfigFor(type: StepType, ctx: ConfigurationContext): NodeConfig | undefined {
  const { rng, constraints } = ctx;
  switch (type) {
    case "fill":
      return { clearBeforeFill: rng.bool() };
    case "select":
      return { selectMultiple: false };
    case "wait":
      return { waitType: "time" };
    case "assertText":
      return { assertionType: "text", comparisonOperator: rng.pick(["equals", "contains"] as const), expectedValue: rng.pick(SAFE_TEXT_VALUES) };
    case "assertVisible":
      return { assertionType: "visible" };
    case "screenshot":
      return { screenshotName: `lab-${rng.int(1000, 9999)}`, fullPage: rng.bool(0.3) };
    case "scroll":
      return {
        scrollTarget: rng.pick(["page", "element"] as const),
        scrollDirection: rng.pick(["up", "down"] as const),
        scrollAmount: rng.int(1, 8) * 100
      };
    case "loop": {
      // AWKIT-MAP-003 coverage: a `customFlow` loop is the only shape that exercises
      // `config.targetFlowId` through the designer mapping, so generate one whenever there is a
      // real sibling flow to name. It needs no locator (`LOOP_ACTIONS_NEEDING_A_TARGET` excludes
      // customFlow) but must reference an existing flow to validate clean.
      if (ctx.referenceableFlowIds.length > 0 && rng.bool(0.25)) {
        return {
          loopType: "fixedCount",
          iterationCount: rng.int(1, constraints.maxLoopIterations),
          loopActionType: "customFlow",
          loopStopOnFailure: true,
          maxIterations: constraints.maxLoopIterations,
          targetFlowId: rng.pick(ctx.referenceableFlowIds)
        };
      }
      return {
        loopType: "fixedCount",
        iterationCount: rng.int(1, constraints.maxLoopIterations),
        loopActionType: "click",
        loopStopOnFailure: true,
        maxIterations: constraints.maxLoopIterations
      };
    }
    case "runFlow":
      return {
        // Placeholder only — `buildStepPayload` overwrites this with the SAME target it put on
        // `flowId`, so the two can never disagree. Two independent picks here once generated a
        // step whose `flowId` and `config.targetFlowId` named different flows (Stage 2b defect).
        targetFlowId: "",
        stopParentOnChildFailure: rng.bool(0.7)
      };
    case "routeChange":
      return {
        routeMode: rng.pick(["switchToLatestTab", "navigateCurrentPage"] as const),
        urlMatch: "contains",
        routeWaitUntil: "load"
      };
    default:
      return undefined;
  }
}

/** One or two condition-based waits. Locator-based variants reuse the page's assert targets. */
function waitsFor(ctx: ConfigurationContext): WaitCondition[] {
  const { rng, page, coverage } = ctx;
  const target = page.assertTargets[0];
  const candidates: WaitCondition[] = [
    { type: "domStable", stableForMs: rng.int(1, 3) * 100, timeoutMs: 5_000 },
    { type: "fixedDelay", delayMs: rng.int(1, 3) * 100 }
  ];
  if (target) {
    candidates.push({ type: "elementVisible", locator: { ...target }, timeoutMs: 5_000 });
  }
  const chosen = rng.sample(candidates, rng.int(0, 1));
  for (const wait of chosen) coverage?.recordGenerated("waitConditionType", wait.type);
  return chosen;
}

/**
 * Build the payload for one node.
 *
 * `requiresLocator` / `requiresValue` come from `NodeCatalog`, which mirrors the renderer's
 * `flowNodeCatalog` (parity is asserted by `verify-random-generator.mts`). Under
 * `recorderFidelity` the generator *deliberately* also attaches a locator to types the catalog
 * does not mark as requiring one — that is the Phase 3 probe for the screenshot/wait locator loss.
 */
export function buildStepPayload(type: StepType, ctx: ConfigurationContext): StepPayload {
  const { rng, constraints, coverage } = ctx;
  const spec = nodeSpec(type);
  const payload: StepPayload = { type };

  if (spec.requiresLocator) {
    const locator = locatorFor(type, ctx);
    if (locator) {
      payload.locator = locator;
      coverage?.recordGenerated("locatorStrategy", locator.strategy);
    }
  } else if (constraints.recorderFidelity && (type === "screenshot" || type === "wait")) {
    // Recorder-captured scoping on a node the designer catalog says needs no locator.
    const locator = locatorFor(type, ctx);
    if (locator) {
      payload.locator = locator;
      coverage?.recordGenerated("locatorStrategy", locator.strategy);
    }
  } else if (type === "loop") {
    // A loop needs a locator whenever its ACTION needs a target, and `nodeConfigFor` emits
    // `loopActionType: "click"`. Without one, `performLoopAction` computes `base = null` and every
    // arm is guarded by `if (target)`, so the loop ran its whole iteration count doing nothing and
    // still reported `passed` — the generated corpus was full of dead loop nodes and nothing said so
    // until the step-level loop contract started checking. The CATALOG stays `requiresLocator: false`
    // because it is a type-level statement and a `scroll`- or `customFlow`-action loop genuinely
    // needs no target; the requirement belongs to the action, which is why it is applied here.
    const locator = locatorFor(type, ctx);
    if (locator) {
      payload.locator = locator;
      coverage?.recordGenerated("locatorStrategy", locator.strategy);
    }
  }

  if (spec.requiresValue) {
    const value = valueFor(type, ctx);
    const source = valueSourceFor(type, value, ctx);
    // A secret-backed step carries the reference only — never a literal alongside it.
    if (source?.type !== "secret") payload.value = value;
    if (source) payload.valueSource = source;
    // A goto whose URL resolves from a secret must not also carry the URL in plaintext.
    if (type === "goto" && source?.type !== "secret") payload.url = value;
    if (type === "runFlow") payload.flowId = value;
  }

  const config = nodeConfigFor(type, ctx);
  if (config) payload.config = config;

  // A scroll-to-element needs the element. `nodeConfigFor` picks `scrollTarget` at random and the
  // catalog marks `scroll` as needing no locator (true for a PAGE scroll), so half the generated
  // scroll nodes named the element target with nothing to scroll to. At run time
  // `cfg.scrollTarget === "element" && step.locator` is then false and the runner quietly wheels the
  // page instead — the flow passes having scrolled the wrong thing. Decided here rather than in the
  // catalog because, as with `loop`, the requirement belongs to the CONFIG and not to the type.
  if (type === "scroll" && payload.config?.scrollTarget === "element" && payload.locator === undefined) {
    const locator = locatorFor(type, ctx);
    if (locator) {
      payload.locator = locator;
      coverage?.recordGenerated("locatorStrategy", locator.strategy);
    } else {
      // No locator available for this context — fall back to the page target so the generated node
      // still describes something the runner can actually do.
      payload.config.scrollTarget = "page";
    }
  }

  // `runFlow` invariant: `flowId` is canonical (the runner reads `flowId ?? config.targetFlowId`,
  // StepExecutor.ts:955); `config.targetFlowId` is a derived alias and must always agree.
  if (type === "runFlow" && payload.config) payload.config.targetFlowId = payload.flowId ?? "";

  if (type === "select") payload.selectionMode = rng.pick(["value", "label", "index"] as const);

  payload.timeoutMs = rng.int(5, 20) * 1_000;
  payload.retry = { count: rng.int(0, 2), delayMs: rng.int(1, 3) * 500 };
  payload.onFailure = { action: rng.pick(["stop", "continue"] as const), screenshot: rng.bool(0.6) };

  const before = waitsFor(ctx);
  if (before.length > 0) payload.beforeWaits = before;

  if (constraints.recorderFidelity) {
    // Recorder popup/window metadata. `toFlowStep` reads none of these fields, so this is the
    // Phase 3 probe for the popup-metadata loss.
    payload.pageAlias = "main";
    if (type === "click" && rng.bool(0.4)) {
      payload.opensPopup = true;
      payload.popupExpectation = {
        popupAlias: "popup-1",
        timeoutMs: 15_000,
        waitUntil: "domcontentloaded",
        closeBehavior: "returnToMain"
      };
    }

    // Explicit safety metadata — authoritative for retry decisions when present. Probe for the
    // safety-policy loss.
    payload.safety = {
      sideEffectLevel: rng.pick(["none", "read", "safeMutation"] as const),
      retryable: rng.bool(0.5)
    };

    // A step declaring more than one typed output. Probe for the outputs-map rewrite.
    if (type === "readText") {
      payload.outputs = {
        [`${rng.pick(SAFE_OUTPUT_KEYS)}Primary`]: { type: "text" },
        [`${rng.pick(SAFE_OUTPUT_KEYS)}Count`]: { type: "number" }
      };
    }

    // Recorder-authored free-text note, plus an explicit loop binding on loop steps. `toFlowStep`
    // mapped neither field (RT-15); emit them on a sample so the loss is exercised, not just predicted.
    if (rng.bool(0.3)) payload.message = rng.pick(SAFE_TEXT_VALUES);
    if (type === "loop") payload.loop = { maxIterations: rng.int(1, constraints.maxLoopIterations) };
  }

  return payload;
}
