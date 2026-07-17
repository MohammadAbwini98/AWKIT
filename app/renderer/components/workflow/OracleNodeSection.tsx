import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { SearchableSelect } from "../shared/SearchableSelect";
import type { OracleNodeBind, OracleNodeConfig, ValueSource } from "@src/profiles/FlowProfile";

interface OracleNodeSectionProps {
  oracle: OracleNodeConfig;
  onChange: (patch: Partial<OracleNodeConfig>) => void;
}

interface NamedOption {
  id: string;
  name: string;
}

/** Simplified bind source kinds surfaced in the node UI (mapped to a full ValueSource). */
type BindSourceKind = "static" | "currentRow" | "workflowInput" | "instanceVariable" | "env";

function sourceKind(vs: ValueSource): BindSourceKind {
  switch (vs.type) {
    case "currentRow":
      return "currentRow";
    case "runtimeInput":
      return "workflowInput";
    case "instanceVariable":
      return "instanceVariable";
    case "env":
      return "env";
    default:
      return "static";
  }
}

function makeSource(kind: BindSourceKind, text: string): ValueSource {
  switch (kind) {
    case "currentRow":
      return { type: "currentRow", path: text || "$" };
    case "workflowInput":
      return { type: "runtimeInput", key: text };
    case "instanceVariable":
      return { type: "instanceVariable", key: text };
    case "env":
      return { type: "env", envKey: text };
    default:
      return { type: "static", value: text };
  }
}

function sourceText(vs: ValueSource): string {
  return vs.value ?? vs.key ?? vs.path ?? vs.envKey ?? "";
}

/**
 * Property-panel section for the Oracle query node. Self-contained: loads Oracle connection profiles
 * + Oracle Data Sources and the feature-availability banner via the preload `oracle`/`dataSources`
 * IPC. Token-only styling (reuses the panel's existing classes).
 */
