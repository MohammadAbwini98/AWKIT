import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const artifactIndex = args.indexOf("--artifact");
  const kindIndex = args.indexOf("--kind");
  if (artifactIndex < 0 || kindIndex < 0) {
    throw new Error("Usage: node scripts/write-artifact-provenance.mjs --artifact <path> --kind <portable|nsis>");
  }

  const artifactPath = resolve(args[artifactIndex + 1]);
  const kind = args[kindIndex + 1];
  const reportPath = resolve(ROOT, "dist", "release-provenance.json");
  const [manifestBytes, signature, manifest, artifactMetadata] = await Promise.all([
    readFile(resolve(ROOT, "resources", "dependency-manifest.json")),
    readFile(resolve(ROOT, "resources", "dependency-manifest.sig"), "utf8").then(JSON.parse),
    readFile(resolve(ROOT, "resources", "dependency-manifest.json"), "utf8").then(JSON.parse),
    stat(artifactPath)
  ]);
  const existing = await readFile(reportPath, "utf8").then(JSON.parse).catch(() => ({ artifacts: {} }));
  const chromium = manifest.browsers.find((browser) => browser.name === "chromium");

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      commit: manifest.application.sourceCommit,
      treeDirty: manifest.application.sourceTreeDirty
    },
    application: {
      name: manifest.application.name,
      version: manifest.application.version,
      electronVersion: manifest.dependencies.electron,
      playwrightVersion: chromium.payloadProvenance.installedPlaywrightVersion
    },
    browser: {
      distribution: "Chrome for Testing",
      version: chromium.version,
      revision: chromium.revision,
      sourceUrl: chromium.payloadProvenance.sourceUrl,
      sourceTimestamp: chromium.payloadProvenance.sourceTimestamp,
      archiveSha256: chromium.payloadProvenance.sourceArchiveSha256,
      executableSha256: chromium.payloadProvenance.executableSha256,
      payloadTree: chromium.payloadProvenance.hash
    },
    dependencyManifest: {
      sha256: createHash("sha256").update(manifestBytes).digest("hex"),
      signatureAlgorithm: signature.algorithm,
      signingKeyId: signature.keyId,
      signature: "resources/dependency-manifest.sig"
    },
    reproducibility: {
      comparisonCommand: "npm run offline:compare-payloads -- --left <artifact-a> --right <artifact-b>",
      model: "decompressed payload paths, sizes and CRC32 values",
      wholeArtifactHashPurpose: "identifies this accepted artifact only; timestamps prevent whole-file reproducibility"
    },
    artifacts: {
      ...(existing.artifacts ?? {}),
      [kind]: {
        file: artifactPath.slice(ROOT.length + 1).replaceAll("\\", "/"),
        size: artifactMetadata.size,
        sha256: await hashFile(artifactPath)
      }
    }
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`Recorded ${kind} artifact provenance: ${reportPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
