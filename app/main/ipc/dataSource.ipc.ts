import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { dialog, ipcMain } from "electron";
import type { JsonArrayDataSourceProfile } from "@src/data/DataSourceProfile";
import { resolveJsonPath } from "@src/data/JsonPathResolver";
import { isPlainObject, setJsonAtPath, validateRowArray, type JsonRow } from "@src/data/TableEditing";
import { sanitizeProfileId } from "@src/storage/ProfileStore";
import { createDataSourceProfileStore } from "../profileStores";
import { getResourcesRoot, getRuntimeDataRoot } from "../appPaths";
import { getConfiguredPaths } from "../storagePaths";
import { isPathInside, isReadableDataSourceFile } from "@src/utils/pathSafety";
import { assertTrustedSender } from "./senderGuard";

/** Max size of a JSON file we will open/preview as a data source (audit §14 — huge-file DoS guard). */
const MAX_DATA_SOURCE_BYTES = 25 * 1024 * 1024;

/** Read failures that must surface to the user (confinement / oversize), not be treated as "file missing". */
class DataSourceReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataSourceReadError";
  }
}

/**
 * Confine data-source reads (audit §14). A data source may point anywhere the user browsed to, but it must
 * never be an AWKIT-internal file: block anything inside the runtime data root (saved sessions/captured
 * browser profiles/durable store/logs/reports) that is NOT the data-sources workspace. External user files
 * and the workspace are allowed; the read-only `resources/` samples live outside the runtime root.
 */
function assertReadableDataFile(resolved: string): void {
  if (isReadableDataSourceFile(getRuntimeDataRoot(), getConfiguredPaths().dataSources, resolved)) return;
  throw new DataSourceReadError(
    "This file is inside a WebFlow Studio data folder (sessions/reports/logs/runtime store) and cannot be used as a data source."
  );
}

/** Read + parse a JSON data file with confinement + size guards. Throws {@link DataSourceReadError}
 *  for confinement/oversize; ENOENT/parse errors propagate as their native errors. */
async function readJsonFileGuarded(resolved: string): Promise<unknown> {
  assertReadableDataFile(resolved);
  const info = await stat(resolved);
  if (info.size > MAX_DATA_SOURCE_BYTES) {
    throw new DataSourceReadError(
      `Data source file is too large to open (${(info.size / 1048576).toFixed(1)} MB; max 25 MB).`
    );
  }
  return JSON.parse(await readFile(resolved, "utf8"));
}

type DataRow = JsonRow;
type DataStore = ReturnType<typeof createDataSourceProfileStore>;

interface CreateFromScratchPayload {
  id?: string;
  name: string;
  fileName: string;
  rows: DataRow[];
  overwrite?: boolean;
}

export function registerDataSourceIpc(): void {
  const store = createDataSourceProfileStore();

  ipcMain.handle("dataSources:list", async () => ensureDefaultDataSource(store));
  ipcMain.handle("dataSources:get", async (_, id: string) => store.get(id));
  ipcMain.handle("dataSources:create", async (_, profile: JsonArrayDataSourceProfile) => store.create(profile));
  ipcMain.handle("dataSources:update", async (_, id: string, profile: JsonArrayDataSourceProfile) => store.update(id, profile));
  ipcMain.handle("dataSources:delete", async (_, id: string) => store.delete(id));
  ipcMain.handle("dataSources:clone", async (_, id: string, nextId?: string) => store.clone(id, nextId));
  ipcMain.handle("dataSources:export", async (_, id: string) => store.export(id));
  ipcMain.handle("dataSources:import", async (_, profile: JsonArrayDataSourceProfile) => store.import(profile));
  ipcMain.handle("dataSources:browseJson", async (_, existingId?: string) => browseJsonDataSource(store, existingId));
  ipcMain.handle("dataSources:preview", async (_, id: string, path?: string) => previewDataSource(store, id, path));
  ipcMain.handle("dataSources:getJsonPaths", async (_, id: string) => getJsonPaths(store, id));

  // ── Visual table editor channels ──────────────────────────────────────────
  ipcMain.handle("dataSources:readJson", async (_, id: string) => readDataSourceRows(store, id));
  ipcMain.handle("dataSources:writeJson", async (event, id: string, rows: DataRow[]) => {
    assertTrustedSender(event);
    return writeDataSourceRows(store, id, rows);
  });
  ipcMain.handle("dataSources:createFromScratch", async (event, payload: CreateFromScratchPayload) => {
    assertTrustedSender(event);
    return createFromScratch(store, payload);
  });

  ipcMain.handle("dataSource:list", async () => ensureDefaultDataSource(store));
}

