import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, join } from "node:path";
import {
  classifyDriverJar,
  requiredJavaMajorFromOjdbcName,
  type OracleDriverBundle,
  type OracleDriverValidationStatus
} from "./OracleDriverBundle";
import { sanitizeProfileId } from "@src/storage/ProfileStore";

/**
 * Managed storage + validation for imported Oracle JDBC **driver bundles** (Phase 06). Each bundle
 * lives in its own directory under `<runtime>/oracle-drivers/<id>/` holding the copied jars plus a
 * `manifest.json` (metadata + hashes) and `checksums.json` (flat filename → `sha256:<hex>`). The app's
 * app-wide default is a tiny `default.json` at the store root.
 *
 * Security: JARs are copied and **hashed** here but NEVER executed in this process. The authoritative
 * load test is an isolated Java bridge launched via the injected {@link DriverProbeFn} — see
 * `oracleService.ts`, which supplies a real temp-bridge probe. Framework-agnostic (no Electron/React).
 */

export interface DriverProbeResult {
  /** Whether a real bridge process actually ran the load test (false ⇒ couldn't test → unverified). */
  probed: boolean;
  driverAvailable: boolean;
  executionMode?: string;
  driverVersion?: string;
  ucpVersion?: string;
  javaVersion?: string;
  /** Safe, secret-free diagnostic. */
  reason?: string;
}

/** Load-test a candidate classpath in an isolated Java bridge. `classpathJars` = absolute jar paths. */
export type DriverProbeFn = (classpathJars: string[]) => Promise<DriverProbeResult>;

export interface ImportBundleInput {
  name: string;
  /** Absolute paths to the user-selected jar files (a folder is expanded to its jars by the caller). */
  sourceFiles: string[];
}

export interface OracleDriverBundleStoreOptions {
  /** `<runtime>/oracle-drivers`. */
  folder: string;
  /** Injected isolated-bridge load test. Absent ⇒ imports are recorded as `unverified`. */
  probe?: DriverProbeFn;
}

const MANIFEST_FILE = "manifest.json";
const CHECKSUMS_FILE = "checksums.json";
const DEFAULT_FILE = "default.json";

export class OracleDriverBundleStore {
  constructor(private readonly options: OracleDriverBundleStoreOptions) {}

  private get root(): string {
    return this.options.folder;
  }

  private bundleDir(id: string): string {
    return join(this.root, id);
  }

  /** List every managed bundle (skips staging dirs and unreadable manifests). */
  list(): OracleDriverBundle[] {
    if (!existsSync(this.root)) return [];
    const out: OracleDriverBundle[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const bundle = this.readManifest(entry.name);
      if (bundle) out.push(bundle);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): OracleDriverBundle | null {
    return this.readManifest(id);
  }

  private readManifest(id: string): OracleDriverBundle | null {
    const path = join(this.bundleDir(id), MANIFEST_FILE);
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as OracleDriverBundle;
      // Recompute the absolute managed dir on load (the machine/user path is not portable).
      return { ...parsed, id, managedDirectory: this.bundleDir(id) };
    } catch {
      return null;
    }
  }

  // ── Default selection ─────────────────────────────────────────────────────

  getDefaultId(): string | undefined {
    const path = join(this.root, DEFAULT_FILE);
    if (!existsSync(path)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { defaultBundleId?: string };
      const id = parsed.defaultBundleId;
      return id && existsSync(this.bundleDir(id)) ? id : undefined;
    } catch {
      return undefined;
    }
  }

  setDefault(id: string): void {
    if (!this.get(id)) throw new Error(`Driver bundle "${id}" was not found.`);
    mkdirSync(this.root, { recursive: true });
    this.atomicWrite(join(this.root, DEFAULT_FILE), JSON.stringify({ defaultBundleId: id }, null, 2) + "\n");
  }

  // ── Import ────────────────────────────────────────────────────────────────

