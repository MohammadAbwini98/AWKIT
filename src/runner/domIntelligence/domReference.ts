import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import { SecretMasker } from "@src/reports/SecretMasker";
import { replaceFileAtomically } from "@src/storage/atomicReplace";

import { DOM_ATTRIBUTE_ALLOWLIST } from "./pageScripts";

/**
 * AWKIT-owned DOM reference (L11, plan E7).
 *
 * The provider's own adaptive store is never used: it persists every raw attribute, raw text and the
 * parent's raw text. This record keeps only what a parser-only matcher needs, after an allowlist in the
 * page, bounds here, and the EXISTING redactors (`SecretMasker` inside `SemanticRedactor`) on every
 * string — no third redactor. It is bound to the step's candidate digest, so any edit to the step's
 * locator makes it stale, and it is never created for a sensitive step, a shadow target or a
 * protected-login document.
 */

export const DOM_REFERENCE_SCHEMA_VERSION = 1;

/** The runtime-root folder (`%LOCALAPPDATA%/SpecterStudio/<runtime>/dom-references`). */
export const DOM_REFERENCE_FOLDER = "dom-references";

export const DOM_REFERENCE_LIMITS = Object.freeze({
  tag: 40,
  attributeValue: 120,
  attributes: DOM_ATTRIBUTE_ALLOWLIST.length,
  text: 120,
  parentText: 80,
  pathDepth: 12,
  siblings: 20,
  children: 20,
  /** One serialized record. */
  fileBytes: 16 * 1024
});

export interface DomReferenceElement {
  tag: string;
  attributes: Record<string, string>;
  text: string;
  /** Tag path from `html` to the element itself, at most 12 levels (the deepest kept). */
  path: string[];
  parent?: { tag: string; attributes: Record<string, string>; text: string };
  siblings: string[];
  children: string[];
}

/**
 * The id a step's reference is stored under: its `locator.blueprintId` when the Recorder gave it one, else
 * (L12.5, steps recorded before blueprints) the step's own id scoped to its flow. The binding digest still
 * makes any locator edit stale, and the route binding still applies.
 */
export function domReferenceId(step: { id?: string; locator?: { blueprintId?: string } }, flowId?: string): string | undefined {
  if (step.locator?.blueprintId) return step.locator.blueprintId;
  if (!step.id) return undefined;
  const id = `step:${flowId ?? "flow"}:${step.id}`;
  return id.length <= 100 ? id : undefined;
}

export interface DomReferenceRecord {
  schemaVersion: typeof DOM_REFERENCE_SCHEMA_VERSION;
  /** `domReferenceId(step)`: the step's `locator.blueprintId`, or its flow-scoped step id. */
  referenceId: string;
  /** `locatorCandidatesDigest` of the step's candidates when captured; a mismatch means stale. */
  bindingDigest: string;
  source: "recorder" | "runtime-refresh";
  capturedAt: string;
  /**
   * L11.F: `routeKey` of the document the element was captured in. A reference is never used on another
   * route. Absent when the document had no route identity, and on records written before 2026-10-01.
   */
  route?: string;
  element: DomReferenceElement;
}

const TAG = /^[a-z][a-z0-9-]{0,39}$/;
const ROUTE = /^[a-f0-9]{20}$/;
const ALLOWED = new Set<string>(DOM_ATTRIBUTE_ALLOWLIST);
const redactor = new SemanticRedactor({ maxContentLength: DOM_REFERENCE_LIMITS.attributeValue }, new SecretMasker());
const masker = new SecretMasker();

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return redactor.redactText(value.replace(/\s+/g, " ").trim()).slice(0, max);
}

function cleanAttributes(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ALLOWED.has(key) || typeof raw !== "string") continue;
    // `maskValue` catches key-shaped and secret-looking values; the redactor catches the rest.
    const masked = masker.maskValue(key, raw);
    const text = typeof masked === "string" ? cleanText(masked, DOM_REFERENCE_LIMITS.attributeValue) : "";
    if (text) out[key] = text;
  }
  return out;
}

function cleanTags(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value.filter((tag): tag is string => typeof tag === "string" && TAG.test(tag));
  return tags.length === value.length ? tags.slice(-max) : undefined;
}

/**
 * Bound and redact a raw in-page capture (`DOM_REFERENCE_CAPTURE_SOURCE`) into a record, or undefined
 * when it is not a well-formed capture. Never throws.
 */
export function buildDomReference(
  raw: unknown,
  binding: { referenceId: string; bindingDigest: string; source: DomReferenceRecord["source"]; capturedAt?: string; route?: string }
): DomReferenceRecord | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const capture = raw as Record<string, unknown>;
  const tag = typeof capture.tag === "string" && TAG.test(capture.tag) ? capture.tag : undefined;
  const attributes = cleanAttributes(capture.attributes);
  const path = cleanTags(capture.path, DOM_REFERENCE_LIMITS.pathDepth);
  const siblings = cleanTags(capture.siblings ?? [], DOM_REFERENCE_LIMITS.siblings);
  const children = cleanTags(capture.children ?? [], DOM_REFERENCE_LIMITS.children);
  if (!tag || !attributes || !path || path.length === 0 || path[path.length - 1] !== tag || !siblings || !children) return undefined;
  if (!binding.referenceId || !binding.bindingDigest) return undefined;
  if (binding.route !== undefined && !ROUTE.test(binding.route)) return undefined;
  let parent: DomReferenceElement["parent"];
  if (capture.parent && typeof capture.parent === "object") {
    const rawParent = capture.parent as Record<string, unknown>;
    const parentTag = typeof rawParent.tag === "string" && TAG.test(rawParent.tag) ? rawParent.tag : undefined;
    const parentAttributes = cleanAttributes(rawParent.attributes);
    if (!parentTag || !parentAttributes) return undefined;
    parent = { tag: parentTag, attributes: parentAttributes, text: cleanText(rawParent.text, DOM_REFERENCE_LIMITS.parentText) };
  }
  return {
    schemaVersion: DOM_REFERENCE_SCHEMA_VERSION,
    referenceId: binding.referenceId,
    bindingDigest: binding.bindingDigest,
    source: binding.source,
    capturedAt: binding.capturedAt ?? new Date().toISOString(),
    ...(binding.route ? { route: binding.route } : {}),
    element: {
      tag,
      attributes,
      text: cleanText(capture.text, DOM_REFERENCE_LIMITS.text),
      path,
      ...(parent ? { parent } : {}),
      siblings,
      children
    }
  };
}

