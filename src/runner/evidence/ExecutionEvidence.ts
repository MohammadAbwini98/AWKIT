/**
 * Run-lifetime failure evidence (Phase L, L5a): the one versioned event contract and its bounded,
 * masked, de-duplicating buffer.
 *
 * Evidence is hostile page data. Every event passes through the same layers as the semantic index
 * (docs/ai/DECISIONS.md, Phase L privacy policy): a fixed payload shape from the collector, then
 * `SemanticRedactor` (which composes `SecretMasker`) on every string, then hard caps, then the
 * independent `findResidualSecrets` rescan of what would be stored. A string the rescan still flags
 * is replaced whole by the redaction marker: the event, its source, status and step stay, because the
 * cause baseline rests on them, and only the text the redactor failed on is lost. URLs are kept
 * only as origin plus a path template with identifiers stripped, never query, fragment or userinfo.
 * Input values are never captured: a field is named by its identity, never its content.
 *
 * Bounds, all explicit and reported: characters per field, bytes per event, events per source,
 * events and bytes per instance, and bytes per run (shared by every instance of one execution).
 * A repeated event is folded into its first occurrence with a repeat count instead of stored again.
 *
 * Framework-agnostic and synchronous: no Playwright, no filesystem, no clock of its own.
 */

import { findResidualSecrets } from "../../semantic/SemanticPolicyValidator";
import { REDACTED, SemanticRedactor } from "../../semantic/SemanticRedactor";

export const EVIDENCE_SCHEMA_VERSION = 1;

export type EvidenceSource =
  /** `role=alert` or `aria-live=assertive` text appeared. */
  | "ui.alert"
  /** `role=status` or `aria-live=polite` text appeared (neutral). */
  | "ui.status"
  /** A toast or banner matched the deterministic heuristic. */
  | "ui.toast"
  /** A field became `aria-invalid` or fired a native `invalid` event (identity only, never its value). */
  | "ui.fieldInvalid"
  /** A subresource answered with status 400 or above. */
  | "http.error"
  /** A request failed at the transport level. */
  | "network.failed"
  /** An uncaught page exception. */
  | "page.error"
  /** `console.error` text. */
  | "console.error"
  /** A main-frame document answered with status 400 or above (status, title, heading only). */
  | "page.errorDocument"
  /** The runner's own failure (timeout, assertion, locator, navigation, cancellation). */
  | "runner.failure";

export const EVIDENCE_SOURCES: readonly EvidenceSource[] = [
  "ui.alert",
  "ui.status",
  "ui.toast",
  "ui.fieldInvalid",
  "http.error",
  "network.failed",
  "page.error",
  "console.error",
  "page.errorDocument",
  "runner.failure"
];

export type EvidenceSeverity = "info" | "warning" | "error";

export interface EvidenceContext {
  executionId: string;
  instanceId: string;
  flowId?: string;
  nodeId?: string;
  stepIndex?: number;
  pageId?: string;
}

export type EvidenceValue = string | number | boolean;

export interface ExecutionEvidenceEvent {
  /** Unique within its instance report; what a cause baseline and any later analysis cite. */
  id: string;
  schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  source: EvidenceSource;
  /** Milliseconds since the instance's collector started, from a monotonic clock. */
  offsetMs: number;
  /** Offset of the latest repeat; equals `offsetMs` for an event seen once. */
  lastOffsetMs: number;
  context: EvidenceContext;
  severity: EvidenceSeverity;
  payload: Readonly<Record<string, EvidenceValue>>;
  dedupeKey: string;
  repeatCount: number;
  /** A field or the payload was cut to fit a cap. */
  truncated: boolean;
}

export interface EvidenceLimits {
  maxFieldChars: number;
  maxPayloadFields: number;
  maxEventBytes: number;
  maxEventsPerSource: number;
  maxEventsPerInstance: number;
  maxBytesPerInstance: number;
}

/**
 * Seeds, sized so the capture cannot dominate a report or memory: 200 events and 128 KB per
 * instance. The measured values are committed by `verify:failure-capture-overhead` (L5a).
 */
export const DEFAULT_EVIDENCE_LIMITS: Readonly<EvidenceLimits> = Object.freeze({
  maxFieldChars: 500,
  maxPayloadFields: 12,
  maxEventBytes: 2_048,
  maxEventsPerSource: 50,
  maxEventsPerInstance: 200,
  maxBytesPerInstance: 128 * 1024
});

/** Per-run byte cap seed, shared by every instance of one execution. */
export const DEFAULT_EVIDENCE_RUN_BYTES = 4 * 1024 * 1024;

/** One execution's byte budget, shared by the buffers of all its instances. */
export class EvidenceRunBudget {
  private used = 0;

  constructor(readonly maxBytes: number = DEFAULT_EVIDENCE_RUN_BYTES) {}

  tryConsume(bytes: number): boolean {
    if (this.used + bytes > this.maxBytes) return false;
    this.used += bytes;
    return true;
  }

