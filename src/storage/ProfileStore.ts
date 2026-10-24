import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { replaceFileAtomically, type AtomicReplaceOptions } from "./atomicReplace";
import { runExclusive } from "./folderWriteCoordinator";

export interface ProfileStore<TProfile extends { id: string }> {
  list(): Promise<TProfile[]>;
  get(id: string): Promise<TProfile | null>;
  create(profile: TProfile): Promise<TProfile>;
  update(id: string, profile: TProfile): Promise<TProfile>;
  delete(id: string): Promise<void>;
  clone(id: string, nextId?: string): Promise<TProfile>;
  import(profile: TProfile): Promise<TProfile>;
  export(id: string): Promise<TProfile>;
}

/** What a write is about to replace, as read inside the lane immediately before the write. */
export type ProfilePreviousState = "present" | "missing" | "unreadable";

export interface ProfileWriteContext<TProfile> {
  id: string;
  operation: "create" | "update" | "updateWith" | "import" | "rename-target";
  previous: TProfile | null;
  previousState: ProfilePreviousState;
  next: TProfile;
}

export interface ProfileDeleteContext {
  id: string;
  operation: "delete" | "rename-source";
}

/**
 * Optional write hooks (Phase N, N6.3). Only the flow store sets them; every other store passes none
 * and behaves exactly as before. None of them may enter this folder's lane: they already run inside it
 * (or, for `onQuarantine`, may), and re-entering would self-deadlock.
 */
export interface ProfileStoreHooks<TProfile> {
  /** Wraps every critical section inside the in-process lane, e.g. with a cross-process lock. */
  exclusive?<R>(task: () => Promise<R>): Promise<R>;
  /** Inside the critical section, after any existence check, immediately before the profile write. */
  beforeWrite?(context: ProfileWriteContext<TProfile>): Promise<void>;
  /** Inside the critical section, immediately before a profile file is deleted (delete, and the rename half of update). */
  beforeDelete?(context: ProfileDeleteContext): Promise<void>;
  /** After a corrupt file was renamed aside. May run inside or outside the critical section. Errors are logged, never thrown into a read. */
  onQuarantine?(id: string): Promise<void>;
}

export interface JsonProfileStoreOptions<TProfile extends { id: string }> {
  folder: string;
  seedFolder?: string;
  extension?: string;
  createClone?: (profile: TProfile, nextId: string) => TProfile;
  /**
   * Passed straight to `replaceFileAtomically`. Production leaves it unset and takes the shared
   * defaults; verifiers use the `renameImpl` / `sleep` seams to force transient and permanent
   * rename failures deterministically, instead of trying to provoke a real EPERM from the OS.
   */
  atomicReplace?: AtomicReplaceOptions;
  /** Flow store only (N6.3): visual-baseline lifecycle and cross-process coordination. */
  hooks?: ProfileStoreHooks<TProfile>;
  /**
   * Flow store only (N6.9, VA-11): `"authorize"` makes `import` over an EXISTING id require the caller's
   * `authorizeOverwrite`, decided inside the critical section before anything is read, quarantined,
   * invalidated or written. Unset keeps the historical overwrite-always import for every other store.
   */
  importOverwrite?: "authorize";
  /** Deadline for the overwrite authorizer (default 5000 ms). A timeout is a denial. */
  importAuthorizationTimeoutMs?: number;
}

export interface ProfileImportRequest {
  /** Re-evaluates the caller's edit authority at the moment of decision. Never takes the folder lane. */
  authorizeOverwrite?: () => Promise<boolean>;
}

export type ProfileImportRefusal = "no-authorizer" | "denied" | "timeout";

/** A refused import over an existing profile (N6.9). Nothing was read, quarantined, invalidated or written. */
export class ProfileImportOverwriteError extends Error {
  readonly code = "FLOW_IMPORT_OVERWRITE_FORBIDDEN";
  readonly refusal: ProfileImportRefusal;

  constructor(refusal: ProfileImportRefusal) {
    super(`Importing over an existing flow requires edit permission (${refusal}).`);
    this.name = "ProfileImportOverwriteError";
    this.refusal = refusal;
  }
}

