/**
 * Fragment intelligence (Phase L, L6 *Intelligence*): deterministic discovery, the T0 summary, and
 * the T1 parameter-mapping suggestion.
 *
 * Three pieces, and only one of them needs a model:
 *
 *  1. **Discovery is deterministic and needs no index.** L6 asks for a passive "a similar fragment
 *     already exists" hint *with no model*. The plan's Intelligence section reaches for the semantic
 *     index, but a user's fragment library is a bounded, user-authored handful, not a corpus — so the
 *     hint is structural similarity over the step shape, computed in-process. That also means the hint
 *     works with AI switched off and with no model pack installed, which is what "passive" should mean.
 *  2. **The summary is T0.** Prose about a fragment, labelled as an interpretation, applied to nothing.
 *  3. **The parameter mapping is T1, and it never binds.** It proposes pairs of *keys*, both drawn
 *     from closed enums, and every pair is re-checked deterministically afterwards. A model's opinion
 *     cannot override a type mismatch, and it can never target a password input at all.
 *
 * Pure: no Electron, no filesystem, no clock, no Playwright, no model.
 */

import type { AiPromptSpec } from "./AiPromptBuilder";
import type { AiOutputSchema } from "./AiOutputContract";
import type { FlowFragment } from "../fragments/FlowFragment";
import type { FlowStep } from "../profiles/FlowProfile";
import type { WorkflowRuntimeInput } from "../profiles/WorkflowProfile";
import { decideAiAction, type AiPolicyConfig, type AiPolicyDecision } from "../security/authz/AiAutonomyPolicy";

export const FRAGMENT_ASSIST_VERSION = 1;

export const FRAGMENT_ASSIST_LIMITS = Object.freeze({
  /** Hints offered at once. A passive hint that lists ten candidates is a dialog, not a hint. */
  maxHints: 3,
  /** Below this, two subgraphs are not "similar" in any sense a user would recognise. */
  minSimilarity: 0.6,
  /** Fragments compared in one pass. A user library is small; this is the guard, not the expectation. */
  maxLibraryScanned: 500,
  maxSummaryChars: 400,
  maxMappings: 16,
  timeoutMs: 30_000,
  maxOutputTokens: 512,
  maxDataChars: 3_000
});

// ── 1. Discovery (deterministic, no model, no index) ────────────────────────────────────────────

export interface FragmentSimilarityHint {
  fragmentId: string;
  fragmentName: string;
  /** 0–1, rounded to three places. */
  similarity: number;
  /** How many of the candidate subgraph's steps the fragment also has, by type. */
  sharedSteps: number;
}

/** The comparable shape of a subgraph: what its steps DO, never what they say or target. */
function shapeOf(steps: readonly FlowStep[]): string[] {
  return steps.map((step) => step.type).sort();
}

/**
 * Multiset Jaccard over step types.
 *
 * Deliberately not a sequence comparison: two authors building the same login will order a `fill`
 * pair either way round, and a hint that missed that would be useless. Deliberately not over names,
 * values or locators either — those are the user's content, and a hint must not depend on two people
 * naming a step the same way.
 */
function shapeSimilarity(a: readonly string[], b: readonly string[]): { score: number; shared: number } {
  if (a.length === 0 && b.length === 0) return { score: 0, shared: 0 };
  const counts = new Map<string, number>();
  for (const type of a) counts.set(type, (counts.get(type) ?? 0) + 1);
  let shared = 0;
  for (const type of b) {
    const left = counts.get(type) ?? 0;
    if (left > 0) {
      counts.set(type, left - 1);
      shared += 1;
    }
  }
  const union = a.length + b.length - shared;
  return { score: union === 0 ? 0 : shared / union, shared };
}

/**
 * The passive hint: fragments whose shape resembles the steps the user has selected.
 *
 * No model, no semantic index, no network. Sorted by similarity then name, so the hint is stable
 * across renders — a hint that reorders itself while a user reads it is worse than none.
 */
