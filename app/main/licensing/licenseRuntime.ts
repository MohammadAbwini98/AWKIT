/**
 * Main-process licensing runtime. Wires the Electron-free licensing domain (`src/licensing`) to real
 * machine signals and the adaptive on-disk store, and owns the single LicenseService instance the IPC
 * layer and the execution gate use. Kept out of `src/licensing` so the domain stays Electron-free and
 * unit-verifiable.
 *
 * **Enforcement is ON by default** (owner decision 2026-07-29, bd `awkit-1cc`). The former
 * `SPECTER_LICENSE_ENFORCE=true` opt-in is gone: optional enforcement is not enforcement. Existing
 * installs are protected by the one-time 14-day migration window in `migrationGraceStore`, not by
 * leaving the gate open.
 *
 * **A packaged build has no bypass at all.** `isPackagedBuild()` is consulted first and reads
 * `app.isPackaged`, which no environment variable, command-line flag, setting or IPC call can
 * change — so the bypass branch below is unreachable in a shipped application. It exists only so
 * automated tests and development composition roots can drive the unlicensed and licensed paths.
 * Packaged validation licenses itself for real instead (see
 * `docs/ai/ORACLE_JDBC_VALIDATION_GATES.md`-style external gate notes and the packaged walkthrough).
 */
import { app } from "electron";
import { join } from "node:path";
import { getRuntimeDataRoot } from "../appPaths";
import { computeMachineFingerprint } from "@src/licensing/MachineFingerprint";
import { LicenseService, type LicenseStatusReport } from "@src/licensing/LicenseService";
import { LicenseStore } from "@src/licensing/store/LicenseStore";
import { LICENSING_PRODUCT, LicenseStatus } from "@src/licensing/LicenseTypes";
import {
  applyLicenseRunGatePolicy,
  type ActiveRunDisposition,
  type RunGateReason
} from "@src/licensing/RunGatePolicy";
import { graceDaysRemaining, type MigrationGraceEvaluation } from "@src/licensing/MigrationGrace";
import { evaluateMigrationGraceWindow, initializeMigrationGrace } from "./migrationGraceStore";

// Re-exported so existing main-process importers keep their path while the value itself lives
// in the licensing domain, shared with the issuer CLI and the dashboard bridge.
export { LICENSING_PRODUCT };

/**
 * The ONLY bypass switch, and it is inert in a packaged build. Named so it cannot be mistaken for a
 * product setting, and deliberately not a `SPECTER_*` variable — those are the app's own namespace.
 */
const TEST_BYPASS_ENV = "AWKIT_TEST_LICENSE_BYPASS";

let service: LicenseService | null = null;

/** Per-user primary + optional machine-wide (read-only) licensing directories. */
function resolveLicensingDirs(): { localDir: string; sharedDir: string | null } {
  const localDir = join(getRuntimeDataRoot(), "Licensing");
  const programData = process.env.PROGRAMDATA;
  const sharedDir = programData ? join(programData, "SpecterStudio", "Licensing") : null;
  return { localDir, sharedDir };
}

export function getLicenseService(): LicenseService {
  if (service) return service;
  const { localDir, sharedDir } = resolveLicensingDirs();
  service = new LicenseService({
    store: new LicenseStore(localDir, sharedDir),
    product: LICENSING_PRODUCT,
    appVersion: safeAppVersion(),
    fingerprintProvider: () => computeMachineFingerprint()
  });
  return service;
}

function safeAppVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return "0.0.0";
  }
}

/**
 * True for a real packaged application. Deliberately reads `app.isPackaged` directly rather than
 * `isProductionOffline()`, because that helper honours `PRODUCTION_OFFLINE` — an environment
 * variable, which is exactly what must never be able to unlock the bypass.
 */
function isPackagedBuild(): boolean {
  try {
    return app.isPackaged === true;
  } catch {
    // Not inside a real Electron app (tsx tooling importing the engine) — development context.
    return false;
  }
}

/**
 * Whether the test/development bypass is active. Always false in a packaged build; the environment
 * variable is not even read there.
 */
export function isLicenseEnforcementBypassed(): boolean {
  if (isPackagedBuild()) return false;
  return process.env[TEST_BYPASS_ENV] === "1";
}

/** Hard enforcement is on unless a non-packaged test/dev composition root has disabled it. */
export function isLicenseEnforcementEnabled(): boolean {
  return !isLicenseEnforcementBypassed();
}

