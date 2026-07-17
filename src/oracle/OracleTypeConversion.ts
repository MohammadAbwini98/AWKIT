import type { OracleBindDefinition } from "../data/DataSourceProfile";

/**
 * Deterministic conversions between AWKIT values and the bridge wire, plus the (TS-side) result
 * limits. The authoritative Oracle→JSON conversion happens in Java where the true column type and
 * NUMBER precision are known; this module handles bind values (TS→wire) and defensive result-limit
 * enforcement on the normalized result the bridge returns.
 */

export type JsonScalar = string | number | boolean | null;

/** One bind ready for the wire: ordinal/name + JDBC type + JSON-scalar value. */
export interface WireBind {
  position?: number;
  name?: string;
  jdbcType: OracleBindDefinition["jdbcType"];
  value: JsonScalar;
}

export class OracleConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OracleConversionError";
  }
}

/**
 * Convert an already-resolved AWKIT value (usually a string from the ValueResolver) into a typed
 * wire scalar for its JDBC type. Never interpolates into SQL — the value is always bound.
 */
export function toWireBindValue(jdbcType: OracleBindDefinition["jdbcType"], raw: unknown): JsonScalar {
  if (jdbcType === "NULL") return null;
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const s = typeof raw === "string" ? raw : String(raw);

  switch (jdbcType) {
    case "STRING":
      return s;
    case "INTEGER": {
      if (!/^[-+]?\d+$/.test(s.trim())) throw new OracleConversionError(`Bind value "${s}" is not a valid integer.`);
      const n = Number(s.trim());
      // Beyond safe integer range → pass as string so Oracle keeps full precision.
      return Number.isSafeInteger(n) ? n : s.trim();
    }
    case "NUMBER":
    case "DECIMAL": {
      const t = s.trim();
      if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) {
        throw new OracleConversionError(`Bind value "${s}" is not a valid number.`);
      }
      const n = Number(t);
      // Preserve high-precision values as strings when a round-trip would lose precision.
      return Number.isFinite(n) && String(n) === t ? n : t;
    }
    case "BOOLEAN": {
      const t = s.trim().toLowerCase();
      if (["true", "1", "y", "yes"].includes(t)) return true;
      if (["false", "0", "n", "no"].includes(t)) return false;
      throw new OracleConversionError(`Bind value "${s}" is not a valid boolean.`);
    }
    case "DATE":
    case "TIMESTAMP": {
      // Accept ISO-8601 or a Date-parseable string; emit ISO-8601 for the bridge to bind.
      const d = new Date(s.trim());
      if (Number.isNaN(d.getTime())) throw new OracleConversionError(`Bind value "${s}" is not a valid date/timestamp.`);
      return d.toISOString();
    }
    default:
      return s;
  }
}

export interface ResultLimits {
  maxRows: number;
  maxColumns?: number;
  maxCellBytes?: number;
  maxSerializedBytes?: number;
}

export interface NormalizedRow {
  [column: string]: JsonScalar | JsonScalar[] | Record<string, JsonScalar>;
}

export interface LimitCheck {
  ok: boolean;
  reason?: string;
  truncated: boolean;
}

/**
 * Defensive TS-side enforcement of result limits on the normalized rows the bridge returned (the
 * bridge already enforces authoritatively, but a compromised/older bridge must not blow past AWKIT
 * limits). Returns whether the result is within limits and whether it was truncated.
 */
export function enforceResultLimits(
  rows: unknown[],
  columns: unknown[],
  limits: ResultLimits
): LimitCheck {
  let truncated = false;
  if (limits.maxColumns && columns.length > limits.maxColumns) {
    return { ok: false, truncated, reason: `Result has ${columns.length} columns (max ${limits.maxColumns}).` };
  }
  if (rows.length > limits.maxRows) {
    truncated = true;
  }
  if (limits.maxCellBytes) {
    for (const row of rows.slice(0, limits.maxRows)) {
      if (typeof row !== "object" || row === null) continue;
      for (const value of Object.values(row as Record<string, unknown>)) {
        if (typeof value !== "string") continue;
        const bytes = Buffer.byteLength(value, "utf8");
        if (bytes > limits.maxCellBytes) {
          return { ok: false, truncated, reason: `A cell is ${bytes} bytes (max ${limits.maxCellBytes}).` };
        }
      }
    }
  }
  if (limits.maxSerializedBytes) {
    const bytes = Buffer.byteLength(JSON.stringify(rows.slice(0, limits.maxRows)), "utf8");
    if (bytes > limits.maxSerializedBytes) {
      return { ok: false, truncated, reason: `Result serialized to ${bytes} bytes (max ${limits.maxSerializedBytes}).` };
    }
  }
  return { ok: true, truncated };
}