  /**
   * Validate the selected files, copy them into managed storage, hash them, and load-test in an
   * isolated bridge. Rejects: no ojdbc jar, multiple ojdbc/ucp jars (mixed versions), unrecognized
   * jars, or a driver that fails to load in a real probe. Returns the recorded bundle.
   */
  async import(input: ImportBundleInput): Promise<OracleDriverBundle> {
    const name = input.name?.trim();
    if (!name) throw new Error("A driver bundle name is required.");
    const files = [...new Set((input.sourceFiles ?? []).filter((f) => f && f.toLowerCase().endsWith(".jar")))];
    if (files.length === 0) throw new Error("Select at least one Oracle JDBC .jar file.");

    // Classify and enforce the single-version / recognized-jar rules.
    const jdbc: string[] = [];
    const ucp: string[] = [];
    const companions: string[] = [];
    for (const file of files) {
      if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`File is not readable: ${basename(file)}`);
      switch (classifyDriverJar(basename(file))) {
        case "jdbc":
          jdbc.push(file);
          break;
        case "ucp":
          ucp.push(file);
          break;
        case "companion":
          companions.push(file);
          break;
        default:
          throw new Error(
            `Unrecognized jar "${basename(file)}". Only Oracle ojdbc*, ucp*, and companion jars may be imported.`
          );
      }
    }
    if (jdbc.length === 0) throw new Error("No ojdbc*.jar found. An Oracle JDBC driver jar is required.");
    if (jdbc.length > 1) throw new Error("Multiple ojdbc jars selected. A bundle must contain exactly one driver version.");
    if (ucp.length > 1) throw new Error("Multiple ucp jars selected. A bundle must contain exactly one UCP version.");

    const jdbcName = basename(jdbc[0]);
    const ucpName = ucp[0] ? basename(ucp[0]) : undefined;
    const companionNames = companions.map((c) => basename(c));

