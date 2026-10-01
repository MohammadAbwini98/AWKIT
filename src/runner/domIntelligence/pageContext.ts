import { findResidualSecrets } from "@src/semantic/SemanticPolicyValidator";
import { REDACTED, SemanticRedactor } from "@src/semantic/SemanticRedactor";

import type { RawDomNormalization } from "./DomIntelligenceProvider";

/**
 * L11.G AI-context normalization, the pure half: the bounded, typed `PageContext` the failure analysis
 * reads beside L5a's evidence, built from the parser-only provider's `normalize_dom` answer, and its
 * prompt rendering. No Playwright, no I/O, no clock (the capture is normalizeDom.ts).
 *
 * Every string goes through the EXISTING `SemanticRedactor`, then a hard cap, then the independent
 * residual-secret rescan of what would be stored (a string it still flags is replaced whole), exactly as
 * L5a's evidence buffer does. Roles come from a closed vocabulary. Every list has a hard bound.
 */

export const PAGE_CONTEXT_VERSION = 1;

/**
 * Whether runs capture a page context on a terminal step failure. Off unless `AWKIT_AI_PAGE_CONTEXT=on`:
 * the L11.G comparison decides the default (docs/plans/ai-upgrade-v5/evidence), and a smaller or richer
 * prompt is not reason enough to change what the failure analysis reads.
 */
export function pageContextEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AWKIT_AI_PAGE_CONTEXT === "on";
}

export const PAGE_CONTEXT_LIMITS = Object.freeze({
  /** Serialized HTML handed to the provider. A page summary needs far less than the 2 MiB protocol bound. */
  maxHtmlBytes: 256 * 1024,
  /** Characters per string after redaction. */
  maxItemChars: 100,
  headings: 8,
  landmarks: 6,
  alerts: 4,
  interactive: 16,
  forms: 2,
  formFields: 8,
  tables: 2,
  columns: 6,
  text: 6,
  /** The whole rendered context, in characters: what a prompt may spend on it. */
  maxRenderedChars: 1_200,
  /** Wall-clock budget for one capture (detection, snapshot and provider together). */
  budgetMs: 1_500
});

export interface PageContext {
  schemaVersion: typeof PAGE_CONTEXT_VERSION;
  title?: string;
  headings: string[];
  landmarks: string[];
  alerts: string[];
  interactive: Array<{ role: string; name: string; disabled?: true }>;
  forms: Array<{ label?: string; fields: Array<{ role: string; label?: string; required?: true; invalid?: true }> }>;
  tables: Array<{ label?: string; columns: string[]; rows: number }>;
  text: string[];
  /** Something was cut: the in-page byte cap, the provider's own caps or AWKIT's bounds. */
  truncated: boolean;
  /** Strings replaced whole because the residual rescan still matched after redaction. */
  residualSecrets: number;
}

/** `suppressed`: the evidence collector's exclusions (protected step or document, raw-UI-text suppression) refused it before any capture. */
export type PageContextRefusal = "disabled" | "suppressed" | "protected-surface" | "provider-unavailable" | "provider-timeout" | "provider-error" | "snapshot-failed";

export interface PageContextMetrics {
  totalMs: number;
  snapshotMs?: number;
  providerMs?: number;
  /** Sanitized HTML that crossed to the provider, in bytes. */
  htmlBytes?: number;
  /** Elements the page had, and subtrees dropped as hidden before anything left the page. */
  elements?: number;
  hiddenDropped?: number;
}

export type PageContextResult = { ok: true; context: PageContext; metrics: PageContextMetrics } | { ok: false; reason: PageContextRefusal; metrics: PageContextMetrics };

/** The roles a context may name: anything else a page declares is collapsed, never repeated. */
const ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "tab",
  "menuitem",
  "switch",
  "combobox",
  "textbox",
  "option",
  "banner",
  "navigation",
  "main",
  "complementary",
  "contentinfo",
  "region",
  "search",
  "form",
  "file",
  "range",
  "color",
  "date"
]);

let defaultRedactor: SemanticRedactor | undefined;

/**
 * The provider's raw normalization → a bounded, redacted `PageContext`. Never throws on hostile input:
 * anything of the wrong shape is dropped.
 */
