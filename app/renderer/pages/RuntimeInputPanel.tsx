import { CheckCircle2, Database, Eye, FileJson, FormInput, LayoutGrid, Link2, ListFilter, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DataBindingEditor } from "../components/data-binding/DataBindingEditor";
import { DropdownValueSelector } from "../components/data-binding/DropdownValueSelector";
import { RuntimeValueInput } from "../components/data-binding/RuntimeValueInput";
import { runtimeInputDefinitions, sampleCustomersData } from "../components/data-binding/sampleData";
import {
  SysBanner,
  SysButton,
  SysCheckRow,
  SysChecklist,
  SysField,
  SysFormFooter,
  SysFormGrid,
  SysList,
  SysListRow,
  SysPage,
  SysPanel,
  SysPanels,
  SysSection,
  type SysTone
} from "../components/system/SystemUI";
import { usePageChrome } from "../state/pageChrome";
import { useNavigation } from "../state/navigation";
import { usePermissions } from "../security/usePermissions";
import { RoutePermissions } from "../security/routePermissions";
import { resolveJsonPath, stringifyResolvedValue } from "@src/data/JsonPathResolver";
import { buildDefaultRuntimeValues, validateRuntimeValues } from "@src/data/RuntimeInputDefinition";
import type { ValueSource } from "@src/profiles/FlowProfile";

const runtimeValuesStorageKey = "specterstudio.runtime-input-values";

function fileBaseName(file: string): string {
  return file.split(/[\\/]/).pop() || file;
}

