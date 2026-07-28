import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DependencyManifest } from "./DependencyManifest";

interface ManifestSignatureRecord {
  schemaVersion: number;
  algorithm: string;
  keyId: string;
  manifest: string;
  manifestSha256: string;
  signatureBase64: string;
}

interface OfflineBrowserPolicy {
  schemaVersion: number;
  playwright: { version: string };
  browser: {
    name: string;
    revision: string;
    version: string;
    executableSha256: string;
    payload: {
      algorithm: string;
      sha256: string;
      fileCount: number;
      totalBytes: number;
    };
  };
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicKeyId(publicKeyPem: string): string {
  const publicKey = createPublicKey(publicKeyPem);
  return `ed25519:${sha256(publicKey.export({ type: "spki", format: "der" }))}`;
}

export async function validateOfflineSupplyChain(
  resourcesRoot: string,
  manifest: DependencyManifest | null
): Promise<string[]> {
  if (!manifest) return ["Dependency manifest cannot be authenticated because it is missing or invalid."];

  const issues: string[] = [];
  const manifestPath = join(resourcesRoot, "dependency-manifest.json");
  const signaturePath = join(resourcesRoot, "dependency-manifest.sig");
  const publicKeyPath = join(resourcesRoot, "trust", "offline-manifest-public.pem");
  const policyPath = join(resourcesRoot, "offline-browser-policy.json");
  const browserExecutablePath = join(resourcesRoot, "browsers", "chromium", "chrome.exe");

  try {
    const [manifestBytes, signatureJson, publicKeyPem, policyBytes, browserExecutable] = await Promise.all([
      readFile(manifestPath),
      readFile(signaturePath, "utf8"),
      readFile(publicKeyPath, "utf8"),
      readFile(policyPath),
      readFile(browserExecutablePath)
    ]);
    const signature = JSON.parse(signatureJson) as ManifestSignatureRecord;
    const policy = JSON.parse(policyBytes.toString("utf8")) as OfflineBrowserPolicy;
    const publicKey = createPublicKey(publicKeyPem);

    if (signature.schemaVersion !== 1 || signature.algorithm !== "Ed25519") {
      issues.push("Dependency-manifest signature metadata is unsupported.");
    }
    if (signature.keyId !== publicKeyId(publicKeyPem)) {
      issues.push("Dependency-manifest signature key does not match the shipped release key.");
    }
    if (signature.manifest !== "dependency-manifest.json") {
      issues.push("Dependency-manifest signature targets an unexpected file.");
    }
    if (signature.manifestSha256 !== sha256(manifestBytes)) {
      issues.push("Dependency-manifest content does not match its signed SHA-256.");
    } else if (!verify(null, manifestBytes, publicKey, Buffer.from(signature.signatureBase64, "base64"))) {
      issues.push("Dependency-manifest Ed25519 signature is invalid.");
    }

    const chromium = manifest.browsers.find((browser) => browser.name === "chromium");
    const provenance = chromium?.payloadProvenance;
    if (!chromium || !provenance) {
      issues.push("Signed dependency manifest has no Chromium payload provenance.");
    } else {
      if (provenance.approvalPolicySha256 !== sha256(policyBytes)) {
        issues.push("Offline browser policy does not match the signed approval-policy hash.");
      }
      if (provenance.executableSha256 !== sha256(browserExecutable)) {
        issues.push("Bundled Chromium executable does not match the signed approval hash.");
      }
      if (
        policy.schemaVersion !== 1 ||
        policy.playwright.version !== provenance.installedPlaywrightVersion ||
        policy.browser.name !== chromium.name ||
        policy.browser.revision !== chromium.revision ||
        policy.browser.version !== chromium.version ||
        policy.browser.executableSha256 !== provenance.executableSha256 ||
        policy.browser.payload.algorithm !== provenance.hash.algorithm ||
        policy.browser.payload.sha256 !== provenance.hash.sha256 ||
        policy.browser.payload.fileCount !== provenance.hash.fileCount ||
        policy.browser.payload.totalBytes !== provenance.hash.totalBytes
      ) {
        issues.push("Signed dependency manifest and offline browser approval policy disagree.");
      }
    }
  } catch (error) {
    issues.push(`Offline supply-chain verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return issues;
}