/**
 * The element part of a raw in-page capture, bounded and redacted, or undefined. Applied as a recorded
 * action enters the main process, so even the unsaved-recording draft never holds unredacted reference
 * text; `buildDomReference` applies the same rules again when the step is finalized.
 */
export function sanitizeDomReferenceCapture(raw: unknown): DomReferenceElement | undefined {
  return buildDomReference(raw, { referenceId: "draft", bindingDigest: "0".repeat(64), source: "recorder" })?.element;
}

/**
 * Strict shape gate for a record read back from disk or sent to a provider. Everything is re-bounded
 * rather than trusted: a hand-edited or corrupt file degrades to "no reference", never to a larger one.
 */
export function validateDomReference(value: unknown): DomReferenceRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<DomReferenceRecord>;
  if (record.schemaVersion !== DOM_REFERENCE_SCHEMA_VERSION) return undefined;
  if (typeof record.referenceId !== "string" || !record.referenceId || record.referenceId.length > 100) return undefined;
  if (typeof record.bindingDigest !== "string" || !/^[a-f0-9]{64}$/.test(record.bindingDigest)) return undefined;
  if (record.source !== "recorder" && record.source !== "runtime-refresh") return undefined;
  if (typeof record.capturedAt !== "string" || Number.isNaN(Date.parse(record.capturedAt))) return undefined;
  const element = record.element;
  if (!element || typeof element !== "object") return undefined;
  if (record.route !== undefined && (typeof record.route !== "string" || !ROUTE.test(record.route))) return undefined;
  const rebuilt = buildDomReference(element, {
    referenceId: record.referenceId,
    bindingDigest: record.bindingDigest,
    source: record.source,
    capturedAt: record.capturedAt,
    route: record.route
  });
  // A stored record must already be in its bounded, redacted form: re-building it must not change it.
  return rebuilt && JSON.stringify(rebuilt.element) === JSON.stringify(element) ? rebuilt : undefined;
}

export interface DomReferenceStore {
  /** The record for `referenceId` when it exists, is valid and is bound to `bindingDigest`. */
  get(referenceId: string, bindingDigest: string): Promise<DomReferenceRecord | undefined>;
  put(record: DomReferenceRecord): Promise<void>;
  delete(referenceId: string): Promise<void>;
}

/**
 * One hashed file per reference under the runtime root (`%LOCALAPPDATA%/SpecterStudio/dom-references`).
 * Writes are temp-then-rename with the shared EPERM/EBUSY retry; reads never throw.
 */
export class FileDomReferenceStore implements DomReferenceStore {
  constructor(private readonly folder: string) {}

  async get(referenceId: string, bindingDigest: string): Promise<DomReferenceRecord | undefined> {
    try {
      const path = this.pathFor(referenceId);
      const info = await stat(path).catch(() => undefined);
      if (!info || info.size > DOM_REFERENCE_LIMITS.fileBytes) return undefined;
      const record = validateDomReference(JSON.parse(await readFile(path, "utf8")));
      return record && record.referenceId === referenceId && record.bindingDigest === bindingDigest ? record : undefined;
    } catch {
      return undefined;
    }
  }

  async put(record: DomReferenceRecord): Promise<void> {
    const valid = validateDomReference(record);
    if (!valid) throw new Error("Refusing to store a DOM reference that is not in its bounded, redacted form.");
    const serialized = `${JSON.stringify(valid)}\n`;
    if (Buffer.byteLength(serialized) > DOM_REFERENCE_LIMITS.fileBytes) throw new Error("DOM reference exceeds its size bound.");
    await mkdir(this.folder, { recursive: true });
    const target = this.pathFor(valid.referenceId);
    const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temp, serialized, "utf8");
    await replaceFileAtomically(temp, target);
  }

  async delete(referenceId: string): Promise<void> {
    await rm(this.pathFor(referenceId), { force: true });
  }

  private pathFor(referenceId: string): string {
    return join(this.folder, `${createHash("sha256").update(referenceId).digest("hex")}.json`);
  }
}

/** In-memory store for verifiers and callers without a runtime root. */
export class MemoryDomReferenceStore implements DomReferenceStore {
  private readonly records = new Map<string, DomReferenceRecord>();

  async get(referenceId: string, bindingDigest: string): Promise<DomReferenceRecord | undefined> {
    const record = this.records.get(referenceId);
    return record && record.bindingDigest === bindingDigest ? record : undefined;
  }

  async put(record: DomReferenceRecord): Promise<void> {
    const valid = validateDomReference(record);
    if (!valid) throw new Error("Refusing to store a DOM reference that is not in its bounded, redacted form.");
    this.records.set(valid.referenceId, valid);
  }

  async delete(referenceId: string): Promise<void> {
    this.records.delete(referenceId);
  }
}
