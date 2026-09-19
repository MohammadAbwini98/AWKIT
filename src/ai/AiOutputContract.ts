/**
 * Output contract (Phase L, L1.3): runtime validation of model output after constrained decoding.
 *
 * Grammar-constrained decoding makes malformed output unlikely, not impossible: a length stop
 * truncates the JSON, and a runtime's schema-to-grammar conversion need not honour every keyword. So
 * the decoded value is validated again here, against the same schema, before any feature sees it.
 * Ids are offered as per-request `enum`s, which means an id or operation the request did not offer
 * is rejected even inside perfectly valid JSON.
 *
 * The schema subset is deliberately bounded: every object is closed (`additionalProperties: false`),
 * every array has `maxItems`, and every free string has `maxLength`.
 *
 * Framework-agnostic and pure.
 */

export type AiOutputSchema =
  | {
      type: "object";
      properties: Readonly<Record<string, AiOutputSchema>>;
      required?: readonly string[];
      additionalProperties: false;
    }
  | { type: "array"; items: AiOutputSchema; minItems?: number; maxItems: number }
  | { type: "string"; enum: readonly string[] }
  | { type: "string"; maxLength: number }
  | { type: "integer" | "number"; minimum?: number; maximum?: number }
  | { type: "boolean" };

/** Longest raw model output accepted for parsing; far above any bounded schema's maximum. */
export const AI_MAX_OUTPUT_CHARS = 16_000;
const MAX_SCHEMA_DEPTH = 6;
const MAX_ERRORS = 20;

export type AiOutputParseResult =
  | { ok: true; value: unknown }
  | { ok: false; code: "MALFORMED_OUTPUT" | "SCHEMA_REJECTED"; errors: string[] };

/** True when the schema stays inside the bounded subset. Requests with anything else are refused. */
export function isBoundedSchema(schema: unknown, depth = 0): schema is AiOutputSchema {
  if (depth > MAX_SCHEMA_DEPTH || typeof schema !== "object" || schema === null) return false;
  const s = schema as Record<string, unknown>;
  switch (s.type) {
    case "object": {
      if (s.additionalProperties !== false || typeof s.properties !== "object" || s.properties === null) return false;
      const props = s.properties as Record<string, unknown>;
      const required = s.required === undefined ? [] : s.required;
      return (
        Array.isArray(required) &&
        required.every((key) => typeof key === "string" && key in props) &&
        Object.values(props).every((child) => isBoundedSchema(child, depth + 1))
      );
    }
    case "array":
      return Number.isInteger(s.maxItems) && (s.maxItems as number) >= 0 && isBoundedSchema(s.items, depth + 1);
    case "string":
      return Array.isArray(s.enum)
        ? s.enum.length > 0 && s.enum.every((value) => typeof value === "string")
        : Number.isInteger(s.maxLength) && (s.maxLength as number) >= 0;
    case "integer":
    case "number":
    case "boolean":
      return true;
    default:
      return false;
  }
}

export function validateAiOutput(value: unknown, schema: AiOutputSchema, path = "$", errors: string[] = []): string[] {
  if (errors.length >= MAX_ERRORS) return errors;
  const fail = (message: string): string[] => {
    errors.push(`${path}: ${message}`);
    return errors;
  };
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("expected an object");
      const record = value as Record<string, unknown>;
      // The offending name is model output, so it is counted, never echoed.
      const unexpected = Object.keys(record).filter((key) => !(key in schema.properties)).length;
      if (unexpected > 0) fail(`${unexpected} unexpected propert${unexpected === 1 ? "y" : "ies"}`);
      for (const key of schema.required ?? []) {
        if (!(key in record)) fail(`missing property "${key}"`);
      }
      for (const [key, child] of Object.entries(schema.properties)) {
        if (key in record) validateAiOutput(record[key], child, `${path}.${key}`, errors);
      }
      return errors;
    }
    case "array": {
      if (!Array.isArray(value)) return fail("expected an array");
      if (value.length > schema.maxItems) fail(`more than ${schema.maxItems} items`);
      if (schema.minItems !== undefined && value.length < schema.minItems) fail(`fewer than ${schema.minItems} items`);
      value.slice(0, schema.maxItems).forEach((item, index) => validateAiOutput(item, schema.items, `${path}[${index}]`, errors));
      return errors;
    }
    case "string": {
      if (typeof value !== "string") return fail("expected a string");
      if ("enum" in schema) {
        if (!schema.enum.includes(value)) fail("value is not one the request offered");
      } else if (value.length > schema.maxLength) {
        fail(`longer than ${schema.maxLength} characters`);
      }
      return errors;
    }
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return fail("expected a number");
      if (schema.type === "integer" && !Number.isInteger(value)) fail("expected an integer");
      if (schema.minimum !== undefined && value < schema.minimum) fail(`below ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) fail(`above ${schema.maximum}`);
      return errors;
    }
    case "boolean":
      return typeof value === "boolean" ? errors : fail("expected a boolean");
  }
}

/** Parse raw model text and validate it. Never throws; the raw text is never echoed into an error. */
export function parseAiOutput(text: string, schema: AiOutputSchema): AiOutputParseResult {
  if (typeof text !== "string" || text.length > AI_MAX_OUTPUT_CHARS) {
    return { ok: false, code: "MALFORMED_OUTPUT", errors: ["output missing or too long"] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch {
    return { ok: false, code: "MALFORMED_OUTPUT", errors: ["output is not valid JSON"] };
  }
  const errors = validateAiOutput(value, schema);
  return errors.length === 0 ? { ok: true, value } : { ok: false, code: "SCHEMA_REJECTED", errors };
}
