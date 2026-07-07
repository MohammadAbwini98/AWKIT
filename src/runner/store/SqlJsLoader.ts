/**
 * Single loader for the `sql.js` WASM runtime (Phase 4A).
 *
 * Why this exists: `initSqlJs()` without options lets emscripten resolve `sql-wasm.wasm`
 * relative to its own script directory. That works in dev and in `app.asar` (Electron's
 * patched `fs` reads inside the archive), but it is implicit and undiagnosable when it
 * breaks. This loader resolves the WASM file explicitly through Node module resolution
 * (`require.resolve("sql.js")` → sibling `sql-wasm.wasm`), passes it via `locateFile`,
 * and exposes the resolved path for the runtime diagnostics / packaged smoke verifier.
 * Resolution works identically for the Node 18 tsx verifiers, `npm run dev`, and the
 * packaged app (`resources/app.asar/node_modules/sql.js/dist/sql-wasm.wasm`).
 * If resolution fails we fall back to sql.js's default behavior instead of failing.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import initSqlJs, { type SqlJsStatic } from "sql.js";

let sqlJsPromise: Promise<SqlJsStatic> | undefined;
let resolvedWasmPath: string | undefined;

/** Resolve the absolute path of `sql-wasm.wasm` next to the resolved sql.js entry. */
export function resolveSqlJsWasmPath(): string | undefined {
  if (resolvedWasmPath) return resolvedWasmPath;
  try {
    const requireFromHere = createRequire(import.meta.url);
    // Resolves to <...>/node_modules/sql.js/dist/sql-wasm.js in dev, tsx, and app.asar.
    const entry = requireFromHere.resolve("sql.js");
    const candidate = join(dirname(entry), "sql-wasm.wasm");
    if (existsSync(candidate)) {
      resolvedWasmPath = candidate;
      return candidate;
    }
  } catch {
    // Fall through: sql.js's own script-directory resolution remains the fallback.
  }
  return undefined;
}

/** Load (once) the sql.js runtime with an explicit WASM location when resolvable. */
export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    const wasmPath = resolveSqlJsWasmPath();
    sqlJsPromise = initSqlJs(
      wasmPath ? { locateFile: (file: string) => (file === "sql-wasm.wasm" ? wasmPath : file) } : undefined
    ).catch((error) => {
      // Allow a retry on the next open instead of caching the rejection forever.
      sqlJsPromise = undefined;
      throw error;
    });
  }
  return sqlJsPromise;
}

/** The WASM path used by `loadSqlJs` (undefined = sql.js default resolution). */
export function getSqlJsWasmPath(): string | undefined {
  return resolvedWasmPath ?? resolveSqlJsWasmPath();
}
