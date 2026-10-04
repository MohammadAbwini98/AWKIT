/**
 * DOM-intelligence provider contract (L11, plan E4).
 *
 * Capability-named on purpose: nothing outside a provider implementation knows it is Scrapling. A
 * provider only ever PARSES sanitized HTML that AWKIT captured and handed to it; it never navigates,
 * fetches, owns a browser or acts. What it returns is evidence: element indices with a provider score.
 * AWKIT's own identity proof decides everything, and the runner never executes a provider candidate
 * its proof did not already choose.
 *
 * Every method resolves (never rejects) with an `ok: false` result on failure, so a caller cannot turn a
 * provider fault into a thrown step error by forgetting a `catch`.
 */

import type { DomReferenceRecord, DomReferenceStore } from "./domReference";

export const DOM_INTELLIGENCE_PROTOCOL_VERSION = 1;

/** Hard bounds shared by the client and the host. */
export const DOM_INTELLIGENCE_LIMITS = Object.freeze({
  /** Serialized HTML a request may carry. */
  maxHtmlBytes: 2 * 1024 * 1024,
  /** One request line (HTML plus envelope). */
  maxRequestBytes: 3 * 1024 * 1024,
  /** One response line. Responses carry indices, scores and bounded normalized text only. */
  maxResponseBytes: 512 * 1024,
  /** Candidates a find request may ask for. */
  maxCandidates: 20,
  /** Default and maximum per-request budgets. */
  defaultTimeoutMs: 1_500,
  maxTimeoutMs: 10_000,
  /** Host start (spawn to hello) budget. */
  startTimeoutMs: 15_000
});

export type DomIntelligenceFailureCode =
  | "DISABLED"
  | "UNAVAILABLE"
  | "INCOMPATIBLE"
  | "TIMEOUT"
  | "CRASHED"
  | "REJECTED"
  | "MALFORMED"
  | "OVERSIZED"
  | "PROTECTED_SURFACE";

export interface DomIntelligenceFailure {
  ok: false;
  code: DomIntelligenceFailureCode;
  /** Bounded diagnostic, never page content. */
  message: string;
}

export interface DomIntelligenceStatus {
  available: boolean;
  provider: "none" | "scrapling";
  mode: "parser-only";
  /** Always false: no provider may own a browser or reach the network (asserted by verifiers). */
  browserAccess: false;
  networkAccess: false;
  protocolVersion?: number;
  /** Provider library version (e.g. the Scrapling release), when available. */
  version?: string;
  runtime?: string;
  /** Why it is unavailable, as a failure code. */
  reason?: DomIntelligenceFailureCode;
  detail?: string;
}

export interface DomRecoveryRequest {
  /** Sanitized HTML from `captureDomSnapshot`, with `data-awkit-v` indices on visible elements. */
  html: string;
  reference: DomReferenceRecord;
  maxCandidates?: number;
  /** Provider score floor in percent (0–100). */
  minScore?: number;
  timeoutMs?: number;
}

export interface DomRecoveryCandidate {
  /** The `data-awkit-v` index: `frame.locator("body *").nth(index)`. */
  index: number;
  /** Provider score in percent. Evidence only; never compared with AWKIT's thresholds. */
  score: number;
}

export type DomRecoveryResult =
  | { ok: true; candidates: DomRecoveryCandidate[]; elements: number; parseMs: number; matchMs: number }
  | DomIntelligenceFailure;

export interface DomReferenceResult {
  ok: true;
  /** Fields the provider will match on, after its own validation. */
  fields: string[];
}

export interface DomNormalizationRequest {
  html: string;
  timeoutMs?: number;
}

/** The provider's raw normalization, before AWKIT bounds and redacts it (`normalizeDom.ts`). */
export interface RawDomNormalization {
  title?: string;
  landmarks: Array<{ role: string; label?: string }>;
  headings: Array<{ level: number; text: string }>;
  interactive: Array<{ role: string; name?: string; disabled?: boolean }>;
  alerts: string[];
  forms: Array<{ label?: string; fields: Array<{ role: string; label?: string; required?: boolean; invalid?: boolean }> }>;
  tables: Array<{ label?: string; columns: string[]; rows: number }>;
  text: string[];
  truncated: boolean;
}

export type DomNormalizationResult = { ok: true; normalization: RawDomNormalization; ms: number } | DomIntelligenceFailure;

export interface DomIntelligenceProvider {
  getStatus(): Promise<DomIntelligenceStatus>;
  saveReference(reference: DomReferenceRecord): Promise<DomReferenceResult | DomIntelligenceFailure>;
  findRecoveryCandidates(request: DomRecoveryRequest): Promise<DomRecoveryResult>;
  normalizeForAi(request: DomNormalizationRequest): Promise<DomNormalizationResult>;
  shutdown(): Promise<void>;
}

/** The absent provider: every request answers DISABLED, nothing is spawned. */
export class NoopDomIntelligenceProvider implements DomIntelligenceProvider {
  constructor(private readonly reason: DomIntelligenceFailureCode = "DISABLED", private readonly detail = "DOM intelligence is not enabled.") {}

  async getStatus(): Promise<DomIntelligenceStatus> {
    return { available: false, provider: "none", mode: "parser-only", browserAccess: false, networkAccess: false, reason: this.reason, detail: this.detail };
  }

  async saveReference(): Promise<DomIntelligenceFailure> {
    return this.failure();
  }

  async findRecoveryCandidates(): Promise<DomIntelligenceFailure> {
    return this.failure();
  }

  async normalizeForAi(): Promise<DomIntelligenceFailure> {
    return this.failure();
  }

  async shutdown(): Promise<void> {
    // Nothing to stop.
  }

  private failure(): DomIntelligenceFailure {
    return { ok: false, code: this.reason, message: this.detail };
  }
}

/** What the runner needs to ask for a repair suggestion after its own recovery refused. */
export interface DomIntelligenceRecoveryOptions {
  provider: DomIntelligenceProvider;
  references: DomReferenceStore;
  /** Wall-clock budget for the whole suggestion stage. Default 800 ms. */
  budgetMs?: number;
}

/** A non-executing repair suggestion, recorded in run provenance. No page text, no selector. */
export interface DomRepairSuggestion {
  provider: DomIntelligenceStatus["provider"];
  candidates: number;
  /** The provider's best candidate: its score, AWKIT's identity score for it, and the proof state. */
  best?: { providerScore: number; awkitScore?: number; proof: DomCandidateProof };
}

/**
 * AWKIT's verdict on one provider candidate. `proven` is AWKIT's own recovery winner (which already
 * executed). `agreed` (L12) is AWKIT's best candidate, refused only on score or margin, that the provider
 * independently ranks first with a clear lead (`decideProviderAgreement`); it executes after the same pin
 * and actionability checks. Nothing else can execute.
 */
export type DomCandidateProof =
  | "proven"
  | "agreed"
  | "below-threshold"
  | "ambiguous-margin"
  | "ancestry-veto"
  | "incompatible"
  | "not-visible"
  | "no-recorded-identity";