  release(bytes: number): void {
    this.used = Math.max(0, this.used - bytes);
  }

  usedBytes(): number {
    return this.used;
  }
}

export interface EvidenceSummary {
  accepted: number;
  /** Occurrences folded into an earlier event's repeat count. */
  repeats: number;
  truncatedEvents: number;
  /** `protected`: occurrences excluded or retracted because they came from a protected-login surface. */
  dropped: { perSource: number; perInstance: number; instanceBytes: number; runBytes: number; eventBytes: number; protected: number };
  bytes: number;
  /**
   * String fields replaced whole because the rescan still matched after redaction, counted over the
   * stored events per occurrence (repeats included; dropped and retracted events count nothing).
   * Absent on reports written before the rescan existed (2026-09-21).
   */
  residualSecrets?: number;
}

export interface EvidenceInput {
  source: EvidenceSource;
  severity: EvidenceSeverity;
  payload: Record<string, unknown>;
  /** Payload fields that identify a repeat. Default: every field except timings. */
  dedupeFields?: readonly string[];
  /** Overrides the buffer's current step context (e.g. a runner failure names its own step). */
  context?: Partial<Omit<EvidenceContext, "executionId" | "instanceId">>;
  /** When the event happened, if earlier than now (details gathered after the fact). */
  atOffsetMs?: number;
}

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const TIMING_FIELD = /(?:Ms|At)$/;
/** Fields holding a URL. They become origin + path template, never redacted text. */
const URL_FIELD = /(?:url|Url|URL)$/;

/** A segment that identifies a record rather than a route: numbers, uuids, hashes, mixed ids, emails. */
function isIdentifierSegment(segment: string): boolean {
  return (
    /^\d+$/.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^[0-9a-f]{16,}$/i.test(segment) ||
    (/\d/.test(segment) && /^[A-Za-z0-9_-]{6,}$/.test(segment)) ||
    segment.includes("@")
  );
}

/**
 * `https://user:pw@shop.example/orders/48213/items?id=7#x` → `https://shop.example/orders/:id/items`.
 * Anything that is not an http(s) URL collapses to a placeholder rather than being kept raw.
 */
