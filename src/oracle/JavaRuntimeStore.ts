import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeProfileId } from "@src/storage/ProfileStore";
import {
  architectureFromOsArch,
  isAcceptableJavaExecutableName,
  javaExecutableCandidates,
  javaHomeForExecutable,
  MIN_SUPPORTED_JAVA_MAJOR,
  type JavaArchitecture,
  type JavaRuntimeProfile,
  type JavaRuntimeStatus
} from "./JavaRuntimeProfile";

/**
 * Managed metadata store for user-selected **Java runtimes** (WS-B). Unlike driver bundles, a Java
 * install is NOT copied into managed storage — it stays wherever the user installed it and we record
 * only a manifest referencing the resolved `java(.exe)` path. Each runtime is a flat
 * `<runtime>/java-runtimes/<id>.json`; the app-wide default is a `.default.json` pointer.
 *
 * Security: this store never executes the selected `java` itself. The `java -version` probe (and the
 * bridge load test) run in the main process via the injected {@link JavaVersionProbeFn}. A runtime is
 * only persisted after that probe reports a parseable version ("save only after validation succeeds").
 * Framework-agnostic (no Electron/React).
 */

export interface JavaVersionProbe {
  /** Whether `java -version` actually executed and exited 0. */
  ran: boolean;
  version?: string;
  major?: number;
  vendor?: string;
  architecture?: JavaArchitecture;
  /** Safe, secret-free diagnostic. */
  reason?: string;
}

/** Spawn `java -version` (no shell) for a resolved executable path and parse its output. */
export type JavaVersionProbeFn = (javaExecutablePath: string) => Promise<JavaVersionProbe>;

export interface AddJavaRuntimeInput {
  name: string;
  /** The raw user selection: a `java(.exe)` path or a JRE/JDK home directory. */
  selectedPath: string;
}

export interface JavaRuntimeStoreOptions {
  /** `<runtime>/java-runtimes`. */
  folder: string;
  /** Injected `java -version` probe. Absent ⇒ runtimes are recorded `unverified`. */
  probe?: JavaVersionProbeFn;
  /** Override for tests (defaults to `process.platform`). */
  platform?: NodeJS.Platform;
}

const DEFAULT_POINTER = ".default.json";

export class JavaRuntimeStore {
  constructor(private readonly options: JavaRuntimeStoreOptions) {}

  private get root(): string {
    return this.options.folder;
  }

  private get platform(): NodeJS.Platform {
    return this.options.platform ?? process.platform;
  }

  private profilePath(id: string): string {
    return join(this.root, `${id}.json`);
  }

  /** List every managed runtime (skips the default pointer + unreadable manifests). */
  list(): JavaRuntimeProfile[] {
    if (!existsSync(this.root)) return [];
    const out: JavaRuntimeProfile[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith(".") || !entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -".json".length);
      const profile = this.read(id);
      if (profile) out.push(profile);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): JavaRuntimeProfile | null {
    return this.read(id);
  }