/** Establish the migration anchor. Bootstrap must call this before it writes any profile data. */
export function initializeLicensingRuntime(): void {
  try {
    initializeMigrationGrace();
  } catch {
    // A missing anchor simply means no grace; it must never prevent the app from starting.
  }
}

export interface RunGateDecision {
  allowed: boolean;
  status: LicenseStatusReport;
  /** True when a run was blocked specifically by license state. */
  blockedByLicense: boolean;
  /** What must happen to work that is already dispatched. */
  activeRunDisposition: ActiveRunDisposition;
  /** True when the run was admitted ONLY because the migration window is open. */
  graceApplied: boolean;
  reason: RunGateReason;
  grace: {
    inGrace: boolean;
    graceEndsAtUtc: string | null;
    daysRemaining: number;
  };
}

/**
 * What the UI needs to explain the gate without re-deriving policy in the renderer: whether runs are
 * currently admitted, and — while the one-time migration window is open — when it closes. The
 * Licensing page and the global status bar both render from this, so a grace deadline can never be
 * shown by one surface and not the other.
 */
export interface LicenseEnforcementView {
  /** False only under the non-packaged test/dev bypass. */
  readonly enforced: boolean;
  readonly runsAllowed: boolean;
  readonly reason: RunGateReason;
  readonly inGrace: boolean;
  readonly graceEndsAtUtc: string | null;
  readonly graceDaysRemaining: number;
}

/** `LicenseStatusReport` plus the enforcement projection above. */
export type LicenseStatusView = LicenseStatusReport & { readonly enforcement: LicenseEnforcementView };

/** Compose the status the renderer receives. Never throws — a gate fault reads as "runs blocked". */
export function projectLicenseStatusView(gate: RunGateDecision): LicenseStatusView {
  return {
    ...gate.status,
    enforcement: {
      enforced: isLicenseEnforcementEnabled(),
      runsAllowed: gate.allowed,
      reason: gate.reason,
      inGrace: gate.grace.inGrace,
      graceEndsAtUtc: gate.grace.graceEndsAtUtc,
      graceDaysRemaining: gate.grace.daysRemaining
    }
  };
}

/** Compose the status the renderer receives. Never throws — a gate fault reads as "runs blocked". */
export function getLicenseStatusView(): LicenseStatusView {
  return projectLicenseStatusView(evaluateRunGate());
}

function unevaluableStatus(): LicenseStatusReport {
  return {
    status: LicenseStatus.NOT_ACTIVATED,
    reasonCode: "NO_LICENSE_INSTALLED",
    userAction: "Licensing could not be evaluated.",
    operable: false,
    checkedAtUtc: new Date().toISOString(),
    source: null,
    conflict: false,
    machineFingerprintHash: "",
    fingerprintConfidence: "limited",
    availableSignals: []
  };
}

/**
 * Decide whether a new protected run may start, and what to do with work already dispatched.
 *
 * Never throws. A licensing fault is reported as `EVALUATION_FAILED` and BLOCKS new runs — the
 * pre-2026-07-29 behaviour of failing open on an internal error is gone, because "the check broke"
 * must not be a way to run unlicensed.
 */
export function evaluateRunGate(): RunGateDecision {
  let status: LicenseStatusReport;
  let evaluationFailed = false;
  try {
    status = getLicenseService().getStatus();
  } catch {
    status = unevaluableStatus();
    evaluationFailed = true;
  }

  let grace: MigrationGraceEvaluation;
  try {
    grace = evaluateMigrationGraceWindow();
  } catch {
    // An unreadable anchor is not a licence. No window, and the gate decides on status alone.
    grace = { inGrace: false, graceEndsAtUtc: null, remainingMs: 0, reason: "NO_ANCHOR", shouldMarkConsumed: false };
  }

  const decision = applyLicenseRunGatePolicy(
    { status: status.status, operable: status.operable, evaluationFailed },
    isLicenseEnforcementEnabled(),
    { inGrace: grace.inGrace, graceEndsAtUtc: grace.graceEndsAtUtc }
  );

  return {
    ...decision,
    status,
    grace: {
      inGrace: grace.inGrace,
      graceEndsAtUtc: grace.graceEndsAtUtc,
      daysRemaining: graceDaysRemaining(grace)
    }
  };
}