export function urlPathTemplate(raw: string, redactor: SemanticRedactor): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "[unparsed-url]";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol}[non-http]`;
  const segments = url.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      let decoded: string;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return ":id";
      }
      if (isIdentifierSegment(decoded)) return ":id";
      // A segment the redactor would alter (a token, a key, a long blob) is not a route either.
      return redactor.redactText(decoded) === decoded ? decoded.slice(0, 64) : ":redacted";
    });
  return `${url.origin}/${segments.join("/")}`;
}

export class EvidenceBuffer {
  private readonly events: ExecutionEvidenceEvent[] = [];
  private readonly byKey = new Map<string, ExecutionEvidenceEvent>();
  private readonly perSource = new Map<EvidenceSource, number>();
  private readonly limits: EvidenceLimits;
  private readonly redactor: SemanticRedactor;
  private readonly now: () => number;
  private readonly startedAt: number;
  private step: Partial<Omit<EvidenceContext, "executionId" | "instanceId">> = {};
  private sequence = 0;
  private bytes = 0;
  private repeats = 0;
  private truncatedEvents = 0;
  /** Stored event id → string fields the rescan replaced in its payload. */
  private readonly residualFields = new Map<string, number>();
  private readonly dropped ={ perSource: 0, perInstance: 0, instanceBytes: 0, runBytes: 0, eventBytes: 0, protected: 0 };

  constructor(
    private readonly identity: { executionId: string; instanceId: string },
    private readonly runBudget: EvidenceRunBudget,
    options: { limits?: Partial<EvidenceLimits>; redactor?: SemanticRedactor; now?: () => number } = {}
  ) {
    this.limits = { ...DEFAULT_EVIDENCE_LIMITS, ...options.limits };
    this.redactor = options.redactor ?? new SemanticRedactor();
    this.now = options.now ?? (() => performance.now());
    this.startedAt = this.now();
  }

  /** The current step, stamped on every event that does not name its own. */
  setStep(step: Partial<Omit<EvidenceContext, "executionId" | "instanceId">>): void {
    this.step = { ...step };
  }

  /** Current offset on this buffer's clock, for callers that record step windows. */
  offsetNow(): number {
    return Math.max(0, Math.round(this.now() - this.startedAt));
  }

  add(input: EvidenceInput): ExecutionEvidenceEvent | null {
    const { payload, truncated, residuals } = this.sanitize(input.payload);
    const dedupeFields = input.dedupeFields ?? Object.keys(payload).filter((field) => !TIMING_FIELD.test(field));
    const dedupeKey = [input.source, input.severity, ...dedupeFields.map((field) => `${field}=${String(payload[field] ?? "")}`)].join("|");
    const now = this.offsetNow();
    const offsetMs = input.atOffsetMs !== undefined && input.atOffsetMs >= 0 && input.atOffsetMs <= now ? Math.round(input.atOffsetMs) : now;

    const existing = this.byKey.get(dedupeKey);
    if (existing) {
      existing.repeatCount += 1;
      existing.lastOffsetMs = offsetMs;
      this.repeats += 1;
      return existing;
    }

    const count = this.perSource.get(input.source) ?? 0;
    if (count >= this.limits.maxEventsPerSource) {
      this.dropped.perSource += 1;
      return null;
    }
    if (this.events.length >= this.limits.maxEventsPerInstance) {
      this.dropped.perInstance += 1;
      return null;
    }
    const eventBytes = JSON.stringify(payload).length;
    if (eventBytes > this.limits.maxEventBytes) {
      this.dropped.eventBytes += 1;
      return null;
    }
    if (this.bytes + eventBytes > this.limits.maxBytesPerInstance) {
      this.dropped.instanceBytes += 1;
      return null;
    }
    if (!this.runBudget.tryConsume(eventBytes)) {
      this.dropped.runBytes += 1;
      return null;
    }

    this.sequence += 1;
    const event: ExecutionEvidenceEvent = {
      id: `ev${this.sequence}`,
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      source: input.source,
      offsetMs,
      lastOffsetMs: offsetMs,
      context: { ...this.step, ...input.context, executionId: this.identity.executionId, instanceId: this.identity.instanceId },
      severity: input.severity,
      payload,
      dedupeKey,
      repeatCount: 1,
      truncated
    };
    this.events.push(event);
    this.byKey.set(dedupeKey, event);
    this.perSource.set(input.source, count + 1);
    this.bytes += eventBytes;
    if (truncated) this.truncatedEvents += 1;
    if (residuals > 0) this.residualFields.set(event.id, residuals);
    return event;
  }

  /** An occurrence withheld because it came from a protected-login surface. */
  dropProtected(): void {
    this.dropped.protected += 1;
  }

  /**
   * Remove accepted events found, after the fact, to belong to a protected-login surface (excluded
   * entirely by the Phase L privacy policy). Their bytes return to both budgets; every occurrence,
   * repeats included, is counted as `dropped.protected`.
   */
  retract(predicate: (event: ExecutionEvidenceEvent) => boolean): number {
    const kept: ExecutionEvidenceEvent[] = [];
    const gone: ExecutionEvidenceEvent[] = [];
    for (const event of this.events) (predicate(event) ? gone : kept).push(event);
    for (const event of gone) {
      const bytes = JSON.stringify(event.payload).length;
      this.byKey.delete(event.dedupeKey);
      this.perSource.set(event.source, (this.perSource.get(event.source) ?? 1) - 1);
      this.bytes -= bytes;
      this.runBudget.release(bytes);
      this.repeats -= event.repeatCount - 1;
      if (event.truncated) this.truncatedEvents -= 1;
      this.dropped.protected += event.repeatCount;
    }
    this.events.splice(0, this.events.length, ...kept);
    return gone.length;
  }

  list(): readonly ExecutionEvidenceEvent[] {
    return this.events;
  }

  summary(): EvidenceSummary {
    return {
      accepted: this.events.length,
      repeats: this.repeats,
      truncatedEvents: this.truncatedEvents,
      dropped: { ...this.dropped },
      bytes: this.bytes,
      // Derived from what is stored, so a dropped occurrence or a retracted event counts nothing.
      residualSecrets: this.events.reduce((sum, event) => sum + (this.residualFields.get(event.id) ?? 0) * event.repeatCount, 0)
    };
  }

  /** Flat, bounded, masked payload: known scalar types only, URL fields as templates, strings redacted, capped and rescanned. */
  private sanitize(raw: Record<string, unknown>): { payload: Record<string, EvidenceValue>; truncated: boolean; residuals: number } {
    const payload: Record<string, EvidenceValue> = {};
    let truncated = false;
    let residuals = 0;
    for (const [field, value] of Object.entries(raw)) {
      if (Object.keys(payload).length >= this.limits.maxPayloadFields) {
        truncated = true;
        break;
      }
      if (!FIELD_NAME.test(field)) continue;
      if (typeof value === "number") {
        if (Number.isFinite(value)) payload[field] = value;
      } else if (typeof value === "boolean") {
        payload[field] = value;
      } else if (typeof value === "string") {
        const clean = URL_FIELD.test(field) ? urlPathTemplate(value, this.redactor) : this.redactor.redactText(value);
        if (clean.length > this.limits.maxFieldChars) truncated = true;
        // Rescan what would be STORED, after the cap: that is the text a report keeps.
        const stored = clean.slice(0, this.limits.maxFieldChars);
        if (findResidualSecrets(stored).length > 0) {
          residuals += 1;
          payload[field] = REDACTED;
        } else {
          payload[field] = stored;
        }
      }
    }
    return { payload, truncated, residuals };
  }
}
