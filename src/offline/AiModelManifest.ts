/**
 * Local-AI model manifest (Phase L, L1.2): the only list of model packs this build accepts. Beside it
 * (L8a.1), the backend manifest: the only GPU backend packs a user may supply for the pinned runtime.
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

import backendManifestSource from "./ai-backend-manifest.json";

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
 * Two packs. Either may be imported; the store keeps one active pack, matched by checksum.
 *
 * The 4B, pinned 2026-09-20. Every field below was MEASURED from the downloaded artifact, not copied from a
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
  }),
  /**
   * Pinned 2026-09-22, the pack L1.8 was re-scoped to (the owner, 2026-09-21), measured the same way by
   * `verify:ai-model-live-0-8b`: size and SHA-256 from the file on disk (equal to the published object),
   * and from its own GGUF header `GGUF v3`, 320 tensors, `general.architecture = qwen35`,
   * `general.name = Qwen_Qwen3.5 0.8B`, `qwen35.context_length = 262144`, `general.file_type = 15`
   * (Q4_K_M). That verifier fails if the context length or quantization below stops matching the header.
   */
  Object.freeze({
    id: "qwen3.5-0.8b-q4-k-m",
    displayName: "Qwen3.5 0.8B (Q4_K_M)",
    fileName: "Qwen3.5-0.8B-Q4_K_M.gguf",
    sizeBytes: 527_502_816,
    sha256: "f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec",
    format: "gguf",
    contextTokens: 262_144,
    quantization: "Q4_K_M",
    license: { spdx: "Apache-2.0", notice: "resources/THIRD_PARTY_NOTICES.md" },
    // Same family and template as the 4B: the host pre-closes the think block the same way.
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
 *
 * `backends` is the backend set admitted for that build (L8a.1, E3): `cpu` ships in the installer,
 * and every other entry is a user-supplied pack that `AI_BACKEND_MANIFEST` pins file by file.
 * scripts/prepare-ai-native-host.mjs and scripts/validate-offline-bundle.ps1 parse this declaration
 * strictly, so it stays one frozen object with one `name`, one `build` and no nested braces.
 */
export const AI_RUNTIME_PIN: Readonly<{ name: "llama.cpp"; build: string | null; backends: readonly AiRuntimeBackend[] }> = Object.freeze({
  name: "llama.cpp",
  build: "node-llama-cpp@3.21.1+llama.cpp@v0.4.0",
  backends: Object.freeze(["cpu", "vulkan"] as const)
});

/** A GPU backend a user may supply. CUDA joins later as its own manifest entry with its own evidence (E3). */
export type AiGpuBackend = "vulkan";
export type AiRuntimeBackend = "cpu" | AiGpuBackend;
const AI_GPU_BACKENDS: readonly AiGpuBackend[] = Object.freeze(["vulkan"]);

export interface AiBackendFile {
  /** POSIX path inside the pack, as the prebuilt package lays it out. */
  path: string;
  /** Bytes; `size`, as the signed dependency manifest names it. */
  size: number;
  /** Lowercase hex SHA-256 of the whole file. */
  sha256: string;
}

/**
 * One user-supplied GPU backend pack: exactly the runtime files of the pinned node-llama-cpp prebuilt
 * for that backend, measured by the L8a.0 gate (`verify:ai-gpu-backend-gate`) and re-measured against
 * the installed package by `verify:ai-backend-manifest`. A pack is accepted only when it holds these
 * files and nothing else. The Visual C++ runtime the pack imports is not part of it: the app copies
 * its own, already validated copy from the installer beside the pack (L8a.2).
 */
export interface AiBackendManifestEntry {
  id: AiGpuBackend;
  package: string;
  packageVersion: string;
  files: readonly AiBackendFile[];
}

const MAX_BACKEND_FILES = 256;
const MAX_BACKEND_FILE_BYTES = 1024 ** 3;
const PACK_PATH = /^[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/;

/** Structural check of one backend entry against the pinned build. Anything that fails is never admitted. */
export function isValidAiBackendManifestEntry(entry: unknown, runtimeBuild: string | null): entry is AiBackendManifestEntry {
  if (typeof entry !== "object" || entry === null || typeof runtimeBuild !== "string") return false;
  const e = entry as Record<string, unknown>;
  const npmVersion = /^node-llama-cpp@(\d+\.\d+\.\d+)\+/.exec(runtimeBuild)?.[1];
  if (
    !AI_GPU_BACKENDS.includes(e.id as AiGpuBackend) ||
    e.package !== `@node-llama-cpp/win-x64-${String(e.id)}` ||
    npmVersion === undefined ||
    e.packageVersion !== npmVersion ||
    !Array.isArray(e.files) ||
    e.files.length === 0 ||
    e.files.length > MAX_BACKEND_FILES
  ) {
    return false;
  }
  const seen = new Set<string>();
  for (const file of e.files as unknown[]) {
    if (typeof file !== "object" || file === null) return false;
    const f = file as Record<string, unknown>;
    if (
      typeof f.path !== "string" ||
      f.path.length > 200 ||
      !PACK_PATH.test(f.path) ||
      f.path.split("/").some((segment) => segment === "." || segment === "..") ||
      /\.gguf$/i.test(f.path) ||
      !Number.isInteger(f.size) ||
      (f.size as number) <= 0 ||
      (f.size as number) > MAX_BACKEND_FILE_BYTES ||
      typeof f.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(f.sha256)
    ) {
      return false;
    }
    // Windows paths are case-insensitive: a case variant would let one entry stand in for another file.
    const key = f.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return seen.has(`bins/win-x64-${String(e.id)}/llama-addon.node`);
}

/**
 * The backend entries a pin admits, from the release-owned JSON source. Fail-closed: a source for another
 * build, a malformed entry, a backend the pin does not list or a backend listed twice admits nothing.
 */
export function resolveAiBackendManifest(
  source: unknown,
  pin: Readonly<{ build: string | null; backends: readonly string[] }>
): readonly AiBackendManifestEntry[] {
  if (typeof source !== "object" || source === null || pin.build === null) return Object.freeze([]);
  const s = source as Record<string, unknown>;
  const schema = s.schema as Record<string, unknown> | undefined;
  if (schema?.name !== "awkit-ai-backend-manifest" || schema.version !== 1 || s.runtimeBuild !== pin.build || !Array.isArray(s.backends)) {
    return Object.freeze([]);
  }
  const valid = s.backends.filter((entry): entry is AiBackendManifestEntry => isValidAiBackendManifestEntry(entry, pin.build));
  const admitted = valid.filter((entry) => pin.backends.includes(entry.id) && valid.filter((other) => other.id === entry.id).length === 1);
  return Object.freeze(
    admitted.map((entry) =>
      Object.freeze({ ...entry, files: Object.freeze(entry.files.map((file) => Object.freeze({ path: file.path, size: file.size, sha256: file.sha256 }))) })
    )
  );
}

export const AI_BACKEND_MANIFEST: readonly AiBackendManifestEntry[] = resolveAiBackendManifest(backendManifestSource, AI_RUNTIME_PIN);

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
