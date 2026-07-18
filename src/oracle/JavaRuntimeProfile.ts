/**
 * User-selected **Java runtime** model (WS-B of the User-Selected-Java refactor).
 *
 * Specter no longer bundles a private JRE. To run Oracle live queries the user selects an installed
 * JRE/JDK directory (or a `java.exe`) in Settings; Specter launches its isolated Java bridge with that
 * executable. A runtime profile records only metadata about an *external* Java install — the install is
 * never copied into managed storage. Connection profiles reference a runtime by `id` only (never a raw
 * executable path/classpath).
 *
 * Pure/framework-agnostic (no Electron/React/child_process) — spawning `java -version` and the bridge
 * load test live in the store's injected probe (see {@link file://./JavaRuntimeStore.ts}).
 */
import { basename, dirname, join } from "node:path";

export type JavaArchitecture = "x64" | "arm64" | "unknown";

/** Lifecycle state of a Java runtime's validation. */
export type JavaRuntimeStatus =
  | "valid" // `java -version` ran and reported a parseable version
  | "unverified" // recorded but not yet probed (no probe available)
  | "missing" // the selected executable is gone from disk
  | "incompatible" // ran, but the version is too old for any supported Oracle driver
  | "validation-failed"; // the executable exists but `java -version` failed / was unparseable

/** The lowest Java major Specter will accept for an Oracle driver (ojdbc8 ⇒ Java 8). */
export const MIN_SUPPORTED_JAVA_MAJOR = 8;

export interface JavaRuntimeProfile {
  id: string;
  name: string;
  /** Absolute path to the resolved `java`/`java.exe`. */
  javaExecutablePath: string;
  /** Absolute path to the runtime home (parent of `bin`), for display. */
  javaHomePath: string;
  /** Full version string as reported (e.g. `17.0.8`). */
  javaVersion: string;
  /** Feature-release major (e.g. `17`; legacy `1.8.0` ⇒ `8`). */
  javaMajorVersion: number;
  vendor?: string;
  architecture: JavaArchitecture;
  importedAt: string;
  lastValidatedAt?: string;
  status: JavaRuntimeStatus;
}

/** Renderer-safe projection + derived fields the Settings UI needs. */
export interface JavaRuntimeProfileView extends JavaRuntimeProfile {
  /** True when this runtime is the app-wide default. */
  isDefault: boolean;
  /** Number of connection profiles referencing this runtime (blocks deletion when > 0). */
  usageCount: number;
}

/** The two selection methods a user can pick (a file, or a JRE/JDK home directory). */
export type JavaRuntimeSelectionKind = "executable" | "directory";

/**
 * Resolve a user selection to an absolute `java(.exe)` path. For an executable selection the path is
 * used directly; for a directory selection we probe `<dir>/bin/java(.exe)` then `<dir>/java(.exe)`.
 * Never depends on `JAVA_HOME` or `PATH`. Returns the candidate paths (caller checks existence via fs
 * so this stays pure/testable).
 */
export function javaExecutableCandidates(selectedPath: string, opts?: { platform?: NodeJS.Platform }): string[] {
  const platform = opts?.platform ?? process.platform;
  const exe = platform === "win32" ? "java.exe" : "java";
  const base = basename(selectedPath).toLowerCase();
  if (base === "java" || base === "java.exe") {
    return [selectedPath];
  }
  return [join(selectedPath, "bin", exe), join(selectedPath, exe)];
}

/** The runtime home (parent of `bin`) for a resolved executable, for display. */
export function javaHomeForExecutable(execPath: string): string {
  const parent = dirname(execPath);
  return basename(parent).toLowerCase() === "bin" ? dirname(parent) : parent;
}

/** True when a resolved executable name is acceptable on this platform (Windows requires `java.exe`). */
export function isAcceptableJavaExecutableName(execPath: string, opts?: { platform?: NodeJS.Platform }): boolean {
  const platform = opts?.platform ?? process.platform;
  const base = basename(execPath).toLowerCase();
  return platform === "win32" ? base === "java.exe" : base === "java" || base === "java.exe";
}

/** Derive the feature-release major from a Java version string (`1.8.0_351` ⇒ 8, `17.0.8` ⇒ 17). */
export function majorFromJavaVersion(version: string): number | undefined {
  const trimmed = version.trim();
  const legacy = trimmed.match(/^1\.(\d+)/);
  if (legacy) {
    const n = Number(legacy[1]);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const modern = trimmed.match(/^(\d+)/);
  if (modern) {
    const n = Number(modern[1]);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

/** Map a JVM `os.arch` value to our coarse architecture enum. */
export function architectureFromOsArch(osArch: string | undefined): JavaArchitecture {
  const a = (osArch ?? "").toLowerCase();
  if (a === "amd64" || a === "x86_64" || a === "x64") return "x64";
  if (a === "aarch64" || a === "arm64") return "arm64";
  return "unknown";
}

export interface ParsedJavaVersion {
  version?: string;
  major?: number;
  vendor?: string;
  architecture: JavaArchitecture;
}

/**
 * Parse the combined output of `java -XshowSettings:properties -version` (written to stderr). Reads
 * the `java.version` / `java.vendor` / `os.arch` properties when present, and falls back to the
 * classic `... version "x.y.z"` banner. Never trusts a filename — only what the JVM reports.
 */
export function parseJavaVersionOutput(output: string): ParsedJavaVersion {
  const text = output ?? "";
  const prop = (name: string): string | undefined => {
    const m = text.match(new RegExp(`^\\s*${name.replace(/\./g, "\\.")}\\s*=\\s*(.+?)\\s*$`, "m"));
    return m?.[1]?.trim() || undefined;
  };

  let version = prop("java.version");
  if (!version) {
    const banner = text.match(/(?:openjdk|java)\s+version\s+"([^"]+)"/i);
    version = banner?.[1]?.trim();
  }

  let vendor = prop("java.vendor");
  if (!vendor) {
    const known = ["Temurin", "Eclipse Adoptium", "Adoptium", "OpenJDK", "Oracle", "Microsoft", "Azul", "Zulu", "Corretto", "GraalVM", "Amazon", "BellSoft", "Liberica"];
    vendor = known.find((k) => text.toLowerCase().includes(k.toLowerCase()));
  }

  const architecture = architectureFromOsArch(prop("os.arch"));
  const major = version ? majorFromJavaVersion(version) : undefined;
  return { version, major, vendor, architecture };
}

/**
 * Bridge-isolation identity for a Java runtime — the resolved executable path. Folded into
 * {@link driverBundleCompatibilityKey} so a different Java runtime never shares a bridge process with
 * another (different Java/driver combos run in separate JVMs).
 */
export function javaRuntimeIdentity(profile: Pick<JavaRuntimeProfile, "id" | "javaExecutablePath">): string {
  return `${profile.id}@${profile.javaExecutablePath}`;
}
