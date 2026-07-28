import type { SemanticReasonCode } from "@src/semantic/contracts/SemanticApi";
// `SemanticKinds` is the PURE half of the contract and is safe to import by value here.
// `SemanticDocument` is NOT — it imports `node:crypto`, and a value import of it fails the renderer
// build with `"createHash" is not exported by "__vite-browser-external"`.
import { SEMANTIC_DOCUMENT_KINDS, type SemanticDocumentKind } from "@src/semantic/contracts/SemanticKinds";
import type { SemanticCapability } from "@src/semantic/contracts/SemanticHealth";

/**
 * Document kind → its display label. Typed as a **total** `Record` over the union: adding a kind
 * without giving it a label fails the build here rather than rendering a raw slug to a user.
 */
const KIND_LABELS: Record<SemanticDocumentKind, string> = {
  workflow: "Workflow",
  flow: "Flow",
  "node-template": "Node",
  // The two locator kinds and the two run kinds must NOT share a label. They are separate filter
  // checkboxes, and an earlier revision labelled both locator kinds "Locator" — which rendered two
  // identical, indistinguishable controls. Every value here has to be unique for that reason.
  "locator-success": "Locator (worked)",
  "locator-failure": "Locator (failed)",
  "run-failure": "Failed run",
  "run-summary": "Run",
  documentation: "Docs"
};

/** The canonical kind list, re-exported so a UI does not maintain a second copy of the order. */
export const SEMANTIC_KIND_OPTIONS = SEMANTIC_DOCUMENT_KINDS;

export function semanticKindLabel(kind: SemanticDocumentKind): string {
  return KIND_LABELS[kind];
}

/**
 * Reason code → one safe, user-facing sentence. Mirrors `pages/admin/adminMessages.ts`.
 *
 * The switch is **exhaustive by type**, not by a `default` branch: the `never` assignment below
 * fails the build if a member is added to `SemanticReasonCode` without a message here. A `default`
 * would compile forever and silently show "something went wrong" for a code that has a precise
 * meaning — which is the whole reason the codes exist.
 *
 * `message` from the response is deliberately NOT concatenated by default. The contract permits a
 * short safe sentence, but it is written for a developer ("The rebuild did not complete."); callers
 * that want it can pass it explicitly.
 */
export function semanticReasonMessage(code: SemanticReasonCode, detail?: string): string {
  const base = ((): string => {
    switch (code) {
      case "OK":
        return "Done.";
      case "NOT_AVAILABLE":
        return "Semantic search is not included in this build.";
      case "INDEX_NOT_READY":
        return "The semantic index has not been built yet. Rebuild it from Settings → Semantic Index.";
      case "INVALID_REQUEST":
        return "That query could not be run as written.";
      case "SEARCH_FAILED":
        return "The search could not be completed.";
      case "REBUILD_REFUSED":
        return "The rebuild was refused.";
      case "CLEAR_FAILED":
        return "The index could not be cleared.";
      case "SETTINGS_REJECTED":
        return "Those semantic settings could not be saved.";
      case "NOT_SUPPORTED":
        return "That action is not supported yet.";
      case "REAUTH_REQUIRED":
        return "Confirm your password to continue.";
      case "NOT_AUTHORIZED":
        return "You don't have permission to do that.";
      default: {
        // Exhaustiveness guard — unreachable while every code is handled above.
        const unhandled: never = code;
        return unhandled;
      }
    }
  })();
  return detail && detail.length > 0 ? `${base} ${detail}` : base;
}

/** Capability → the short label shown beside the health indicator. */
export function semanticCapabilityLabel(capability: SemanticCapability): string {
  switch (capability) {
    case "available":
      return "Available";
    case "availableOnDemand":
      return "Available on demand";
    case "unavailable":
      return "Unavailable";
    default: {
      const unhandled: never = capability;
      return unhandled;
    }
  }
}

/**
 * Capability → the status-tone token used by the shared badge classes. Kept here rather than in the
 * component so the search page and the settings panel cannot drift apart on what "healthy" looks
 * like.
 */
export function semanticCapabilityTone(capability: SemanticCapability): "ok" | "warn" | "error" {
  switch (capability) {
    case "available":
      return "ok";
    case "availableOnDemand":
      return "warn";
    case "unavailable":
      return "error";
    default: {
      const unhandled: never = capability;
      return unhandled;
    }
  }
}
