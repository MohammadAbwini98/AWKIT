/**
 * What an `assertText` STEP NODE needs, refined by its configured assertion kind.
 *
 * WHY THIS EXISTS — this is the third instance of one defect class, after `awkit-3p6x` (the wait
 * node) and `awkit-jtok` (the Smart Wait conditions). `STEP_REQUIREMENTS` answers one requirement
 * per step *type*, and `assertText` is SEVEN different assertions behind one type literal. Its flat
 * row `{ requiresLocator: true, requiresValue: true }` was wrong three separate ways:
 *
 *  1. **The expected value was invisible to the gate.** `hasRequiredValue` reads `step.value` and
 *     `step.valueSource`; the designer's "Expected value" box writes `config.expectedValue`
 *     (`flowProfileMapping.ts`), which the runtime reads FIRST. So an ordinary, fully configured
 *     Assert Text node reported "requires a value or value source" — the same false positive that
 *     `awkit-3p6x` fixed for a Fixed time Wait carrying its duration in `timeoutMs`.
 *  2. **Two arms demanded a locator they never use.** A `url` assertion reads `activePage.url()` and
 *     a `storage` assertion reads through `page.evaluate`; neither touches `step.locator`, yet both
 *     were reported as missing one.
 *  3. **Two arms had required config enforced only by a runtime throw.** `attribute` needs
 *     `config.attributeName` and `storage` needs `config.storageKey`; without them
 *     `executeAssertion` throws — but only after the browser is open and earlier steps have already
 *     applied their side effects.
 *
 * THE CONTRACT IS READ OFF THE RUNTIME. `StepExecutor.executeAssertion` is the only executor:
 *
 * ```
 * const assertionType = cfg.assertionType ?? "text";
 * const operator      = cfg.comparisonOperator ?? "contains";
 * const expected      = await resolveStepValue(step, cfg.expectedValue ?? step.value);
 *
 * url:       actual = activePage.url()                          // no locator
 * count:     actual = locatorFactory.create(step.locator).count()
 * attribute: requires cfg.attributeName, else throws            // resolve(step)
 * storage:   requires cfg.storageKey, else throws               // page.evaluate — no locator
 * value:     actual = resolve(step).inputValue()
 * else:      actual = resolve(step).innerText()                 // "text" AND "visible" land here
 * ```
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { FlowStep, NodeConfig } from "../profiles/FlowProfile";

/** The seven assertion kinds `executeAssertion` dispatches on. */
export type AssertionKind = NonNullable<NodeConfig["assertionType"]>;

/** Every assertion kind, exhaustively — the literals `NodeConfig.assertionType` permits. */
export const ASSERTION_KINDS: readonly AssertionKind[] = ["visible", "text", "value", "count", "url", "attribute", "storage"];

/** Every comparison operator, exhaustively. */
export const COMPARISON_OPERATORS: readonly NonNullable<NodeConfig["comparisonOperator"]>[] = ["equals", "contains", "greaterThan", "lessThan"];

/** Storage areas a `storage` assertion may read. */
export const STORAGE_AREAS: readonly NonNullable<NodeConfig["storageArea"]>[] = ["local", "session"];

const KNOWN_KINDS: ReadonlySet<string> = new Set<string>(ASSERTION_KINDS);
const KNOWN_OPERATORS: ReadonlySet<string> = new Set<string>(COMPARISON_OPERATORS);
const KNOWN_AREAS: ReadonlySet<string> = new Set<string>(STORAGE_AREAS);

export function isKnownAssertionKind(kind: string): kind is AssertionKind {
  return KNOWN_KINDS.has(kind);
}

/**
 * The kind an assertion runs as. Mirrors `executeAssertion`'s `cfg.assertionType ?? "text"`, and its
 * final `else` arm: an unrecognised literal reads `innerText`, exactly like `text`, so validating it
 * as anything else would describe a step the runner does not execute. The unknown literal itself is
 * reported separately — it is a real misconfiguration, just not a different set of requirements.
 */
export function resolveAssertionKind(step: FlowStep): AssertionKind {
  const configured = step.config?.assertionType;
  return configured !== undefined && isKnownAssertionKind(configured) ? configured : "text";
}

/** What one assertion step needs. */
export interface AssertionStepContract {
  readonly kind: AssertionKind;
  /** `url` and `storage` read the page, not an element; every other kind resolves `step.locator`. */
  readonly requiresLocator: boolean;
  /** Every kind compares against an expected value; only the CHANNEL differs from other step types. */
  readonly requiresValue: boolean;
  /** The extra `config` field this kind cannot run without, if any. */
  readonly requiredConfigField?: "attributeName" | "storageKey";
}