  private read(id: string): JavaRuntimeProfile | null {
    const path = this.profilePath(id);
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as JavaRuntimeProfile;
      return { ...parsed, id };
    } catch {
      return null;
    }
  }

  // ── Default selection ─────────────────────────────────────────────────────

  getDefaultId(): string | undefined {
    const path = join(this.root, DEFAULT_POINTER);
    if (!existsSync(path)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { defaultRuntimeId?: string };
      const id = parsed.defaultRuntimeId;
      return id && existsSync(this.profilePath(id)) ? id : undefined;
    } catch {
      return undefined;
    }
  }

  setDefault(id: string): void {
    if (!this.get(id)) throw new Error(`Java runtime "${id}" was not found.`);
    mkdirSync(this.root, { recursive: true });
    this.atomicWrite(join(this.root, DEFAULT_POINTER), JSON.stringify({ defaultRuntimeId: id }, null, 2) + "\n");
  }

  // ── Add / validate ─────────────────────────────────────────────────────────

  /**
   * Resolve a user selection to a `java(.exe)`, run `java -version`, and persist the runtime. Rejects a
   * missing executable, a non-`java.exe` on Windows, a failed/unparseable `java -version`, or a version
   * below {@link MIN_SUPPORTED_JAVA_MAJOR}. Only saved after the probe succeeds.
   */
  async add(input: AddJavaRuntimeInput): Promise<JavaRuntimeProfile> {
    const name = input.name?.trim();
    if (!name) throw new Error("A Java runtime name is required.");
    const execPath = this.resolveExecutable(input.selectedPath);
    if (!execPath) {
      throw new Error(`No java executable was found at "${input.selectedPath}". Select a java(.exe) file or a JRE/JDK folder.`);
    }
    if (!isAcceptableJavaExecutableName(execPath, { platform: this.platform })) {
      throw new Error(`"${execPath}" is not a Java executable. On Windows, select java.exe.`);
    }

    const probe = this.options.probe ? await this.options.probe(execPath) : undefined;
    if (this.options.probe) {
      if (!probe || !probe.ran) {
        throw new Error(`Could not run "java -version" for the selected runtime${probe?.reason ? ` (${probe.reason})` : ""}. The runtime was not added.`);
      }
      if (!probe.version || !probe.major) {
        throw new Error("Could not determine the Java version of the selected runtime. The runtime was not added.");
      }
      if (probe.major < MIN_SUPPORTED_JAVA_MAJOR) {
        throw new Error(`Java ${probe.version} is too old — Oracle JDBC drivers require Java ${MIN_SUPPORTED_JAVA_MAJOR}+. The runtime was not added.`);
      }
    }

    const now = new Date().toISOString();
    const id = this.uniqueId(name);
    const profile: JavaRuntimeProfile = {
      id,
      name,
      javaExecutablePath: execPath,
      javaHomePath: javaHomeForExecutable(execPath),
      javaVersion: probe?.version ?? "unknown",
      javaMajorVersion: probe?.major ?? 0,
      vendor: probe?.vendor,
      architecture: probe?.architecture ?? architectureFromOsArch(undefined),
      importedAt: now,
      lastValidatedAt: probe?.ran ? now : undefined,
      status: probe?.ran ? "valid" : "unverified"
    };
    this.write(profile);
    return profile;
  }

  /** Re-resolve + re-probe an existing runtime and persist the resulting status. */
  async validate(id: string): Promise<JavaRuntimeProfile> {
    const existing = this.get(id);
    if (!existing) throw new Error(`Java runtime "${id}" was not found.`);
    if (!existsSync(existing.javaExecutablePath)) {
      return this.persist({ ...existing, status: "missing" });
    }
    if (!this.options.probe) return existing;
    const probe = await this.options.probe(existing.javaExecutablePath);
    let status: JavaRuntimeStatus;
    if (!probe.ran || !probe.version || !probe.major) {
      status = "validation-failed";
    } else if (probe.major < MIN_SUPPORTED_JAVA_MAJOR) {
      status = "incompatible";
    } else {
      status = "valid";
    }
    return this.persist({
      ...existing,
      javaVersion: probe.version ?? existing.javaVersion,
      javaMajorVersion: probe.major ?? existing.javaMajorVersion,
      vendor: probe.vendor ?? existing.vendor,
      architecture: probe.architecture ?? existing.architecture,
      javaHomePath: javaHomeForExecutable(existing.javaExecutablePath),
      status,
      lastValidatedAt: new Date().toISOString()
    });
  }

  remove(id: string): void {
    rmSync(this.profilePath(id), { force: true });
    if (this.getDefaultId() === id) rmSync(join(this.root, DEFAULT_POINTER), { force: true });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private resolveExecutable(selectedPath: string): string | undefined {
    const raw = selectedPath?.trim();
    if (!raw) return undefined;
    for (const candidate of javaExecutableCandidates(raw, { platform: this.platform })) {
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
        // unreadable — keep trying
      }
    }
    return undefined;
  }

  private persist(profile: JavaRuntimeProfile): JavaRuntimeProfile {
    this.write(profile);
    return profile;
  }

  private write(profile: JavaRuntimeProfile): void {
    mkdirSync(this.root, { recursive: true });
    this.atomicWrite(this.profilePath(profile.id), JSON.stringify(stripId(profile), null, 2) + "\n");
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
    while (existsSync(this.profilePath(id))) id = `${base}-${n++}`;
    return id;
  }
}

/** The id is encoded in the filename — don't duplicate it inside the manifest. */
function stripId(profile: JavaRuntimeProfile): Omit<JavaRuntimeProfile, "id"> {
  const { id, ...rest } = profile;
  return rest;
}
