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

/**
 * Which required inputs have no value. Typed on the three fields it actually reads rather than on
 * `RuntimeInputDefinition`, because a workflow's own `runtimeInputs` carry a slightly wider `type`
 * vocabulary (`password`) and are the declaration a real run must be judged against. Narrowing here
 * would have forced a cast at the run boundary, which is how a check ends up applied to the wrong
 * declaration entirely.
 */
export function validateRuntimeValues(
  definitions: readonly Pick<RuntimeInputDefinition, "key" | "label" | "required">[],
  values: Record<string, unknown>
): Array<{ key: string; message: string }> {
  return definitions
    .filter((definition) => definition.required && (values[definition.key] === undefined || values[definition.key] === ""))
    .map((definition) => ({ key: definition.key, message: `${definition.label} is required.` }));
}