export class JsonProfileStore<TProfile extends { id: string }> implements ProfileStore<TProfile> {
  private readonly extension: string;

  constructor(private readonly options: JsonProfileStoreOptions<TProfile>) {
    this.extension = options.extension ?? ".json";
  }

  // Every on-disk mutation for this store runs under the one coordination authority for its
  // RESOLVED folder, not a queue owned by this instance — two stores constructed independently
  // against the same configured folder must not be able to interleave their replacements.
  // FIFO; a failed task rejects for its caller but never blocks the ones queued behind it (that
  // guarantee now lives in the coordinator, which settles the lane tail on both branches).
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const exclusive = this.options.hooks?.exclusive;
    return runExclusive(this.options.folder, exclusive ? () => exclusive(task) : task);
  }

  async list(): Promise<TProfile[]> {
    await this.ensureSeeded();
    const files = await this.getProfileFiles();
    const profiles = await Promise.all(files.map((file) => this.readProfileFile(file)));
    const validProfiles: TProfile[] = [];
    for (const profile of profiles) {
      if (profile) validProfiles.push(profile);
    }
    return validProfiles.sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<TProfile | null> {
    await this.ensureSeeded();
    return this.readProfileFile(this.pathForId(id));
  }

  async create(profile: TProfile): Promise<TProfile> {
    await this.ensureStoreFolder();
    // Check-then-write is one critical section: with per-folder coordination two independently
    // constructed stores can no longer both observe "absent" and both create the same id.
    await this.serialize(async () => {
      const existing = await this.get(profile.id);
      if (existing) throw new Error(`Profile already exists: ${profile.id}`);
      await this.options.hooks?.beforeWrite?.({ id: profile.id, operation: "create", previous: null, previousState: "missing", next: profile });
      await this.writeProfileUnlocked(profile);
    });
    return profile;
  }

  async update(id: string, profile: TProfile): Promise<TProfile> {
    await this.ensureStoreFolder();
    // Write the new record first, then drop the old one on an id rename. A crash between the two
    // leaves both files (a recoverable duplicate), never zero files — the record is never lost.
    // Both halves run in ONE critical section so no other writer to this folder can observe (or
    // write into) the window between them.
    await this.serialize(async () => {
      const hooks = this.options.hooks;
      if (hooks?.beforeWrite) {
        const previous = await this.readPreviousUnlocked(profile.id);
        await hooks.beforeWrite({ id: profile.id, operation: id === profile.id ? "update" : "rename-target", ...previous, next: profile });
      }
      await this.writeProfileUnlocked(profile);
      if (id !== profile.id) {
        await hooks?.beforeDelete?.({ id, operation: "rename-source" });
        await this.deleteUnlocked(id);
      }
    });
    return profile;
  }

  /**
   * Read-modify-write inside this folder's lane: `change` sees the file as it is now and returns the
   * next profile, or `undefined` to write nothing. No writer to the folder can land between the read
   * and the write, which is what makes a compare-and-swap (an AI revert) safe against a concurrent
   * save through any other store instance. The id cannot change here; use `update` to rename.
   */
  async updateWith(id: string, change: (current: TProfile | null) => TProfile | undefined): Promise<TProfile | undefined> {
    await this.ensureStoreFolder();
    return this.serialize(async () => {
      const hooks = this.options.hooks;
      const previous = hooks?.beforeWrite ? await this.readPreviousUnlocked(id) : null;
      const next = change(previous ? previous.previous : await this.readProfileFile(this.pathForId(id)));
      if (next === undefined) return undefined;
      if (next.id !== id) throw new Error(`updateWith cannot change a profile id (${id} -> ${next.id})`);
      if (hooks?.beforeWrite && previous) await hooks.beforeWrite({ id, operation: "updateWith", ...previous, next });
      await this.writeProfileUnlocked(next);
      return next;
    });
  }

  async delete(id: string): Promise<void> {
    await this.serialize(async () => {
      await this.options.hooks?.beforeDelete?.({ id, operation: "delete" });
      await this.deleteUnlocked(id);
    });
  }

  async clone(id: string, nextId = `${id}-copy`): Promise<TProfile> {
    const profile = await this.get(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);

    const clone = this.options.createClone ? this.options.createClone(profile, nextId) : ({ ...profile, id: nextId } as TProfile);
    return this.create(clone);
  }

  async import(profile: TProfile, request: ProfileImportRequest = {}): Promise<TProfile> {
    await this.ensureStoreFolder();
    const beforeWrite = this.options.hooks?.beforeWrite;
    const guarded = this.options.importOverwrite === "authorize";
    if (!beforeWrite && !guarded) {
      await this.writeProfile(profile);
      return profile;
    }
    await this.serialize(async () => {
      // N6.9: the overwrite authorization comes first, before the previous file is read (and so before
      // any quarantine) and before any invalidation. Nothing below may move ahead of it.
      if (guarded) await this.authorizeImportUnlocked(profile.id, request.authorizeOverwrite);
      if (beforeWrite) {
        const previous = await this.readPreviousUnlocked(profile.id);
        await beforeWrite({ id: profile.id, operation: "import", ...previous, next: profile });
      }
      await this.writeProfileUnlocked(profile);
    });
    return profile;
  }

  /**
   * Inside the critical section: an import over an existing id needs the authorizer's yes, within the
   * deadline. Existence is a `stat`, so an unparseable file counts as existing and is never read or
   * quarantined here; any error other than "not found" also counts as existing (fail closed).
   */
  protected async authorizeImportUnlocked(id: string, authorizer: (() => Promise<boolean>) | undefined): Promise<void> {
    try {
      await stat(this.pathForId(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    }
    if (!authorizer) throw new ProfileImportOverwriteError("no-authorizer");
    const timeoutMs = this.options.importAuthorizationTimeoutMs ?? 5000;
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      authorizer().then(
        (allowed) => (allowed === true ? ("allowed" as const) : ("denied" as const)),
        () => "denied" as const
      ),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      })
    ]).finally(() => clearTimeout(timer));
    if (outcome !== "allowed") throw new ProfileImportOverwriteError(outcome);
  }

  async export(id: string): Promise<TProfile> {
    const profile = await this.get(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);
    return profile;
  }

  private async ensureSeeded(): Promise<void> {
    await this.ensureStoreFolder();
    if (!this.options.seedFolder) return;

    const existing = await this.getProfileFiles();
    if (existing.length > 0) return;

    try {
      const seedFiles = await readdir(this.options.seedFolder);
      await Promise.all(
        seedFiles
          .filter((file) => extname(file).toLowerCase() === this.extension)
          .map((file) => copyFile(join(this.options.seedFolder!, file), join(this.options.folder, basename(file))))
      );
    } catch {
      // Seed resources are optional in development and test environments.
    }
  }

  private async ensureStoreFolder(): Promise<void> {
    await mkdir(this.options.folder, { recursive: true });
  }

  private async getProfileFiles(): Promise<string[]> {
    try {
      const files = await readdir(this.options.folder);
      return files.filter((file) => extname(file).toLowerCase() === this.extension).map((file) => join(this.options.folder, file));
    } catch {
      return [];
    }
  }

  private async readProfileFile(path: string): Promise<TProfile | null> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      // A missing file is a normal "not found"; any other IO error is logged, not silently hidden.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[profile-store] Could not read ${path}: ${(error as Error).message}`);
      }
      return null;
    }
    try {
      return JSON.parse(raw) as TProfile;
    } catch (error) {
      await this.quarantineCorrupt(path, error);
      return null;
    }
  }

  /**
   * A profile file that is not valid JSON is NOT silently dropped: it is renamed to a
   * `.corrupt-<ts>` sibling (outside the store extension so it is not re-scanned) so the bytes
   * survive for recovery, and the failure is logged loudly. The original is never destroyed.
   */
  private async quarantineCorrupt(path: string, error: unknown): Promise<void> {
    const target = `${path}.corrupt-${Date.now()}`;
    try {
      await rename(path, target);
      console.error(
        `[profile-store] ${path} is not valid JSON; preserved as ${target} so it is not lost. ` +
          `Parse error: ${(error as Error).message}`
      );
      const onQuarantine = this.options.hooks?.onQuarantine;
      if (onQuarantine) {
        await onQuarantine(basename(path, this.extension)).catch((hookError: unknown) => {
          console.error(`[profile-store] quarantine hook failed for ${path}: ${(hookError as Error).message}`);
        });
      }
    } catch (renameError) {
      console.error(
        `[profile-store] ${path} is not valid JSON and could not be quarantined ` +
          `(${(renameError as Error).message}); left in place. Parse error: ${(error as Error).message}`
      );
    }
  }

  /** The file a write is about to replace, for `beforeWrite`. A corrupt file is quarantined (and reported) here. */
  private async readPreviousUnlocked(id: string): Promise<{ previous: TProfile | null; previousState: ProfilePreviousState }> {
    const path = this.pathForId(id);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { previous: null, previousState: "missing" };
      return { previous: null, previousState: "unreadable" };
    }
    try {
      return { previous: JSON.parse(raw) as TProfile, previousState: "present" };
    } catch (error) {
      await this.quarantineCorrupt(path, error);
      return { previous: null, previousState: "unreadable" };
    }
  }

  private writeProfile(profile: TProfile): Promise<void> {
    return this.serialize(() => this.writeProfileUnlocked(profile));
  }

  /**
   * The write itself, WITHOUT taking the folder lane. Composite operations (`create`'s
   * check-then-write, `update`'s write-then-delete) hold the lane across all of their steps, so
   * they must call the unlocked internals — re-entering `serialize` from inside a task already
   * running on that folder's lane would wait on a tail that only settles once the caller returns,
   * i.e. self-deadlock.
   */
  private writeProfileUnlocked(profile: TProfile): Promise<void> {
    const contents = `${JSON.stringify(profile, null, 2)}\n`;
    return this.atomicWrite(this.pathForId(profile.id), contents);
  }

  /** As `delete`, without taking the folder lane. See `writeProfileUnlocked`. */
  private deleteUnlocked(id: string): Promise<void> {
    return rm(this.pathForId(id), { force: true });
  }

  /**
   * Crash-safe write: serialize to a temp file in the same directory, then rename over the target.
   * libuv's rename replaces the destination atomically on Windows (MOVEFILE_REPLACE_EXISTING), so a
   * crash or power loss mid-write can never leave a half-written / truncated profile — the previous
   * good file stays intact until the complete new one is in place. On failure the temp is cleaned up.
   */
  private async atomicWrite(path: string, contents: string): Promise<void> {
    const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(tmp, contents, "utf8");
    // The rename is retried on transient Windows contention. A single unretried rename here lost a
    // user's save outright: a soak of the Workflow capsule suite reproduced
    //   EPERM: operation not permitted, rename '<...>.json.<pid>.<ts>.<rand>.tmp' -> '<...>.json'
    // with the edited workflow visibly on the canvas and the Save button enabled, roughly one run in
    // four. The renderer surfaced it as a "Failed to save changes" toast that auto-dismissed, so the
    // change was gone with only a few seconds of on-screen warning. Antivirus, the search indexer and
    // backup agents all open files for a few milliseconds on Windows, which is routine rather than
    // exceptional. Same policy and helper as the settings writer (awkit-4qs); see
    // app/main/atomicReplace.ts for why only EPERM/EBUSY are retried and why the backoff is linear
    // and short. On a terminal failure it removes the temp and rethrows the ORIGINAL error, so the
    // behaviour callers already depend on is unchanged.
    await replaceFileAtomically(tmp, path, this.options.atomicReplace ?? {});
  }

  private pathForId(id: string): string {
    return join(this.options.folder, `${sanitizeProfileId(id)}${this.extension}`);
  }
}

export function sanitizeProfileId(id: string): string {
  return id.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "profile";
}
