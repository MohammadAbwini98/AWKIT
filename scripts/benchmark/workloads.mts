/**
 * Representative workload matrix for the real-ExecutionEngine capacity benchmark (Phase 3).
 *
 * Each class is a real `FlowProfile` (start → steps → end) + a `ScenarioProfile` (one flow, no links) +
 * a `ConcurrentRunProfile` template, driven through `ExecutionEngine.startRun`. Steps target the offline
 * workload server from `lib.mts` (form / spa / table / image-heavy / idle / download / multitab) — no
 * public internet. Step shapes match the proven `verify-runner` set (id locators, absolute goto URLs).
 *
 * MIXED is produced by running several single-class runs CONCURRENTLY on one engine (the browser pool,
 * shared pool, backpressure, adaptive controller and weighted admission are all GLOBAL across runs), which
 * is more realistic than one identical scenario per run.
 */
import type { FlowProfile, FlowStep, FlowEdge } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";

export type WorkloadClass = "light" | "medium" | "heavy" | "waiting";
export const WORKLOAD_CLASSES: WorkloadClass[] = ["light", "medium", "heavy", "waiting"];

/** Chain steps start → …steps… → end with success edges (mirrors verify-runner's simpleFlow). */
function linearFlow(id: string, name: string, steps: FlowStep[]): FlowProfile {
  const nodes: FlowStep[] = [
    { id: "start", type: "start", name: "start" },
    ...steps,
    { id: "end", type: "end", name: "end" }
  ];
  const ids = nodes.map((n) => n.id);
  const edges: FlowEdge[] = ids.slice(0, -1).map((source, i) => ({ id: `${id}-e${i}`, source, target: ids[i + 1], type: "success" }));
  return { id, name, version: 1, nodes, edges };
}

const cont = { action: "continue" as const, screenshot: false };

/** LIGHT — normal navigation + form fill + submit + confirmation. Base cost (~1.0 weight). */
function lightFlow(base: string): FlowProfile {
  return linearFlow("wl-light", "Light form", [
    { id: "goto", type: "goto", name: "goto form", url: `${base}/form` },
    { id: "f0", type: "fill", name: "fill 0", locator: { strategy: "id", value: "fld0" }, value: "tester" },
    { id: "f1", type: "fill", name: "fill 1", locator: { strategy: "id", value: "fld1" }, value: "alpha" },
    { id: "f2", type: "fill", name: "fill 2", locator: { strategy: "id", value: "fld2" }, value: "bravo" },
    { id: "go", type: "click", name: "submit", locator: { strategy: "id", value: "go" }, onFailure: cont },
    { id: "assert", type: "assertText", name: "confirm", locator: { strategy: "id", value: "title" }, onFailure: cont, config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "Form" } }
  ]);
}

/** MEDIUM — SPA navigation + table + API-backed sub-resources + multiple navigations. */
function mediumFlow(base: string): FlowProfile {
  return linearFlow("wl-medium", "Medium SPA+table", [
    { id: "goto", type: "goto", name: "goto spa", url: `${base}/spa`, afterWaits: [{ type: "response", urlContains: "/img/", armBeforeAction: true, timeoutMs: 8000, reason: "spa renders images on load" }] },
    { id: "v2", type: "click", name: "spa list", locator: { strategy: "id", value: "v2" }, onFailure: cont },
    { id: "v3", type: "click", name: "spa detail", locator: { strategy: "id", value: "v3" }, onFailure: cont },
    { id: "table", type: "goto", name: "goto table", url: `${base}/table` },
    { id: "assertT", type: "assertText", name: "assert table", locator: { strategy: "id", value: "title" }, onFailure: cont, config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "Table" } },
    { id: "spa2", type: "goto", name: "goto spa again", url: `${base}/spa` },
    { id: "v2b", type: "click", name: "spa list 2", locator: { strategy: "id", value: "v2" }, onFailure: cont }
  ]);
}

