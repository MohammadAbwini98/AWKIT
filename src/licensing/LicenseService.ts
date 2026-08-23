/**
 * Licensing orchestration — the API the trusted main process (Phase 5 IPC) calls. Ties together the
 * machine fingerprint, the signature/time/status validator, and the adaptive store, and maintains store
 * metadata (clock high-water mark, last-validated time). Electron-free and dependency-injected so it is
 * fully unit-verifiable.
 *
 * It performs NO authorization — the caller enforces RBAC separately. It never touches auth/RBAC data.
 */
import { buildActivationRequest } from "./LicenseCanonical";
import {
  DEFAULT_LICENSE_POLICY,
  LicenseStatus,
  type ActivationRequest,
  type LicenseDocument,
  type LicensePolicy,
  type LicenseValidationResult,
  type MachineFingerprint
} from "./LicenseTypes";
import { validateLicense } from "./LicenseValidator";
import { verifyLicenseSignature } from "./crypto/LicenseSignature";
import type { TrustedKey } from "./crypto/TrustedKeys";
import { buildEnvelope, LicenseStore, type LicenseEnvelope, type LicenseMeta } from "./store/LicenseStore";

export interface LicenseServiceOptions {
  store: LicenseStore;
  product: string;
  appVersion: string;
  /** Injected so tests can supply a fixed fingerprint; the app passes computeMachineFingerprint. */
  fingerprintProvider: () => MachineFingerprint;
  policy?: LicensePolicy;
  /** Injected clock (ms) for testability; defaults to Date.now. */
  now?: () => number;
  /** Override trusted keys (tests). App uses embedded defaults. */
  trustedKeys?: readonly TrustedKey[];
}

export interface LicenseStatusReport extends LicenseValidationResult {
  source: "shared" | "local" | null;
  /** Both LocalAppData and ProgramData hold a readable license (provisioned one takes precedence). */
  conflict: boolean;
  machineFingerprintHash: string;
  fingerprintConfidence: MachineFingerprint["confidenceLevel"];
  availableSignals: string[];
}

export interface ImportOutcome {
  ok: boolean;
  status: LicenseStatusReport;
  /** Set when the import was rejected before committing. */
  rejectedReason?: "SIGNATURE_INVALID" | "UNSUPPORTED" | "PRODUCT_MISMATCH" | "MACHINE_MISMATCH" | "CORRUPTED";
}

const IMPORT_BLOCKING = new Set([
  LicenseStatus.INVALID_SIGNATURE,
  LicenseStatus.CORRUPTED,
  LicenseStatus.UNSUPPORTED_VERSION,
  LicenseStatus.MACHINE_MISMATCH
]);

export class LicenseService {
  private readonly opts: LicenseServiceOptions;
  private readonly policy: LicensePolicy;
  private readonly now: () => number;

  constructor(options: LicenseServiceOptions) {
    this.opts = options;
    this.policy = options.policy ?? DEFAULT_LICENSE_POLICY;
    this.now = options.now ?? (() => Date.now());
  }

  /** Current license status for this machine, updating store metadata (clock high-water, last-validated). */
  getStatus(): LicenseStatusReport {
    const fingerprint = this.opts.fingerprintProvider();
    const load = this.opts.store.load();
    const nowMs = this.now();

    const clockEnvelopeMs = load.envelope ? Date.parse(load.envelope.meta.clockHighWaterUtc) : undefined;
    // AWKIT-LIC-002 (fold-in): for provisioned installs the LOCAL shadow advances the rollback
    // high-water even though the shared license file itself is read-only.
    let clockShadowMs: number | undefined;
    if (load.source === "shared") {
      try {
        const s = this.opts.store.loadShadowMeta();
        clockShadowMs = s.clockHighWaterUtc ? Date.parse(s.clockHighWaterUtc) : undefined;
      } catch {
        clockShadowMs = undefined;
      }
    }
    const highs = [clockEnvelopeMs, clockShadowMs].filter((n): n is number => n != null && !Number.isNaN(n));
    const clockHighWaterMs = highs.length ? Math.max(...highs) : undefined;
    const result = validateLicense({
      license: load.corrupted ? null : load.envelope?.license ?? null,
      currentFingerprintHash: fingerprint.fingerprintHash,
      nowMs,
      clockHighWaterMs: Number.isNaN(clockHighWaterMs as number) ? undefined : clockHighWaterMs,
      locallyRevoked: load.envelope?.meta.locallyRevoked ?? false,
      policy: this.policy,
      trustedKeys: this.opts.trustedKeys
    });

    const status: LicenseStatusReport = {
      // A corrupted store surfaces CORRUPTED even though validateLicense saw a null license.
      ...(load.corrupted
        ? { ...result, status: LicenseStatus.CORRUPTED, reasonCode: "LICENSE_FILE_CORRUPTED", operable: false }
        : result),
      entitlements: load.envelope?.license.entitlements ?? (load.envelope ? [] : undefined),
      source: load.source,
      conflict: load.conflict,
      machineFingerprintHash: fingerprint.fingerprintHash,
      fingerprintConfidence: fingerprint.confidenceLevel,
      availableSignals: fingerprint.availableSignals
    };

    // AWKIT-LIC-002 (fold-in): advance clock/revocation metadata for PROVISIONED (shared) sources
    // too — into a local shadow file, since the shared location is read-only. Without it the
    // rollback high-water never moves for provisioned installs, defeating the mitigation.
    if (load.envelope && load.source === "shared") {
      try {
        const shadow = this.opts.store.loadShadowMeta();
        const priorShadow = shadow.clockHighWaterUtc ? Date.parse(shadow.clockHighWaterUtc) : NaN;
        const envelopeHigh = Date.parse(load.envelope.meta.clockHighWaterUtc);
        const candidates = [nowMs, Number.isNaN(priorShadow) ? -Infinity : priorShadow, Number.isNaN(envelopeHigh) ? -Infinity : envelopeHigh];
        this.opts.store.saveShadowMeta({ clockHighWaterUtc: new Date(Math.max(...candidates)).toISOString() });
      } catch {
        // Shadow maintenance is best-effort; the validation result stands regardless.
      }
    }

    // Maintain metadata only for the writable (local) source; the provisioned shared file is read-only.
    if (load.envelope && load.source === "local") {
      const priorHigh = Date.parse(load.envelope.meta.clockHighWaterUtc);
      const nextHigh = Number.isNaN(priorHigh) ? nowMs : Math.max(priorHigh, nowMs);
      const meta: LicenseMeta = {
        ...load.envelope.meta,
        lastValidatedUtc: new Date(nowMs).toISOString(),
        clockHighWaterUtc: new Date(nextHigh).toISOString()
      };
      try {
        this.opts.store.saveLocal(buildEnvelope(load.envelope.license, meta));
      } catch {
        // Metadata refresh is best-effort; validation result stands regardless.
      }
    }

    return status;
  }

