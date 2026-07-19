/**
 * Main-process licensing runtime. Wires the Electron-free licensing domain (`src/licensing`) to real
 * machine signals and the adaptive on-disk store, and owns the single LicenseService instance the IPC
 * layer and the execution gate use. Kept out of `src/licensing` so the domain stays Electron-free and
 * unit-verifiable.
 *
 * Enforcement is OPT-IN (default OFF) via `SPECTER_LICENSE_ENFORCE=true`. With enforcement OFF the app
 * behaves exactly as before (no run is blocked) — the licensing surface, status, import/export, and audit
 * are all live, but license state never prevents a run. This lets licensing ship without changing runtime
 * behaviour for existing/unlicensed installs until an operator explicitly turns enforcement on.
 */
import { app } from "electron";
import { join } from "node:path";
import { getRuntimeDataRoot } from "../appPaths";
import { computeMachineFingerprint } from "@src/licensing/MachineFingerprint";
import { LicenseService, type LicenseStatusReport } from "@src/licensing/LicenseService";
import { LicenseStore } from "@src/licensing/store/LicenseStore";
import { LicenseStatus } from "@src/licensing/LicenseTypes";

export const LICENSING_PRODUCT = "SpecterStudio";

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

/** True when hard license enforcement is turned on. Default OFF — see module note. */
export function isLicenseEnforcementEnabled(): boolean {
  return process.env.SPECTER_LICENSE_ENFORCE === "true";
}

export interface RunGateDecision {
  allowed: boolean;
  status: LicenseStatusReport;
  /** True when a run was blocked specifically by license state (enforcement on + not operable). */
  blockedByLicense: boolean;
}

/**
 * Decide whether a new protected run may start. When enforcement is OFF, always allowed (status still
 * reported for surfacing). When ON, allowed only if the current license status is operable
 * (VALID / EXPIRING_SOON). Never throws — a runtime failure fails OPEN when enforcement is off and is
 * surfaced as a blocked run only when enforcement is on.
 */
export function evaluateRunGate(): RunGateDecision {
  let status: LicenseStatusReport;
  try {
    status = getLicenseService().getStatus();
  } catch {
    // Could not evaluate licensing — treat as not-activated for reporting.
    status = {
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
  if (!isLicenseEnforcementEnabled()) {
    return { allowed: true, status, blockedByLicense: false };
  }
  return { allowed: status.operable, status, blockedByLicense: !status.operable };
}
