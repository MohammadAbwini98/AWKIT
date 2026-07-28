import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PRIVATE_KEY = resolve(ROOT, ".release-local", "offline-manifest-private.pem");
const DEFAULT_PUBLIC_KEY = resolve(ROOT, "resources", "trust", "offline-manifest-public.pem");
const DEFAULT_MANIFEST = resolve(ROOT, "resources", "dependency-manifest.json");
const DEFAULT_SIGNATURE = resolve(ROOT, "resources", "dependency-manifest.sig");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function keyId(publicKey) {
  return `ed25519:${sha256(publicKey.export({ type: "spki", format: "der" }))}`;
}

async function generateKeys(privateKeyPath, publicKeyPath) {
  if (existsSync(privateKeyPath) || existsSync(publicKeyPath)) {
    throw new Error("Refusing to overwrite an existing offline-manifest signing key.");
  }

  const pair = generateKeyPairSync("ed25519");
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPem = pair.publicKey.export({ type: "spki", format: "pem" });
  await mkdir(dirname(privateKeyPath), { recursive: true });
  await mkdir(dirname(publicKeyPath), { recursive: true });
  await writeFile(privateKeyPath, privatePem, { encoding: "utf8", mode: 0o600 });
  await writeFile(publicKeyPath, publicPem, "utf8");
  process.stdout.write(`Generated offline-manifest signing key ${keyId(pair.publicKey)}.\n`);
  process.stdout.write(`Private key: ${privateKeyPath} (local, ignored; back it up securely)\n`);
  process.stdout.write(`Public key:  ${publicKeyPath} (ship with the application)\n`);
}

async function signManifest(manifestPath, signaturePath, privateKeyPath, publicKeyPath) {
  if (!existsSync(privateKeyPath)) {
    throw new Error(
      `Offline-manifest private key is missing: ${privateKeyPath}. ` +
      "Generate or provision the release key before packaging."
    );
  }
  if (!existsSync(publicKeyPath)) {
    throw new Error(`Offline-manifest public key is missing: ${publicKeyPath}.`);
  }

  const manifestBytes = await readFile(manifestPath);
  const privateKey = createPrivateKey(await readFile(privateKeyPath, "utf8"));
  const publicKey = createPublicKey(await readFile(publicKeyPath, "utf8"));
  const derivedPublicKey = createPublicKey(privateKey);
  if (
    !derivedPublicKey.export({ type: "spki", format: "der" }).equals(
      publicKey.export({ type: "spki", format: "der" })
    )
  ) {
    throw new Error("Offline-manifest private key does not match the shipped public key.");
  }

  const signature = sign(null, manifestBytes, privateKey);
  const record = {
    schemaVersion: 1,
    algorithm: "Ed25519",
    keyId: keyId(publicKey),
    manifest: "dependency-manifest.json",
    manifestSha256: sha256(manifestBytes),
    signatureBase64: signature.toString("base64")
  };
  await writeFile(signaturePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  process.stdout.write(`Signed ${manifestPath} with ${record.keyId}.\n`);
}

export async function verifyManifestSignature({
  manifestPath = DEFAULT_MANIFEST,
  signaturePath = DEFAULT_SIGNATURE,
  publicKeyPath = DEFAULT_PUBLIC_KEY
} = {}) {
  const manifestBytes = await readFile(manifestPath);
  const signatureRecord = JSON.parse(await readFile(signaturePath, "utf8"));
  const publicKey = createPublicKey(await readFile(publicKeyPath, "utf8"));

  if (signatureRecord.schemaVersion !== 1 || signatureRecord.algorithm !== "Ed25519") {
    throw new Error("Dependency-manifest signature metadata is unsupported.");
  }
  if (signatureRecord.keyId !== keyId(publicKey)) {
    throw new Error("Dependency-manifest signature key id does not match the shipped public key.");
  }
  if (signatureRecord.manifest !== "dependency-manifest.json") {
    throw new Error("Dependency-manifest signature targets an unexpected file.");
  }
  if (signatureRecord.manifestSha256 !== sha256(manifestBytes)) {
    throw new Error("Dependency-manifest SHA-256 does not match its signature record.");
  }
  if (!verify(null, manifestBytes, publicKey, Buffer.from(signatureRecord.signatureBase64, "base64"))) {
    throw new Error("Dependency-manifest Ed25519 signature is invalid.");
  }

  return signatureRecord;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? resolve(args[index + 1]) : fallback;
  };
  const privateKeyPath = option(
    "--private-key",
    process.env.AWKIT_OFFLINE_MANIFEST_PRIVATE_KEY
      ? resolve(process.env.AWKIT_OFFLINE_MANIFEST_PRIVATE_KEY)
      : DEFAULT_PRIVATE_KEY
  );
  const publicKeyPath = option("--public-key", DEFAULT_PUBLIC_KEY);
  const manifestPath = option("--manifest", DEFAULT_MANIFEST);
  const signaturePath = option("--signature", DEFAULT_SIGNATURE);

  if (command === "generate-key") {
    await generateKeys(privateKeyPath, publicKeyPath);
  } else if (command === "sign") {
    await signManifest(manifestPath, signaturePath, privateKeyPath, publicKeyPath);
  } else if (command === "verify") {
    const record = await verifyManifestSignature({ manifestPath, signaturePath, publicKeyPath });
    process.stdout.write(`Verified ${manifestPath} with ${record.keyId}.\n`);
  } else {
    throw new Error("Usage: node scripts/offline-manifest-signature.mjs <generate-key|sign|verify> [options]");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
