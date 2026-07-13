// IPC contract guard (audit A6). Statically checks the renderer↔main channel contract so it can't
// silently drift. No Electron — reads the source of `app/main/ipc/*` and `app/main/preload.ts`.
//
// Enforces:
//   1. Every channel the preload invokes has exactly one main-process handler (no broken renderer
//      call to a missing/renamed handler).
//   2. No channel is registered twice (a duplicate handler is a bug — the 2nd throws at runtime).
//   3. Every registered handler is either exposed through the preload OR listed in BACKEND_ONLY
//      below — so a NEW handler that is never wired to the UI fails the build and must be justified.
//   4. BACKEND_ONLY has no stale entries (each must still be a registered channel).
//
// Run: npx tsx scripts/verify-ipc-contract.mts
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IPC_DIR = join(ROOT, "app", "main", "ipc");
const PRELOAD = join(ROOT, "app", "main", "preload.ts");

// Channels intentionally registered in main but NOT exposed through the preload bridge, so the
// renderer (and therefore any web content) cannot reach them. These are internal/legacy CRUD APIs
// with no current UI consumer. Documented here rather than deleted; revisit when wiring their UI.
// Keep alphabetical. Removing a handler? Remove it here too (check 4 flags stale entries).
const BACKEND_ONLY = new Set<string>([
  "dataSource:list", // legacy singular alias; renderer uses dataSources:list
  "flow:list", // legacy singular alias; renderer uses flows:list
  "instance:list", // legacy singular alias; renderer uses instances:list
  "instances:clone",
  "instances:create",
  "instances:delete",
  "instances:export",
  "instances:get",
  "instances:import",
  "instances:update",
  "reports:create",
  "reports:delete",
  "reports:export",
  "reports:list", // legacy plural alias; renderer uses report:list
  "runtimeInputs:clone",
  "runtimeInputs:create",
  "runtimeInputs:delete",
  "runtimeInputs:export",
  "runtimeInputs:get",
  "runtimeInputs:import",
  "runtimeInputs:update",
  "scenario:get", // workflows are edited/saved via workflows:*; scenario:get/save are unused internals
  "scenario:save"
]);

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

// Collect registered channels (with duplicate detection) from every ipc handler file.
const registered = new Map<string, number>();
for (const file of readdirSync(IPC_DIR).filter((f) => f.endsWith(".ts"))) {
  const src = readFileSync(join(IPC_DIR, file), "utf8");
  for (const m of src.matchAll(/ipcMain\.handle\(\s*"([^"]+)"/g)) {
    registered.set(m[1], (registered.get(m[1]) ?? 0) + 1);
  }
}

// Collect channels the preload actually invokes.
const preloadSrc = readFileSync(PRELOAD, "utf8");
const invoked = new Set<string>();
for (const m of preloadSrc.matchAll(/ipcRenderer\.invoke\(\s*"([^"]+)"/g)) invoked.add(m[1]);

// Check 1 — no preload invoke without a handler.
const missingHandlers = [...invoked].filter((c) => !registered.has(c)).sort();
check("every preload-invoked channel has a main handler", missingHandlers.length === 0, missingHandlers.join(", "));

// Check 2 — no duplicate registrations.
const duplicates = [...registered].filter(([, n]) => n > 1).map(([c]) => c).sort();
check("no channel is registered more than once", duplicates.length === 0, duplicates.join(", "));

// Check 3 — every registered channel is exposed or explicitly backend-only.
const undocumented = [...registered.keys()].filter((c) => !invoked.has(c) && !BACKEND_ONLY.has(c)).sort();
check(
  "no registered handler is unexposed AND undocumented (add to preload or BACKEND_ONLY)",
  undocumented.length === 0,
  undocumented.join(", ")
);

// Check 4 — BACKEND_ONLY has no stale entries.
const stale = [...BACKEND_ONLY].filter((c) => !registered.has(c)).sort();
check("BACKEND_ONLY has no stale entries", stale.length === 0, stale.join(", "));

const passed = results.filter((r) => r.pass).length;
console.log(
  `\nIPC contract: ${passed}/${results.length} checks passed ` +
    `(${registered.size} handlers, ${invoked.size} exposed, ${BACKEND_ONLY.size} backend-only).`
);
process.exit(passed === results.length ? 0 : 1);
