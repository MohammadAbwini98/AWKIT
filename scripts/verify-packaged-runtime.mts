/**
 * Packaged-app runtime smoke verification (Phase 4D).
 * Run with: npm run verify:packaged-runtime   (AFTER `npm run package:portable`)
 *
 * Verifies against the REAL packaged build in dist/win-unpacked (the exact app the portable
 * EXE wraps): the app.asar ships the sql.js WASM runtime, the offline dependency manifest
 * declares it, the packaged app LAUNCHES, the durable SQLite runtime store initializes inside
 * the packaged main process (proving the WASM loaded from app.asar), runtime paths point at
 * the writable %LOCALAPPDATA% root (never into resources/app.asar), the runtime status IPC
 * works, and the produced DB file is a real SQLite database readable by an external tool.
 *
 * NOT covered here (covered live in dev by verify:cancellation / verify:artifacts):
 * cancellation closing a packaged-run browser and failure screenshot/trace capture.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { loadSqlJs } from "@src/runner/store/SqlJsLoader";
import { capturePackagedAppPids, ensurePackagedAppDead } from "./helpers/packaged-process-tree.mts";

const requireFromHere = createRequire(import.meta.url);
// @electron/asar is CJS (ships with electron-builder's dependency tree).
const asar = requireFromHere("@electron/asar") as { listPackage(archive: string, options?: unknown): string[] };

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const unpackedDir = join(root, "dist", "win-unpacked");
const exePath = join(unpackedDir, "WebFlow Studio.exe");
const asarPath = join(unpackedDir, "resources", "app.asar");
const packagedResources = join(unpackedDir, "resources", "resources");

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function main(): Promise<void> {
  console.log("Packaged runtime smoke verification (dist/win-unpacked)");

  console.log("\nPart A — packaged bundle contents");
  if (!existsSync(exePath) || !existsSync(asarPath)) {
    console.error(`  ✗ Packaged app not found (${exePath}).`);
    console.error("    Build it first: npm run package:portable");
    process.exit(1);
  }
  check("packaged EXE + app.asar exist", true);

  const asarFiles = new Set(asar.listPackage(asarPath).map((entry) => entry.replace(/\\/g, "/")));
  check("app.asar contains out/main/main.js", asarFiles.has("/out/main/main.js"));
  check("app.asar contains node_modules/sql.js/dist/sql-wasm.js", asarFiles.has("/node_modules/sql.js/dist/sql-wasm.js"));
  check("app.asar contains node_modules/sql.js/dist/sql-wasm.wasm", asarFiles.has("/node_modules/sql.js/dist/sql-wasm.wasm"));
  check(
    "bundled Chromium present in packaged resources",
    existsSync(join(packagedResources, "browsers", "chromium", "chrome.exe"))
  );

  console.log("\nPart B — packaged offline dependency manifest");
  const manifestPath = join(packagedResources, "dependency-manifest.json");
  let manifest: any = null;
  try {
    manifest = JSON.parse((await readFile(manifestPath, "utf8")).replace(/^﻿/, ""));
  } catch {
    /* checked below */
  }
  check("packaged dependency manifest parses", manifest !== null, manifestPath);
  check("manifest declares sql.js runtime included", manifest?.runtime?.sqlJsRuntimeIncluded === true);
  check("manifest declares sql.js WASM asset included", manifest?.runtime?.sqlJsWasmIncluded === true);
  check("manifest lists the sql.js dependency version", typeof manifest?.dependencies?.sqlJs === "string" && manifest.dependencies.sqlJs !== "not-used", String(manifest?.dependencies?.sqlJs));
  check("manifest still declares no internet requirement", manifest?.offline?.internetRequired === false && manifest?.offline?.runtimeDownloadsAllowed === false);

  console.log("\nPart C — launch the packaged app and read the runtime environment");
  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.ELECTRON_RUN_AS_NODE; // must boot as a GUI app
  const app = await electron.launch({ executablePath: exePath, env: env as never, timeout: 60_000 });
  // Launcher-stub gotcha (Phase 5.1D): the spawned EXE is a stub; capture the REAL main pid
  // for cleanup so a failed run never leaves a zombie app.
  const appPids = await capturePackagedAppPids(app);
  let environment: any = null;
  let status: any = null;
  try {
    const win = await app.firstWindow({ timeout: 60_000 });
    await win.waitForLoadState("domcontentloaded");
    check("packaged app launched and opened a window", true);

    // Durable init is kicked off at IPC registration; poll until the environment appears.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      status = await win
        .evaluate(() => (window as any).playwrightFlowStudio.executions.runtimeStatus())
        .catch(() => null);
      environment = status?.environment ?? null;
      if (environment) break;
      await sleep(500);
    }
    check("runtime status IPC works in the packaged app", status !== null);
    check("runtime environment diagnostics are reported", environment !== null, JSON.stringify(status ?? {}).slice(0, 200));
    check(`appMode is "packaged" (got "${environment?.appMode}")`, environment?.appMode === "packaged");
    check(
      "durable store enabled — sql.js WASM loaded inside the packaged main process",
      environment?.durableStoreEnabled === true
    );
    check(
      "sql.js WASM resolved from inside app.asar",
      typeof environment?.sqlJsWasmPath === "string" && /app\.asar[\\/]node_modules[\\/]sql\.js/.test(environment.sqlJsWasmPath),
      environment?.sqlJsWasmPath
    );
    const localAppData = process.env.LOCALAPPDATA ?? "";
    check(
      "runtime root is the writable %LOCALAPPDATA%/WebFlow Studio (not resources/app.asar)",
      typeof environment?.runtimeRoot === "string" &&
        environment.runtimeRoot.toLowerCase().startsWith(join(localAppData, "WebFlow Studio").toLowerCase()) &&
        !environment.runtimeRoot.includes("app.asar"),
      environment?.runtimeRoot
    );
    check(
      "sqlitePath sits under <runtimeRoot>/runtime/runtime.sqlite",
      typeof environment?.sqlitePath === "string" &&
        environment.sqlitePath.toLowerCase().startsWith(String(environment.runtimeRoot).toLowerCase()) &&
        environment.sqlitePath.endsWith("runtime.sqlite"),
      environment?.sqlitePath
    );
    check(
      "artifactsRoot sits under the runtime root",
      typeof environment?.artifactsRoot === "string" && environment.artifactsRoot.toLowerCase().startsWith(String(environment.runtimeRoot).toLowerCase()),
      environment?.artifactsRoot
    );
  } finally {
    const leftovers = await ensurePackagedAppDead(app, appPids);
    check("packaged app process tree fully terminated (no zombie main/stub)", leftovers.length === 0, leftovers.join(","));
  }

  console.log("\nPart D — durable DB written by the packaged app is a real SQLite database");
  if (environment?.sqlitePath && existsSync(environment.sqlitePath)) {
    check("runtime.sqlite exists on disk after packaged launch", true, environment.sqlitePath);
    const bytes = await readFile(environment.sqlitePath);
    check("DB file has the SQLite format 3 header", bytes.subarray(0, 16).toString("utf8").startsWith("SQLite format 3"));
    // Read the packaged app's DB with raw sql.js from THIS checkout — a true external,
    // read-only inspection (never writes back over the app's file).
    const SQL = await loadSqlJs();
    const db = new SQL.Database(bytes);
    try {
      const migrations = db.exec("SELECT version, name FROM runtime_migrations ORDER BY version");
      const migrationCount = migrations.length ? migrations[0].values.length : 0;
      check(`external read works — ${migrationCount} migration(s) recorded`, migrationCount >= 1);
      check("runs table readable externally", Array.isArray(db.exec("SELECT COUNT(*) FROM runtime_runs")));
    } finally {
      db.close();
    }
  } else {
    check("runtime.sqlite exists on disk after packaged launch", false, String(environment?.sqlitePath));
  }

  console.log("\nPart E — artifacts root is writable");
  if (environment?.artifactsRoot) {
    try {
      await mkdir(environment.artifactsRoot, { recursive: true });
      const probe = join(environment.artifactsRoot, `.packaged-verify-${Date.now()}`);
      await writeFile(probe, "ok", "utf8");
      await rm(probe, { force: true });
      check("artifactsRoot accepts writes", true, environment.artifactsRoot);
    } catch (error) {
      check("artifactsRoot accepts writes", false, error instanceof Error ? error.message : String(error));
    }
  } else {
    check("artifactsRoot accepts writes", false, "artifactsRoot missing from environment");
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  console.log("Note: packaged cancellation/browser-close and failure screenshot/trace capture are");
  console.log("covered live in dev by verify:cancellation and verify:artifacts (same code path).");
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`✗ Unhandled failure: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
