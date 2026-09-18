import { Database, FileJson, Play, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DataBindingEditor } from "../components/data-binding/DataBindingEditor";
import { DropdownValueSelector } from "../components/data-binding/DropdownValueSelector";
import { RuntimeValueInput } from "../components/data-binding/RuntimeValueInput";
import { runtimeInputDefinitions, sampleCustomersData } from "../components/data-binding/sampleData";
import { usePageChrome } from "../state/pageChrome";
import { resolveJsonPath, stringifyResolvedValue } from "@src/data/JsonPathResolver";
import { buildDefaultRuntimeValues, validateRuntimeValues } from "@src/data/RuntimeInputDefinition";
import type { ValueSource } from "@src/profiles/FlowProfile";

const runtimeValuesStorageKey = "specterstudio.runtime-input-values";

export function RuntimeInputPanel() {
  const [runtimeValues, setRuntimeValues] = useState<Record<string, unknown>>(() => buildDefaultRuntimeValues(runtimeInputDefinitions));
  const [selectionMode, setSelectionMode] = useState<"value" | "label" | "index">("value");
  const [runWorkflowId, setRunWorkflowId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [valueSource, setValueSource] = useState<ValueSource>({
    type: "json",
    file: "resources/sample-data/customers.json",
    path: "$.customers[0].firstName"
  });

  useEffect(() => {
    const saved = localStorage.getItem(runtimeValuesStorageKey);
    if (saved) setRuntimeValues((current) => ({ ...current, ...JSON.parse(saved) }));
    window.playwrightFlowStudio.settings
      .get()
      .then((settings) => setRunWorkflowId(settings.instanceRunSettings.workflowId))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    localStorage.setItem(runtimeValuesStorageKey, JSON.stringify(runtimeValues));
  }, [runtimeValues]);

  const validationIssues = useMemo(() => validateRuntimeValues(runtimeInputDefinitions, runtimeValues), [runtimeValues]);

  const validateInputs = () => {
    setStatusMessage(
      validationIssues.length ? `${validationIssues.length} required value(s) missing.` : "All runtime inputs are valid."
    );
  };

  const runScenario = async () => {
    if (!runWorkflowId) {
      setStatusMessage("Select a workflow on the Instances page before running.");
      return;
    }
    if (validationIssues.length) {
      setStatusMessage(`Cannot run: ${validationIssues.length} required value(s) missing.`);
      return;
    }
    try {
      const result = (await window.playwrightFlowStudio.executions.runWorkflow({ workflowId: runWorkflowId, dryRun: true })) as {
        status?: string;
        message?: string;
      };
      setStatusMessage(result.message ?? `Workflow ${result.status ?? "run"} requested with current inputs.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Run request failed.");
    }
  };

  usePageChrome(
    {
      actions: [
        { id: "validate", label: "Validate", icon: <ShieldCheck size={15} aria-hidden="true" />, onClick: validateInputs, title: "Check required runtime inputs" },
        {
          id: "run",
          label: "Run",
          icon: <Play size={15} aria-hidden="true" />,
          variant: "primary",
          onClick: () => void runScenario(),
          disabled: !runWorkflowId,
          title: runWorkflowId ? "Run the selected workflow with these inputs" : "Select a workflow on the Instances page first"
        }
      ],
      dirty: false
    },
    [validationIssues.length, runWorkflowId]
  );
  const sampleRow = sampleCustomersData.customers[0];
  const rowPreview = stringifyResolvedValue(resolveJsonPath(sampleCustomersData, "$.customers[0].email"));

  const updateRuntimeValue = (key: string, value: unknown) => {
    setRuntimeValues((current) => ({ ...current, [key]: value }));
  };

  const browseCustomerDataFile = async () => {
    const result = (await window.playwrightFlowStudio.dataSources.browseJson("customers-json")) as
      | { canceled: true }
      | { canceled: false; profile: { file: string; path: string } };
    if (!result.canceled) {
      updateRuntimeValue("customerDataFile", result.profile.file);
      setValueSource({ type: "json", file: result.profile.file, path: result.profile.path });
    }
  };

  return (
    <section className="page operations-system-page runtime-system-page">
      <h1 className="sr-only">Runtime Inputs</h1>
      <section className="work-panel input-panel runtime-panel operations-system-surface">
        <div className="operations-system-context">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>Runtime values are retained locally for the selected workflow and verified before the dry run starts.</span>
        </div>

        <div className="operations-system-metrics runtime-system-metrics" aria-label="Runtime input summary">
          <article className="operations-system-metric tone-info">
            <span className="operations-system-metric-icon" aria-hidden="true"><Database size={16} /></span>
            <span className="operations-system-metric-label">Input fields</span>
            <strong>{runtimeInputDefinitions.length}</strong>
            <small>Available to this scenario</small>
          </article>
          <article className={`operations-system-metric ${validationIssues.length ? "tone-warning" : "tone-success"}`}>
            <span className="operations-system-metric-icon" aria-hidden="true"><ShieldCheck size={16} /></span>
            <span className="operations-system-metric-label">Validation</span>
            <strong>{validationIssues.length ? "Review" : "Ready"}</strong>
            <small>{validationIssues.length ? `${validationIssues.length} required value${validationIssues.length === 1 ? "" : "s"} missing` : "All required values present"}</small>
          </article>
          <article className="operations-system-metric tone-neutral">
            <span className="operations-system-metric-icon" aria-hidden="true"><FileJson size={16} /></span>
            <span className="operations-system-metric-label">Selection mode</span>
            <strong>{selectionMode}</strong>
            <small>How dropdown values resolve</small>
          </article>
        </div>

        <div className="runtime-grid expanded operations-runtime-grid">
          <section className="runtime-form operations-system-panel">
            <div className="operations-system-panel-head">
              <div>
                <h2>Scenario fields</h2>
                <span>Values supplied before the selected workflow starts.</span>
              </div>
            </div>
            <label>
              Customer Data File
              <div className="file-input-row">
                <FileJson size={16} />
                <input
                  value={String(runtimeValues.customerDataFile ?? "")}
                  onChange={(event) => updateRuntimeValue("customerDataFile", event.target.value)}
                />
                <button onClick={browseCustomerDataFile} type="button">
                  Browse
                </button>
              </div>
            </label>
            {runtimeInputDefinitions
              .filter((definition) => definition.key !== "customerDataFile")
              .map((definition) => (
                <RuntimeValueInput
                  definition={definition}
                  key={definition.key}
                  value={runtimeValues[definition.key]}
                  onChange={updateRuntimeValue}
                />
              ))}
            <DropdownValueSelector mode={selectionMode} onModeChange={setSelectionMode} />
          </section>

          <section className="binding-workbench operations-system-panel">
            <div className="operations-system-panel-head">
              <div>
                <h2>Value sources</h2>
                <span>Fill input from JSON or a runtime value.</span>
              </div>
            </div>
            <DataBindingEditor
              runtimeInputKeys={runtimeInputDefinitions.map((definition) => definition.key)}
              valueSource={valueSource}
              onChange={setValueSource}
            />
            <div className="runtime-preview-grid">
              <article>
                <span>Current row email</span>
                <strong>{rowPreview}</strong>
              </article>
              <article>
                <span>Dropdown select mode</span>
                <strong>{selectionMode}</strong>
              </article>
              <article>
                <span>Runtime account type</span>
                <strong>{String(runtimeValues.selectedAccountType ?? "")}</strong>
              </article>
              <article>
                <span>Current row account type</span>
                <strong>{sampleRow.accountType}</strong>
              </article>
            </div>
          </section>

          <aside className="runtime-summary operations-runtime-summary operations-system-panel">
            <div className="operations-system-panel-head">
              <div>
                <h2>Run readiness</h2>
                <span>Live checks for this dry run.</span>
              </div>
            </div>
            <article>
              <Database size={18} />
              <div>
                <strong>Data rows</strong>
                <span>{sampleCustomersData.customers.length} sample rows detected</span>
              </div>
            </article>
            <article>
              <ShieldCheck size={18} />
              <div>
                <strong>Input validation</strong>
                <span>{validationIssues.length ? `${validationIssues.length} required values missing` : "All required values present"}</span>
              </div>
            </article>
            <div className="validation-list">
              {validationIssues.length ? (
                validationIssues.map((issue) => <span key={issue.key}>{issue.message}</span>)
              ) : (
                <strong>Runtime inputs are valid.</strong>
              )}
            </div>
            {statusMessage ? <span className="form-message">{statusMessage}</span> : null}
          </aside>
        </div>
      </section>
    </section>
  );
}
