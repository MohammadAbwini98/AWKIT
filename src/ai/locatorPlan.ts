/**
 * Locator plan DSL, trusted compiler and intent guard (Phase L, L3 §2–§3).
 *
 * A model never returns a selector. It returns a versioned plan that names a strategy, a value and at
 * most `MAX_LOCATOR_CONTAINER_CHAIN` semantic scopes; `compileLocatorPlan` is the only path from that
 * plan to a `LocatorCandidate` + `LocatorContext`. Frame and shadow scope always come from the captured
 * context, never from the plan. `guardLocatorPlanIntent` then rejects any plan whose target or scope text
 * is a bound data value (L2 markers), and flags a position → text scope change as `meaningChange`, which
 * `AiAutonomyPolicy` turns from T2 into a T1 suggestion.
 *
 * Nothing here proves a candidate (L3 §4 proof gates run in the browser) and nothing needs a model.
 * Framework-agnostic and pure.
 */
import {
  MAX_LOCATOR_CONTAINER_CHAIN,
  locatorContainerChain,
  type LocatorCandidate,
  type LocatorContainerContext,
  type LocatorContext,
  type LocatorStrategy,
  type StepLocator
} from "../profiles/FlowProfile";
import { validateAiOutput, type AiOutputSchema } from "./AiOutputContract";

export const LOCATOR_PLAN_VERSION = 1;
/** L3 §7: synthesis attempts per job, consumed only by real rejections. */
export const LOCATOR_PLAN_MAX_ATTEMPTS = 2;

const PLAN_STRATEGIES = ["role", "label", "placeholder", "text", "testId", "id", "css", "xpath"] as const;
const SCOPE_KINDS = ["dialog", "tableRow", "card", "listItem", "landmark", "form", "section"] as const;
const MAX_VALUE = 200;
const MAX_NAME = 120;

const CANDIDATE_PROPERTIES = {
  strategy: { type: "string", enum: PLAN_STRATEGIES },
  value: { type: "string", maxLength: MAX_VALUE },
  name: { type: "string", maxLength: MAX_NAME },
  exact: { type: "boolean" }
} as const;

/** The grammar the model decodes against; closed objects, so a frame or script field is refused. */
export const LOCATOR_PLAN_SCHEMA: AiOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "target", "scopes"],
  properties: {
    version: { type: "integer", minimum: LOCATOR_PLAN_VERSION, maximum: LOCATOR_PLAN_VERSION },
    target: { type: "object", additionalProperties: false, required: ["strategy", "value"], properties: CANDIDATE_PROPERTIES },
    scopes: {
      type: "array",
      maxItems: MAX_LOCATOR_CONTAINER_CHAIN,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "strategy", "value"],
        properties: {
          ...CANDIDATE_PROPERTIES,
          kind: { type: "string", enum: SCOPE_KINDS },
          hasText: { type: "string", maxLength: MAX_NAME },
          visibleOnly: { type: "boolean" }
        }
      }
    }
  }
};

export type LocatorPlanRejectionCode =
  | "MALFORMED"
  | "INVENTED_FRAME"
  | "UNSUPPORTED"
  | "SCRIPT"
  | "POSITIONAL"
  | "UNSTABLE_ID"
  | "XPATH_NOT_ALLOWED"
  | "INTENT_BOUND_VALUE";

/** Structured, deterministic feedback for the next attempt. `field` is a path, never page or model text. */
export interface LocatorPlanRejection {
  ok: false;
  code: LocatorPlanRejectionCode;
  field: string;
}

export interface CompiledLocatorPlan {
  ok: true;
  candidate: LocatorCandidate;
  context?: LocatorContext;
}

export interface LocatorPlanPolicy {
  /** XPath only under explicit policy (L3 §2). */
  allowXPath?: boolean;
}