export function RuntimeInputPanel() {
  const { navigateTo } = useNavigation();
  const { can } = usePermissions();
  const [runtimeValues, setRuntimeValues] = useState<Record<string, unknown>>(() => buildDefaultRuntimeValues(runtimeInputDefinitions));
  const [selectionMode, setSelectionMode] = useState<"value" | "label" | "index">("value");
  const [runWorkflowId, setRunWorkflowId] = useState("");
  const [workflowName, setWorkflowName] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: SysTone; text: string } | null>(null);
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

  // The selected workflow's name titles the form panel; unreadable workflows simply fall back to the id.
  useEffect(() => {
    if (!runWorkflowId) {
      setWorkflowName(null);
      return;
    }
    window.playwrightFlowStudio.workflows
      .list()
      .then((workflows) => setWorkflowName(workflows.find((workflow) => workflow.id === runWorkflowId)?.name ?? null))
      .catch(() => setWorkflowName(null));
  }, [runWorkflowId]);

  useEffect(() => {
    localStorage.setItem(runtimeValuesStorageKey, JSON.stringify(runtimeValues));
  }, [runtimeValues]);

  const validationIssues = useMemo(() => validateRuntimeValues(runtimeInputDefinitions, runtimeValues), [runtimeValues]);
  const issueByKey = useMemo(() => new Map(validationIssues.map((issue) => [issue.key, issue.message])), [validationIssues]);

  const validateInputs = () => {
    setStatus(
      validationIssues.length
        ? { tone: "warning", text: `${validationIssues.length} required value(s) missing.` }
        : { tone: "success", text: "All runtime inputs are valid." }
    );
  };

  const runScenario = async () => {
    if (!runWorkflowId) {
      setStatus({ tone: "warning", text: "Select a workflow on the Instances page before running." });
      return;
    }
    if (validationIssues.length) {
      setStatus({ tone: "danger", text: `Cannot run: ${validationIssues.length} required value(s) missing.` });
      return;
    }
    try {
      const result = (await window.playwrightFlowStudio.executions.runWorkflow({ workflowId: runWorkflowId, dryRun: true })) as {
        status?: string;
        message?: string;
      };
      setStatus({ tone: "info", text: result.message ?? `Workflow ${result.status ?? "run"} requested with current inputs.` });
    } catch (error) {
      setStatus({ tone: "danger", text: error instanceof Error ? error.message : "Run request failed." });
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
  const dataFile = String(runtimeValues.customerDataFile ?? "");
  const accountType = String(runtimeValues.selectedAccountType ?? "");
  const formDesignerPermission = RoutePermissions.formDesigner;
  const canPreviewForm = !formDesignerPermission || can(formDesignerPermission);

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

  const resetToDefaults = () => {
    setRuntimeValues(buildDefaultRuntimeValues(runtimeInputDefinitions));
    setSelectionMode("value");
    setStatus({ tone: "info", text: "Runtime inputs reset to their defaults." });
  };

  return (
    <SysPage className="runtime-inputs-page">
      <h1 className="sr-only">Runtime Inputs</h1>
      {status ? (
        <SysBanner tone={status.tone} actionLabel="Dismiss" onAction={() => setStatus(null)}>
          {status.text}
        </SysBanner>
      ) : null}

      <SysSection
        icon={FormInput}
        title="Scenario fields"
        text="Fields the runner prompts for, or binds from a data source, before a workflow starts. Values are kept on this machine."
        actions={
          canPreviewForm ? (
            <SysButton kind="small" icon={Eye} onClick={() => navigateTo("formDesigner")}>
              Preview form
            </SysButton>
          ) : null
        }
      />

      <SysPanels>
        <SysPanel
          icon={LayoutGrid}
          title={workflowName ?? (runWorkflowId ? runWorkflowId : "Scenario inputs")}
          meta={`${runtimeInputDefinitions.length} fields · bound to ${fileBaseName(dataFile) || "no data file"}`}
        >
          <SysFormGrid min={240}>
            <SysField
              label="Customer data file"
              wide
              invalid={issueByKey.has("customerDataFile")}
              hint={issueByKey.get("customerDataFile") ?? "JSON file whose rows drive data-driven runs"}
            >
              <span className="sys-file-row">
                <input className="sys-control is-mono" value={dataFile} onChange={(event) => updateRuntimeValue("customerDataFile", event.target.value)} />
                <SysButton kind="small" icon={FileJson} onClick={() => void browseCustomerDataFile()}>
                  Browse
                </SysButton>
              </span>
            </SysField>
            {runtimeInputDefinitions
              .filter((definition) => definition.key !== "customerDataFile")
              .map((definition) => (
                <RuntimeValueInput
                  definition={definition}
                  key={definition.key}
                  value={runtimeValues[definition.key]}
                  onChange={updateRuntimeValue}
                  invalidMessage={issueByKey.get(definition.key)}
                />
              ))}
            <DropdownValueSelector mode={selectionMode} onModeChange={setSelectionMode} />
          </SysFormGrid>
          <SysFormFooter>
            <SysButton kind="small" icon={RotateCcw} onClick={resetToDefaults}>
              Reset to defaults
            </SysButton>
            <SysButton kind="smallPrimary" icon={ShieldCheck} onClick={validateInputs}>
              Validate inputs
            </SysButton>
          </SysFormFooter>
        </SysPanel>

        <SysPanel icon={Link2} title="Value sources" meta="Where each field resolves from">
          <SysList label="Value sources">
            <SysListRow
              icon={Database}
              title="$.customers[0].email"
              sub={`JSON path · ${fileBaseName(dataFile) || "sample data"} row 1 → "${rowPreview}"`}
              badge={rowPreview ? "Resolved" : "Unresolved"}
              badgeTone={rowPreview ? "success" : "danger"}
            />
            <SysListRow
              icon={Database}
              title="$.customers[0].accountType"
              sub={`JSON path · current row → "${sampleRow.accountType}"`}
              badge="Resolved"
              badgeTone="success"
            />
            <SysListRow
              icon={FormInput}
              tone={accountType ? "running" : "danger"}
              title="{{ runtime.selectedAccountType }}"
              sub={accountType ? `Runtime input · prompted at start → "${accountType}"` : "Runtime input · no value selected"}
              badge={accountType ? "Prompt" : "Unresolved"}
              badgeTone={accountType ? "info" : "danger"}
            />
            <SysListRow
              icon={ListFilter}
              title="Dropdown select mode"
              sub="How a dropdown option is matched when the flow runs"
              value={selectionMode === "value" ? "By value" : selectionMode === "label" ? "By label" : "By index"}
            />
          </SysList>
        </SysPanel>
      </SysPanels>

      <SysPanels>
        <SysPanel icon={Link2} title="Value source binding" meta="Fill an input from JSON, a runtime value or the environment">
          <DataBindingEditor
            runtimeInputKeys={runtimeInputDefinitions.map((definition) => definition.key)}
            valueSource={valueSource}
            onChange={setValueSource}
          />
        </SysPanel>

        <SysPanel icon={CheckCircle2} tone={validationIssues.length ? "warning" : "success"} title="Run readiness" meta="Live checks for this dry run">
          <SysChecklist label="Run readiness">
            <SysCheckRow tone="success" title="Data rows" sub={`${sampleCustomersData.customers.length} sample rows detected`} badge="Pass" />
            <SysCheckRow
              tone={validationIssues.length ? "warning" : "success"}
              title="Input validation"
              sub={validationIssues.length ? `${validationIssues.length} required value${validationIssues.length === 1 ? "" : "s"} missing` : "All required values present"}
              badge={validationIssues.length ? "Review" : "Pass"}
            />
            <SysCheckRow
              tone={runWorkflowId ? "success" : "warning"}
              title="Workflow selected"
              sub={runWorkflowId ? workflowName ?? runWorkflowId : "Select a workflow on the Instances page before running"}
              badge={runWorkflowId ? "Pass" : "Required"}
            />
            {validationIssues.map((issue) => (
              <SysCheckRow key={issue.key} tone="danger" title={issue.message} sub="Fill the field above, then validate again" badge="Missing" />
            ))}
          </SysChecklist>
        </SysPanel>
      </SysPanels>
    </SysPage>
  );
}