export function normalizePageContext(raw: RawDomNormalization, redactor?: Pick<SemanticRedactor, "redactText">): PageContext {
  const redact = redactor ?? (defaultRedactor ??= new SemanticRedactor());
  let truncated = raw?.truncated === true;
  let residualSecrets = 0;
  const clean = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const collapsed = value.replace(/\s+/g, " ").trim();
    if (!collapsed) return undefined;
    const redacted = redact.redactText(collapsed);
    if (redacted.length > PAGE_CONTEXT_LIMITS.maxItemChars) truncated = true;
    const stored = redacted.slice(0, PAGE_CONTEXT_LIMITS.maxItemChars);
    // Rescan what would be STORED, after the cap, exactly like L5a's evidence buffer.
    if (findResidualSecrets(stored).length > 0) {
      residualSecrets += 1;
      return REDACTED;
    }
    return stored;
  };
  const role = (value: unknown): string => (typeof value === "string" && ROLES.has(value.toLowerCase()) ? value.toLowerCase() : "control");
  const list = <T>(value: unknown, max: number, map: (entry: unknown) => T | undefined): T[] => {
    if (!Array.isArray(value)) return [];
    const out: T[] = [];
    for (const entry of value) {
      if (out.length >= max) {
        truncated = true;
        break;
      }
      const mapped = map(entry);
      if (mapped !== undefined) out.push(mapped);
    }
    return out;
  };
  const record = (entry: unknown): Record<string, unknown> | undefined => (entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : undefined);

  const title = clean(raw?.title);
  const context: PageContext = {
    schemaVersion: PAGE_CONTEXT_VERSION,
    ...(title ? { title } : {}),
    headings: list(raw?.headings, PAGE_CONTEXT_LIMITS.headings, (entry) => {
      const heading = record(entry);
      const text = clean(heading?.text);
      const level = typeof heading?.level === "number" && heading.level >= 1 && heading.level <= 6 ? Math.trunc(heading.level) : undefined;
      return text ? (level ? `h${level} ${text}` : text) : undefined;
    }),
    landmarks: list(raw?.landmarks, PAGE_CONTEXT_LIMITS.landmarks, (entry) => {
      const landmark = record(entry);
      if (!landmark) return undefined;
      const label = clean(landmark.label);
      return label ? `${role(landmark.role)} ${label}` : role(landmark.role);
    }),
    alerts: list(raw?.alerts, PAGE_CONTEXT_LIMITS.alerts, clean),
    interactive: list(raw?.interactive, PAGE_CONTEXT_LIMITS.interactive, (entry) => {
      const control = record(entry);
      const name = clean(control?.name);
      if (!control || !name) return undefined;
      return { role: role(control.role), name, ...(control.disabled === true ? { disabled: true as const } : {}) };
    }),
    forms: list(raw?.forms, PAGE_CONTEXT_LIMITS.forms, (entry) => {
      const form = record(entry);
      if (!form) return undefined;
      const label = clean(form.label);
      const fields = list(form.fields, PAGE_CONTEXT_LIMITS.formFields, (fieldEntry) => {
        const field = record(fieldEntry);
        if (!field) return undefined;
        const fieldLabel = clean(field.label);
        return {
          role: role(field.role),
          ...(fieldLabel ? { label: fieldLabel } : {}),
          ...(field.required === true ? { required: true as const } : {}),
          ...(field.invalid === true ? { invalid: true as const } : {})
        };
      });
      return { ...(label ? { label } : {}), fields };
    }),
    tables: list(raw?.tables, PAGE_CONTEXT_LIMITS.tables, (entry) => {
      const table = record(entry);
      if (!table) return undefined;
      const label = clean(table.label);
      const rows = typeof table.rows === "number" && Number.isFinite(table.rows) ? Math.max(0, Math.min(100_000, Math.trunc(table.rows))) : 0;
      return { ...(label ? { label } : {}), columns: list(table.columns, PAGE_CONTEXT_LIMITS.columns, clean), rows };
    }),
    text: list(raw?.text, PAGE_CONTEXT_LIMITS.text, clean),
    truncated: false,
    residualSecrets: 0
  };
  context.truncated = truncated;
  context.residualSecrets = residualSecrets;
  return context;
}

/**
 * A context read back from a stored report (report.json can be edited, imported or older than this shape):
 * exactly the stored shape, within every bound, every string rescanned for residual secrets, or nothing.
 */
