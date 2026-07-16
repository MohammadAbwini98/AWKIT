/**
 * Pure helpers for the visual JSON data-source table editor.
 * No Electron/React imports — shared by the IPC layer and the renderer, and
 * unit-verifiable via scripts/verify-data-editor.mts.
 */
export type JsonRow = Record<string, unknown>;

export function isPlainObject(value: unknown): value is JsonRow {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Validate that a value is editable as a table (a root array of plain objects). */
export function validateRowArray(value: unknown): { ok: boolean; message?: string } {
  if (!Array.isArray(value)) {
    return { ok: false, message: "This JSON file cannot be edited visually because it is not a root array of objects." };
  }
  for (const item of value) {
    if (!isPlainObject(item)) {
      return { ok: false, message: "This JSON file cannot be edited visually because the array contains non-object items." };
    }
  }
  return { ok: true };
}

/** Property names that must never be written through a JSON path (prototype-pollution guard). */
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Set `value` at a simple dot JSON path (`$`, `$.customers`, `$.a.b`), preserving siblings. */
export function setJsonAtPath(data: unknown, path: string, value: unknown): unknown {
  const keys = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
  if (keys.length === 0) return value;
  if (keys.some((key) => FORBIDDEN_JSON_KEYS.has(key))) {
    throw new Error("Invalid JSON path: reserved property name (__proto__/constructor/prototype).");
  }
  const root: JsonRow = isPlainObject(data) ? { ...data } : {};
  let node = root;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    node[key] = isPlainObject(node[key]) ? { ...(node[key] as JsonRow) } : {};
    node = node[key] as JsonRow;
  }
  node[keys[keys.length - 1]] = value;
  return root;
}

/** Render a JSON value as editable text. */
export function displayCellValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Coerce edited text back to a JSON value (preserves number/boolean/null; nested → JSON text). */
export function coerceCellValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed === "number" || typeof parsed === "boolean" || typeof parsed === "string") {
      return parsed;
    }
    return text; // objects/arrays kept as JSON text
  } catch {
    return text;
  }
}

/** Ordered union of object keys across all rows (first-seen order). */
export function deriveColumns(rows: JsonRow[]): string[] {
  const seen: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key);
  return seen;
}

/** Make rows rectangular: every row has every column (missing → ""). */
export function normalizeRows(rows: JsonRow[], columns: string[]): JsonRow[] {
  return rows.map((row) => {
    const next: JsonRow = {};
    for (const col of columns) next[col] = col in row ? row[col] : "";
    return next;
  });
}