    // Stage into a temp dir, then rename into place on success (never a half-written bundle).
    mkdirSync(this.root, { recursive: true });
    const id = this.uniqueId(name);
    const staging = join(this.root, `.staging-${id}-${Date.now().toString(36)}`);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });

    try {
      const checksums: Record<string, string> = {};
      const copyOne = (src: string) => {
        const fname = basename(src);
        copyFileSync(src, join(staging, fname));
        checksums[fname] = `sha256:${sha256(join(staging, fname))}`;
      };
      [jdbc[0], ...(ucp[0] ? [ucp[0]] : []), ...companions].forEach(copyOne);

      // Load-test the staged jars in an isolated bridge.
      const probe = this.options.probe
        ? await this.options.probe([join(staging, jdbcName), ...companionNames.map((n) => join(staging, n)), ...(ucpName ? [join(staging, ucpName)] : [])])
        : undefined;

      let validationStatus: OracleDriverValidationStatus;
      if (!probe || !probe.probed) {
        validationStatus = "unverified";
      } else if (probe.driverAvailable) {
        validationStatus = "valid";
      } else {
        throw new Error(
          `The Oracle driver failed to load from "${jdbcName}"${probe.reason ? ` (${probe.reason})` : ""}. The bundle was not imported.`
        );
      }

      const now = new Date().toISOString();
      const bundle: OracleDriverBundle = {
        id,
        name,
        source: "imported",
        managedDirectory: this.bundleDir(id),
        jdbcJar: jdbcName,
        ucpJar: ucpName,
        companionJars: companionNames,
        jdbcVersion: probe?.driverVersion && probe.driverVersion !== "unavailable" ? probe.driverVersion : undefined,
        ucpVersion: probe?.ucpVersion && probe.ucpVersion !== "unavailable" ? probe.ucpVersion : undefined,
        requiredJavaMajor: requiredJavaMajorFromOjdbcName(jdbcName),
        checksums,
        importedAt: now,
        lastValidatedAt: probe?.probed ? now : undefined,
        validationStatus
      };
      // Persist manifest + checksums into staging, then atomically publish the whole directory.
      writeFileSync(join(staging, MANIFEST_FILE), JSON.stringify(stripAbsolute(bundle), null, 2) + "\n", "utf8");
      writeFileSync(join(staging, CHECKSUMS_FILE), JSON.stringify(checksums, null, 2) + "\n", "utf8");
      renameSync(staging, this.bundleDir(id));
      return { ...bundle, managedDirectory: this.bundleDir(id) };
    } catch (err) {
      rmSync(staging, { recursive: true, force: true });
      throw err;
    }
  }

  // ── Re-validation ───────────────────────────────────────────────────────────

  /** Recompute checksums for a managed bundle and update its status (tamper/corruption detection). */
  revalidateChecksums(id: string): OracleDriverValidationStatus {
    const bundle = this.get(id);
    if (!bundle) return "missing";
    for (const [fname, expected] of Object.entries(bundle.checksums)) {
      const abs = join(bundle.managedDirectory, fname);
      if (!existsSync(abs)) return this.persistStatus(id, "missing");
      const expectedHex = expected.startsWith("sha256:") ? expected.slice("sha256:".length) : expected;
      if (sha256(abs).toLowerCase() !== expectedHex.toLowerCase()) return this.persistStatus(id, "checksum-failed");
    }
    return bundle.validationStatus;
  }

  /** Re-run the isolated-bridge load test and persist the resulting status. */
  async validate(id: string): Promise<OracleDriverBundle> {
    const bundle = this.get(id);
    if (!bundle) throw new Error(`Driver bundle "${id}" was not found.`);
    const checksum = this.revalidateChecksums(id);
    if (checksum === "missing" || checksum === "checksum-failed") {
      return this.get(id) ?? bundle;
    }
    if (!this.options.probe) return bundle;
    const classpath = [
      join(bundle.managedDirectory, bundle.jdbcJar),
      ...(bundle.ucpJar ? [join(bundle.managedDirectory, bundle.ucpJar)] : []),
      ...bundle.companionJars.map((c) => join(bundle.managedDirectory, c))
    ];
    const probe = await this.options.probe(classpath);
    const status: OracleDriverValidationStatus = !probe.probed
      ? "unverified"
      : probe.driverAvailable
        ? "valid"
        : "invalid";
    const updated: OracleDriverBundle = {
      ...bundle,
      validationStatus: status,
      jdbcVersion: probe.driverVersion && probe.driverVersion !== "unavailable" ? probe.driverVersion : bundle.jdbcVersion,
      ucpVersion: probe.ucpVersion && probe.ucpVersion !== "unavailable" ? probe.ucpVersion : bundle.ucpVersion,
      lastValidatedAt: probe.probed ? new Date().toISOString() : bundle.lastValidatedAt
    };
    this.writeManifest(updated);
    return updated;
  }

  remove(id: string): void {
    rmSync(this.bundleDir(id), { recursive: true, force: true });
    if (this.getDefaultId() === id) rmSync(join(this.root, DEFAULT_FILE), { force: true });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private persistStatus(id: string, status: OracleDriverValidationStatus): OracleDriverValidationStatus {
    const bundle = this.get(id);
    if (bundle) this.writeManifest({ ...bundle, validationStatus: status });
    return status;
  }

  private writeManifest(bundle: OracleDriverBundle): void {
    this.atomicWrite(join(this.bundleDir(bundle.id), MANIFEST_FILE), JSON.stringify(stripAbsolute(bundle), null, 2) + "\n");
  }

  private atomicWrite(path: string, contents: string): void {
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, contents, "utf8");
    try {
      renameSync(tmp, path);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
  }

  private uniqueId(name: string): string {
    const base = sanitizeProfileId(name);
    let id = base;
    let n = 2;
    while (existsSync(this.bundleDir(id))) id = `${base}-${n++}`;
    return id;
  }
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/** The managed dir is machine-specific — never persist it (recomputed on load). */
function stripAbsolute(bundle: OracleDriverBundle): Omit<OracleDriverBundle, "managedDirectory"> {
  const { managedDirectory, ...rest } = bundle;
  return rest;
}
