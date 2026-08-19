/** Main-process composition root for the offline issuer console. */
import { getRuntimeDataRoot } from "../appPaths";
import { LICENSING_PRODUCT } from "./licenseRuntime";
import {
  DEFAULT_ISSUER_KEY_ID,
  issuerKeyPathFor,
  issuerOutputDirectoryFor
} from "@src/licensing/issuer/IssuerLocations";
import { LicenseIssuerService } from "@src/licensing/issuer/LicenseIssuerService";

let issuerService: LicenseIssuerService | null = null;

export function getIssuerOutputDirectory(): string {
  return issuerOutputDirectoryFor(getRuntimeDataRoot());
}

export function getLicenseIssuerService(): LicenseIssuerService {
  if (issuerService) return issuerService;
  issuerService = new LicenseIssuerService({
    keyId: DEFAULT_ISSUER_KEY_ID,
    // Same resolution the developer-tooling bridge uses, so both see one key (IssuerLocations.ts).
    keyPath: issuerKeyPathFor(getRuntimeDataRoot(), DEFAULT_ISSUER_KEY_ID),
    outputDirectory: getIssuerOutputDirectory(),
    product: LICENSING_PRODUCT
  });
  return issuerService;
}
