import type { OracleNodeConfig, ValueSource } from "../profiles/FlowProfile";
import { toWireBindValue, type WireBind } from "./OracleTypeConversion";
import { mapOracleResult, type OracleMappedResult } from "./OracleResultMapper";
import type { OracleQueryResult } from "./OracleQueryService";
import { OracleBridgeCallError } from "./OracleBridgeProtocol";

/** Request the node runner receives: the node config + already-resolved, typed binds. */
export interface OracleNodeExecuteRequest {
  config: OracleNodeConfig;
  binds: WireBind[];
}

/**
 * Runs the node's query. Provided by the main process (backed by OracleQueryService + connection/
 * data-source resolution). Node executors never call the bridge directly — they call this.
 */
export type OracleNodeRunner = (
  request: OracleNodeExecuteRequest,
  options: { signal?: AbortSignal }
) => Promise<OracleQueryResult>;

export interface OracleNodeDeps {
  /** Resolve a bind's ValueSource to a string using AWKIT's existing ValueResolver. */
  resolveValue: (valueSource: ValueSource) => Promise<string>;
  runner: OracleNodeRunner;
  signal?: AbortSignal;
}

/** Resolve + type-convert each configured bind into a wire bind (prepared-statement value). */
export async function resolveOracleBinds(config: OracleNodeConfig, resolveValue: OracleNodeDeps["resolveValue"]): Promise<WireBind[]> {
  const binds = config.binds ?? [];
  const wire: WireBind[] = [];
  for (const bind of binds) {
    let raw = "";
    try {
      raw = await resolveValue(bind.valueSource);
    } catch (err) {
      throw new OracleBridgeCallError("INVALID_CONFIGURATION", `Bind "${bind.name ?? bind.position ?? "?"}" could not be resolved: ${(err as Error).message}`);
    }
    if ((raw === "" || raw === undefined) && bind.defaultValue !== undefined && bind.defaultValue !== "") {
      raw = bind.defaultValue;
    }
    if ((raw === "" || raw === undefined) && bind.required) {
      throw new OracleBridgeCallError("INVALID_CONFIGURATION", `Required bind "${bind.name ?? bind.position ?? "?"}" resolved to an empty value.`);
    }
    wire.push({ position: bind.position, name: bind.name, jdbcType: bind.jdbcType, value: toWireBindValue(bind.jdbcType, raw) });
  }
  return wire;
}

/** Resolve binds, execute the query through the runner, and map the result to the node's typed value. */
export async function runOracleNode(config: OracleNodeConfig, deps: OracleNodeDeps): Promise<OracleMappedResult> {
  const binds = await resolveOracleBinds(config, deps.resolveValue);
  const result = await deps.runner({ config, binds }, { signal: deps.signal });
  return mapOracleResult(result, config);
}