// ── Table editor helpers (pure logic shared via @src/data/TableEditing) ───────

/** Editor data files live in a `files/` subfolder so they never collide with the
 *  profile-metadata files (`<dataSources>/<id>.json`) the profile store also writes there. */
function dataFilesDir(): string {
  return join(getConfiguredPaths().dataSources, "files");
}

/** The profile-metadata file path the data-source store uses for an id. */
function metadataPath(id: string): string {
  return join(getConfiguredPaths().dataSources, `${sanitizeProfileId(id)}.json`);
}

/** Sample data under resources/ is read-only; saving migrates to the writable data-sources folder. */
function isProtectedFile(file: string): boolean {
  if (file.startsWith("resources/") || file.startsWith("resources\\")) return true;
  const resolved = resolveProjectPath(file);
  return resolved.startsWith(getResourcesRoot()) || resolved.includes("app.asar");
}

/** Resolve the on-disk data file for a profile, redirecting away from a collision
 *  with the profile-metadata file (auto-heals data sources created by the old buggy path). */
function resolveDataFile(profile: JsonArrayDataSourceProfile): string {
  const resolved = resolveProjectPath(profile.file);
  if (resolved === metadataPath(profile.id)) return join(dataFilesDir(), `${sanitizeProfileId(profile.id)}.json`);
  return resolved;
}

async function readDataSourceRows(store: DataStore, id: string) {
  const profile = await store.get(id);
  if (!profile) throw new Error(`Data source not found: ${id}`);

  const dataPath = resolveDataFile(profile);
  let data: unknown;
  let fileExists = true;
  try {
    data = await readJsonFileGuarded(dataPath);
  } catch (error) {
    if (error instanceof DataSourceReadError) throw error; // confinement/oversize → surface to the user
    fileExists = false;
    data = profile.path === "$" ? [] : {};
  }

  const selected = resolveJsonPath(data, profile.path);
  if (!Array.isArray(selected)) {
    if (!fileExists) {
      // New (or auto-healed) data file: start empty, recovering the seed row if the
      // profile recorded one (e.g. a source created before the file-folder fix).
      const seed = isPlainObject(profile.sampleRow) ? [profile.sampleRow as DataRow] : [];
      return { profile, rows: seed, editable: true, writable: !isProtectedFile(profile.file) };
    }
    return { profile, rows: [] as DataRow[], editable: false, writable: false, message: validateRowArray(selected).message };
  }
  const validation = validateRowArray(selected);
  if (!validation.ok) {
    return { profile, rows: [] as DataRow[], editable: false, writable: false, message: validation.message };
  }
  return { profile, rows: selected as DataRow[], editable: true, writable: !isProtectedFile(profile.file) };
}

