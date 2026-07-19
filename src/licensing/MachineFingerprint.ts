/**
 * Deterministic, privacy-preserving machine fingerprint for per-machine licensing.
 *
 * Principles (Phase 4):
 * - Combine MULTIPLE approved, non-admin-readable signals; tolerate any one being missing.
 * - Normalise every signal deterministically, then hash — raw values are NEVER persisted or displayed.
 * - Never use IP address, hostname alone, or MAC alone as identity. Hostname here is only ONE weak signal
 *   among several and never decides identity by itself.
 * - Report which signal CATEGORIES were available and a confidence level (high/medium/limited).
 * - Works on restricted corporate machines, VMs, and portable installs without administrator rights.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";

/** Bump when the set of signals or normalisation changes (invalidates prior fingerprints by design). */
export const FINGERPRINT_ALGORITHM_VERSION = 1 as const;

import type { ConfidenceLevel, MachineFingerprint } from "./LicenseTypes";

interface Signal {
  /** Stable category name recorded in `availableSignals` (never the raw value). */
  category: string;
  /** Normalised value contributing to the hash, or null when unavailable. */
  value: string | null;
  /** Strong signals (stable + machine-specific) raise confidence; weak ones do not. */
  strong: boolean;
}

function norm(value: string | undefined | null): string | null {
  if (value == null) return null;
  const trimmed = value.replace(/\s+/g, " ").trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** Windows MachineGuid: stable per-machine, readable without admin. Null off-Windows or on any failure. */
function readWindowsMachineGuid(): string | null {
  if (os.platform() !== "win32") return null;
  try {
    const out = execFileSync(
      "reg",
      ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 4000 }
    );
    const match = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** First stable, non-internal MAC — used only as ONE signal, never alone (see module note). */
function firstStableMac(): string | null {
  try {
    const ifaces = os.networkInterfaces();
    const macs: string[] = [];
    for (const name of Object.keys(ifaces).sort()) {
      for (const entry of ifaces[name] ?? []) {
        if (!entry.internal && entry.mac && entry.mac !== "00:00:00:00:00:00") macs.push(entry.mac.toLowerCase());
      }
    }
    macs.sort();
    return macs.length > 0 ? macs[0] : null;
  } catch {
    return null;
  }
}

/** Collect the raw signal set. Exposed for testability; callers should prefer computeMachineFingerprint. */
export function collectSignals(): Signal[] {
  const cpus = (() => {
    try {
      return os.cpus();
    } catch {
      return [];
    }
  })();
  const totalMemGb = (() => {
    try {
      return Math.round(os.totalmem() / (1024 * 1024 * 1024));
    } catch {
      return null;
    }
  })();

  return [
    { category: "machineGuid", value: norm(readWindowsMachineGuid()), strong: true },
    { category: "platform", value: norm(`${os.platform()}:${os.arch()}`), strong: false },
    { category: "cpuModel", value: norm(cpus[0]?.model), strong: true },
    { category: "cpuCount", value: cpus.length > 0 ? String(cpus.length) : null, strong: false },
    { category: "totalMemoryGb", value: totalMemGb != null ? String(totalMemGb) : null, strong: false },
    { category: "mac", value: norm(firstStableMac()), strong: true },
    { category: "hostname", value: norm(os.hostname()), strong: false }
  ];
}

function confidenceFor(signals: Signal[]): ConfidenceLevel {
  const present = signals.filter((s) => s.value != null);
  const strongPresent = present.filter((s) => s.strong).length;
  if (strongPresent >= 2 && present.length >= 4) return "high";
  if (strongPresent >= 1 && present.length >= 3) return "medium";
  return "limited";
}

/**
 * Compute the machine fingerprint from the provided signals (defaults to live collection). The hash is
 * SHA-256 over a canonical `category=value` list of AVAILABLE signals only, so a missing signal shifts
 * confidence but still yields a stable fingerprint from the remaining ones.
 */
export function computeMachineFingerprint(signals: Signal[] = collectSignals()): MachineFingerprint {
  const available = signals
    .filter((s) => s.value != null)
    .sort((a, b) => a.category.localeCompare(b.category));

  const canonical = available.map((s) => `${s.category}=${s.value}`).join("\n");
  const fingerprintHash = createHash("sha256")
    .update(`v${FINGERPRINT_ALGORITHM_VERSION}\n${canonical}`)
    .digest("hex");

  return {
    algorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
    fingerprintHash,
    availableSignals: available.map((s) => s.category),
    confidenceLevel: confidenceFor(signals),
    generatedAtUtc: new Date().toISOString()
  };
}
