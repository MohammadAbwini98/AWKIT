import { useEffect, useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import type { CanvasNode as Node } from "../canvas";
import type { FlowDesignerNodeData } from "./flowDesignerTypes";
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from "./flowDesignerTypes";
import { getNodeDefinition } from "./flowNodeRegistry";
import { SearchableSelect } from "../shared/SearchableSelect";
import { OracleNodeSection } from "./OracleNodeSection";
import { defaultOracleNodeConfig } from "./flowDesignerTypes";
import type { AsyncCompletionMode, LoaderCompletion, OracleNodeConfig, WaitCondition, WaitHttpMethod } from "@src/profiles/FlowProfile";
import { classLabel, reviewWait } from "@src/profiles/asyncCompletionReview";

/** Completion-policy options for the Async Completion editor. */
const COMPLETION_MODES: { id: AsyncCompletionMode; label: string }[] = [
  { id: "allRequired", label: "All required (default)" },
  { id: "networkThenUi", label: "Network then UI" },
  { id: "anyRequired", label: "Any required" },
  { id: "quietPeriod", label: "Quiet period" }
];

/** New-condition scaffolds for the Async Completion editor. */
const WAIT_SCAFFOLDS: Record<"api" | "loader" | "ui" | "table" | "group" | "poll", () => WaitCondition> = {
  api: () => ({ type: "response", method: "GET", urlContains: "", statusRange: [200, 299], armBeforeAction: true }),
  loader: () => ({ type: "loaderHidden", locator: { strategy: "css", value: "" }, appearanceGraceMs: 1500, mustAppear: false, completion: "hidden" }),
  ui: () => ({ type: "textVisible", text: "" }),
  table: () => ({ type: "tableHasRows", tableLocator: { strategy: "css", value: "" }, minRows: 1 }),
  // OR-group (awkit-y24), scaffolded with the empty-result contract's two branches: rows OR empty-state.
  group: () => ({ type: "anyOf", conditions: [
    { type: "tableHasRows", tableLocator: { strategy: "css", value: "" }, minRows: 1 },
    { type: "textVisible", text: "" }
  ] }),
  // 202 → poll-to-terminal (awkit-4km C1).
  poll: () => ({ type: "apiPolling", urlContains: "", pollingStatus: 202, maxAttempts: 30 })
};

interface DataSourceOption {
  id: string;
  name: string;
}

interface FlowNodePropertiesPanelProps {
  selectedNode: Node<FlowDesignerNodeData> | null;
  validationMessages: string[];
  dataSources: DataSourceOption[];
  flows: DataSourceOption[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onUpdateNode: (nodeId: string, data: Partial<FlowDesignerNodeData>) => void;
  onDelete?: () => void;
}

export function FlowNodePropertiesPanel({
  selectedNode,
  validationMessages,
  dataSources,
  flows,
  collapsed,
  onToggleCollapsed,
  onUpdateNode,
  onDelete
}: FlowNodePropertiesPanelProps) {
  // Saved sessions for the Reuse Session node's dropdown (fetched from the Main process).
  const [availableSessions, setAvailableSessions] = useState<{ id: string; name: string; targetUrl?: string }[]>([]);
  const stepType = selectedNode?.data.stepType;
  useEffect(() => {
    if (stepType !== "reuseSession") return;
    let cancelled = false;
    window.playwrightFlowStudio.session
      .list()
      .then((sessions) => {
        if (cancelled) return;
        setAvailableSessions(
          sessions.filter((s) => s.status === "ready").map((s) => ({ id: s.id, name: s.name, targetUrl: s.targetUrl }))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [stepType]);

  if (collapsed) {
    return (
      <aside className="properties-panel collapsed">
        <button className="icon-button" onClick={onToggleCollapsed} title="Show Node Properties" type="button">
          <PanelRightOpen size={16} />
        </button>
        <span className="panel-rail-label">Node Properties</span>
      </aside>
    );
  }

  const data = selectedNode?.data;
  const definition = data ? getNodeDefinition(data.stepType) : null;
  const has = (section: Parameters<NonNullable<typeof definition>["sections"]["includes"]>[0]) =>
    definition?.sections.includes(section) ?? false;
  const set = (patch: Partial<FlowDesignerNodeData>) => selectedNode && onUpdateNode(selectedNode.id, patch);
  const typeErrors = data && definition ? definition.validate(data) : [];
  // A recorded locator that resolves to multiple elements must not read as "valid".
  const locatorQualityErrors =
    data?.locatorQuality && data.locatorQuality.isUnique === false
      ? [data.locatorQuality.warning ?? `${data.name} locator matches ${data.locatorQuality.matchCount} elements (not unique).`]
      : [];
  const kind = data?.valueSourceType === "dynamic" ? "dynamic" : "static";
  const smartWaitCount = (data?.beforeWaits?.length ?? 0) + (data?.afterWaits?.length ?? 0);
  const updateWait = (phase: "beforeWaits" | "afterWaits", index: number, patch: Partial<WaitCondition>) => {
    if (!data) return;
    const waits = [...(data[phase] ?? [])];
    waits[index] = { ...waits[index], ...patch } as WaitCondition;
    set({ [phase]: waits } as Partial<FlowDesignerNodeData>);
  };
  const removeWait = (phase: "beforeWaits" | "afterWaits", index: number) => {
    if (!data) return;
    set({ [phase]: data[phase].filter((_, i) => i !== index) } as Partial<FlowDesignerNodeData>);
  };
  const addWait = (phase: "beforeWaits" | "afterWaits", kind: keyof typeof WAIT_SCAFFOLDS) => {
    if (!data) return;
    set({ [phase]: [...(data[phase] ?? []), WAIT_SCAFFOLDS[kind]()] } as Partial<FlowDesignerNodeData>);
  };

  // Type-specific field editors so users can add and fully configure a condition (not just remove it).
  // Takes a generic `update` callback (not phase/index) so the SAME editor renders both a top-level
  // wait and a nested OR-group branch (recursion, no parallel editor). Return type is annotated because
  // the `anyOf` case calls `renderWaitEditor` on its children.
  const renderWaitEditor = (wait: WaitCondition, update: (patch: Partial<WaitCondition>) => void): ReactNode => {
    switch (wait.type) {
      case "response":
        return (
          <>
            <label>
              Method
              <select
                value={wait.method ?? "ANY"}
                onChange={(e) => update({ method: e.target.value === "ANY" ? undefined : (e.target.value as WaitHttpMethod) })}
              >
                {["ANY", "GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label>
              URL contains
              <input value={wait.urlContains ?? ""} placeholder="/api/orders" onChange={(e) => update({ urlContains: e.target.value })} />
            </label>
            <div className="async-status-row">
              <label>
                Status ≥
                <input
                  type="number"
                  value={wait.statusRange?.[0] ?? 200}
                  onChange={(e) => update({ statusRange: [Number(e.target.value), wait.statusRange?.[1] ?? 299] as [number, number] })}
                />
              </label>
              <label>
                ≤
                <input
                  type="number"
                  value={wait.statusRange?.[1] ?? 299}
                  onChange={(e) => update({ statusRange: [wait.statusRange?.[0] ?? 200, Number(e.target.value)] as [number, number] })}
                />
              </label>
            </div>
            <label className="inline-check">
              <input type="checkbox" checked={wait.armBeforeAction ?? false} onChange={(e) => update({ armBeforeAction: e.target.checked })} />
              Arm before action (catch fast responses)
            </label>
          </>
        );
      case "loaderHidden":
        return (
          <>
            <label>
              Loader locator (CSS)
              <input
                value={wait.locator?.value ?? ""}
                placeholder=".spinner"
                onChange={(e) => update({ locator: { strategy: wait.locator?.strategy ?? "css", value: e.target.value } })}
              />
            </label>
            <div className="async-status-row">
              <label>
                Appearance grace (ms)
                <input
                  type="number"
                  value={wait.appearanceGraceMs ?? ""}
                  placeholder="1500"
                  onChange={(e) => update({ appearanceGraceMs: e.target.value ? Number(e.target.value) : undefined })}
                />
              </label>
              <label>
                Completion
                <select value={wait.completion ?? "hidden"} onChange={(e) => update({ completion: e.target.value as LoaderCompletion })}>
                  <option value="hidden">Hidden</option>
                  <option value="detached">Detached</option>
                  <option value="ariaBusyFalse">aria-busy = false</option>
                </select>
              </label>
            </div>
            <label className="inline-check">
              <input type="checkbox" checked={wait.mustAppear ?? false} onChange={(e) => update({ mustAppear: e.target.checked })} />
              Must appear (fail if the loader never shows)
            </label>
          </>
        );
      case "textVisible":
        return (
          <>
            <label>
              Text
              <input value={wait.text ?? ""} placeholder="Saved successfully" onChange={(e) => update({ text: e.target.value })} />
            </label>
            <label className="inline-check">
              <input type="checkbox" checked={wait.exact ?? false} onChange={(e) => update({ exact: e.target.checked })} />
              Match exactly
            </label>
          </>
        );
      case "tableHasRows":
        return (
          <div className="async-status-row">
            <label>
              Table locator
              <input
                value={wait.tableLocator?.value ?? ""}
                placeholder="#results"
                onChange={(e) => update({ tableLocator: { strategy: wait.tableLocator?.strategy ?? "css", value: e.target.value } })}
              />
            </label>
            <label>
              Min rows
              <input type="number" min={0} value={wait.minRows ?? 1} onChange={(e) => update({ minRows: Number(e.target.value) })} />
            </label>
          </div>
        );
      case "listHasItems":
        return (
          <div className="async-status-row">
            <label>
              List locator
              <input
                value={wait.listLocator?.value ?? ""}
                placeholder=".cards"
                onChange={(e) => update({ listLocator: { strategy: wait.listLocator?.strategy ?? "css", value: e.target.value } })}
              />
            </label>
            <label>
              Min items
              <input type="number" min={0} value={wait.minItems ?? 1} onChange={(e) => update({ minItems: Number(e.target.value) })} />
            </label>
          </div>
        );
      case "apiPolling":
        return (
          <>
            <label>
              Poll URL contains
              <input value={wait.urlContains ?? ""} placeholder="/api/jobs/" onChange={(e) => update({ urlContains: e.target.value })} />
            </label>
            <div className="async-status-row">
              <label>
                Still-processing status
                <input type="number" value={wait.pollingStatus ?? 202} onChange={(e) => update({ pollingStatus: Number(e.target.value) })} />
              </label>
              <label>
                Max polls
                <input type="number" min={1} value={wait.maxAttempts ?? 30} onChange={(e) => update({ maxAttempts: Number(e.target.value) })} />
              </label>
            </div>
            <label>
              Terminal field (optional)
              <input value={wait.responseField ?? ""} placeholder="status" onChange={(e) => update({ responseField: e.target.value || undefined })} />
            </label>
            <label>
              Terminal values (comma-separated)
              <input
                value={(wait.terminalValues ?? []).join(", ")}
                placeholder="succeeded, failed"
                onChange={(e) => update({ terminalValues: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })}
              />
            </label>
          </>
        );
      case "anyOf": {
        // OR-group branch editor (awkit-y24): passes when ANY branch matches. Keep the step on
        // "All required" so an armed API response AND this group both gate completion.
        const branches = wait.conditions ?? [];
        const setBranches = (next: WaitCondition[]) => update({ conditions: next } as Partial<WaitCondition>);
        const addBranch = (kind: keyof typeof WAIT_SCAFFOLDS) => setBranches([...branches, WAIT_SCAFFOLDS[kind]()]);
        return (
          <div className="anyof-group">
            <small className="form-message">Passes when ANY branch matches (OR). Combine with “All required” so the API and this group both gate the step.</small>
            <div className="async-add-row">
              <button className="toolbar-button" type="button" onClick={() => addBranch("ui")} title="Add a text/UI outcome branch">
                <Plus size={13} /> UI text
              </button>
              <button className="toolbar-button" type="button" onClick={() => addBranch("table")} title="Add a table-rows branch">
                <Plus size={13} /> Table rows
              </button>
              <button className="toolbar-button" type="button" onClick={() => addBranch("api")} title="Add an API branch">
                <Plus size={13} /> API
              </button>
              <button className="toolbar-button" type="button" onClick={() => addBranch("loader")} title="Add a loader branch">
                <Plus size={13} /> Loader
              </button>
            </div>
            {branches.length ? (
              branches.map((child, i) => {
                const childReview = reviewWait(child);
                const childBadge = classLabel(childReview.classification);
                return (
                  <div className="anyof-branch" key={`branch-${i}-${child.type}`}>
                    <div className="smart-wait-card-head">
                      <strong>{smartWaitTitle(child)}</strong>
                      <span className={`async-badge async-badge-${childReview.classification}`} title={childBadge.hint}>{childBadge.label}</span>
                      <button type="button" className="icon-button" title="Remove branch" onClick={() => setBranches(branches.filter((_, j) => j !== i))}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <span>{smartWaitDetail(child)}</span>
                    {renderWaitEditor(child, (patch) => setBranches(branches.map((b, j) => (j === i ? ({ ...b, ...patch } as WaitCondition) : b))))}
                  </div>
                );
              })
            ) : (
              <small className="async-warning">⚠ Add at least one branch (two make a real OR).</small>
            )}
          </div>
        );
      }
      default:
        return null;
    }
  };

  const renderWaitList = (label: string, phase: "beforeWaits" | "afterWaits", waits: WaitCondition[]) => (
    <div className="smart-wait-list">
      <div className="smart-wait-list-heading">
        <strong>{label}</strong>
        <div className="async-add-row">
          <button className="toolbar-button" type="button" onClick={() => addWait(phase, "api")} title="Add an API/response condition">
            <Plus size={13} /> API
          </button>
          <button className="toolbar-button" type="button" onClick={() => addWait(phase, "loader")} title="Add a loader/spinner condition">
            <Plus size={13} /> Loader
          </button>
          <button className="toolbar-button" type="button" onClick={() => addWait(phase, "ui")} title="Add a UI outcome condition">
            <Plus size={13} /> UI outcome
          </button>
          <button className="toolbar-button" type="button" onClick={() => addWait(phase, "group")} title="Add an OR-group of alternative outcomes (e.g. rows OR empty-state)">
            <Plus size={13} /> OR group
          </button>
          <button className="toolbar-button" type="button" onClick={() => addWait(phase, "poll")} title="Add a 202 → poll-to-terminal condition">
            <Plus size={13} /> Poll
          </button>
        </div>
      </div>
      {waits.length ? (
        waits.map((wait, index) => {
          const review = reviewWait(wait);
          const badge = classLabel(review.classification);
          return (
            <div className="smart-wait-card" key={`${phase}-${index}-${wait.type}`}>
              <div className="smart-wait-card-head">
                <strong>{smartWaitTitle(wait)}</strong>
                <span className={`async-badge async-badge-${review.classification}`} title={badge.hint}>{badge.label}</span>
                <button type="button" className="icon-button" title="Remove condition" onClick={() => removeWait(phase, index)}>
                  <Trash2 size={14} />
                </button>
              </div>
              <span>{smartWaitDetail(wait)}</span>
              {wait.reason ? <small>Evidence: {wait.reason}</small> : null}
              {review.warnings.map((w, i) => (
                <small key={i} className="async-warning">⚠ {w}</small>
              ))}
              {renderWaitEditor(wait, (patch) => updateWait(phase, index, patch))}
              <div className="async-status-row">
                <label className="inline-check">
                  <input type="checkbox" checked={!wait.optional} onChange={(e) => updateWait(phase, index, { optional: !e.target.checked })} />
                  Required
                </label>
                <label>
                  Timeout (ms)
                  <input
                    type="number"
                    min={0}
                    value={wait.timeoutMs ?? ""}
                    placeholder="30000"
                    onChange={(e) => updateWait(phase, index, { timeoutMs: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </label>
              </div>
            </div>
          );
        })
      ) : (
        <span className="form-message">No conditions — add one above.</span>
      )}
    </div>
  );

  return (
    <aside className="properties-panel template-config-drawer">
      <div className="properties-heading with-action template-drawer-header">
        <div className="drawer-title-row">
          <div className="drawer-node-icon" aria-hidden="true">
            <SlidersHorizontal size={18} />
          </div>
          <div className="properties-heading-text">
            <h2>{data?.name ?? "Node Properties"}</h2>
            <span>
              {selectedNode ? selectedNode.id : "No node selected"}
              {definition ? ` · ${definition.category}` : ""}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          {selectedNode ? (
            <button className="icon-button danger" onClick={onDelete} title="Delete node" type="button">
              <Trash2 size={17} />
            </button>
          ) : null}
          <button className="icon-button" onClick={onToggleCollapsed} title="Collapse properties" type="button">
            <PanelRightClose size={16} />
          </button>
        </div>
      </div>

      <div className="properties-tabs" role="tablist" aria-label="Node configuration tabs">
        <button className="properties-tab active" type="button" role="tab" aria-selected="true">
          Setup
        </button>
        <button className="properties-tab" type="button" role="tab" aria-selected="false" disabled title="Not available yet">
          Test
        </button>
      </div>

      <div className="properties-body">
      {data && selectedNode && definition ? (
        <>
          <details className="property-group" open>
            <summary>Basic</summary>
            <section className="property-section">
              <label>
                Name
                <input value={data.name} onChange={(e) => set({ name: e.target.value })} />
              </label>
              <label>
                Description
                <input value={data.description} onChange={(e) => set({ description: e.target.value })} />
              </label>
              <div className="node-size-row">
                <span>
                  Size {Math.round(data.width)}×{Math.round(data.height)}
                </span>
                <button
                  className="toolbar-button"
                  type="button"
                  title="Reset node size to default"
                  disabled={data.width === DEFAULT_NODE_WIDTH && data.height === DEFAULT_NODE_HEIGHT}
                  onClick={() => set({ width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT })}
                >
                  Reset size
                </button>
              </div>
            </section>
          </details>

          {has("locator") ? (
            <details className="property-group" open>
              <summary>Locator</summary>
              <section className="property-section">
                <label>
                  Strategy
                  <select value={data.locatorStrategy} onChange={(e) => set({ locatorStrategy: e.target.value as FlowDesignerNodeData["locatorStrategy"], locatorQuality: undefined })}>
                    <option value="role">Role</option>
                    <option value="label">Label</option>
                    <option value="placeholder">Placeholder</option>
                    <option value="text">Text</option>
                    <option value="testId">Test ID</option>
                    <option value="id">ID</option>
                    <option value="css">CSS</option>
                    <option value="xpath">XPath</option>
                    <option value="tagName">Tag Name</option>
                  </select>
                </label>
                <label>
                  Value
                  {/* Editing the value invalidates recorder uniqueness metadata. */}
                  <input value={data.locatorValue} onChange={(e) => set({ locatorValue: e.target.value, locatorQuality: undefined })} />
                </label>
                <label>
                  Accessible Name
                  <input value={data.locatorName} onChange={(e) => set({ locatorName: e.target.value, locatorQuality: undefined })} />
                </label>
                {data.locatorStrategy === "role" || data.locatorStrategy === "text" || data.locatorStrategy === "label" || data.locatorStrategy === "placeholder" ? (
                  <label className="inline-check">
                    <input type="checkbox" checked={data.locatorExact} onChange={(e) => set({ locatorExact: e.target.checked })} />
                    Match exactly
                  </label>
                ) : null}
                {data.locatorQuality ? (
                  <div className={`locator-quality ${data.locatorQuality.isUnique ? "ok" : "warn"}`}>
                    <strong>
                      {data.locatorQuality.isUnique
                        ? `Locator quality: Unique · ${data.locatorQuality.confidence} confidence${
                            data.locatorQuality.disambiguation === "container"
                              ? " · scoped to container"
                              : data.locatorQuality.disambiguation === "compound"
                                ? " · compound selector"
                                : data.locatorQuality.disambiguation === "positional"
                                  ? " · positional fallback"
                                  : ""
                          }`
                        : `Locator warning: matches ${data.locatorQuality.matchCount} elements`}
                    </strong>
                    {data.locatorQuality.warning ? <span>{data.locatorQuality.warning}</span> : null}
                    <span className="locator-quality-meta">
                      Strategy: {data.locatorQuality.strategy}
                      {typeof data.locatorQuality.candidateCount === "number" ? ` · ${data.locatorQuality.candidateCount} candidates evaluated` : ""}
                    </span>
                  </div>
                ) : null}
              </section>
            </details>
          ) : null}

          {has("locator") || stepType === "goto" || stepType === "routeChange" ? (
            <details className="property-group" open={smartWaitCount > 0}>
              <summary>Async Completion</summary>
              <section className="property-section">
                <label>
                  Completion policy
                  <select
                    value={data.completionMode ?? "allRequired"}
                    onChange={(e) => set({ completionMode: e.target.value === "allRequired" ? undefined : (e.target.value as AsyncCompletionMode) })}
                  >
                    {COMPLETION_MODES.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <p className="form-message">
                  How the after-action conditions combine. Add API, loader, and UI-outcome conditions below;
                  each can be required or optional. Recorded conditions carry their observed evidence.
                </p>
                {renderWaitList("Before action", "beforeWaits", data.beforeWaits ?? [])}
                {renderWaitList("After action", "afterWaits", data.afterWaits ?? [])}
              </section>
            </details>
          ) : null}

          {has("select") ? (
            <details className="property-group" open>
              <summary>Selection</summary>
              <section className="property-section">
                <label>
                  Selection mode
                  <select value={data.selectionMode} onChange={(e) => set({ selectionMode: e.target.value as FlowDesignerNodeData["selectionMode"] })}>
                    <option value="value">By value</option>
                    <option value="label">By label</option>
                    <option value="index">By index</option>
                  </select>
                </label>
                <label className="inline-check">
                  <input type="checkbox" checked={data.selectMultiple} onChange={(e) => set({ selectMultiple: e.target.checked })} />
                  Allow multiple selection
                </label>
              </section>
            </details>
          ) : null}

          {has("value") ? (
            <details className="property-group" open>
              <summary>Value Source</summary>
              <section className="property-section">
                <label>
                  Type
                  <select value={kind} onChange={(e) => set({ valueSourceType: e.target.value as FlowDesignerNodeData["valueSourceType"] })}>
                    <option value="static">Static</option>
                    <option value="dynamic">Dynamic</option>
                  </select>
                </label>
                {kind === "static" ? (
                  <label>
                    Text Value
                    <input value={data.value} onChange={(e) => set({ value: e.target.value })} />
                  </label>
                ) : (
                  <>
                    <label>
                      Data Source
                      <select value={data.dataSourceScope} onChange={(e) => set({ dataSourceScope: e.target.value as FlowDesignerNodeData["dataSourceScope"] })}>
                        <option value="workflow">Use workflow data source</option>
                        <option value="specific">Choose specific data source</option>
                      </select>
                    </label>
                    {data.dataSourceScope === "specific" ? (
                      <label>
                        JSON Data Source
                        <SearchableSelect
                          ariaLabel="JSON data source"
                          value={data.dataSourceId}
                          placeholder="Select data source…"
                          options={dataSources.map((s) => ({ value: s.id, label: s.name, description: s.id }))}
                          onChange={(next) => set({ dataSourceId: next })}
                        />
                      </label>
                    ) : (
                      <span className="form-message">Resolved from the workflow's data source at run time.</span>
                    )}
                    <label>
                      Key Name
                      <input value={data.keyName} placeholder="email" onChange={(e) => set({ keyName: e.target.value })} />
                    </label>
                  </>
                )}
                {data.stepType === "fill" ? (
                  <label className="inline-check">
                    <input type="checkbox" checked={data.clearBeforeFill} onChange={(e) => set({ clearBeforeFill: e.target.checked })} />
                    Clear before fill
                  </label>
                ) : null}
              </section>
            </details>
          ) : null}

          {has("wait") ? (
            <details className="property-group" open>
              <summary>Wait</summary>
              <section className="property-section">
                <label>
                  Wait type
                  <select value={data.waitType} onChange={(e) => set({ waitType: e.target.value as FlowDesignerNodeData["waitType"] })}>
                    <option value="time">Fixed time</option>
                    <option value="selector">Selector visible</option>
                    <option value="navigation">Navigation</option>
                    <option value="networkIdle">Network idle</option>
                    <option value="textVisible">Text visible</option>
                  </select>
                </label>
                {data.waitType === "time" ? (
                  <label>
                    Duration (ms)
                    <input type="number" min={0} value={data.timeoutMs} onChange={(e) => set({ timeoutMs: Number(e.target.value) })} />
                  </label>
                ) : data.waitType === "selector" ? (
                  <label>
                    Selector
                    <input value={data.locatorValue} onChange={(e) => set({ locatorValue: e.target.value })} />
                  </label>
                ) : data.waitType === "textVisible" ? (
                  <label>
                    Text
                    <input value={data.value} onChange={(e) => set({ value: e.target.value })} />
                  </label>
                ) : (
                  <span className="form-message">Waits for the page to reach this state.</span>
                )}
              </section>
            </details>
          ) : null}

          {has("assertion") ? (
            <details className="property-group" open>
              <summary>Assertion</summary>
              <section className="property-section">
                <label>
                  Assertion type
                  <select value={data.assertionType} onChange={(e) => set({ assertionType: e.target.value as FlowDesignerNodeData["assertionType"] })}>
                    <option value="visible">Element visible</option>
                    <option value="text">Text</option>
                    <option value="value">Input value</option>
                    <option value="count">Element count</option>
                    <option value="url">Page URL</option>
                  </select>
                </label>
                {data.assertionType !== "visible" ? (
                  <>
                    <label>
                      Comparison
                      <select value={data.comparisonOperator} onChange={(e) => set({ comparisonOperator: e.target.value as FlowDesignerNodeData["comparisonOperator"] })}>
                        <option value="equals">Equals</option>
                        <option value="contains">Contains</option>
                        <option value="greaterThan">Greater than</option>
                        <option value="lessThan">Less than</option>
                      </select>
                    </label>
                    <label>
                      Expected value
                      <input value={data.expectedValue} onChange={(e) => set({ expectedValue: e.target.value })} />
                    </label>
                  </>
                ) : null}
              </section>
            </details>
          ) : null}

          {has("screenshot") ? (
            <details className="property-group" open>
              <summary>Screenshot</summary>
              <section className="property-section">
                <label>
                  Screenshot name
                  <input value={data.screenshotName} placeholder="step-name (optional)" onChange={(e) => set({ screenshotName: e.target.value })} />
                </label>
                <label className="inline-check">
                  <input type="checkbox" checked={data.fullPage} onChange={(e) => set({ fullPage: e.target.checked })} />
                  Capture full page
                </label>
                <label>
                  Element locator (optional)
                  <input value={data.locatorValue} placeholder="leave empty for whole page" onChange={(e) => set({ locatorValue: e.target.value })} />
                </label>
                <span className="form-message">Saved under the configured screenshots path and attached to the run report.</span>
              </section>
            </details>
          ) : null}

          {has("scroll") ? (
            <details className="property-group" open>
              <summary>Scroll</summary>
              <section className="property-section">
                <label>
                  Scroll target
                  <select value={data.scrollTarget} onChange={(e) => set({ scrollTarget: e.target.value as FlowDesignerNodeData["scrollTarget"] })}>
                    <option value="page">Page</option>
                    <option value="element">Element</option>
                  </select>
                </label>
                {data.scrollTarget === "element" ? (
                  <label>
                    Element locator
                    <input value={data.locatorValue} onChange={(e) => set({ locatorValue: e.target.value })} />
                  </label>
                ) : null}
                <label>
                  Direction
                  <select value={data.scrollDirection} onChange={(e) => set({ scrollDirection: e.target.value as FlowDesignerNodeData["scrollDirection"] })}>
                    <option value="down">Down</option>
                    <option value="up">Up</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </label>
                <label>
                  Amount (px)
                  <input type="number" min={0} value={data.scrollAmount} onChange={(e) => set({ scrollAmount: Number(e.target.value) })} />
                </label>
              </section>
            </details>
          ) : null}

          {has("loop") ? (
            <details className="property-group" open>
              <summary>Loop</summary>
              <section className="property-section">
                <label>
                  Loop type
                  <select value={data.loopType} onChange={(e) => set({ loopType: e.target.value as FlowDesignerNodeData["loopType"] })}>
                    <option value="fixedCount">Fixed count</option>
                    <option value="elements">Over elements</option>
                    <option value="dataRows">Over data rows</option>
                  </select>
                </label>
                {data.loopType === "fixedCount" ? (
                  <label>
                    Iterations
                    <input type="number" min={1} value={data.iterationCount} onChange={(e) => set({ iterationCount: Number(e.target.value) })} />
                  </label>
                ) : data.loopType === "elements" ? (
                  <label>
                    Element locator
                    <input value={data.locatorValue} onChange={(e) => set({ locatorValue: e.target.value })} />
                  </label>
                ) : (
                  <span className="form-message">Iterates the workflow data source rows.</span>
                )}
                <label>
                  Loop action
                  <select value={data.loopActionType} onChange={(e) => set({ loopActionType: e.target.value as FlowDesignerNodeData["loopActionType"] })}>
                    <option value="click">Click</option>
                    <option value="fill">Fill</option>
                    <option value="scroll">Scroll</option>
                    <option value="delete">Delete</option>
                    <option value="customFlow">Custom flow</option>
                  </select>
                </label>
                <label>
                  Max iterations (guard)
                  <input type="number" min={1} value={data.maxIterations} onChange={(e) => set({ maxIterations: Number(e.target.value) })} />
                </label>
                <label className="inline-check">
                  <input type="checkbox" checked={data.loopStopOnFailure} onChange={(e) => set({ loopStopOnFailure: e.target.checked })} />
                  Stop on failure
                </label>
              </section>
            </details>
          ) : null}

          {has("runFlow") ? (
            <details className="property-group" open>
              <summary>Run Another Flow</summary>
              <section className="property-section">
                <label>
                  Target flow
                  <SearchableSelect
                    ariaLabel="Target flow"
                    value={data.targetFlowId}
                    placeholder="Select a flow…"
                    options={flows.map((f) => ({ value: f.id, label: f.name, description: f.id }))}
                    onChange={(next) => set({ targetFlowId: next })}
                  />
                </label>
                <label className="inline-check">
                  <input type="checkbox" checked={data.stopParentOnChildFailure} onChange={(e) => set({ stopParentOnChildFailure: e.target.checked })} />
                  Stop parent flow if child fails
                </label>
                <span className="form-message">Recursion is guarded (max nested depth 5; self-calls are blocked at run time).</span>
              </section>
            </details>
          ) : null}

          {has("condition") ? (
            <details className="property-group" open>
              <summary>Condition</summary>
              <section className="property-section">
                <label>
                  Expression
                  <input value={data.value} placeholder="${outputs.flow.ok} === 'true'" onChange={(e) => set({ value: e.target.value })} />
                </label>
              </section>
            </details>
          ) : null}

          {has("routeChange") ? (
            <details className="property-group" open>
              <summary>Route Change</summary>
              <section className="property-section">
                <label>
                  Mode
                  <select value={data.routeMode} onChange={(e) => set({ routeMode: e.target.value as FlowDesignerNodeData["routeMode"] })}>
                    <option value="switchToUrl">Switch to existing page by URL</option>
                    <option value="switchToLatestTab">Switch to latest opened tab</option>
                    <option value="waitForNewTab">Wait for a new tab then switch</option>
                    <option value="navigateCurrentPage">Navigate current page to URL</option>
                  </select>
                </label>
                {data.routeMode === "switchToUrl" ? (
                  <label>
                    URL match
                    <select value={data.urlMatch} onChange={(e) => set({ urlMatch: e.target.value as FlowDesignerNodeData["urlMatch"] })}>
                      <option value="contains">Contains</option>
                      <option value="exact">Exact</option>
                      <option value="regex">Regex</option>
                    </select>
                  </label>
                ) : null}
                {data.routeMode === "switchToUrl" || data.routeMode === "navigateCurrentPage" ? (
                  <label>
                    URL value
                    <input value={data.value} placeholder="${BASE_URL}/details" onChange={(e) => set({ value: e.target.value })} />
                  </label>
                ) : (
                  <span className="form-message">
                    {data.routeMode === "waitForNewTab"
                      ? "Waits up to the timeout for a new tab to open, then targets it."
                      : "Targets the most recently opened tab. Subsequent steps use the new page."}
                  </span>
                )}
                <label>
                  Wait until
                  <select value={data.routeWaitUntil} onChange={(e) => set({ routeWaitUntil: e.target.value as FlowDesignerNodeData["routeWaitUntil"] })}>
                    <option value="load">Load</option>
                    <option value="domcontentloaded">DOM content loaded</option>
                    <option value="networkidle">Network idle</option>
                  </select>
                </label>
                <span className="form-message">After this step, later nodes target the switched page/tab.</span>
              </section>
            </details>
          ) : null}

          {has("session") ? (
            <details className="property-group" open>
              <summary>Save Session</summary>
              <section className="property-section">
                <label>
                  Session name
                  <input value={data.sessionName} placeholder="my-login-session" onChange={(e) => set({ sessionName: e.target.value })} />
                </label>
                <label>
                  Target folder (optional)
                  <input
                    value={data.sessionFolder}
                    placeholder="Leave empty for the default sessions folder"
                    onChange={(e) => set({ sessionFolder: e.target.value })}
                  />
                </label>
                <label>
                  Capture scope
                  <select value={data.captureScope} onChange={(e) => set({ captureScope: e.target.value as FlowDesignerNodeData["captureScope"] })}>
                    <option value="context">Current browser context</option>
                    <option value="origin">Current origin only</option>
                  </select>
                </label>
                <label className="inline-check">
                  <input type="checkbox" checked={data.overwriteSession} onChange={(e) => set({ overwriteSession: e.target.checked })} />
                  Overwrite existing session
                </label>
                <label className="inline-check">
                  <input type="checkbox" checked={data.maskSession} onChange={(e) => set({ maskSession: e.target.checked })} />
                  Mask sensitive output in logs
                </label>
                <span className="form-message">
                  Saves cookies + localStorage to the runtime sessions folder ($LOCALAPPDATA/SpecterStudio/sessions). Session
                  files are sensitive local files — never committed or printed.
                </span>
              </section>
            </details>
          ) : null}

          {has("protectedLogin") ? (
            <details className="property-group" open>
              <summary>Protected Login Handoff</summary>
              <section className="property-section">
                <label>
                  Provider
                  <select value={data.loginProvider} onChange={(e) => set({ loginProvider: e.target.value as FlowDesignerNodeData["loginProvider"] })}>
                    <option value="auto">Auto detect</option>
                    <option value="google">Google</option>
                    <option value="microsoft">Microsoft</option>
                    <option value="okta">Okta</option>
                    <option value="auth0">Auth0</option>
                    <option value="duo">Duo</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>
                  Handoff mode
                  <select value={data.handoffMode} onChange={(e) => set({ handoffMode: e.target.value as FlowDesignerNodeData["handoffMode"] })}>
                    <option value="pauseAndAsk">Pause and ask user</option>
                    <option value="openSystemBrowserOAuth">Open system browser OAuth</option>
                    <option value="useSavedSession">Use saved session</option>
                    <option value="useTestSession">Use test session</option>
                    <option value="cancel">Cancel with clear error</option>
                  </select>
                </label>
                <label>
                  Instructions to user
                  <textarea
                    rows={3}
                    value={data.handoffInstructions}
                    placeholder="Explain what the user should do (required for 'Pause and ask user')."
                    onChange={(e) => set({ handoffInstructions: e.target.value })}
                  />
                </label>
                <label className="inline-check">
                  <input type="checkbox" checked={data.detectBeforeHandoff} onChange={(e) => set({ detectBeforeHandoff: e.target.checked })} />
                  Run protected-login detection first
                </label>
                <label className="inline-check">
                  <input type="checkbox" checked={data.allowRetry} onChange={(e) => set({ allowRetry: e.target.checked })} />
                  Allow retry
                </label>
                <label>
                  Timeout (ms, 0 = disabled)
                  <input type="number" min={0} value={data.handoffTimeoutMs} onChange={(e) => set({ handoffTimeoutMs: Number(e.target.value) })} />
                </label>
                <span className="form-message">
                  This node pauses the run and shows approved handoff options. SpecterStudio never bypasses CAPTCHA, MFA, or
                  bot-detection. Unsupported modes (OAuth, saved/test session) are shown disabled with a reason.
                </span>
              </section>
            </details>
          ) : null}

          {has("reuseSession") ? (
            <details className="property-group" open>
              <summary>Saved Session</summary>
              <section className="property-section">
                <label>
                  Mode
                  <select
                    value={data.reuseSessionMode}
                    onChange={(e) => set({ reuseSessionMode: e.target.value as FlowDesignerNodeData["reuseSessionMode"] })}
                  >
                    <option value="autoDetect">Auto detect (match by target URL origin)</option>
                    <option value="selected">Selected session</option>
                  </select>
                </label>
                {data.reuseSessionMode === "selected" ? (
                  <label>
                    Saved Session
                    <SearchableSelect
                      ariaLabel="Saved session"
                      value={data.reuseSessionId}
                      placeholder="Select a saved session…"
                      options={availableSessions.map((s) => ({ value: s.id, label: s.name, description: s.targetUrl }))}
                      onChange={(next) => set({ reuseSessionId: next })}
                    />
                  </label>
                ) : (
                  <label>
                    Target URL (optional)
                    <input
                      value={data.value}
                      placeholder="Leave blank to use the current page URL"
                      onChange={(e) => set({ value: e.target.value })}
                    />
                  </label>
                )}
                <span className="form-message">
                  Loads a previously captured login session (from the Sessions Manager) and restarts the automation browser with
                  that profile. Auto-detect matches a ready session by normalized origin (protocol + host + port); Selected uses a
                  specific session. Only sessions in a "ready" state are listed.
                </span>
              </section>
            </details>
          ) : null}

          {has("oracle") ? (
            <OracleNodeSection
              oracle={data.oracle ?? defaultOracleNodeConfig()}
              onChange={(patch: Partial<OracleNodeConfig>) => set({ oracle: { ...(data.oracle ?? defaultOracleNodeConfig()), ...patch } })}
            />
          ) : null}

          {has("execution") ? (
            <details className="property-group">
              <summary>Execution</summary>
              <section className="property-section">
                <label>
                  Timeout (ms)
                  <input type="number" min={0} value={data.timeoutMs} onChange={(e) => set({ timeoutMs: Number(e.target.value) })} />
                </label>
                <div className="two-column-fields">
                  <label>
                    Retry Count
                    <input type="number" min={0} value={data.retryCount} onChange={(e) => set({ retryCount: Number(e.target.value) })} />
                  </label>
                  <label>
                    Retry Delay
                    <input type="number" min={0} value={data.retryDelayMs} onChange={(e) => set({ retryDelayMs: Number(e.target.value) })} />
                  </label>
                </div>
                <label>
                  Failure Behavior
                  <select value={data.failureAction} onChange={(e) => set({ failureAction: e.target.value as FlowDesignerNodeData["failureAction"] })}>
                    <option value="stop">Stop flow</option>
                    <option value="continue">Continue flow</option>
                    <option value="goToFailureEdge">Go to failure connector</option>
                    <option value="manualHandoff">Trigger manual handoff</option>
                  </select>
                </label>
                <label className="inline-check">
                  <input type="checkbox" checked={data.screenshotOnFailure} onChange={(e) => set({ screenshotOnFailure: e.target.checked })} />
                  Take screenshot on failure
                </label>
              </section>
            </details>
          ) : null}

          {has("output") ? (
            <details className="property-group">
              <summary>Output</summary>
              <section className="property-section">
                <label>
                  Output Key
                  <input value={data.outputKey} onChange={(e) => set({ outputKey: e.target.value })} />
                </label>
              </section>
            </details>
          ) : null}
        </>
      ) : (
        <div className="empty-properties">Select a node on the canvas to edit its configuration.</div>
      )}

      <section className="property-section">
        <h3>Validation</h3>
        <div className="validation-list">
          {[...typeErrors, ...locatorQualityErrors, ...validationMessages].length ? (
            [...typeErrors, ...locatorQualityErrors, ...validationMessages].map((message) => <span key={message}>{message}</span>)
          ) : (
            <strong>Node configuration is valid.</strong>
          )}
        </div>
      </section>
      </div>

      {/* Node edits are live-bound (onUpdateNode) — the footer only offers a safe "Done"/collapse
          action; there is no fake save here. */}
      <div className="properties-footer single">
        <button className="toolbar-button primary" type="button" onClick={onToggleCollapsed}>
          Done
        </button>
      </div>
    </aside>
  );
}

function smartWaitTitle(wait: WaitCondition): string {
  switch (wait.type) {
    case "loaderHidden":
      return "Loader hidden";
    case "elementVisible":
      return "Element visible";
    case "elementHidden":
      return "Element hidden";
    case "elementEnabled":
      return "Element enabled";
    case "textVisible":
      return "Text visible";
    case "toastVisible":
      return "Toast visible";
    case "response":
      return "Response";
    case "tableHasRows":
      return "Table rows";
    case "listHasItems":
      return "List items";
    case "urlChanged":
      return "URL changed";
    case "domStable":
      return "DOM stable";
    case "fixedDelay":
      return "Fixed delay";
    case "anyOf":
      return "Any of (OR)";
    case "apiPolling":
      return "Poll to terminal";
  }
}

function smartWaitDetail(wait: WaitCondition): string {
  switch (wait.type) {
    case "loaderHidden":
    case "elementVisible":
    case "elementHidden":
    case "elementEnabled":
      return `${wait.locator.strategy}: ${wait.locator.value}`;
    case "textVisible":
      return wait.exact ? `"${wait.text}" exactly` : `"${wait.text}"`;
    case "toastVisible":
      return wait.locator ? `${wait.locator.strategy}: ${wait.locator.value}` : wait.text ? `"${wait.text}"` : "[role=alert]";
    case "response":
      return `${wait.method ?? "ANY"} ${wait.urlContains ?? ""} ${(wait.statusRange ?? [200, 399]).join("-")}${wait.armBeforeAction ? " before action" : ""}`;
    case "tableHasRows":
      return `${wait.tableLocator.strategy}: ${wait.tableLocator.value} >= ${wait.minRows}`;
    case "listHasItems":
      return `${wait.listLocator.strategy}: ${wait.listLocator.value} >= ${wait.minItems}`;
    case "urlChanged":
      return wait.urlContains ? `contains ${wait.urlContains}` : wait.fromUrl ? `from ${wait.fromUrl}` : "any URL change";
    case "domStable":
      return `${wait.stableForMs ?? 500}ms`;
    case "fixedDelay":
      return `${wait.delayMs}ms`;
    case "anyOf": {
      const branches = wait.conditions ?? [];
      return branches.length ? branches.map((c) => smartWaitTitle(c)).join(" OR ") : "no branches";
    }
    case "apiPolling":
      return `~${wait.urlContains || "(any)"} until ${wait.responseField ? `${wait.responseField} ∈ {${(wait.terminalValues ?? []).join(", ")}}` : (wait.terminalStatusRange ?? [200, 299]).join("-")}`;
  }
}
