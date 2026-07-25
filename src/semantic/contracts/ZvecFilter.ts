/**
 * Typed, structural filters for the Zvec semantic index — and the value-safety rule that makes
 * building a filter expression safe at all.
 *
 * ## Why a typed clause list rather than a filter string
 *
 * Zvec's `filter` is a SQL-like expression **string** with no parameter binding, so a value is
 * interpolated into a grammar. A raw expression must therefore never cross `SemanticStore`: callers
 * describe *what* to match with the clauses below, and the expression is assembled at the trusted
 * edge. The host assembles it a second time, independently (see `native-hosts/zvec/zvec-host.cjs`)
 * — the same deliberate duplication as `isConfinedGenerationPath`, so an IPC validation gap cannot
 * become a filter-injection path.
 *
 * ## The value rule is a REFUSAL, not an escaper
 *
 * Escaping was measured against the real binding rather than assumed, and no escaper is correct for
 * arbitrary strings (see `scripts/verify-semantic-zvec-filter.mts` for the fixtures):
 *
 * | value | escape `"` only | escape `"` and `\` |
 * |---|---|---|
 * | `only a quote` | exact match | exact match |
 * | `ends-with\` | **lexer error** | silently matches NOTHING |
 * | `mid\"quote` | **lexer error** | silently matches NOTHING |
 *
 * The grammar treats `\"` as an escaped quote but a backslash before any other character as
 * literal, so doubling backslashes corrupts the value while not doubling them lets a trailing
 * backslash escape its own closing quote. The second column is the dangerous one: a `deleteByEntity`
 * would report `ok` having removed nothing — precisely the "partial delete reporting success"
 * failure this subsystem refuses to ship.
 *
 * So a value containing a backslash or a control character is **rejected**, not escaped. Quotes are
 * safe and are escaped as `\"`. Refusing a value AWKIT cannot represent is honest; guessing at one
 * is how content stays indexed after the caller was told it was gone.
 */

/**
 * Fields a filter may name. An allowlist, not a free string: a typo'd or attacker-chosen field name
 * cannot reach the expression, and the set is checked against `SEMANTIC_SCHEMA` by
 * `verify:semantic-zvec-filter` so a schema change cannot silently orphan a filter dimension.
 */
export const ZVEC_FILTERABLE_FIELDS = [
  "id",
  "kind",
  "entityId",
  "revision",
  "sourceHash",
  "schemaVersion",
  "workflowId",
  "flowId",
  "nodeId",
  "nodeType",
  "hostname",
  "outcome",
  "errorCategory"
] as const;

export type ZvecFilterField = (typeof ZVEC_FILTERABLE_FIELDS)[number];

export function isZvecFilterField(value: unknown): value is ZvecFilterField {
  return typeof value === "string" && (ZVEC_FILTERABLE_FIELDS as readonly string[]).includes(value);
}

/**
 * A single condition. Kept deliberately small — every operator here is one whose behaviour was
 * confirmed against the real binding. `NOT <field> = <v>` is absent because the grammar rejects it
 * (`no viable alternative at input 'NOTkind'`); use `neq`, which the grammar spells `!=`.
 */
export type ZvecFilterClause =
  | { field: ZvecFilterField; op: "eq"; value: string | number }
  | { field: ZvecFilterField; op: "neq"; value: string | number }
  | { field: ZvecFilterField; op: "in"; values: readonly (string | number)[] }
  | { field: ZvecFilterField; op: "isNull" }
  | { field: ZvecFilterField; op: "gte"; value: number };

/**
 * A conjunction of clauses. AND-only by design: disjunction across different fields is not needed by
 * any current caller, and every operator combination admitted here is one the grammar was measured
 * to accept. An empty clause list is NOT a match-everything filter — it is refused, because
 * "delete where nothing" silently meaning "delete everything" is the worst possible default.
 */
export interface ZvecSafeFilter {
  all: readonly ZvecFilterClause[];
}

