import type { RuntimeInputDefinition } from "@src/data/RuntimeInputDefinition";

interface RuntimeValueInputProps {
  definition: RuntimeInputDefinition;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}

export function RuntimeValueInput({ definition, value, onChange }: RuntimeValueInputProps) {
  if (definition.type === "dropdown") {
    return (
      <label>
        {definition.label}
        <select value={String(value ?? "")} onChange={(event) => onChange(definition.key, event.target.value)}>
          {(definition.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (definition.type === "checkbox") {
    return (
      <label className="inline-check">
        <input checked={Boolean(value)} type="checkbox" onChange={(event) => onChange(definition.key, event.target.checked)} />
        {definition.label}
      </label>
    );
  }

  return (
    <label>
      {definition.label}
      <input
        type={definition.type === "number" ? "number" : "text"}
        value={String(value ?? "")}
        onChange={(event) => onChange(definition.key, definition.type === "number" ? Number(event.target.value) : event.target.value)}
      />
    </label>
  );
}
