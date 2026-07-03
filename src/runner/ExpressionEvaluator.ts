/**
 * Tiny, safe boolean expression evaluator for connector conditions.
 * Supports `LEFT OP RIGHT` comparisons and bare truthiness — no `eval`.
 *
 * Tokens may reference resolved values via `${path}` (e.g. `${outputs.login.ok}`,
 * `${runtimeInputs.accountType}`). The caller supplies a `getValue(path)` resolver.
 */
export type ValueResolver = (path: string) => unknown;

const COMPARATORS = ["===", "!==", "==", "!=", ">=", "<=", ">", "<"] as const;
type Comparator = (typeof COMPARATORS)[number];

function isTruthy(value: unknown): boolean {
  if (typeof value === "string") return !["", "false", "0", "no", "off"].includes(value.trim().toLowerCase());
  if (typeof value === "number") return value !== 0;
  return Boolean(value);
}

/** Resolve a single operand token to a primitive value. */
function resolveOperand(token: string, getValue: ValueResolver): unknown {
  const trimmed = token.trim();
  const templ = trimmed.match(/^\$\{([^}]+)\}$/);
  if (templ) return getValue(templ[1].trim());
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

function compare(left: unknown, op: Comparator, right: unknown): boolean {
  switch (op) {
    case "===":
    case "==":
      return String(left) === String(right);
    case "!==":
    case "!=":
      return String(left) !== String(right);
    case ">":
      return Number(left) > Number(right);
    case "<":
      return Number(left) < Number(right);
    case ">=":
      return Number(left) >= Number(right);
    case "<=":
      return Number(left) <= Number(right);
  }
}

export function evaluateBoolean(expression: string, getValue: ValueResolver): boolean {
  const expr = expression.trim();
  if (!expr) return true;

  for (const op of COMPARATORS) {
    const index = expr.indexOf(op);
    // Avoid matching ">"/"<" inside ">="/"<=" by checking longer operators first (array order).
    if (index > 0) {
      const left = resolveOperand(expr.slice(0, index), getValue);
      const right = resolveOperand(expr.slice(index + op.length), getValue);
      return compare(left, op as Comparator, right);
    }
  }

  return isTruthy(resolveOperand(expr, getValue));
}
