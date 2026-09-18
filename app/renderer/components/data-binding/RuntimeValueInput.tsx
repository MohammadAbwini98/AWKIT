import type { RuntimeInputDefinition } from "@src/data/RuntimeInputDefinition";
import { SysField, SysSelect, SysSwitch } from "../system/SystemUI";

interface RuntimeValueInputProps {
  definition: RuntimeInputDefinition;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  /** Validation message for this field; marks the field invalid (red label, border and hint). */
  invalidMessage?: string;
  hint?: string;
}

export function RuntimeValueInput({ definition, value, onChange, invalidMessage, hint }: RuntimeValueInputProps) {
  if (definition.type === "checkbox") {
    return (
      <SysSwitch
        checked={Boolean(value)}
        onToggle={() => onChange(definition.key, !value)}
        label={definition.label}
        hint={invalidMessage ?? hint}
        wide
      />
    );
  }

  const fieldHint = invalidMessage ?? hint;
  if (definition.type === "dropdown") {
    return (
      <SysField label={definition.label} hint={fieldHint} invalid={Boolean(invalidMessage)}>
        <SysSelect value={String(value ?? "")} onChange={(event) => onChange(definition.key, event.target.value)}>
          {(definition.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SysSelect>
      </SysField>
    );
  }

  return (
    <SysField label={definition.label} hint={fieldHint} invalid={Boolean(invalidMessage)}>
      <input
        className="sys-control"
        type={definition.type === "number" ? "number" : "text"}
        value={String(value ?? "")}
        onChange={(event) => onChange(definition.key, definition.type === "number" ? Number(event.target.value) : event.target.value)}
      />
    </SysField>
  );
}
