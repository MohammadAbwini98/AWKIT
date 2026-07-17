import type { OracleBindDefinition } from "../data/DataSourceProfile";
import { toWireBindValue, type WireBind } from "./OracleTypeConversion";
import { OracleBridgeCallError } from "./OracleBridgeProtocol";

/** Context available when a Data Source resolves its own query binds (before any per-step context). */
export interface DataSourceBindContext {
  /** Resolution-time environment (usually a scoped subset of `process.env`). */
  env?: Record<string, string | undefined>;
  /** Workflow-level inputs known at data-source resolution time. */
  workflowInputs?: Record<string, unknown>;
}

function bindLabel(bind: OracleBindDefinition): string {
  return String(bind.name ?? bind.position ?? "?");
}

/**
 * Resolve an Oracle **Data Source** query's binds to wire binds at DATA-SOURCE resolution time.
 *
 * A Data Source resolves once, before any per-row / per-step context exists, so only resolution-time
 * bind sources are supported here: `static`, `env`, and `workflowInput`. Per-row (`currentRow`),
 * `previousOutput`, and `flowInput` binds are meaningful only inside step execution — they belong on
 * the Oracle **node** (see `resolveOracleBinds`) and are rejected here with a clear message rather
 * than silently binding an empty value.
 */
export function resolveDataSourceBinds(
  binds: OracleBindDefinition[] | undefined,
  ctx: DataSourceBindContext = {}
): WireBind[] {
  const wire: WireBind[] = [];
  for (const bind of binds ?? []) {
    const source = bind.source;
    let raw = "";
    switch (source?.kind) {
      case "static":
        raw = source.value ?? "";
        break;
      case "env": {
        const key = source.key ?? source.value ?? "";
        raw = ctx.env?.[key] ?? "";
        break;
      }
      case "workflowInput": {
        const key = source.key ?? source.path ?? source.value ?? "";
        const value = ctx.workflowInputs?.[key];
        raw = value === undefined || value === null ? "" : String(value);
        break;
      }
      default:
        throw new OracleBridgeCallError(
          "INVALID_CONFIGURATION",
          `Bind "${bindLabel(bind)}" uses source "${source?.kind ?? "unknown"}", which is only available on the Oracle node, not on a Data Source query.`
        );
    }

    if ((raw === "" || raw === undefined) && bind.defaultValue !== undefined && bind.defaultValue !== "") {
      raw = bind.defaultValue;
    }
    if ((raw === "" || raw === undefined) && bind.required) {
      throw new OracleBridgeCallError(
        "INVALID_CONFIGURATION",
        `Required bind "${bindLabel(bind)}" resolved to an empty value.`
      );
    }
    wire.push({ position: bind.position, name: bind.name, jdbcType: bind.jdbcType, value: toWireBindValue(bind.jdbcType, raw) });
  }
  return wire;
}