export function findSimilarFragments(
  steps: readonly FlowStep[],
  library: readonly FlowFragment[],
  limits = FRAGMENT_ASSIST_LIMITS
): FragmentSimilarityHint[] {
  if (steps.length === 0) return [];
  const shape = shapeOf(steps);
  return library
    .slice(0, limits.maxLibraryScanned)
    .map((fragment) => {
      const { score, shared } = shapeSimilarity(shape, shapeOf(fragment.nodes));
      return { fragmentId: fragment.id, fragmentName: fragment.name, similarity: Math.round(score * 1000) / 1000, sharedSteps: shared };
    })
    .filter((hint) => hint.similarity >= limits.minSimilarity)
    .sort((a, b) => b.similarity - a.similarity || a.fragmentName.localeCompare(b.fragmentName))
    .slice(0, limits.maxHints);
}

// ── 2. Summary (T0) ─────────────────────────────────────────────────────────────────────────────

export interface FragmentSummaryRequest {
  prompt: AiPromptSpec;
  schema: AiOutputSchema;
  fragmentId: string;
}

const SUMMARY_INSTRUCTIONS =
  "You describe what a saved automation fragment does, in at most two plain sentences, for someone " +
  "deciding whether to reuse it. You are given the fragment's step types in order and the keys of the " +
  "inputs it requires. Describe only what those steps imply. Do not invent steps, data or outcomes.";

/**
 * A fragment's shape, for a summary.
 *
 * Step TYPES and input KEYS only. Not step names, not locator values, not typed values: a fragment is
 * captured verbatim from a real flow, so its names and values are the user's own business content,
 * and a summary is not worth sending them.
 */
export function buildFragmentSummaryRequest(fragment: FlowFragment, limits = FRAGMENT_ASSIST_LIMITS): FragmentSummaryRequest | undefined {
  if (fragment.nodes.length === 0) return undefined;
  return {
    prompt: {
      instructions: SUMMARY_INSTRUCTIONS,
      maxDataChars: limits.maxDataChars,
      fields: [
        { name: "StepTypesInOrder", ids: fragment.nodes.map((step) => step.type) },
        { name: "RequiredInputKeys", ids: fragment.inputs.length ? fragment.inputs.map((input) => input.key) : ["none"] },
        { name: "FragmentKind", ids: [fragment.kind] }
      ]
    },
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["version", "summary"],
      properties: {
        version: { type: "integer", minimum: FRAGMENT_ASSIST_VERSION, maximum: FRAGMENT_ASSIST_VERSION },
        summary: { type: "string", maxLength: limits.maxSummaryChars }
      }
    },
    fragmentId: fragment.id
  };
}

export type FragmentAssistRejectionCode =
  | "MALFORMED"
  | "EMPTY_SUMMARY"
  | "UNSAFE_TEXT"
  /** A key the fragment does not declare. */
  | "UNKNOWN_FRAGMENT_INPUT"
  /** A key the destination workflow does not declare. */
  | "UNKNOWN_WORKFLOW_INPUT"
  /** The same fragment input mapped twice, or two fragment inputs aliased onto one workflow input. */
  | "DUPLICATE_MAPPING"
  /** The two inputs are not the same type. A model's opinion never overrides the declaration. */
  | "TYPE_MISMATCH"
  /** The destination is a password input. A fragment input is never silently bound to a credential. */
  | "CREDENTIAL_TARGET";

export interface FragmentAssistRejection {
  ok: false;
  code: FragmentAssistRejectionCode;
  field: string;
}

