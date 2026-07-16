/**
 * Lenient runtime bounds-normalization for flow JSON (audit F-03).
 *
 * TypeScript interfaces are compile-time only, so a manipulated/hand-edited flow can carry
 * out-of-range numbers or enormous arrays that become local denial-of-service levers. This clamps
 * the known DoS-prone fields IN PLACE before execution and returns human-readable warnings.
 *
 * Deliberately lenient (owner decision): it does NOT reject unknown extra properties (so legacy
 * saved flows keep loading) and does NOT reject unknown step types here — `StepExecutor` already
 * throws on an unsupported step type, and `validateConnectorStructure` already blocks invalid graphs.
 */
import type { FlowProfile, FlowStep, WaitCondition } from "./FlowProfile";

export const FLOW_BOUNDS = {
  /** Max per-step / per-wait timeout (10 min). */
  maxTimeoutMs: 600_000,
  /** Max fixed delay (10 min). */
  maxDelayMs: 600_000,
  /** Max automatic retries for a single step. */
  maxRetryCount: 20,
  /** Max loop iterations (node loop config and loop connectors). */
  maxLoopIterations: 10_000,
  /** Max ranked locator alternatives kept per step. */
  maxAlternatives: 50,
  /** Max before/after waits kept per step. */
  maxWaitsPerStep: 50
} as const;

function clamp(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < min) return min;
  if (value > max) return max;
  return undefined; // in range → no change
}

function clampWaits(waits: WaitCondition[] | undefined, stepId: string, kind: string, warnings: string[]): WaitCondition[] | undefined {
  if (!Array.isArray(waits)) return waits;
  let list = waits;
  if (list.length > FLOW_BOUNDS.maxWaitsPerStep) {
    warnings.push(`Step ${stepId}: ${kind} truncated to ${FLOW_BOUNDS.maxWaitsPerStep} (was ${list.length}).`);
    list = list.slice(0, FLOW_BOUNDS.maxWaitsPerStep);
  }
  for (const wait of list) {
    const t = clamp((wait as { timeoutMs?: number }).timeoutMs, 0, FLOW_BOUNDS.maxTimeoutMs);
    if (t !== undefined) (wait as { timeoutMs?: number }).timeoutMs = t;
    if (wait.type === "fixedDelay") {
      const d = clamp(wait.delayMs, 0, FLOW_BOUNDS.maxDelayMs);
      if (d !== undefined) wait.delayMs = d;
    }
  }
  return list;
}

function normalizeStep(step: FlowStep, warnings: string[]): void {
  const t = clamp(step.timeoutMs, 0, FLOW_BOUNDS.maxTimeoutMs);
  if (t !== undefined) {
    warnings.push(`Step ${step.id}: timeoutMs clamped to ${t}.`);
    step.timeoutMs = t;
  }
  if (step.retry) {
    const c = clamp(step.retry.count, 0, FLOW_BOUNDS.maxRetryCount);
    if (c !== undefined) { warnings.push(`Step ${step.id}: retry.count clamped to ${c}.`); step.retry.count = c; }
    const d = clamp(step.retry.delayMs, 0, FLOW_BOUNDS.maxDelayMs);
    if (d !== undefined) step.retry.delayMs = d;
  }
  if (step.loop?.maxIterations !== undefined) {
    const m = clamp(step.loop.maxIterations, 0, FLOW_BOUNDS.maxLoopIterations);
    if (m !== undefined) { warnings.push(`Step ${step.id}: loop.maxIterations clamped to ${m}.`); step.loop.maxIterations = m; }
  }
  if (step.config) {
    for (const key of ["iterationCount", "maxIterations"] as const) {
      const v = clamp(step.config[key], 0, FLOW_BOUNDS.maxLoopIterations);
      if (v !== undefined) { warnings.push(`Step ${step.id}: config.${key} clamped to ${v}.`); step.config[key] = v; }
    }
  }
  if (step.locator?.alternatives && step.locator.alternatives.length > FLOW_BOUNDS.maxAlternatives) {
    warnings.push(`Step ${step.id}: locator alternatives truncated to ${FLOW_BOUNDS.maxAlternatives}.`);
    step.locator.alternatives = step.locator.alternatives.slice(0, FLOW_BOUNDS.maxAlternatives);
  }
  step.beforeWaits = clampWaits(step.beforeWaits, step.id, "beforeWaits", warnings);
  step.afterWaits = clampWaits(step.afterWaits, step.id, "afterWaits", warnings);
}

/**
 * Clamp DoS-prone numeric/array fields on a flow in place. Returns warnings (already generic —
 * no user values). Safe to call on any FlowProfile just before execution.
 */
export function normalizeFlowBounds(flow: FlowProfile): string[] {
  const warnings: string[] = [];
  if (Array.isArray(flow.nodes)) {
    for (const step of flow.nodes) normalizeStep(step, warnings);
    const ids = flow.nodes.map((n) => n.id);
    if (new Set(ids).size !== ids.length) warnings.push(`Flow ${flow.id}: duplicate node ids present (first match wins).`);
  }
  if (Array.isArray(flow.edges)) {
    for (const edge of flow.edges) {
      if (edge.loop?.maxIterations !== undefined) {
        const m = clamp(edge.loop.maxIterations, 0, FLOW_BOUNDS.maxLoopIterations);
        if (m !== undefined) { warnings.push(`Connector ${edge.id}: loop.maxIterations clamped to ${m}.`); edge.loop.maxIterations = m; }
      }
      if (edge.maxLoopCount !== undefined) {
        const m = clamp(edge.maxLoopCount, 0, FLOW_BOUNDS.maxLoopIterations);
        if (m !== undefined) edge.maxLoopCount = m;
      }
    }
  }
  return warnings;
}

/** Collect the distinct secret names referenced by any step's value source across the given flows. */
export function collectSecretNames(flows: FlowProfile[]): string[] {
  const names = new Set<string>();
  for (const flow of flows) {
    for (const step of flow.nodes ?? []) {
      for (const source of [step.valueSource, step.loop?.valueSource]) {
        if (source?.type === "secret" && source.secretName?.trim()) names.add(source.secretName.trim());
      }
    }
  }
  return [...names];
}