export function readPageContext(value: unknown): PageContext | undefined {
  const context = value as Partial<PageContext> | null;
  if (!context || typeof context !== "object" || context.schemaVersion !== PAGE_CONTEXT_VERSION) return undefined;
  // Stored headings and regions carry a short role prefix ("h2 ", "navigation ") before a bounded item.
  const text = (entry: unknown) => typeof entry === "string" && entry.length <= PAGE_CONTEXT_LIMITS.maxItemChars + 16 && findResidualSecrets(entry).length === 0;
  const optionalText = (entry: unknown) => entry === undefined || text(entry);
  const flag = (entry: unknown) => entry === undefined || entry === true;
  const list = (entries: unknown, max: number, valid: (entry: any) => boolean) => Array.isArray(entries) && entries.length <= max && entries.every(valid);
  const ok =
    optionalText(context.title) &&
    list(context.headings, PAGE_CONTEXT_LIMITS.headings, text) &&
    list(context.landmarks, PAGE_CONTEXT_LIMITS.landmarks, text) &&
    list(context.alerts, PAGE_CONTEXT_LIMITS.alerts, text) &&
    list(context.text, PAGE_CONTEXT_LIMITS.text, text) &&
    list(context.interactive, PAGE_CONTEXT_LIMITS.interactive, (control) => Boolean(control) && ROLES_OR_CONTROL(control.role) && text(control.name) && flag(control.disabled)) &&
    list(context.forms, PAGE_CONTEXT_LIMITS.forms, (form) =>
      Boolean(form) && optionalText(form.label) && list(form.fields, PAGE_CONTEXT_LIMITS.formFields, (field) => Boolean(field) && ROLES_OR_CONTROL(field.role) && optionalText(field.label) && flag(field.required) && flag(field.invalid))
    ) &&
    list(context.tables, PAGE_CONTEXT_LIMITS.tables, (table) => Boolean(table) && optionalText(table.label) && list(table.columns, PAGE_CONTEXT_LIMITS.columns, text) && Number.isInteger(table.rows) && table.rows >= 0 && table.rows <= 100_000) &&
    typeof context.truncated === "boolean" &&
    Number.isInteger(context.residualSecrets);
  return ok ? (context as PageContext) : undefined;
}

const ROLES_OR_CONTROL = (role: unknown): boolean => typeof role === "string" && (role === "control" || ROLES.has(role));

/** One line per non-empty part, whole lines only, within `maxChars`: what the failure analysis shows. */
export function pageContextLines(context: PageContext, maxChars: number = PAGE_CONTEXT_LIMITS.maxRenderedChars): string[] {
  // JSON quoting: a quote inside page text cannot close the string and forge another segment.
  const quoted = (value: string) => JSON.stringify(value);
  const candidates = [
    context.title ? `Title: ${quoted(context.title)}` : "",
    context.alerts.length ? `Alerts shown: ${context.alerts.map(quoted).join("; ")}` : "",
    context.headings.length ? `Headings: ${context.headings.map(quoted).join("; ")}` : "",
    ...context.forms.map(
      (form) =>
        `Form${form.label ? ` ${quoted(form.label)}` : ""}: ` +
        form.fields.map((field) => `${field.role}${field.label ? ` ${quoted(field.label)}` : ""}${field.required ? " required" : ""}${field.invalid ? " INVALID" : ""}`).join("; ")
    ),
    context.interactive.length ? `Controls: ${context.interactive.map((control) => `${control.role} ${quoted(control.name)}${control.disabled ? " DISABLED" : ""}`).join("; ")}` : "",
    ...context.tables.map((table) => `Table${table.label ? ` ${quoted(table.label)}` : ""}: ${table.rows} row(s)${table.columns.length ? `, columns ${table.columns.map(quoted).join(", ")}` : ""}`),
    context.landmarks.length ? `Regions: ${context.landmarks.map(quoted).join("; ")}` : "",
    context.text.length ? `Text: ${context.text.map(quoted).join("; ")}` : ""
  ].filter(Boolean);
  const lines: string[] = [];
  let used = 0;
  for (const line of candidates) {
    if (used + line.length + 1 > maxChars) continue;
    lines.push(line);
    used += line.length + 1;
  }
  return lines;
}
