/**
 * Local-AI model manifest (Phase L, L1.2): the only list of model packs this build accepts.
 *
 * Owned by the release role, like `DependencyManifest.ts`: `src/offline/**` is the offline boundary,
 * so every edit is Risk 3 and lease-gated. It changes only with an app release. There is no online
 * refresh and no user override, and a pack whose SHA-256 is not listed here is refused at import
 * (docs/ai/DECISIONS.md, 2026-09-19). The model pack never ships in the installer and never enters
 * the signed dependency manifest; the pinned llama.cpp runtime will, when it ships.
 *
 * It was EMPTY BY DESIGN until 2026-09-20, because a checksum cannot be written down for a file
 * nobody has measured and a guessed entry would make the import check pass for the wrong reason.
 * The pack has now been downloaded and measured, and the runtime installed, so both the entry and
 * `AI_RUNTIME_PIN.build` are pinned from real artifacts. If either is ever emptied again the app
 * returns to its pre-Phase-L behaviour: every import is refused, and while `build` is null no host
 * is started even if one is present.
 */

export interface AiModelManifestEntry {
  /** Stable id recorded in `AiActionRecord.modelId`. */
  id: string;
  displayName: string;
  /** Expected file name, for the import dialog and notices. Identity is the checksum, never the name. */
  fileName: string;
  sizeBytes: number;
  /** Lowercase hex SHA-256 of the whole file. */
  sha256: string;
  format: "gguf";
  /** The model's own context length; the app still caps every request at 4K. */
  contextTokens: number;
  quantization: string;
  /** SPDX license id and where its notice ships. */
  license: { spdx: string; notice: string };
  /** Constrained decoding is mandatory, so a pack without grammar support can never be admitted. */
  capabilities: { jsonSchemaGrammar: boolean; thinkingToggle: boolean };
}

/**
 * Pinned 2026-09-20. Every field below was MEASURED from the downloaded artifact, not copied from a
 * model card: the size and SHA-256 from the file on disk (`certutil -hashfile … SHA256`), and the
 * identity fields from the GGUF header itself — `GGUF v3`, `general.architecture = qwen35`,
 * `qwen35.context_length = 262144`, `general.name = Qwen_Qwen3.5 4B`, 426 tensors. The published
 * checksum agreed with the measured one exactly, which is a cross-check rather than the source.
 */
export const AI_MODEL_MANIFEST: readonly AiModelManifestEntry[] = Object.freeze([
  Object.freeze({
    id: "qwen3.5-4b-q4-k-m",
    displayName: "Qwen3.5 4B (Q4_K_M)",
    fileName: "Qwen3.5-4B-Q4_K_M.gguf",
    sizeBytes: 2_707_513_696,
    sha256: "25082a7dd3776cc3c741c6347d3bd04523f05796607b3fbc32fa3a25dfa1418c",
    format: "gguf",
    // The model's own context length. Every request is still capped at AI_CONTEXT_TOKENS (4K).
    contextTokens: 262_144,
    quantization: "Q4_K_M",
    license: { spdx: "Apache-2.0", notice: "resources/THIRD_PARTY_NOTICES.md" },
    // Constrained decoding is mandatory. Qwen3.5 is a hybrid reasoning model, so thinking is a real
    // toggle — the host closes it by pre-filling an empty think block on the assistant turn.
    capabilities: { jsonSchemaGrammar: true, thinkingToggle: true }
  })
]);

/**
 * The llama.cpp build the host must report in its handshake.
 *
 * Measured, not assumed: the host composes this as
 * `${RUNTIME_PACKAGE}@${pkg.version}+llama.cpp@${release.release}`, read from the installed
 * `node_modules/node-llama-cpp/package.json` and its `llama/binariesGithubRelease.json`. A handshake
 * reporting anything else is refused as incompatible and no model is loaded.
 */
export const AI_RUNTIME_PIN: Readonly<{ name: "llama.cpp"; build: string | null }> = Object.freeze({
  name: "llama.cpp",
  build: "node-llama-cpp@3.21.1+llama.cpp@v0.4.0"
});

const MAX_PACK_BYTES = 64 * 1024 ** 3;

/** Structural check. The import path ignores any entry that fails it, whatever the list says. */
export function isValidAiModelManifestEntry(entry: unknown): entry is AiModelManifestEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  const license = e.license as Record<string, unknown> | undefined;
  const capabilities = e.capabilities as Record<string, unknown> | undefined;
  return (
    typeof e.id === "string" &&
    /^[a-z0-9][a-z0-9._-]{0,63}$/.test(e.id) &&
    typeof e.displayName === "string" &&
    e.displayName.trim().length > 0 &&
    e.displayName.length <= 120 &&
    typeof e.fileName === "string" &&
    /^[A-Za-z0-9._-]{1,128}\.gguf$/.test(e.fileName) &&
    Number.isInteger(e.sizeBytes) &&
    (e.sizeBytes as number) > 0 &&
    (e.sizeBytes as number) <= MAX_PACK_BYTES &&
    typeof e.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(e.sha256) &&
    e.format === "gguf" &&
    Number.isInteger(e.contextTokens) &&
    (e.contextTokens as number) > 0 &&
    typeof e.quantization === "string" &&
    e.quantization.length > 0 &&
    typeof license?.spdx === "string" &&
    license.spdx.length > 0 &&
    typeof license?.notice === "string" &&
    license.notice.length > 0 &&
    capabilities?.jsonSchemaGrammar === true &&
    typeof capabilities?.thinkingToggle === "boolean"
  );
}