export type ZvecFilterErrorCode =
  | "FILTER_EMPTY"
  | "FILTER_UNKNOWN_FIELD"
  | "FILTER_UNKNOWN_OPERATOR"
  | "FILTER_VALUE_UNSAFE"
  | "FILTER_VALUE_TYPE"
  | "FILTER_IN_EMPTY";

export class ZvecFilterError extends Error {
  constructor(
    readonly code: ZvecFilterErrorCode,
    /** Never includes the offending VALUE — a filter value can carry entity names. */
    detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ZvecFilterError";
  }
}

/**
 * Whether a string can be represented in the filter grammar without corruption.
 *
 * Backslash: the grammar's only escape is `\"`, so a backslash is neither safely doubled nor safely
 * left alone (see the header table). Control characters: never legitimate in a filterable dimension,
 * and invisible in any diagnostic that echoes the expression.
 */
export function isFilterSafeString(value: string): boolean {
  if (value.includes("\\")) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/** Quote a string literal. Assumes `isFilterSafeString`; asserts it rather than trusting the caller. */
export function quoteFilterString(value: string): string {
  if (!isFilterSafeString(value)) {
    throw new ZvecFilterError("FILTER_VALUE_UNSAFE", "value contains a backslash or control character");
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function renderScalar(value: unknown): string {
  if (typeof value === "string") return quoteFilterString(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ZvecFilterError("FILTER_VALUE_TYPE", "number must be finite");
    return String(value);
  }
  throw new ZvecFilterError("FILTER_VALUE_TYPE", `expected string or number, received ${typeof value}`);
}

function renderClause(clause: ZvecFilterClause): string {
  if (!isZvecFilterField(clause.field)) {
    throw new ZvecFilterError("FILTER_UNKNOWN_FIELD", String(clause.field));
  }
  switch (clause.op) {
    // Equality is a single `=`. `==` is a syntax error in this grammar, which is exactly the kind of
    // thing that must be settled by measurement rather than by analogy with other query languages.
    case "eq":
      return `${clause.field} = ${renderScalar(clause.value)}`;
    case "neq":
      return `${clause.field} != ${renderScalar(clause.value)}`;
    case "gte":
      return `${clause.field} >= ${renderScalar(clause.value)}`;
    case "isNull":
      // An OMITTED optional field reads as NULL here — optionals are written by omission, because
      // the binding rejects an explicit null on a nullable string field.
      return `${clause.field} IS NULL`;
    case "in": {
      if (clause.values.length === 0) throw new ZvecFilterError("FILTER_IN_EMPTY", clause.field);
      // Parentheses, not brackets: `IN [...]` is a syntax error.
      return `${clause.field} IN (${clause.values.map(renderScalar).join(", ")})`;
    }
    default:
      throw new ZvecFilterError("FILTER_UNKNOWN_OPERATOR", (clause as { op?: string }).op ?? "unknown");
  }
}

/**
 * Assemble a filter expression. Throws `ZvecFilterError` rather than emitting an expression it
 * cannot vouch for — a filter that "mostly" matches is how a delete under-removes silently.
 */
export function buildZvecFilterExpression(filter: ZvecSafeFilter): string {
  if (!filter || !Array.isArray(filter.all) || filter.all.length === 0) {
    throw new ZvecFilterError("FILTER_EMPTY", "a filter must contain at least one clause");
  }
  const rendered = filter.all.map(renderClause);
  return rendered.length === 1 ? rendered[0] : rendered.map((r) => `(${r})`).join(" AND ");
}

/** Every document, expressed as a clause the schema guarantees. `schemaVersion` is non-nullable. */
export function matchAllFilter(): ZvecSafeFilter {
  return { all: [{ field: "schemaVersion", op: "gte", value: 0 }] };
}

/** Every document projected from one source entity, whatever its revision. */
export function entityFilter(entityId: string): ZvecSafeFilter {
  return { all: [{ field: "entityId", op: "eq", value: entityId }] };
}
