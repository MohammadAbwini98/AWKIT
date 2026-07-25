/**
 * Shared match-explanation vocabulary (plan §12.4).
 *
 * Both store implementations derive their `reasons` from here. That is not tidiness — the contract
 * suite asserts on the vocabulary, so if each store invented its own strings the two would drift
 * and a caller could not rely on `reasons` meaning the same thing across backends. The shared suite
 * caught exactly that: the Zvec adapter originally returned a flat "Full-text match" while the
 * in-memory store explained title vs content matches.
 *
 * Ranking WEIGHTS deliberately stay with each store — the vendor ranks differently and the plan
 * warns against inventing a permanent weighting formula before benchmark data exists. Only the
 * explanation is shared.
 *
 * Framework-agnostic.
 */

import type { SemanticSearchRequest } from "./contracts/SemanticDocument";

/** Lowercase alphanumeric tokens, length ≥ 2. The one tokenizer both stores use. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2);
}

export interface ExplainableDocument {
  title: string;
  content: string;
  tags: readonly string[];
  workflowId?: string;
  hostname?: string;
  nodeType?: string;
  outcome?: string;
}

/**
 * Human-readable reasons a document matched.
 *
 * Never an opaque score restated as confidence — every entry names a concrete, checkable property.
 */
export function deriveMatchReasons(
  doc: ExplainableDocument,
  terms: readonly string[],
  request: SemanticSearchRequest
): string[] {
  const reasons: string[] = [];

  if (terms.length === 0) {
    reasons.push("Filter match");
  } else {
    const titleTokens = new Set(tokenize(doc.title));
    const contentTokens = new Set(tokenize(doc.content));
    const tagTokens = new Set(tokenize(doc.tags.join(" ")));

    const titleHits = terms.filter((t) => titleTokens.has(t)).length;
    if (titleHits === terms.length) reasons.push("Title exact match");
    else if (titleHits > 0) reasons.push("Title partial match");

    if (terms.some((t) => contentTokens.has(t))) reasons.push("Content match");
    if (terms.some((t) => tagTokens.has(t))) reasons.push("Tag match");
  }

  if (request.workflowId !== undefined && doc.workflowId === request.workflowId) reasons.push("Current workflow match");
  if (request.hostname !== undefined && doc.hostname === request.hostname) reasons.push("Current hostname match");
  if (request.nodeType !== undefined && doc.nodeType === request.nodeType) reasons.push("Same node type");
  if (doc.outcome === "failure") reasons.push("Recorded failure");

  // A hit with no explanation would violate the contract, so fall back to the honest generic reason
  // rather than returning an empty list.
  if (reasons.length === 0) reasons.push("Full-text match");

  return reasons;
}