const reject = (code: LocatorPlanRejectionCode, field: string): LocatorPlanRejection => ({ ok: false, code, field });
const hasControlChar = (value: string): boolean => [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

// Mirrors the recorder page script's `looksGeneratedId` (which cannot be imported into a page script).
function looksGeneratedId(id: string): boolean {
  return (
    id.length > 40 ||
    /^\d/.test(id) ||
    /[:.]/.test(id) ||
    /(^|[-_])[0-9a-f]{6,}($|[-_])/i.test(id) ||
    /__[A-Za-z0-9]*\d[A-Za-z0-9]*$/.test(id) ||
    /^(radix|headlessui|mui-|ember|ext-gen|react-aria|:r)/i.test(id) ||
    /\d{4,}/.test(id)
  );
}

const SCRIPT_PATTERN = /javascript:|<\s*\/?\s*script|\bon[a-z]+\s*=|^\s*(internal|js|xpath|css|text|id|nth|data-testid|_react|_vue)\s*[:=]|>>/i;
const POSITIONAL_XPATH = /\[\s*\d+\s*\]|position\s*\(|last\s*\(/i;
const ID_TOKEN = /^[A-Za-z][\w-]*$/;
const ROLE_TOKEN = /^[a-z]+$/;

/** One candidate (target or scope) against the strategy rules; undefined when it is acceptable. */
function checkCandidate(candidate: LocatorCandidate, field: string, policy: LocatorPlanPolicy): LocatorPlanRejection | undefined {
  const value = candidate.value.trim();
  const texts = [candidate.value, candidate.name ?? ""];
  if (!value) return reject("MALFORMED", `${field}.value`);
  if (texts.some(hasControlChar)) return reject("SCRIPT", field);
  if (texts.some((t) => /javascript:|<\s*\/?\s*script/i.test(t))) return reject("SCRIPT", field);
  switch (candidate.strategy as LocatorStrategy) {
    case "role":
      return ROLE_TOKEN.test(value) ? undefined : reject("UNSUPPORTED", `${field}.value`);
    case "label":
    case "placeholder":
    case "text":
    case "testId":
      return undefined;
    case "id":
      if (!ID_TOKEN.test(value)) return reject("SCRIPT", `${field}.value`);
      return looksGeneratedId(value) ? reject("UNSTABLE_ID", `${field}.value`) : undefined;
    case "css": {
      // Only an approved stable id selector; anything else (classes, combinators, :nth-*) is refused.
      if (SCRIPT_PATTERN.test(value)) return reject("SCRIPT", `${field}.value`);
      if (/:nth-|:eq\(|:first|:last/i.test(value)) return reject("POSITIONAL", `${field}.value`);
      if (!value.startsWith("#") || !ID_TOKEN.test(value.slice(1))) return reject("UNSUPPORTED", `${field}.value`);
      return looksGeneratedId(value.slice(1)) ? reject("UNSTABLE_ID", `${field}.value`) : undefined;
    }
    case "xpath":
      if (!policy.allowXPath) return reject("XPATH_NOT_ALLOWED", `${field}.strategy`);
      if (SCRIPT_PATTERN.test(value)) return reject("SCRIPT", `${field}.value`);
      if (POSITIONAL_XPATH.test(value)) return reject("POSITIONAL", `${field}.value`);
      return value.startsWith("/") ? undefined : reject("UNSUPPORTED", `${field}.value`);
    default:
      return reject("UNSUPPORTED", `${field}.strategy`);
  }
}

function toCandidate(raw: Record<string, unknown>): LocatorCandidate {
  return {
    strategy: raw.strategy as LocatorStrategy,
    value: String(raw.value).trim(),
    ...(typeof raw.name === "string" && raw.name.trim() ? { name: raw.name.trim() } : {}),
    ...(typeof raw.exact === "boolean" ? { exact: raw.exact } : {})
  };
}

/**
 * The only path from model output to a locator. `captured` is the context the Recorder (or the saved
 * step) proved; its frame chain and shadow scope are copied verbatim and the plan cannot add to them.
 */
export function compileLocatorPlan(
  plan: unknown,
  captured: LocatorContext | undefined,
  policy: LocatorPlanPolicy = {}
): CompiledLocatorPlan | LocatorPlanRejection {
  if (typeof plan === "object" && plan !== null && !Array.isArray(plan)) {
    const keys = Object.keys(plan);
    if (keys.some((key) => /frame|shadow|iframe/i.test(key))) return reject("INVENTED_FRAME", "$");
  }
  if (validateAiOutput(plan, LOCATOR_PLAN_SCHEMA).length > 0) return reject("MALFORMED", "$");
  // A closed root resolves through the instrumented bridge's own target signature, not a candidate.
  if (captured?.shadow?.instrumented) return reject("UNSUPPORTED", "context.shadow");

  const source = plan as { target: Record<string, unknown>; scopes: Array<Record<string, unknown>> };
  const candidate = toCandidate(source.target);
  const targetProblem = checkCandidate(candidate, "target", policy);
  if (targetProblem) return targetProblem;

  const containers: LocatorContainerContext[] = [];
  for (const [index, scope] of source.scopes.entries()) {
    const field = `scopes.${index}`;
    const container: LocatorContainerContext = {
      type: scope.kind as LocatorContainerContext["type"],
      ...toCandidate(scope),
      ...(typeof scope.hasText === "string" && scope.hasText.trim() ? { hasText: scope.hasText.trim() } : {}),
      ...(scope.visibleOnly === true ? { visibleOnly: true } : {})
    };
    const problem = checkCandidate(container, field, policy);
    if (problem) return problem;
    // `hasText` is matched literally by Playwright, so only control characters are refused.
    if (container.hasText && hasControlChar(container.hasText)) return reject("SCRIPT", `${field}.hasText`);
    containers.push(container);
  }

  const context: LocatorContext = {
    ...(captured?.frameChain?.length ? { frameChain: captured.frameChain.map((segment) => ({ ...segment })) } : {}),
    ...(!captured?.frameChain?.length && captured?.frame ? { frame: { ...captured.frame } } : {}),
    ...(captured?.shadow ? { shadow: structuredClone(captured.shadow) } : {}),
    ...(containers.length ? { containers } : {})
  };
  return { ok: true, candidate, ...(Object.keys(context).length ? { context } : {}) };
}

export interface LocatorIntentInput {
  /** Raw bound texts (action value, earlier inputs, `valueSource`, data-source column values); memory only. */
  boundValues: readonly string[];
  /** The authoritative locator the plan would replace. */
  baseline: StepLocator;
}

export type LocatorIntentResult = { ok: true; meaningChange: boolean } | LocatorPlanRejection;

const normalizeBound = (values: readonly string[]): string[] =>
  [...new Set(values.map((v) => (typeof v === "string" ? v.trim().toLowerCase() : "")).filter((v) => v.length >= 2))];

/** L3 §3: runs before any proof. A plan scoped by a bound value would silently re-target on the next data row. */
export function guardLocatorPlanIntent(compiled: CompiledLocatorPlan, input: LocatorIntentInput): LocatorIntentResult {
  const bound = normalizeBound(input.boundValues);
  const containers = locatorContainerChain(compiled.context);
  const fields: Array<[string, string | undefined]> = [
    ["target.value", compiled.candidate.value],
    ["target.name", compiled.candidate.name],
    ...containers.flatMap((c, i): Array<[string, string | undefined]> => [
      [`scopes.${i}.value`, c.value],
      [`scopes.${i}.name`, c.name],
      [`scopes.${i}.hasText`, c.hasText]
    ])
  ];
  for (const [field, text] of fields) {
    const haystack = (text ?? "").toLowerCase();
    if (haystack && bound.some((value) => haystack.includes(value))) return reject("INTENT_BOUND_VALUE", field);
  }

  const baselinePositional =
    input.baseline.guard !== undefined ||
    input.baseline.quality?.disambiguation === "positional" ||
    input.baseline.quality?.strategy === "fallback";
  const baselineTexts = new Set(
    locatorContainerChain(input.baseline.context)
      .map((c) => c.hasText?.trim().toLowerCase())
      .filter(Boolean)
  );
  const newTextScope = containers.some((c) => c.hasText && !baselineTexts.has(c.hasText.toLowerCase()));
  const meaningChange = newTextScope || (baselinePositional && compiled.candidate.strategy === "text");
  return { ok: true, meaningChange };
}

/** Compile, then guard: the single entry an L3 job calls per synthesis attempt. */
export function evaluateLocatorPlan(
  plan: unknown,
  input: LocatorIntentInput & { captured?: LocatorContext; policy?: LocatorPlanPolicy }
): (CompiledLocatorPlan & { meaningChange: boolean }) | LocatorPlanRejection {
  const compiled = compileLocatorPlan(plan, input.captured, input.policy);
  if (!compiled.ok) return compiled;
  const intent = guardLocatorPlanIntent(compiled, input);
  return intent.ok ? { ...compiled, meaningChange: intent.meaningChange } : intent;
}