export function parseFragmentSummary(value: unknown, limits = FRAGMENT_ASSIST_LIMITS): { ok: true; summary: string } | FragmentAssistRejection {
  const reject = (code: FragmentAssistRejectionCode, field: string): FragmentAssistRejection => ({ ok: false, code, field });
  if (typeof value !== "object" || value === null || Array.isArray(value)) return reject("MALFORMED", "$");
  const raw = value as Record<string, unknown>;
  if (raw.version !== FRAGMENT_ASSIST_VERSION) return reject("MALFORMED", "version");
  if (typeof raw.summary !== "string") return reject("MALFORMED", "summary");
  const summary = raw.summary.trim();
  if (!summary) return reject("EMPTY_SUMMARY", "summary");
  if (summary.length > limits.maxSummaryChars) return reject("MALFORMED", "summary");
  if ([...summary].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return reject("UNSAFE_TEXT", "summary");
  return { ok: true, summary };
}

// ── 3. Parameter mapping (T1, and it never binds) ───────────────────────────────────────────────

export interface ParameterMappingRequest {
  prompt: AiPromptSpec;
  schema: AiOutputSchema;
  fragmentId: string;
  /** The fragment's declared inputs. The only left-hand sides a mapping may name. */
  fragmentInputs: FlowFragment["inputs"];
  /** The destination workflow's declared inputs. The only right-hand sides. */
  workflowInputs: readonly WorkflowRuntimeInput[];
}

const MAPPING_INSTRUCTIONS =
  "A saved automation fragment requires some inputs, named by key. The workflow it is being added to " +
  "declares its own inputs, also by key. Suggest which workflow input each fragment input most likely " +
  "corresponds to, using only the keys and labels given. " +
  "Map only what you are confident about: leaving a fragment input unmapped is a correct answer and a " +
  "wrong pairing is not. Never map two fragment inputs to the same workflow input. " +
  "Your answer is a suggestion a person will review; nothing is bound by it.";

/**
 * Fragment inputs and workflow inputs, as two closed key spaces.
 *
 * Password-typed workflow inputs are **excluded from the request entirely**, not merely refused in
 * the answer. A credential is never a mapping target, so the model is not shown one and cannot
 * propose one; the parse still refuses it, because a request is not the only way to reach the parse.
 */
export function buildParameterMappingRequest(
  fragment: FlowFragment,
  workflowInputs: readonly WorkflowRuntimeInput[],
  limits = FRAGMENT_ASSIST_LIMITS
): ParameterMappingRequest | undefined {
  const mappable = workflowInputs.filter((input) => input.type !== "password");
  if (fragment.inputs.length === 0 || mappable.length === 0) return undefined;
  const fragmentKeys = fragment.inputs.map((input) => input.key);
  const workflowKeys = mappable.map((input) => input.key);
  const describe = (entries: ReadonlyArray<{ key: string; label: string; type: string; required: boolean }>): string =>
    entries.map((entry) => `${entry.key}: type=${entry.type} required=${entry.required} label="${entry.label}"`).join("\n");

  return {
    prompt: {
      instructions: MAPPING_INSTRUCTIONS,
      maxDataChars: limits.maxDataChars,
      fields: [
        { name: "FragmentInputs", text: describe(fragment.inputs) },
        { name: "WorkflowInputs", text: describe(mappable) }
      ]
    },
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["version", "mappings"],
      properties: {
        version: { type: "integer", minimum: FRAGMENT_ASSIST_VERSION, maximum: FRAGMENT_ASSIST_VERSION },
        mappings: {
          type: "array",
          maxItems: Math.min(fragmentKeys.length, limits.maxMappings),
          items: {
            type: "object",
            additionalProperties: false,
            required: ["fragmentInputKey", "workflowInputKey"],
            properties: {
              fragmentInputKey: { type: "string", enum: fragmentKeys },
              workflowInputKey: { type: "string", enum: workflowKeys }
            }
          }
        }
      }
    },
    fragmentId: fragment.id,
    fragmentInputs: fragment.inputs,
    workflowInputs: mappable
  };
}

export interface ParameterMapping {
  fragmentInputKey: string;
  workflowInputKey: string;
}

