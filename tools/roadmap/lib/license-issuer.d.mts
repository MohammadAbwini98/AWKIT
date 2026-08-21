/**
 * Types for `license-issuer.mjs`.
 *
 * The implementation stays plain ESM because the roadmap server runs directly under Node. The
 * maintained `.mts` verifier imports the same module, so this sidecar keeps that real boundary in
 * `typecheck:scripts` without enabling JavaScript broadly or duplicating the implementation.
 */
import type { ActivationRequest, LicenseDocument } from "../../../src/licensing/LicenseTypes";
import type {
  IssuedLicenseResult,
  IssuerReadiness,
  IssuerReasonCode,
  IssueLicenseWindow
} from "../../../src/licensing/issuer/LicenseIssuerContracts";

export type IssuerBridgeCommand = "readiness" | "parse" | "issue" | "history";
export type IssuerLicenseType = "trial" | "standard" | "enterprise";
export type IssuerEntitlement =
  | "workflow.execute"
  | "workflow.concurrent"
  | "workflow.scheduled"
  | "automation.browser";

export type ActivationRequestParseReason =
  | "ACTIVATION_REQUEST_INVALID"
  | "ACTIVATION_REQUEST_TOO_LARGE"
  | "ACTIVATION_REQUEST_NOT_JSON";

export type IssuePayloadBuildReason =
  | ActivationRequestParseReason
  | "ISSUER_OPTIONS_INVALID"
  | "ISSUER_TIMESTAMP_INVALID"
  | "ISSUER_EXPIRY_NOT_AFTER_START";

export type IssuerBridgeFailureReason =
  | IssuerReasonCode
  | "ISSUER_BRIDGE_UNAVAILABLE"
  | "ISSUER_BRIDGE_FAILED"
  | "BRIDGE_FAILED";

/** A discriminated result whose inactive member remains safely readable by current consumers. */
export type IssuerResult<Value, Reason extends string> =
  | { ok: true; value: Value; reason?: undefined }
  | { ok: false; value?: undefined; reason: Reason };

interface PreparedIssuePayloadBase {
  /** Parsed JSON only; the trusted bridge applies the authoritative `ActivationRequest` guard. */
  activationRequest: Record<string, unknown>;
  licenseType: IssuerLicenseType;
  entitlements: IssuerEntitlement[];
}

export type PreparedIssuePayload =
  | (PreparedIssuePayloadBase & { validityDays: number; validityWindow?: never })
  | (PreparedIssuePayloadBase & { validityDays?: never; validityWindow: IssueLicenseWindow });

export interface DashboardIssuerReadiness extends IssuerReadiness {
  product: string;
  licenseTypes: IssuerLicenseType[];
  entitlements: IssuerEntitlement[];
  limits: {
    maxValidityDays: number;
    minValidityMinutes: number;
    maxFutureStartDays: number;
  };
}

export interface IssuerHistoryRecord {
  at: unknown;
  serialNumber: unknown;
  licenseId: unknown;
  licenseType: unknown;
  machineFingerprintHash: string | null;
  validFromUtc: unknown;
  expiresAtUtc: unknown;
  entitlements: unknown[];
  keyId: unknown;
}

export interface IssuerHistory {
  records: IssuerHistoryRecord[];
}

export interface IssuedLicenseEnvelope {
  result: IssuedLicenseResult;
  document: LicenseDocument;
}

export interface ParseActivationRequestBridgePayload {
  activationRequest: Record<string, unknown>;
}

export declare const LICENSE_ISSUE_ACTION_HEADER: "license-issue";

export declare function runIssuerBridge(
  command: "readiness"
): Promise<IssuerResult<DashboardIssuerReadiness, IssuerBridgeFailureReason>>;
export declare function runIssuerBridge(
  command: "history"
): Promise<IssuerResult<IssuerHistory, IssuerBridgeFailureReason>>;
export declare function runIssuerBridge(
  command: "parse",
  payload: ParseActivationRequestBridgePayload
): Promise<IssuerResult<ActivationRequest, IssuerBridgeFailureReason>>;
export declare function runIssuerBridge(
  command: "issue",
  payload: PreparedIssuePayload
): Promise<IssuerResult<IssuedLicenseEnvelope, IssuerBridgeFailureReason>>;

export declare function parseActivationRequestBody(
  body: unknown
): IssuerResult<Record<string, unknown>, ActivationRequestParseReason>;

export declare function buildIssuePayload(
  body: unknown
): IssuerResult<PreparedIssuePayload, IssuePayloadBuildReason>;

export declare const __test__: {
  BRIDGE_SCRIPT: string;
  TSX_CLI: string | null;
  MAX_REQUEST_BYTES: number;
  BRIDGE_COMMANDS: Set<IssuerBridgeCommand>;
};
