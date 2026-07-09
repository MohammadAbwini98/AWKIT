import { Trash2 } from "lucide-react";
import type {
  ConditionalConnectorConfig,
  ConnectorConditionOperator,
  ConnectorConditionSource,
  ConnectorKind,
  EdgeVisualStyle,
  FlowEdgeType,
  LoopConnectorConfig,
  ParallelConnectorConfig
} from "@src/profiles/FlowProfile";
import { connectorTypeColor } from "../shared/connectorStyle";
import { ConnectorStyleEditor } from "../shared/ConnectorStyleEditor";

export type FlowConnectionData = {
  linkType: FlowEdgeType;
  label?: string;
  expression?: string;
  style?: EdgeVisualStyle;
  maxLoopCount?: number;
  /** Structured connector category (Checkpoint B). */
  kind?: ConnectorKind;
  conditional?: ConditionalConnectorConfig;
  parallel?: ParallelConnectorConfig;
  loop?: LoopConnectorConfig;
  /**
   * Display-only fields injected per-render by the canvas (Flow Designer `edgesForCanvas`) for the
   * `templateSmooth` edge. NEVER persisted — `toFlowProfile` reads connector fields explicitly and
   * ignores these.
   */
  showAddButton?: boolean;
  onInsertNode?: (edgeId: string) => void;
};

const OPERATOR_OPTIONS: { value: ConnectorConditionOperator; label: string }[] = [
  { value: "always", label: "Always" },
  { value: "equals", label: "equals" },
  { value: "notEquals", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "notContains", label: "not contains" },
  { value: "exists", label: "exists" },
  { value: "notExists", label: "not exists" },
  { value: "greaterThan", label: "greater than" },
  { value: "greaterThanOrEqual", label: "≥" },
  { value: "lessThan", label: "less than" },
  { value: "lessThanOrEqual", label: "≤" },
  { value: "truthy", label: "is truthy" },
  { value: "falsy", label: "is falsy" }
];

const SOURCE_OPTIONS: { value: ConnectorConditionSource; label: string }[] = [
  { value: "outcome", label: "Node outcome" },
  { value: "status", label: "Node status" },
  { value: "errorCode", label: "Error code" },
  { value: "variable", label: "Variable / output" },
  { value: "dataSourceValue", label: "Data source value" }
];

const KIND_TO_LINKTYPE: Record<ConnectorKind, FlowEdgeType> = {
  normal: "success",
  conditional: "conditional",
  parallel: "parallel",
  loop: "loop"
};

function deriveKind(data?: FlowConnectionData): ConnectorKind {
  if (data?.kind) return data.kind;
  switch (data?.linkType) {
    case "conditional":
    case "outcome":
      return "conditional";
    case "parallel":
      return "parallel";
    case "loop":
    case "loopBack":
      return "loop";
    default:
      return "normal";
  }
}

export interface SelectedConnection {
  id: string;
  source: string;
  target: string;
  data?: FlowConnectionData;
}

interface ConnectionPropertiesPanelProps {
  edge: SelectedConnection | null;
  onUpdate: (edgeId: string, patch: Partial<FlowConnectionData>) => void;
  onDelete: (edgeId: string) => void;
  /** Available data sources for loop-connector (dataSource mode) selection. */
  dataSources?: { id: string; name: string }[];
  /**
   * True when the edge's source node already has a self-loop connector (Point 3): the
   * kind selector is locked to Conditional for every other outgoing connector from that node.
   */
  sourceHasLoop?: boolean;
}

/** Re-exported for backward compatibility; the connector colors now live in the shared module. */
export const flowLinkTypeColor: Record<FlowEdgeType, string> = connectorTypeColor as Record<FlowEdgeType, string>;

const linkTypeOptions: { value: FlowEdgeType; label: string }[] = [
  { value: "success", label: "Success" },
  { value: "failure", label: "Failure" },
  { value: "always", label: "Always" },
  { value: "conditional", label: "Conditional" },
  { value: "outcome", label: "Outcome-based" },
  { value: "manualApproval", label: "Manual approval" },
  { value: "loop", label: "Loop" },
  { value: "loopBack", label: "Loop Back" },
  { value: "parallel", label: "Parallel" }
];

