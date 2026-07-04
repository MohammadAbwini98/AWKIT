import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

  constructor(private readonly options: JsonProfileStoreOptions<TProfile>) {
    this.extension = options.extension ?? ".json";
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
    if (id !== profile.id) {
      await this.delete(id);
    }
    await this.writeProfile(profile);
    return profile;
  }

  async delete(id: string): Promise<void> {
    await rm(this.pathForId(id), { force: true });
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
    try {
      return JSON.parse(await readFile(path, "utf8")) as TProfile;
    } catch {
      return null;
    }
  }

  private async writeProfile(profile: TProfile): Promise<void> {
    await writeFile(this.pathForId(profile.id), `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  }

  private pathForId(id: string): string {
    return join(this.options.folder, `${sanitizeProfileId(id)}${this.extension}`);
  }
}

export function sanitizeProfileId(id: string): string {
  return id.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "profile";
}