  /**
   * Import (or replace) a signed license. Validates format, schema, signature, product, and machine
   * fingerprint BEFORE committing; commits atomically to LocalAppData only. NOT_YET_VALID / EXPIRED
   * licenses are accepted (a pre-dated or renewal license can be imported ahead of use).
   */
  importLicense(license: LicenseDocument): ImportOutcome {
    const fingerprint = this.opts.fingerprintProvider();

    // Structural + schema + algorithm gate via a fresh validation against this machine.
    const preview = validateLicense({
      license,
      currentFingerprintHash: fingerprint.fingerprintHash,
      nowMs: this.now(),
      policy: this.policy,
      trustedKeys: this.opts.trustedKeys
    });

    if (IMPORT_BLOCKING.has(preview.status)) {
      const rejectedReason =
        preview.status === LicenseStatus.INVALID_SIGNATURE
          ? "SIGNATURE_INVALID"
          : preview.status === LicenseStatus.MACHINE_MISMATCH
            ? "MACHINE_MISMATCH"
            : preview.status === LicenseStatus.CORRUPTED
              ? "CORRUPTED"
              : "UNSUPPORTED";
      return { ok: false, status: this.getStatus(), rejectedReason };
    }

    // Defense-in-depth: never persist a license whose signature does not verify.
    if (!verifyLicenseSignature(license, this.opts.trustedKeys).ok) {
      return { ok: false, status: this.getStatus(), rejectedReason: "SIGNATURE_INVALID" };
    }

    if (license.product !== this.opts.product) {
      return { ok: false, status: this.getStatus(), rejectedReason: "PRODUCT_MISMATCH" };
    }

    // AWKIT-LIC-002 (fold-in): importing a replacement must NOT reset the machine's clock-rollback
    // high-water mark nor clear a local revocation — otherwise the advertised rollback mitigation
    // could be defeated by re-importing any signed license. Both carry forward; only an explicit
    // administrative removal clears them.
    const priorMeta = this.opts.store.load().envelope?.meta;
    const nowIso = new Date(this.now()).toISOString();
    const priorHigh = priorMeta ? Date.parse(priorMeta.clockHighWaterUtc) : NaN;
    const highWater = Number.isNaN(priorHigh)
      ? nowIso
      : new Date(Math.max(priorHigh, this.now())).toISOString();
    const meta: LicenseMeta = {
      importedAtUtc: nowIso,
      lastValidatedUtc: nowIso,
      clockHighWaterUtc: highWater,
      locallyRevoked: priorMeta?.locallyRevoked ?? false
    };
    this.opts.store.saveLocal(buildEnvelope(license, meta));
    return { ok: true, status: this.getStatus() };
  }

  /**
   * Locally revoke the active license. Only the writable LocalAppData license can be revoked here; a
   * provisioned (shared) license is read-only and must be removed by the administrator that provisioned it.
   */
  revokeLocal(): { ok: boolean; status: LicenseStatusReport; reason?: "NO_LOCAL_LICENSE" | "SHARED_READ_ONLY" } {
    const load = this.opts.store.load();
    if (load.source === "shared") return { ok: false, status: this.getStatus(), reason: "SHARED_READ_ONLY" };
    if (!load.envelope) return { ok: false, status: this.getStatus(), reason: "NO_LOCAL_LICENSE" };

    const meta: LicenseMeta = { ...load.envelope.meta, locallyRevoked: true };
    this.opts.store.saveLocal(buildEnvelope(load.envelope.license, meta));
    return { ok: true, status: this.getStatus() };
  }

  /** Remove the local license entirely (returns to NOT_ACTIVATED unless a provisioned license remains). */
  removeLocal(): { ok: boolean; status: LicenseStatusReport } {
    this.opts.store.removeLocal();
    return { ok: true, status: this.getStatus() };
  }

  /** Build a privacy-safe activation request for the offline issuer. */
  exportActivationRequest(): ActivationRequest {
    return buildActivationRequest(this.opts.fingerprintProvider(), this.opts.product, this.opts.appVersion);
  }

  /** Snapshot the current envelope (for callers that need raw meta; secrets already absent). */
  peekEnvelope(): LicenseEnvelope | null {
    return this.opts.store.load().envelope;
  }
}