export function ConnectionPropertiesPanel({ edge, onUpdate, onDelete, dataSources = [], sourceHasLoop = false }: ConnectionPropertiesPanelProps) {
  const kind = edge ? deriveKind(edge.data) : "normal";
  const cond = edge?.data?.conditional;
  const par = edge?.data?.parallel;
  const lp = edge?.data?.loop;
  // Rule 3/4: a conditional/parallel connector is part of a locked pair — its kind (and type)
  // can't be changed until a connector is removed (which reverts the survivor to Normal).
  // Rule 1: loop is created only by the node's loop button, never selected here.
  const isBranch = kind === "conditional" || kind === "parallel";
  const kindLocked = isBranch || kind === "loop" || sourceHasLoop;

  const onKindChange = (nextKind: ConnectorKind) => {
    if (!edge || kindLocked) return;
    if (nextKind === "loop") return; // loop is button-managed, never selectable
    const patch: Partial<FlowConnectionData> = { kind: nextKind, linkType: KIND_TO_LINKTYPE[nextKind] };
    if (nextKind === "conditional" && !edge.data?.conditional) {
      patch.conditional = { sourceField: "outcome", operator: "equals", expectedValue: "", priority: 0 };
    }
    if (nextKind === "parallel" && !edge.data?.parallel) {
      patch.parallel = { joinMode: "waitAll", failMode: "failFast" };
    }
    onUpdate(edge.id, patch);
  };

  return (
    <aside className="properties-panel template-config-drawer connection-config-drawer">
      <div className="properties-heading with-action template-drawer-header">
        <div className="drawer-title-row">
          <div className="drawer-node-icon connector-icon" aria-hidden="true">
            ↗
          </div>
          <div className="properties-heading-text">
            <h2>Connection</h2>
            <span>{edge ? `${edge.source} → ${edge.target}` : "No connection selected"}</span>
          </div>
        </div>
        {edge ? (
          <button className="icon-button danger" onClick={() => onDelete(edge.id)} title="Delete connection" type="button">
            <Trash2 size={17} />
          </button>
        ) : null}
      </div>

      <div className="properties-tabs" role="tablist" aria-label="Connection configuration tabs">
        <button className="properties-tab active" type="button" role="tab" aria-selected="true">
          Setup
        </button>
        <button className="properties-tab" type="button" role="tab" aria-selected="false" disabled title="Not available yet">
          Test
        </button>
      </div>

      <div className="properties-body">
      {edge ? (
        <>
          <section className="property-section">
            <h3>Connection</h3>
            <label>
              Connector kind
              <select value={kind} disabled={kindLocked} onChange={(event) => onKindChange(event.target.value as ConnectorKind)}>
                <option value="normal">Normal</option>
                <option value="conditional">Conditional</option>
                <option value="parallel">Parallel</option>
                {/* Loop is created only by the node's loop button (Rule 1); shown disabled so an
                    existing loop connector still displays, but it can never be selected here. */}
                <option disabled value="loop">
                  Loop
                </option>
              </select>
              {isBranch ? (
                <small>
                  {kind === "conditional" ? "Conditional" : "Parallel"} connectors come in a locked pair. Remove one connector to
                  change the kind — the remaining connector reverts to Normal automatically.
                </small>
              ) : kind === "loop" ? (
                <small>Loop connectors are managed by the node&apos;s loop button. Remove the loop to change this connector.</small>
              ) : sourceHasLoop ? (
                <small>
                  This node has a loop connector. Additional outgoing connectors must be Conditional. Remove the loop connector to
                  choose another connector kind.
                </small>
              ) : null}
            </label>
            <label>
              Type (visual / legacy)
              <select
                value={edge.data?.linkType ?? "success"}
                disabled={kindLocked}
                onChange={(event) => onUpdate(edge.id, { linkType: event.target.value as FlowEdgeType })}
              >
                {linkTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Label
              <input
                value={edge.data?.label ?? ""}
                placeholder="Optional edge label"
                onChange={(event) => onUpdate(edge.id, { label: event.target.value })}
              />
            </label>

            {kind === "conditional" ? (
              <>
                <label>
                  Source field
                  <select
                    value={cond?.sourceField ?? "outcome"}
                    onChange={(event) =>
                      onUpdate(edge.id, { conditional: { ...(cond ?? { operator: "equals" }), sourceField: event.target.value as ConnectorConditionSource } })
                    }
                  >
                    {SOURCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {cond?.sourceField === "variable" || cond?.sourceField === "dataSourceValue" ? (
                  <label>
                    Variable / path
                    <input
                      value={cond?.variableName ?? ""}
                      placeholder="outputs.flow.status"
                      onChange={(event) => onUpdate(edge.id, { conditional: { ...(cond ?? { sourceField: "variable", operator: "equals" }), variableName: event.target.value } })}
                    />
                  </label>
                ) : null}
                <label>
                  Operator
                  <select
                    value={cond?.operator ?? "equals"}
                    onChange={(event) =>
                      onUpdate(edge.id, { conditional: { ...(cond ?? { sourceField: "outcome" }), operator: event.target.value as ConnectorConditionOperator } })
                    }
                  >
                    {OPERATOR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {cond?.operator && !["always", "exists", "notExists", "truthy", "falsy"].includes(cond.operator) ? (
                  <label>
                    Expected value
                    <input
                      value={String(cond?.expectedValue ?? "")}
                      placeholder="success"
                      onChange={(event) => onUpdate(edge.id, { conditional: { ...(cond ?? { sourceField: "outcome", operator: "equals" }), expectedValue: event.target.value } })}
                    />
                  </label>
                ) : null}
                <label>
                  Priority
                  <input
                    type="number"
                    value={cond?.priority ?? 0}
                    onChange={(event) => onUpdate(edge.id, { conditional: { ...(cond ?? { sourceField: "outcome", operator: "equals" }), priority: parseInt(event.target.value, 10) || 0 } })}
                  />
                  <small>Higher priority wins when multiple conditional connectors match.</small>
                </label>
              </>
            ) : null}

            {kind === "parallel" ? (
              <>
                <label>
                  Join mode
                  <select
                    value={par?.joinMode ?? "waitAll"}
                    onChange={(event) => onUpdate(edge.id, { parallel: { ...(par ?? { failMode: "failFast" }), joinMode: event.target.value as ParallelConnectorConfig["joinMode"] } })}
                  >
                    <option value="waitAll">Wait all</option>
                    <option value="waitAny">Wait any</option>
                  </select>
                </label>
                <label>
                  Fail mode
                  <select
                    value={par?.failMode ?? "failFast"}
                    onChange={(event) => onUpdate(edge.id, { parallel: { ...(par ?? { joinMode: "waitAll" }), failMode: event.target.value as ParallelConnectorConfig["failMode"] } })}
                  >
                    <option value="failFast">Fail fast</option>
                    <option value="collectErrors">Collect errors</option>
                  </select>
                </label>
                <label>
                  Execution
                  <select
                    value={par?.isolation ?? "sharedPage"}
                    onChange={(event) => onUpdate(edge.id, { parallel: { ...(par ?? { joinMode: "waitAll", failMode: "failFast" }), isolation: event.target.value as ParallelConnectorConfig["isolation"] } })}
                  >
                    <option value="sharedPage">Shared page (sequential, safe)</option>
                    <option value="isolatedPage">Isolated pages (concurrent)</option>
                  </select>
                </label>
                {par?.isolation === "isolatedPage" ? (
                  <label>
                    Max concurrency
                    <input
                      type="number"
                      min={1}
                      max={16}
                      value={par?.maxConcurrency ?? 0}
                      placeholder="all branches"
                      onChange={(event) => onUpdate(edge.id, { parallel: { ...(par ?? { joinMode: "waitAll", failMode: "failFast" }), maxConcurrency: parseInt(event.target.value, 10) || undefined } })}
                    />
                  </label>
                ) : null}
                <span className="form-message">
                  Shared page = sequential fan-out on the current page (no concurrent UI mutation). Isolated pages = each branch
                  runs concurrently on its own page in the same browser context (shared session, independent DOM). Set the same
                  modes on every parallel connector leaving this node.
                </span>
              </>
            ) : null}

            {kind === "loop" ? (
              <>
                <label>
                  Loop mode
                  <select
                    value={lp?.mode ?? "count"}
                    onChange={(event) => onUpdate(edge.id, { loop: { ...(lp ?? { maxIterations: 3 }), mode: event.target.value as LoopConnectorConfig["mode"] } })}
                  >
                    <option value="count">Count</option>
                    <option value="staticList">Static list</option>
                    <option value="dataSource">Data source</option>
                    <option value="whileCondition">While condition</option>
                  </select>
                </label>
                <label>
                  Max iterations
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={lp?.maxIterations ?? 3}
                    onChange={(event) => onUpdate(edge.id, { loop: { ...(lp ?? { mode: "count" }), maxIterations: parseInt(event.target.value, 10) || 1 } })}
                  />
                </label>
                {lp?.mode === "staticList" ? (
                  <label>
                    Static values (comma-separated)
                    <input
                      value={(lp?.staticValues ?? []).join(", ")}
                      placeholder="customer1, customer2, customer3"
                      onChange={(event) =>
                        onUpdate(edge.id, {
                          loop: { ...(lp ?? { mode: "staticList", maxIterations: 3 }), staticValues: event.target.value.split(",").map((v) => v.trim()).filter(Boolean) }
                        })
                      }
                    />
                  </label>
                ) : null}
                {lp?.mode === "dataSource" ? (
                  <>
                    <label>
                      Data source
                      <select
                        value={lp?.dataSourceId ?? ""}
                        onChange={(event) => onUpdate(edge.id, { loop: { ...(lp ?? { mode: "dataSource", maxIterations: 3 }), dataSourceId: event.target.value || undefined } })}
                      >
                        <option value="">Workflow data source (default)</option>
                        {dataSources.map((ds) => (
                          <option key={ds.id} value={ds.id}>
                            {ds.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Row key (optional)
                      <input
                        value={lp?.dataSourceBinding ?? ""}
                        placeholder="email — leave blank to pass the whole row"
                        onChange={(event) => onUpdate(edge.id, { loop: { ...(lp ?? { mode: "dataSource", maxIterations: 3 }), dataSourceBinding: event.target.value } })}
                      />
                    </label>
                  </>
                ) : null}
                <label>
                  Parameter name (runtime input)
                  <input
                    value={lp?.parameterName ?? ""}
                    placeholder="item"
                    onChange={(event) => onUpdate(edge.id, { loop: { ...(lp ?? { mode: "count", maxIterations: 3 }), parameterName: event.target.value } })}
                  />
                  <small>The target node reads this via a runtimeInput value source.</small>
                </label>
                <label>
                  Delay between iterations (ms)
                  <input
                    type="number"
                    min={0}
                    value={lp?.delayMs ?? 0}
                    onChange={(event) => onUpdate(edge.id, { loop: { ...(lp ?? { mode: "count", maxIterations: 3 }), delayMs: parseInt(event.target.value, 10) || 0 } })}
                  />
                </label>
                {lp?.mode === "whileCondition" ? (
                  <span className="form-message">
                    While-condition loops repeat the target while the condition holds (set it as a Conditional connector on the
                    target), bounded by Max iterations.
                  </span>
                ) : null}
              </>
            ) : null}
          </section>

          <ConnectorStyleEditor
            style={edge.data?.style}
            onChange={(patch) => onUpdate(edge.id, { style: { ...edge.data?.style, ...patch } })}
            onReset={() => onUpdate(edge.id, { style: undefined })}
          />

          <section className="property-section">
            <h3>Actions</h3>
            <button className="toolbar-button" onClick={() => onDelete(edge.id)} type="button">
              <Trash2 size={14} />
              Delete connection
            </button>
          </section>
        </>
      ) : (
        <div className="empty-properties">Select a connection on the canvas to edit its type, label, and condition.</div>
      )}
      </div>

      {/* Connector edits are live-bound (onUpdate) — no fake save. "Run Test" has no runtime yet,
          so it stays disabled; "Done" is a safe no-op affordance matching the template drawer. */}
      <div className="properties-footer">
        <button className="toolbar-button" type="button" disabled title="Not available yet">
          Run Test
        </button>
        <button className="toolbar-button primary" type="button" disabled={!edge}>
          Done
        </button>
      </div>
    </aside>
  );
}
