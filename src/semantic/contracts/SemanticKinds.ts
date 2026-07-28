/**
 * The pure, platform-free core of the semantic contract: document kinds and query bounds.
 *
 * Split out of `SemanticDocument.ts` (2026-07-28) for a structural reason, not a stylistic one.
 * `SemanticDocument.ts` imports `node:crypto` for document hashing, so **any value imported from it
 * drags `createHash` along**. `SemanticApi.ts` value-imports the kind guard and the topK bounds, so
 * the first renderer module to import a semantic value — a length limit, a kind list — failed the
 * build with `"createHash" is not exported by "__vite-browser-external"`. Types erase and were never
 * the problem; values are.
 *
 * Everything here is data and a type guard: no crypto, no filesystem, no Electron, no React. It is
 * safe in the main process, the renderer, a verifier, and the Zvec host alike. Anything needing a
 * digest belongs in `SemanticDocument.ts`, not here — that is the boundary this file exists to hold.
 *
 * `SemanticDocument.ts` re-exports these, so existing importers are unaffected.
 */

export type SemanticDocumentKind =
  | "workflow"
  | "flow"
  | "node-template"
  | "locator-success"
  | "locator-failure"
  | "run-failure"
  | "run-summary"
  | "documentation";

export const SEMANTIC_DOCUMENT_KINDS: readonly SemanticDocumentKind[] = [
  "workflow",
  "flow",
  "node-template",
  "locator-success",
  "locator-failure",
  "run-failure",
  "run-summary",
  "documentation"
];

export function isSemanticDocumentKind(value: unknown): value is SemanticDocumentKind {
  return typeof value === "string" && (SEMANTIC_DOCUMENT_KINDS as readonly string[]).includes(value);
}

export const SEMANTIC_DEFAULT_TOP_K = 20;
export const SEMANTIC_MAX_TOP_K = 100;
