/**
 * The pinned Vulkan pack exactly as a user supplies it (the manifest's files, from the installed prebuilt),
 * imported into a scratch backends root through the production `AiBackendPackStore` and the real trust chain:
 * the signed dependency manifest and this build's staged VC++ runtime. The same import `verify-ai-gpu-host`
 * makes, for the live quality verifiers' Automatic arm (`verify-ai-explanation-live.mts --execution auto`).
 *
 * The scratch folder is named like verify-ai-gpu-host's (`awkit-gpu-host-*`), and the caller removes it with
 * `removeWhenReleased` once no process maps the pack's DLLs.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AiBackendPackStore, backendTrustSources, resolveBackendTrust } from "@src/ai/AiBackendPack";
import { AI_BACKEND_MANIFEST, AI_RUNTIME_PIN } from "@src/offline/AiModelManifest";
import { readSignedDependencyManifest } from "@src/offline/SupplyChainIntegrity";

import { ROOT } from "./launch.mts";

export type VulkanPackImport = { ok: true; scratch: string; backendsRoot: string } | { ok: false; scratch: string | null; reason: string };

export async function importPinnedVulkanPack(): Promise<VulkanPackImport> {
  const entry = AI_BACKEND_MANIFEST.find((candidate) => candidate.id === "vulkan");
  const installed = path.join(ROOT, "node_modules", "@node-llama-cpp", "win-x64-vulkan");
  if (!entry || !existsSync(installed)) return { ok: false, scratch: null, reason: "the pinned Vulkan prebuilt is not installed" };
  const scratch = mkdtempSync(path.join(os.tmpdir(), "awkit-gpu-host-"));
  const source = path.join(scratch, "vulkan-pack");
  for (const file of entry.files) {
    const target = path.join(source, ...file.path.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(installed, ...file.path.split("/")), target);
  }
  const backendsRoot = path.join(scratch, "backends");
  const sources = backendTrustSources({ packaged: false, resourcesPath: "", appPath: ROOT });
  const store = new AiBackendPackStore({
    root: backendsRoot,
    entry,
    runtimeBuild: AI_RUNTIME_PIN.build,
    trust: async () => resolveBackendTrust({ signed: await readSignedDependencyManifest(sources.resourcesRoot), hostRoot: sources.hostRoot, entry, runtimeBuild: AI_RUNTIME_PIN.build! })
  });
  const imported = await store.import(source);
  return imported.ok ? { ok: true, scratch, backendsRoot } : { ok: false, scratch, reason: JSON.stringify(imported) };
}
