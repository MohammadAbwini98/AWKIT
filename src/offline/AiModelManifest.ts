/**
 * Local-AI model manifest (Phase L, L1.2): the only list of model packs this build accepts.
 *
 * Owned by the release role, like `DependencyManifest.ts`: `src/offline/**` is the offline boundary,
 * so every edit is Risk 3 and lease-gated. It changes only with an app release. There is no online
 * refresh and no user override, and a pack whose SHA-256 is not listed here is refused at import
 * (docs/ai/DECISIONS.md, 2026-09-19). The model pack never ships in the installer and never enters
 * the signed dependency manifest; the pinned llama.cpp runtime will, when it ships.
 *
 * EMPTY BY DESIGN until the owner pins a real pack. A checksum cannot be written down for a file
 * nobody has measured, and a guessed entry would make the import check pass for the wrong reason.
 * With no entry every import is refused and the app behaves exactly as it did before Phase L. The
 * same holds for `AI_RUNTIME_PIN.build`: while it is null, no host is started even if one is present.
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

export const AI_MODEL_MANIFEST: readonly AiModelManifestEntry[] = Object.freeze([]);

/** The llama.cpp build the host must report in its handshake. Null until a runtime ships. */
export const AI_RUNTIME_PIN: Readonly<{ name: "llama.cpp"; build: string | null }> = Object.freeze({
  name: "llama.cpp",
  build: null
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