/**
 * Exported so the DESIGNER can consult the same table. The properties panel edits
 * `FlowDesignerNodeData`, which is not a `FlowStep`, and giving it its own copy of the rule is
 * exactly how the panel came to know about the expected value but not about `attributeName` or
 * `storageKey`. One table, two callers.
 */
export const ASSERTION_CONTRACTS: Record<AssertionKind, Omit<AssertionStepContract, "kind">> = {
  // `visible` has no arm of its own in `executeAssertion`; it falls through to `innerText`, so it
  // behaves exactly like `text`. (The dedicated visibility check is the separate `assertVisible`
  // STEP TYPE, which is validated by the ordinary table and is correct there.)
  visible: { requiresLocator: true, requiresValue: true },
  text: { requiresLocator: true, requiresValue: true },
  value: { requiresLocator: true, requiresValue: true },
  count: { requiresLocator: true, requiresValue: true },
  url: { requiresLocator: false, requiresValue: true },
  attribute: { requiresLocator: true, requiresValue: true, requiredConfigField: "attributeName" },
  storage: { requiresLocator: false, requiresValue: true, requiredConfigField: "storageKey" }
};

/** The contract for this exact step, resolved from its configured assertion kind. */
export function assertionStepContract(step: FlowStep): AssertionStepContract {
  const kind = resolveAssertionKind(step);
  return { kind, ...ASSERTION_CONTRACTS[kind] };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Whether the assertion states an expected value through any channel the runner reads.
 *
 * `resolveStepValue(step, cfg.expectedValue ?? step.value)` resolves a `valueSource` FIRST and
 * otherwise takes `config.expectedValue`, then `step.value`. All three are legal; the designer
 * writes the first, and a Recorder-captured or hand-written flow may use either of the others.
 *
 * An empty expected value is deliberately NOT accepted. With the default `contains` operator,
 * `actual.includes("")` is true for every possible page — the assertion passes without asserting
 * anything. (An "is empty" assertion is not lost by this: the designer already maps an empty box to
 * `undefined` before it is persisted, so that state is not expressible today either way.)
 */
export function hasAssertionExpectedValue(step: FlowStep): boolean {
  if (step.valueSource !== undefined) return true;
  if (isNonEmptyString(step.config?.expectedValue)) return true;
  return isNonEmptyString(step.value);
}

/** The literal expected value, when one is written directly rather than resolved at run time. */
function literalExpectedValue(step: FlowStep): string | undefined {
  if (step.valueSource !== undefined) return undefined;
  const literal = step.config?.expectedValue ?? step.value;
  return isNonEmptyString(literal) ? literal : undefined;
}

/** A configuration defect that does not stop the step from resolving its inputs. */
export interface AssertionConfigDefect {
  readonly field: string;
  readonly detail: string;
}

/**
 * Configuration literals outside their permitted set, and operator/value pairings that cannot
 * succeed. Judged only when PRESENT — every one of these fields has a documented runtime default.
 */
export function assertionConfigDefects(step: FlowStep): AssertionConfigDefect[] {
  const config = step.config;
  if (config === undefined) return [];
  const defects: AssertionConfigDefect[] = [];

  // An unknown literal silently becomes a `text` assertion via the executor's final `else`, so the
  // step runs — just never as the assertion that was written.
  if (config.assertionType !== undefined && !KNOWN_KINDS.has(config.assertionType)) {
    defects.push({
      field: "assertionType",
      detail: `names an unknown assertion kind "${String(config.assertionType)}"; the runner would fall back to comparing the element's text`
    });
  }

  // Likewise `compareValues`' `default:` arm silently substitutes `contains`.
  if (config.comparisonOperator !== undefined && !KNOWN_OPERATORS.has(config.comparisonOperator)) {
    defects.push({
      field: "comparisonOperator",
      detail: `names an unknown comparison operator "${String(config.comparisonOperator)}"; the runner would fall back to "contains"`
    });
  }

  if (config.storageArea !== undefined && !KNOWN_AREAS.has(config.storageArea)) {
    defects.push({ field: "storageArea", detail: `names an unknown storage area "${String(config.storageArea)}"; it must be "local" or "session"` });
  }

  // `greaterThan`/`lessThan` are `Number(actual) > Number(expected)`. A non-numeric literal is `NaN`,
  // and every comparison against NaN is false — the assertion can never pass, whatever the page does.
  const operator = config.comparisonOperator;
  if (operator === "greaterThan" || operator === "lessThan") {
    const literal = literalExpectedValue(step);
    if (literal !== undefined && !Number.isFinite(Number(literal))) {
      defects.push({
        field: "expectedValue",
        detail: `compares numerically against "${literal}", which is not a number; Number("${literal}") is NaN and every comparison with NaN is false, so the assertion can never pass`
      });
    }
  }

  return defects;
}
