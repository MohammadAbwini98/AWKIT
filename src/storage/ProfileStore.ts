import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

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

export interface JsonProfileStoreOptions<TProfile extends { id: string }> {
  folder: string;
  seedFolder?: string;
  extension?: string;
  createClone?: (profile: TProfile, nextId: string) => TProfile;
}

export class JsonProfileStore<TProfile extends { id: string }> implements ProfileStore<TProfile> {
  private readonly extension: string;
  // Serializes every on-disk mutation (writeProfile/delete) for this store so overlapping saves
  // to the same folder can never physically interleave. FIFO; a failed task rejects for its caller
  // but never blocks the ones queued behind it (both branches of the chain settle the tail).
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: JsonProfileStoreOptions<TProfile>) {
    this.extension = options.extension ?? ".json";
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(task, task);
    this.writeChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
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
    const existing = await this.get(profile.id);
    if (existing) throw new Error(`Profile already exists: ${profile.id}`);
    await this.writeProfile(profile);
    return profile;
  }

  async update(id: string, profile: TProfile): Promise<TProfile> {
    await this.ensureStoreFolder();
    // Write the new record first, then drop the old one on an id rename. A crash between the two
    // leaves both files (a recoverable duplicate), never zero files — the record is never lost.
    await this.writeProfile(profile);
    if (id !== profile.id) {
      await this.delete(id);
    }
    return profile;
  }

  async delete(id: string): Promise<void> {
    await this.serialize(() => rm(this.pathForId(id), { force: true }));
  }

  async clone(id: string, nextId = `${id}-copy`): Promise<TProfile> {
    const profile = await this.get(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);

    const clone = this.options.createClone ? this.options.createClone(profile, nextId) : ({ ...profile, id: nextId } as TProfile);
    return this.create(clone);
  }

  async import(profile: TProfile): Promise<TProfile> {
    await this.ensureStoreFolder();
    await this.writeProfile(profile);
    return profile;
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
    } catch (renameError) {
      console.error(
        `[profile-store] ${path} is not valid JSON and could not be quarantined ` +
          `(${(renameError as Error).message}); left in place. Parse error: ${(error as Error).message}`
      );
    }
  }

  private writeProfile(profile: TProfile): Promise<void> {
    const contents = `${JSON.stringify(profile, null, 2)}\n`;
    return this.serialize(() => this.atomicWrite(this.pathForId(profile.id), contents));
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
    try {
      await rename(tmp, path);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private pathForId(id: string): string {
    return join(this.options.folder, `${sanitizeProfileId(id)}${this.extension}`);
  }
}

export function sanitizeProfileId(id: string): string {
  return id.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "profile";
}