async function writeDataSourceRows(store: DataStore, id: string, rows: DataRow[]): Promise<JsonArrayDataSourceProfile> {
  const profile = await store.get(id);
  if (!profile) throw new Error(`Data source not found: ${id}`);
  const validation = validateRowArray(rows);
  if (!validation.ok) throw new Error(validation.message);

  let file = profile.file;
  let path = profile.path;
  const resolved = resolveDataFile(profile);
  const collidesWithMetadata = resolveProjectPath(profile.file) === metadataPath(profile.id);
  // Confine editor writes to the data-sources workspace so a manipulated/imported profile with an
  // arbitrary absolute `file` cannot overwrite files elsewhere on disk (audit F-04). Out-of-workspace
  // targets are redirected into the writable `files/` folder instead of written in place.
  const outsideWorkspace = !isPathInside(getConfiguredPaths().dataSources, resolved);

  if (isProtectedFile(profile.file) || collidesWithMetadata || outsideWorkspace) {
    // Migrate a read-only sample (or a legacy collided file) into the writable
    // data-sources `files/` folder as a root array.
    const target = join(dataFilesDir(), `${sanitizeProfileId(id)}.json`);
    await mkdir(dataFilesDir(), { recursive: true });
    await writeFile(target, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
    file = target;
    path = "$";
  } else {
    let data: unknown;
    try {
      data = JSON.parse(await readFile(resolved, "utf8"));
    } catch {
      data = path === "$" ? [] : {};
    }
    data = setJsonAtPath(data, path, rows);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  const updated: JsonArrayDataSourceProfile = {
    ...profile,
    file,
    path,
    rowCount: rows.length,
    sampleRow: rows[0],
    updatedAt: new Date().toISOString()
  };
  await store.update(id, updated);
  return updated;
}

async function createFromScratch(store: DataStore, payload: CreateFromScratchPayload): Promise<JsonArrayDataSourceProfile> {
  const name = (payload.name ?? "").trim();
  if (!name) throw new Error("Data source name is required.");
  let fileName = (payload.fileName ?? name).trim();
  if (!fileName) throw new Error("File name is required.");
  if (!fileName.toLowerCase().endsWith(".json")) fileName += ".json";

  await mkdir(dataFilesDir(), { recursive: true });
  const file = join(dataFilesDir(), fileName);
  if (existsSync(file) && !payload.overwrite) {
    throw new Error(`A file named "${fileName}" already exists. Choose a different name or confirm overwrite.`);
  }

  const id = (payload.id || basename(fileName, ".json")).replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase();
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const validation = validateRowArray(rows);
  if (!validation.ok) throw new Error(validation.message);

  await writeFile(file, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  const now = new Date().toISOString();
  const profile: JsonArrayDataSourceProfile = {
    id,
    name,
    type: "jsonArray",
    file,
    path: "$",
    createdAt: now,
    updatedAt: now,
    rowCount: rows.length,
    sampleRow: rows[0]
  };
  await store.import(profile);
  return profile;
}

async function browseJsonDataSource(store: ReturnType<typeof createDataSourceProfileStore>, existingId?: string) {
  const result = await dialog.showOpenDialog({
    title: "Select JSON data source",
    properties: ["openFile"],
    filters: [{ name: "JSON files", extensions: ["json"] }]
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  const file = result.filePaths[0];
  const data = await readJsonFileGuarded(file);
  const paths = collectJsonPaths(data);
  const firstArrayPath = paths.find((path) => Array.isArray(resolveJsonPath(data, path))) ?? "$";
  const rows = resolveJsonPath(data, firstArrayPath);
  const now = new Date().toISOString();
  const id = existingId || basename(file, ".json").replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase();
  const existing = existingId ? await store.get(existingId) : null;
  const profile: JsonArrayDataSourceProfile = {
    id,
    name: basename(file),
    type: "jsonArray",
    file,
    path: firstArrayPath,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    rowCount: Array.isArray(rows) ? rows.length : undefined,
    sampleRow: Array.isArray(rows) ? rows[0] : undefined
  };

  await store.import(profile);

  return {
    canceled: false,
    profile,
    paths,
    data
  };
}

async function ensureDefaultDataSource(store: ReturnType<typeof createDataSourceProfileStore>): Promise<JsonArrayDataSourceProfile[]> {
  const existing = await store.list();
  if (existing.length > 0) return existing;

  const sample: JsonArrayDataSourceProfile = {
    id: "customers-json",
    name: "customers.json",
    type: "jsonArray",
    file: "resources/sample-data/customers.json",
    path: "$.customers",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await store.import(sample);
  return store.list();
}

async function previewDataSource(
  store: ReturnType<typeof createDataSourceProfileStore>,
  id: string,
  path?: string
): Promise<{ profile: JsonArrayDataSourceProfile; data: unknown; rows: unknown[]; selected: unknown }> {
  const profile = await store.get(id);
  if (!profile) throw new Error(`Data source not found: ${id}`);

  const data = await readJson(resolveDataFile(profile));
  const rows = resolveJsonPath(data, profile.path);
  const selected = resolveJsonPath(data, path ?? profile.path);

  return {
    profile,
    data,
    rows: Array.isArray(rows) ? rows : [],
    selected
  };
}

async function getJsonPaths(store: ReturnType<typeof createDataSourceProfileStore>, id: string): Promise<string[]> {
  const profile = await store.get(id);
  if (!profile) throw new Error(`Data source not found: ${id}`);
  const data = await readJson(resolveDataFile(profile));
  return collectJsonPaths(data);
}

async function readJson(file: string): Promise<unknown> {
  return readJsonFileGuarded(resolveProjectPath(file));
}

function resolveProjectPath(file: string): string {
  if (isAbsolute(file)) return file;
  if (file.startsWith("resources/") || file.startsWith("resources\\")) {
    return join(process.cwd(), file);
  }
  return join(getResourcesRoot(), file);
}

function collectJsonPaths(value: unknown, basePath = "$"): string[] {
  const paths = [basePath];

  if (Array.isArray(value)) {
    value.slice(0, 1).forEach((item, index) => {
      paths.push(...collectJsonPaths(item, `${basePath}[${index}]`));
    });
    return paths;
  }

  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
      paths.push(...collectJsonPaths(nested, `${basePath}.${key}`));
    });
  }

  return [...new Set(paths)];
}
