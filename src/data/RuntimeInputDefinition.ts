export type RuntimeInputType = "text" | "dropdown" | "number" | "checkbox" | "file";

export interface RuntimeInputOption {
  label: string;
  value: string;
}

export interface RuntimeInputDefinition {
  key: string;
  label: string;
  type: RuntimeInputType;
  required: boolean;
  defaultValue?: string | number | boolean;
  options?: RuntimeInputOption[];
}

export function buildDefaultRuntimeValues(definitions: RuntimeInputDefinition[]): Record<string, unknown> {
  return definitions.reduce<Record<string, unknown>>((values, definition) => {
    values[definition.key] = definition.defaultValue ?? "";
    return values;
  }, {});
}

export function validateRuntimeValues(
  definitions: RuntimeInputDefinition[],
  values: Record<string, unknown>
): Array<{ key: string; message: string }> {
  return definitions
    .filter((definition) => definition.required && (values[definition.key] === undefined || values[definition.key] === ""))
    .map((definition) => ({ key: definition.key, message: `${definition.label} is required.` }));
}
