/** Main-process composition root for the offline issuer console. */
import { getRuntimeDataRoot } from "../appPaths";
import { LICENSING_PRODUCT } from "./licenseRuntime";
import {
  DEFAULT_ISSUER_KEY_ID,
  issuerOutputDirectoryFor,
  resolveIssuerKeyLocation
} from "@src/licensing/issuer/IssuerLocations";
import { LicenseIssuerService } from "@src/licensing/issuer/LicenseIssuerService";

let issuerService: LicenseIssuerService | null = null;

export function getIssuerOutputDirectory(): string {
  return issuerOutputDirectoryFor(getRuntimeDataRoot());
}

export function getLicenseIssuerService(): LicenseIssuerService {
  if (issuerService) return issuerService;
  // The canonical resolver (IssuerLocations.ts) — the same call the dashboard bridge, the CLI and
  // keygen make, so all four can never disagree about which file is the signing key.
  const location = resolveIssuerKeyLocation({
    runtimeRoot: getRuntimeDataRoot(),
    keyId: DEFAULT_ISSUER_KEY_ID
  });
  issuerService = new LicenseIssuerService({
    keyId: location.keyId,
    keyPath: location.keyPath,
    outputDirectory: getIssuerOutputDirectory(),
    product: LICENSING_PRODUCT,
    keySource: location.source,
    // Disclosed here and nowhere else: the Issuer console is behind the exclusive Issuer role and a
    // fresh reauth inside this app, and an operator told "the key was not found" with no location
    // has no way to act. The value is `redactKeyPath`'d — a place, never key material.
    keyLocationDisclosure: location.displayPath || undefined,
    locationProblem: location.problem
  });
  return issuerService;
}