export interface ParameterMappingSuggestion {
  ok: true;
  /** Reviewed pairs. NOTHING is bound by this: a caller applies them only with a user's approval. */
  mappings: ParameterMapping[];
  /** Fragment inputs the model left unmapped. A legitimate answer, surfaced rather than hidden. */
  unmapped: string[];
}

/**
 * Validate a decoded mapping against the request that produced it.
 *
 * The rules a grammar cannot express, and they are the ones that matter: no duplicate on either side
 * (aliasing two distinct fragment inputs onto one workflow input silently merges them), types must
 * agree by the DECLARATIONS rather than by the model's confidence, and a password input is never a
 * target even if one somehow reaches here.
 */
export function parseParameterMapping(value: unknown, request: ParameterMappingRequest): ParameterMappingSuggestion | FragmentAssistRejection {
  const reject = (code: FragmentAssistRejectionCode, field: string): FragmentAssistRejection => ({ ok: false, code, field });
  if (typeof value !== "object" || value === null || Array.isArray(value)) return reject("MALFORMED", "$");
  const raw = value as Record<string, unknown>;
  if (raw.version !== FRAGMENT_ASSIST_VERSION) return reject("MALFORMED", "version");
  if (!Array.isArray(raw.mappings)) return reject("MALFORMED", "mappings");

  const fragmentByKey = new Map(request.fragmentInputs.map((input) => [input.key, input]));
  const workflowByKey = new Map(request.workflowInputs.map((input) => [input.key, input]));
  const usedFragment = new Set<string>();
  const usedWorkflow = new Set<string>();
  const mappings: ParameterMapping[] = [];

  for (const [index, entry] of raw.mappings.entries()) {
    const path = `mappings.${index}`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return reject("MALFORMED", path);
    const { fragmentInputKey, workflowInputKey } = entry as Record<string, unknown>;
    if (typeof fragmentInputKey !== "string") return reject("MALFORMED", `${path}.fragmentInputKey`);
    if (typeof workflowInputKey !== "string") return reject("MALFORMED", `${path}.workflowInputKey`);
    const source = fragmentByKey.get(fragmentInputKey);
    if (!source) return reject("UNKNOWN_FRAGMENT_INPUT", `${path}.fragmentInputKey`);
    const target = workflowByKey.get(workflowInputKey);
    if (!target) return reject("UNKNOWN_WORKFLOW_INPUT", `${path}.workflowInputKey`);
    if (target.type === "password") return reject("CREDENTIAL_TARGET", `${path}.workflowInputKey`);
    if (usedFragment.has(fragmentInputKey)) return reject("DUPLICATE_MAPPING", `${path}.fragmentInputKey`);
    // Two fragment inputs sharing one workflow input would make two distinct values one value, and
    // the run would silently use the same data for both. Refused, not de-duplicated.
    if (usedWorkflow.has(workflowInputKey)) return reject("DUPLICATE_MAPPING", `${path}.workflowInputKey`);
    // The declarations decide compatibility, never the model. A `number` bound to a `checkbox` is
    // wrong however confident the answer sounds.
    if (source.type !== target.type) return reject("TYPE_MISMATCH", `${path}.workflowInputKey`);
    usedFragment.add(fragmentInputKey);
    usedWorkflow.add(workflowInputKey);
    mappings.push({ fragmentInputKey, workflowInputKey });
  }

  return {
    ok: true,
    mappings,
    unmapped: request.fragmentInputs.filter((input) => !usedFragment.has(input.key)).map((input) => input.key)
  };
}

/** T0: a fragment summary is observed and labelled, never applied. */
export function fragmentSummaryDecision(policy: AiPolicyConfig): AiPolicyDecision {
  return decideAiAction("fragmentSummary", "interpretation", {}, policy);
}

/** T1: a parameter mapping is suggested for review. `fragmentParameterMapping`'s ceiling is T1. */
export function parameterMappingDecision(policy: AiPolicyConfig): AiPolicyDecision {
  return decideAiAction("fragmentParameterMapping", "parameterMapping", {}, policy);
}