export function OracleNodeSection({ oracle, onChange }: OracleNodeSectionProps) {
  const [profiles, setProfiles] = useState<NamedOption[]>([]);
  const [oracleSources, setOracleSources] = useState<NamedOption[]>([]);
  const [availability, setAvailability] = useState<{ available: boolean; reason?: string; driverExpected: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const api = window.playwrightFlowStudio;
    api.oracle
      .availability()
      .then((a) => !cancelled && setAvailability(a))
      .catch(() => undefined);
    api.oracle
      .listProfiles()
      .then((list) => !cancelled && setProfiles(list.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => undefined);
    api.dataSources
      .list()
      .then((list) =>
        !cancelled &&
        setOracleSources(
          list
            .filter((d) => (d as { type?: string }).type === "oracle")
            .map((d) => ({ id: d.id, name: d.name }))
        )
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const binds = oracle.binds ?? [];
  const updateBind = (index: number, patch: Partial<OracleNodeBind>) => {
    const next = binds.map((b, i) => (i === index ? { ...b, ...patch } : b));
    onChange({ binds: next });
  };
  const addBind = () =>
    onChange({ binds: [...binds, { name: "", jdbcType: "STRING", valueSource: { type: "static", value: "" } }] });
  const removeBind = (index: number) => onChange({ binds: binds.filter((_, i) => i !== index) });

  const scalar = oracle.returnType === "string" || oracle.returnType === "number" || oracle.returnType === "boolean";

  return (
    <details className="property-group" open>
      <summary>Oracle Query</summary>
      <section className="property-section">
        {availability && !availability.available ? (
          <span className="form-message" role="alert">
            Oracle is unavailable in this build: {availability.reason ?? "runtime not found"}. The node can be configured but
            will not run until the Oracle runtime is present.
          </span>
        ) : null}
        {availability && availability.available && !availability.driverExpected ? (
          <span className="form-message">
            Running with the database-free mock driver (no Oracle JDBC jars vendored) — queries return sample data.
          </span>
        ) : null}

        <label>
          Connection Source
          <select
            value={oracle.connectionSource}
            onChange={(e) => onChange({ connectionSource: e.target.value as OracleNodeConfig["connectionSource"] })}
          >
            <option value="dataSource">Oracle Data Source</option>
            <option value="profile">Connection Profile</option>
          </select>
        </label>

        {oracle.connectionSource === "dataSource" ? (
          <>
            <label>
              Oracle Data Source
              <SearchableSelect
                ariaLabel="Oracle Data Source"
                value={oracle.dataSourceId ?? ""}
                placeholder={oracleSources.length ? "Select an Oracle Data Source…" : "No Oracle Data Sources yet"}
                options={oracleSources.map((s) => ({ value: s.id, label: s.name }))}
                onChange={(next) => onChange({ dataSourceId: next })}
              />
            </label>
            <label>
              SQL Override (optional)
              <textarea
                rows={3}
                value={oracle.sql ?? ""}
                placeholder="Leave blank to use the Data Source's own query"
                onChange={(e) => onChange({ sql: e.target.value })}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Connection Profile
              <SearchableSelect
                ariaLabel="Oracle connection profile"
                value={oracle.connectionProfileId ?? ""}
                placeholder={profiles.length ? "Select a connection profile…" : "No Oracle profiles yet"}
                options={profiles.map((p) => ({ value: p.id, label: p.name }))}
                onChange={(next) => onChange({ connectionProfileId: next })}
              />
            </label>
            <label>
              SQL Query (read-only SELECT)
              <textarea
                rows={4}
                value={oracle.sql ?? ""}
                placeholder="SELECT ... FROM ... WHERE col = :name"
                onChange={(e) => onChange({ sql: e.target.value })}
              />
            </label>
          </>
        )}

        {/* ── Bind parameters ─────────────────────────────────────────────── */}
        <div className="smart-wait-list">
          <div className="smart-wait-list-heading">
            <strong>Bind Parameters</strong>
            <button className="toolbar-button" type="button" onClick={addBind}>
              <Plus size={14} /> Add
            </button>
          </div>
          {binds.length === 0 ? (
            <span className="form-message">No binds. Add a bind to safely pass values into `:name` placeholders.</span>
          ) : (
            binds.map((bind, index) => (
              <div className="smart-wait-card" key={`bind-${index}`}>
                <div className="two-column-fields">
                  <label>
                    Name / :placeholder
                    <input
                      value={bind.name ?? ""}
                      placeholder="name"
                      onChange={(e) => updateBind(index, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    JDBC Type
                    <select value={bind.jdbcType} onChange={(e) => updateBind(index, { jdbcType: e.target.value as OracleNodeBind["jdbcType"] })}>
                      {["STRING", "NUMBER", "INTEGER", "DECIMAL", "BOOLEAN", "DATE", "TIMESTAMP", "NULL"].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="two-column-fields">
                  <label>
                    Value Source
                    <select
                      value={sourceKind(bind.valueSource)}
                      onChange={(e) => updateBind(index, { valueSource: makeSource(e.target.value as BindSourceKind, sourceText(bind.valueSource)) })}
                    >
                      <option value="static">Static value</option>
                      <option value="currentRow">Current data row</option>
                      <option value="workflowInput">Workflow input</option>
                      <option value="instanceVariable">Instance variable</option>
                      <option value="env">Environment variable</option>
                    </select>
                  </label>
                  <label>
                    {sourceKind(bind.valueSource) === "static" ? "Value" : sourceKind(bind.valueSource) === "currentRow" ? "Path" : "Key"}
                    <input
                      value={sourceText(bind.valueSource)}
                      onChange={(e) => updateBind(index, { valueSource: makeSource(sourceKind(bind.valueSource), e.target.value) })}
                    />
                  </label>
                </div>
                <div className="smart-wait-card-head">
                  <label className="inline-check">
                    <input type="checkbox" checked={bind.required ?? false} onChange={(e) => updateBind(index, { required: e.target.checked })} />
                    Required
                  </label>
                  <button className="toolbar-button" type="button" onClick={() => removeBind(index)} title="Remove bind">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Limits ──────────────────────────────────────────────────────── */}
        <div className="two-column-fields">
          <label>
            Query Timeout (ms)
            <input type="number" min={0} value={oracle.timeoutMs ?? 30000} onChange={(e) => onChange({ timeoutMs: Number(e.target.value) })} />
          </label>
          <label>
            Max Rows
            <input type="number" min={1} value={oracle.maxRows ?? 10000} onChange={(e) => onChange({ maxRows: Number(e.target.value) })} />
          </label>
        </div>
        <label>
          Fetch Size
          <input type="number" min={1} value={oracle.fetchSize ?? 200} onChange={(e) => onChange({ fetchSize: Number(e.target.value) })} />
        </label>

        {/* ── Result mapping ──────────────────────────────────────────────── */}
        <label>
          Return Type
          <select value={oracle.returnType} onChange={(e) => onChange({ returnType: e.target.value as OracleNodeConfig["returnType"] })}>
            <option value="string">String (single value)</option>
            <option value="number">Number (single value)</option>
            <option value="boolean">Boolean (single value)</option>
            <option value="list">List (rows or a column)</option>
          </select>
        </label>

        {scalar || (oracle.returnType === "list" && oracle.listMode === "column") ? (
          <label>
            Column
            <input
              value={oracle.selectedColumn ?? ""}
              placeholder="Column name to read"
              onChange={(e) => onChange({ selectedColumn: e.target.value })}
            />
          </label>
        ) : null}

        {scalar ? (
          <>
            <div className="two-column-fields">
              <label>
                Row Index
                <input type="number" min={0} value={oracle.selectedRowIndex ?? 0} onChange={(e) => onChange({ selectedRowIndex: Number(e.target.value) })} />
              </label>
              <label>
                Multiple Rows
                <select value={oracle.multiRowBehavior ?? "first"} onChange={(e) => onChange({ multiRowBehavior: e.target.value as OracleNodeConfig["multiRowBehavior"] })}>
                  <option value="first">Use selected row</option>
                  <option value="error">Fail if more than one row</option>
                </select>
              </label>
            </div>
            <label>
              When Empty
              <select value={oracle.emptyBehavior ?? "null"} onChange={(e) => onChange({ emptyBehavior: e.target.value as OracleNodeConfig["emptyBehavior"] })}>
                <option value="null">Return null</option>
                <option value="default">Return a default value</option>
                <option value="error">Fail the step</option>
              </select>
            </label>
            {oracle.emptyBehavior === "default" ? (
              <label>
                Default Value
                <input value={oracle.defaultValue ?? ""} onChange={(e) => onChange({ defaultValue: e.target.value })} />
              </label>
            ) : null}
          </>
        ) : null}

        {oracle.returnType === "boolean" ? (
          <div className="two-column-fields">
            <label>
              True values
              <input value={oracle.booleanTrueValues ?? ""} placeholder="Y,1,true,YES" onChange={(e) => onChange({ booleanTrueValues: e.target.value })} />
            </label>
            <label>
              False values
              <input value={oracle.booleanFalseValues ?? ""} placeholder="N,0,false,NO" onChange={(e) => onChange({ booleanFalseValues: e.target.value })} />
            </label>
          </div>
        ) : null}

        {oracle.returnType === "list" ? (
          <label>
            List Contents
            <select value={oracle.listMode ?? "rows"} onChange={(e) => onChange({ listMode: e.target.value as OracleNodeConfig["listMode"] })}>
              <option value="rows">Array of row objects</option>
              <option value="column">Array of a single column's values</option>
            </select>
          </label>
        ) : null}

        <label>
          Output Variable (optional)
          <input
            value={oracle.outputVariable ?? ""}
            placeholder="Instance variable to store the result"
            onChange={(e) => onChange({ outputVariable: e.target.value })}
          />
        </label>

        <span className="form-message">
          Read-only queries only (SELECT / WITH … SELECT). Values are always passed as prepared-statement binds — never
          concatenated into SQL. Credentials stay in the secure store and never appear in the workflow.
        </span>
      </section>
    </details>
  );
}
