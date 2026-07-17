import type { OracleNodeConfig } from "../profiles/FlowProfile";
import type { OracleQueryResult } from "./OracleQueryService";

export type OracleMappedValue = string | number | boolean | null | unknown[] | Record<string, unknown>;

export class OracleMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OracleMappingError";
  }
}

export interface OracleMappedResult {
  value: OracleMappedValue;
  rowCount: number;
  truncated: boolean;
  columns: { name: string; jdbcType: string }[];
  executionMs: number;
  source: "runtime-query" | "snapshot";
}

/**
 * Deterministically map an {@link OracleQueryResult} to the node's typed value. No silent JS
 * truthiness, no silent row concatenation, explicit empty/null/multi-row/precision behavior.
 */
export function mapOracleResult(result: OracleQueryResult, config: OracleNodeConfig): OracleMappedResult {
  const base = {
    rowCount: result.rowCount,
    truncated: result.truncated,
    columns: result.columns.map((c) => ({ name: c.name, jdbcType: c.jdbcType })),
    executionMs: result.executionMs,
    source: result.source
  };

  if (config.returnType === "list") {
    return { ...base, value: mapList(result, config) };
  }
  return { ...base, value: mapScalar(result, config) };
}

function parseCsvSet(csv: string | undefined, fallback: string[]): Set<string> {
  const items = (csv ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set(items.length ? items : fallback);
}

function selectColumnName(result: OracleQueryResult, config: OracleNodeConfig): string {
  const col = config.selectedColumn?.trim();
  if (col) return col;
  const first = result.columns[0]?.name;
  if (!first) throw new OracleMappingError("Query returned no columns to read.");
  return first;
}

function cellValue(row: Record<string, unknown>, column: string): unknown {
  if (!(column in row)) {
    // Case-insensitive fallback (Oracle upper-cases unquoted identifiers).
    const key = Object.keys(row).find((k) => k.toLowerCase() === column.toLowerCase());
    if (key === undefined) throw new OracleMappingError(`Column "${column}" is not in the result.`);
    return row[key];
  }
  return row[column];
}

function mapScalar(result: OracleQueryResult, config: OracleNodeConfig): OracleMappedValue {
  const column = selectColumnName(result, config);

  if (result.rows.length === 0) {
    return emptyScalar(config, column);
  }
  if (config.multiRowBehavior === "error" && result.rows.length > 1) {
    throw new OracleMappingError(`Query returned ${result.rows.length} rows but a single value was expected.`);
  }
  const index = config.selectedRowIndex ?? 0;
  const row = result.rows[index];
  if (!row) {
    return emptyScalar(config, column);
  }
  const raw = cellValue(row, column);
  if (raw === null || raw === undefined) return null;

  switch (config.returnType) {
    case "string":
      return typeof raw === "string" ? raw : String(raw);
    case "number":
      return toNumber(raw);
    case "boolean":
      return toBoolean(raw, config);
    default:
      return String(raw);
  }
}

function emptyScalar(config: OracleNodeConfig, _column: string): OracleMappedValue {
  const behavior = config.emptyBehavior ?? "null";
  if (behavior === "error") throw new OracleMappingError("Query returned no rows.");
  if (behavior === "default") {
    const def = config.defaultValue ?? "";
    if (config.returnType === "number") return toNumber(def);
    if (config.returnType === "boolean") return toBoolean(def, config);
    return def;
  }
  return null;
}

function toNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  const s = String(raw).trim();
  const n = Number(s);
  if (!Number.isFinite(n)) throw new OracleMappingError(`Value "${s}" cannot be converted to a number.`);
  // Detect precision loss: the round-trip must reproduce the input.
  if (s !== "" && String(n) !== s && !/^[-+]?0\d/.test(s) && !/[eE]/.test(s)) {
    throw new OracleMappingError(`Value "${s}" loses precision as a JavaScript number; read it as a string instead.`);
  }
  return n;
}

function toBoolean(raw: unknown, config: OracleNodeConfig): boolean {
  if (typeof raw === "boolean") return raw;
  const trueSet = parseCsvSet(config.booleanTrueValues, ["true", "1", "y", "yes"]);
  const falseSet = parseCsvSet(config.booleanFalseValues, ["false", "0", "n", "no"]);
  const s = String(raw).trim().toLowerCase();
  if (trueSet.has(s)) return true;
  if (falseSet.has(s)) return false;
  throw new OracleMappingError(`Value "${String(raw)}" does not match any configured boolean mapping.`);
}

function mapList(result: OracleQueryResult, config: OracleNodeConfig): unknown[] {
  if (config.listMode === "column") {
    const column = selectColumnName(result, config);
    return result.rows.map((row) => {
      const v = cellValue(row, column);
      return v === undefined ? null : v;
    });
  }
  // Default: array of row objects.
  return result.rows;
}
