import { useMemo, useState } from "react";
import { resolveJsonPath, stringifyResolvedValue } from "@src/data/JsonPathResolver";
import type { ValueSource, ValueSourceType } from "@src/profiles/FlowProfile";
import { SysField, SysFormGrid, SysKvItem, SysSelect } from "../system/SystemUI";
import { JsonFilePicker } from "./JsonFilePicker";
import { JsonPathPicker } from "./JsonPathPicker";
import { sampleCustomersData } from "./sampleData";

const paths = [
  "$.customers[0].firstName",
  "$.customers[0].lastName",
  "$.customers[0].email",
  "$.customers[0].country",
  "$.customers[0].accountType",
  "$.customers[0].segment"
];

interface DataBindingEditorProps {
  valueSource: ValueSource;
  runtimeInputKeys: string[];
  onChange: (valueSource: ValueSource) => void;
}

/** Value-source binding editor on the design form grid: source type, its parameters, resolved preview. */
export function DataBindingEditor({ valueSource, runtimeInputKeys, onChange }: DataBindingEditorProps) {
  const [file, setFile] = useState(valueSource.file ?? "resources/sample-data/customers.json");
  const [path, setPath] = useState(valueSource.path ?? "$.customers[0].firstName");

  const preview = useMemo(() => {
    try {
      if (valueSource.type === "json") return stringifyResolvedValue(resolveJsonPath(sampleCustomersData, path));
      if (valueSource.type === "currentRow") return stringifyResolvedValue(resolveJsonPath(sampleCustomersData.customers[0], valueSource.path ?? "$.firstName"));
      if (valueSource.type === "generated") return `Generated: ${valueSource.generator ?? "uuid"}`;
      return valueSource.value ?? valueSource.key ?? valueSource.envKey ?? valueSource.outputKey ?? "";
    } catch (error) {
      return error instanceof Error ? error.message : "Unable to resolve value";
    }
  }, [path, valueSource]);

  const updateType = (type: ValueSourceType) => {
    if (type === "json") onChange({ type, file, path });
    else if (type === "runtimeInput") onChange({ type, key: runtimeInputKeys[0] ?? "" });
    else if (type === "env") onChange({ type, envKey: "USERNAME" });
    else if (type === "generated") onChange({ type, generator: "uuid" });
    else if (type === "currentRow") onChange({ type, path: "$.firstName" });
    else if (type === "flowOutput") onChange({ type, flowId: "create-customer-flow", outputKey: "customerId" });
    else onChange({ type, value: "" });
  };

  return (
    <SysFormGrid min={220}>
      <SysField label="Value source">
        <SysSelect value={valueSource.type} onChange={(event) => updateType(event.target.value as ValueSourceType)}>
          <option value="static">Static value</option>
          <option value="json">JSON file value</option>
          <option value="runtimeInput">Runtime UI input</option>
          <option value="env">Environment variable</option>
          <option value="flowOutput">Previous flow output</option>
          <option value="generated">Generated value</option>
          <option value="currentRow">Current JSON row</option>
          <option value="instanceVariable">Instance variable</option>
        </SysSelect>
      </SysField>

      {valueSource.type === "json" ? (
        <>
          <JsonPathPicker
            paths={paths}
            value={path}
            onChange={(nextPath) => {
              setPath(nextPath);
              onChange({ type: "json", file, path: nextPath });
            }}
          />
          <JsonFilePicker
            wide
            value={file}
            onChange={(nextFile) => {
              setFile(nextFile);
              onChange({ type: "json", file: nextFile, path });
            }}
          />
        </>
      ) : null}

      {valueSource.type === "runtimeInput" ? (
        <SysField label="Runtime input key">
          <SysSelect value={valueSource.key ?? ""} onChange={(event) => onChange({ type: "runtimeInput", key: event.target.value })}>
            {runtimeInputKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </SysSelect>
        </SysField>
      ) : null}

      {valueSource.type === "static" ? (
        <SysField label="Static value">
          <input className="sys-control" value={valueSource.value ?? ""} onChange={(event) => onChange({ type: "static", value: event.target.value })} />
        </SysField>
      ) : null}

      {valueSource.type === "env" ? (
        <SysField label="Environment key">
          <input className="sys-control is-mono" value={valueSource.envKey ?? ""} onChange={(event) => onChange({ type: "env", envKey: event.target.value })} />
        </SysField>
      ) : null}

      {valueSource.type === "currentRow" ? (
        <SysField label="Current row path">
          <input className="sys-control is-mono" value={valueSource.path ?? "$.firstName"} onChange={(event) => onChange({ type: "currentRow", path: event.target.value })} />
        </SysField>
      ) : null}

      <div className="sys-field is-wide">
        <SysKvItem label="Resolved preview" value={preview === "" ? "—" : preview} mono />
      </div>
    </SysFormGrid>
  );
}
