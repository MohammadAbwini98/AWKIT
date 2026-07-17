/**
 * Oracle JDBC **driver bundle** model (Phases 05–07 of the Docker & JDBC Driver Settings plan).
 *
 * A driver bundle is a Specter-managed set of Oracle JDBC/UCP jars the user imported through Settings
 * (or the app's own bundled default). Imported JARs are executable code and are treated as trusted
 * plugins: they are copied into Specter-managed storage, hashed, and load-tested inside an **isolated
 * Java bridge process** — never loaded in Electron main/renderer. Connection profiles reference a
 * bundle by `id` only (never a raw JAR path/classpath).
 *
 * Pure/framework-agnostic (no Electron/React/fs) — the store and probe live in
 * {@link file://./OracleDriverBundleStore.ts}.
 */

export type OracleDriverBundleSource = "bundled" | "imported";

/** Lifecycle state of a bundle's validation. */
export type OracleDriverValidationStatus =
  | "valid" // load-tested in a real bridge; driver class loaded
  | "unverified" // copied + hashed, not yet load-tested (or the bridge was unavailable)
  | "invalid" // load test failed — the driver could not load
  | "missing" // a declared file is gone from managed storage
  | "checksum-failed"; // a managed file no longer matches its recorded hash (tamper/corruption)

/** UI compatibility label (Phase 05). */
export type OracleDriverCompatibilityLabel =
  | "Certified"
  | "Compatible but unverified"
  | "Unsupported"
  | "Unknown";

/** Roles a jar can play in a bundle, inferred from its filename (never trusted alone — see the probe). */
export type OracleDriverJarRole = "jdbc" | "ucp" | "companion" | "unknown";

export interface OracleDriverBundle {
  id: string;
  name: string;
  source: OracleDriverBundleSource;
  /** Absolute path to `<runtime>/oracle-drivers/<id>/` (recomputed on load; not the security boundary). */
  managedDirectory: string;
  /** Filename (within `managedDirectory`) of the required ojdbc jar. */
  jdbcJar: string;
  /** Filename of the UCP jar, when present (required for real UCP pooling). */
  ucpJar?: string;
  /** Filenames of optional companion jars (oraclepki, osdt_core, osdt_cert, ons, simplefan). */
  companionJars: string[];
  /** Oracle JDBC implementation version reported by the bridge probe (e.g. `23.26.2.0.0`). */
  jdbcVersion?: string;
  /** Oracle UCP version reported by the probe, or absent when UCP is not included. */
  ucpVersion?: string;
  /** Minimum Java major inferred from the ojdbc filename (ojdbc17 ⇒ 17). */
  requiredJavaMajor?: number;
  supportedDatabaseVersions?: string[];
  /** Managed-storage filename → `sha256:<hex>` (recorded at import; re-checked before every bridge launch). */
  checksums: Record<string, string>;
  importedAt?: string;
  lastValidatedAt?: string;
  validationStatus: OracleDriverValidationStatus;
  compatibilityLabel?: OracleDriverCompatibilityLabel;
}

/** Renderer-safe projection + derived fields the Settings UI needs (no secret material exists here). */
export interface OracleDriverBundleView extends OracleDriverBundle {
  /** True when this bundle is the app-wide default. */
  isDefault: boolean;
  /** Number of connection profiles referencing this bundle (blocks deletion when > 0). */
  usageCount: number;
  /** Whether real UCP pooling is available (a ucp jar is included). */
  supportsPooling: boolean;
}

/** Optional companion jars accepted alongside the required ojdbc jar (Phase 05). */
export const ORACLE_COMPANION_JAR_NAMES = [
  "oraclepki",
  "osdt_core",
  "osdt_cert",
  "ons",
  "simplefan"
] as const;

/** Classify a jar by filename. Case-insensitive; the authoritative check is the bridge probe. */
export function classifyDriverJar(filename: string): OracleDriverJarRole {
  const base = filename.toLowerCase();
  if (!base.endsWith(".jar")) return "unknown";
  const stem = base.slice(0, -".jar".length);
  if (/^ojdbc\d*$/.test(stem) || stem === "ojdbc") return "jdbc";
  if (/^ucp(\d+)?$/.test(stem)) return "ucp";
  if (ORACLE_COMPANION_JAR_NAMES.some((c) => stem === c || stem.startsWith(`${c}-`))) return "companion";
  return "unknown";
}

/** Infer the minimum Java major from an ojdbc filename (`ojdbc17.jar` ⇒ 17, `ojdbc8.jar` ⇒ 8). */
export function requiredJavaMajorFromOjdbcName(filename: string): number | undefined {
  const m = filename.toLowerCase().match(/^ojdbc(\d+)\.jar$/);
  if (!m) return undefined;
  const major = Number(m[1]);
  // ojdbc6/7 targeted Java 6/7; ojdbc8/10/11/17 target that Java major.
  return Number.isFinite(major) && major > 0 ? major : undefined;
}

/**
 * Derive a UI compatibility label from validation state + the running JDK. We never claim vendor
 * "Certified" from a filename — a load-tested bundle running on a compatible JDK is
 * "Compatible but unverified" until live DB validation certifies it externally.
 */
export function compatibilityLabelFor(
  bundle: Pick<OracleDriverBundle, "validationStatus" | "requiredJavaMajor" | "compatibilityLabel">,
  runningJavaMajor?: number
): OracleDriverCompatibilityLabel {
  if (bundle.compatibilityLabel === "Certified") return "Certified"; // set only by external live validation
  switch (bundle.validationStatus) {
    case "invalid":
    case "missing":
    case "checksum-failed":
      return "Unsupported";
    case "valid": {
      if (
        bundle.requiredJavaMajor != null &&
        runningJavaMajor != null &&
        runningJavaMajor < bundle.requiredJavaMajor
      ) {
        return "Unsupported"; // driver needs a newer JDK than the bridge runtime
      }
      return "Compatible but unverified";
    }
    default:
      return "Unknown";
  }
}

/**
 * Phase 07 bundle-isolation compatibility key. Two profiles/queries may share one Java bridge process
 * (and its pools) only when this key matches — so different driver versions NEVER land in one Java
 * classpath. Delimited + collision-safe (no hashing needed); order-stable.
 */
export function driverBundleCompatibilityKey(input: {
  driverBundleId: string;
  javaIdentity: string;
  protocolVersion: number;
  walletMode?: boolean;
}): string {
  const parts = [
    `bundle=${input.driverBundleId}`,
    `java=${input.javaIdentity}`,
    `proto=${input.protocolVersion}`,
    `wallet=${input.walletMode ? "1" : "0"}`
  ];
  // Escape the delimiter so a value containing "|" can't forge a key collision.
  return parts.map((p) => p.replace(/\|/g, "%7C")).join("|");
}

/** The stable id of the app's own bundled default driver (present only when jars are vendored). */
export const SPECTER_BUNDLED_DRIVER_ID = "specter-bundled";
