/** Main-process composition root for the offline issuer console. */
import { join } from "node:path";
import { getRuntimeDataRoot } from "../appPaths";
import { LICENSING_PRODUCT } from "./licenseRuntime";
import { LicenseIssuerService } from "@src/licensing/issuer/LicenseIssuerService";

const DEFAULT_KEY_ID = "key1";
let issuerService: LicenseIssuerService | null = null;

export function getIssuerOutputDirectory(): string {
  return join(getRuntimeDataRoot(), "issuer-output");
}

export function getLicenseIssuerService(): LicenseIssuerService {
  if (issuerService) return issuerService;
  const defaultKeyPath = join(
    getRuntimeDataRoot(),
    "issuer-keys",
    `${DEFAULT_KEY_ID}.ed25519.pkcs8.b64`
  );
  issuerService = new LicenseIssuerService({
    keyId: DEFAULT_KEY_ID,
    keyPath: process.env.SPECTER_ISSUER_KEY ?? defaultKeyPath,
    outputDirectory: getIssuerOutputDirectory(),
    product: LICENSING_PRODUCT
  });
  return issuerService;
}
