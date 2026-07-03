import { useMemo, useState } from "react";
import { resolveJsonPath, stringifyResolvedValue } from "@src/data/JsonPathResolver";
import type { ValueSource, ValueSourceType } from "@src/profiles/FlowProfile";
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
    <section className="data-binding-editor">
      <label>
        Value Source
        <select value={valueSource.type} onChange={(event) => updateType(event.target.value as ValueSourceType)}>
          <option value="static">Static value</option>
          <option value="json">JSON file value</option>
          <option value="runtimeInput">Runtime UI input</option>
          <option value="env">Environment variable</option>
          <option value="flowOutput">Previous flow output</option>
          <option value="generated">Generated value</option>
          <option value="currentRow">Current JSON row</option>
          <option value="instanceVariable">Instance variable</option>
        </select>
      </label>

      {valueSource.type === "json" ? (
        <>
          <JsonFilePicker
            value={file}
            onChange={(nextFile) => {
              setFile(nextFile);
              onChange({ type: "json", file: nextFile, path });
            }}
          />
          <JsonPathPicker
            paths={paths}
            value={path}
            onChange={(nextPath) => {
              setPath(nextPath);
              onChange({ type: "json", file, path: nextPath });
            }}
          />
        </>
      ) : null}

      {valueSource.type === "runtimeInput" ? (
        <label>
          Runtime Input Key
          <select value={valueSource.key ?? ""} onChange={(event) => onChange({ type: "runtimeInput", key: event.target.value })}>
            {runtimeInputKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {valueSource.type === "static" ? (
        <label>
          Static Value
          <input value={valueSource.value ?? ""} onChange={(event) => onChange({ type: "static", value: event.target.value })} />
        </label>
      ) : null}

      {valueSource.type === "env" ? (
        <label>
          Environment Key
          <input value={valueSource.envKey ?? ""} onChange={(event) => onChange({ type: "env", envKey: event.target.value })} />
        </label>
      ) : null}

      {valueSource.type === "currentRow" ? (
        <label>
          Current Row Path
          <input value={valueSource.path ?? "$.firstName"} onChange={(event) => onChange({ type: "currentRow", path: event.target.value })} />
        </label>
      ) : null}

      <article className="binding-preview">
        <span>Resolved preview</span>
        <strong>{preview}</strong>
      </article>
    </section>
  );
}