/** HEAVY — image/asset-heavy + popup (multi-tab) + download. */
function heavyFlow(base: string): FlowProfile {
  return linearFlow("wl-heavy", "Heavy image+popup+download", [
    { id: "goto", type: "goto", name: "goto image-heavy", url: `${base}/image-heavy` },
    { id: "assertI", type: "assertText", name: "assert image", locator: { strategy: "id", value: "title" }, onFailure: cont, config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "Image" } },
    { id: "mt", type: "goto", name: "goto multitab", url: `${base}/multitab` },
    {
      id: "open", type: "click", name: "open popup", locator: { strategy: "id", value: "open" }, onFailure: cont,
      opensPopup: true,
      popupExpectation: { popupAlias: "popup-1", waitUntil: "domcontentloaded", timeoutMs: 8000, closeBehavior: "returnToMain" }
    },
    { id: "dl", type: "goto", name: "goto download", url: `${base}/download` },
    { id: "dlfile", type: "downloadFile", name: "download file", locator: { strategy: "id", value: "dl" }, timeoutMs: 15000, onFailure: cont }
  ]);
}

/** WAITING — long waits + request/response waits + idle periods. Holds a slot with near-zero CPU. */
function waitingFlow(base: string, waitMs = 4000): FlowProfile {
  return linearFlow("wl-waiting", "Waiting idle", [
    { id: "goto", type: "goto", name: "goto idle", url: `${base}/idle` },
    { id: "w1", type: "wait", name: "idle wait 1", timeoutMs: waitMs, config: { waitType: "time" } },
    { id: "resp", type: "goto", name: "await ping", url: `${base}/idle`, afterWaits: [{ type: "response", urlContains: "api/ping", armBeforeAction: true, timeoutMs: 8000, reason: "idle page polls /api/ping" }] },
    { id: "w2", type: "wait", name: "idle wait 2", timeoutMs: waitMs, config: { waitType: "time" } },
    { id: "assert", type: "assertText", name: "assert idle", locator: { strategy: "id", value: "title" }, onFailure: cont, config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "Idle" } }
  ]);
}

export function buildFlow(cls: WorkloadClass, base: string, waitMs?: number): FlowProfile {
  switch (cls) {
    case "light": return lightFlow(base);
    case "medium": return mediumFlow(base);
    case "heavy": return heavyFlow(base);
    case "waiting": return waitingFlow(base, waitMs);
  }
}

export function buildScenario(cls: WorkloadClass, flowId: string): ScenarioProfile {
  return {
    id: `wl-scn-${cls}`,
    name: `Workload ${cls}`,
    executionMode: "sequential",
    maxParallelFlows: 1,
    flows: [{ order: 1, flowId, required: true }],
    links: [],
    failurePolicy: { stopOnRequiredFlowFailure: false, continueOnOptionalFlowFailure: true, takeScreenshotOnFailure: false }
  };
}

export function buildProfile(
  cls: WorkloadClass,
  base: string,
  opts: { executionId: string; headless: boolean; maxConcurrentInstances: number }
): ConcurrentRunProfile {
  return {
    id: opts.executionId,
    scenarioId: `wl-scn-${cls}`,
    runMode: "fixedConcurrent",
    maxConcurrentInstances: opts.maxConcurrentInstances,
    browserWindowMode: opts.headless ? "headless" : "activeOnly",
    instanceTemplate: {
      browser: "chromium",
      headless: opts.headless,
      isolationMode: "browserContext",
      baseUrl: base,
      timeoutMs: 30000,
      viewport: { width: 1280, height: 720 }
    },
    resourceControls: { maxBrowserContextsPerProcess: 8, delayBetweenInstanceStartsMs: 50 },
    failurePolicy: { stopAllOnCriticalFailure: false, continueOtherInstancesOnFailure: true, retryFailedInstance: false, retryCount: 0 }
  };
}

/** Realistic production mix (sums to 1.0). MIXED capacity ≠ identical-workflow capacity. */
export const DEFAULT_MIX: Record<WorkloadClass, number> = { light: 0.4, medium: 0.25, heavy: 0.2, waiting: 0.15 };

/** Deterministic round-robin-ish picker honoring the mix ratios (stable, reproducible). */
export function makeMixPicker(mix: Record<WorkloadClass, number> = DEFAULT_MIX): () => WorkloadClass {
  const bag: WorkloadClass[] = [];
  const scale = 20;
  for (const cls of WORKLOAD_CLASSES) {
    const n = Math.max(1, Math.round((mix[cls] ?? 0) * scale));
    for (let i = 0; i < n; i++) bag.push(cls);
  }
  let i = 0;
  return () => bag[i++ % bag.length];
}
