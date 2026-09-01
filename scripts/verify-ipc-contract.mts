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
//
// A channel counts as registered when it is passed as a string literal either to `ipcMain.handle`
// directly, or to one of the registration helpers below — helpers that call `ipcMain.handle` with
// the channel as a VARIABLE, which this file's static scan cannot otherwise see. Any new helper of
// that shape must be added here. Check 1 fails closed if one is missed (a preload invoke would
// appear to have no handler), but check 3 would fail OPEN — an unscanned handler is not tested for
// being unexposed and undocumented — so this list is load-bearing, not a convenience.
const REGISTRARS = ["ipcMain\\.handle", "handleReportsRead"];
const REGISTRATION_RE = new RegExp(`(?:${REGISTRARS.join("|")})\\(\\s*"([^"]+)"`, "g");

const registered = new Map<string, number>();
for (const file of readdirSync(IPC_DIR).filter((f) => f.endsWith(".ts"))) {
  const src = readFileSync(join(IPC_DIR, file), "utf8");
  for (const m of src.matchAll(REGISTRATION_RE)) {
    registered.set(m[1], (registered.get(m[1]) ?? 0) + 1);
  }
}

// Collect channels the preload actually invokes.
//
// Call sites go through preload's own `invoke(...)` wrapper (awkit-x48), which strips Electron's
// remote-method preamble off rejections; the wrapper itself is the one remaining
// `ipcRenderer.invoke(...)`. Both spellings are collected, so this keeps reading the real contract
// whichever side of that boundary a channel is called from. A cardinality floor below turns a
// pattern that silently stops matching into a failure instead of "0 exposed, all backend-only".
const preloadSrc = readFileSync(PRELOAD, "utf8");
const invoked = new Set<string>();
for (const m of preloadSrc.matchAll(/(?:^|[^.\w])(?:ipcRenderer\.)?invoke\(\s*"([^"]+)"/gm)) invoked.add(m[1]);
check(
  "the preload scan found the exposed surface (pattern still matches)",
  invoked.size >= 150,
  `${invoked.size} channels matched — the preload invoke pattern may have changed`
);

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

// ── Check 5 (AWKIT-SEC-002) — authorization registry ─────────────────────────
//
// Every registered channel must DECLARE its authorization level:
//   PERMISSION — the handler calls `assertSenderPermission` (directly or via a local `authorize`
//                helper), or `assertTrustedSender` for pre-login trust-boundary channels;
//   NONE       — deliberately open, listed here with a reason;
//   TRUSTED    — trusted-sender-checked only, listed here with a reason.
//
// A plain `ipcMain.handle` with no guard used to pass every other check; this registry closes the
// class: adding an ungated channel without declaring it here fails the build and forces the
// decision to be made in review rather than silently shipped.
const AUTHZ_REGISTRY: Record<string, { level: "NONE" | "TRUSTED"; reason: string }> = {
  // Pre-login authentication surface (must be reachable before any session exists).
  "auth:getCapabilities": { level: "TRUSTED", reason: "pre-login capability probe required to render the login surface" },
  "auth:openOAuth": { level: "TRUSTED", reason: "opens the system browser for OAuth on the login screen" },
  "auth:openExternal": { level: "TRUSTED", reason: "opens external help/links from the login surface" },
  "security:getBootState": { level: "TRUSTED", reason: "boot-state probe before any session exists" },
  "settings:get": { level: "NONE", reason: "boot-time settings read; needed before login to render shell/appearance" },
  "offlineRuntime:getStatus": { level: "NONE", reason: "read-only offline-runtime status banner data" },
  "branding:getState": { level: "NONE", reason: "open read documented at branding.ipc.ts — every signed-in role renders the sidebar logo" },
  // Window chrome controls (any renderer, incl. frameless splash).
  "window:minimize": { level: "TRUSTED", reason: "frameless window chrome control" },
  "window:toggleMaximize": { level: "TRUSTED", reason: "frameless window chrome control" },
  "window:close": { level: "TRUSTED", reason: "frameless window chrome control" },
  "window:isMaximized": { level: "TRUSTED", reason: "frameless window chrome control" },
  // Read-only run-status surfaces (no secrets; reports themselves are gated).
  "execution:list": { level: "NONE", reason: "run-card status list for the monitor page; no credentials" },
  "execution:validate": { level: "NONE", reason: "pre-run validation report for the run form" },
  "execution:runtimeStatus": { level: "NONE", reason: "live progress snapshot for the monitor page" },
  "execution:recoveryDetails": { level: "NONE", reason: "recovery notes read-back; recovery ACTION is gated" },
  // Validation engine reads.
  "validation:statusAll": { level: "NONE", reason: "read-only legacy-compatibility status summary" },
  "validation:status": { level: "NONE", reason: "read-only per-flow compatibility status" },
  "validation:meta": { level: "NONE", reason: "read-only scan metadata" },
  "validation:grants": { level: "NONE", reason: "read-only grant list shown in Settings" },
  "validation:latestScan": { level: "NONE", reason: "read-only last-scan result" },
  "validation:migrations": { level: "NONE", reason: "read-only migration history" },
  "validation:previewSafeFixes": { level: "NONE", reason: "dry-run preview only; APPLYING fixes is permission-gated" },
  // Oracle configuration metadata reads (writes/tests/drivers are trusted/gated above them).
  "oracle:availability": { level: "NONE", reason: "feature availability probe" },
  "oracle:profiles:list": { level: "NONE", reason: "connection-profile names/metadata read" },
  "oracle:profiles:get": { level: "NONE", reason: "single connection-profile metadata read" },
  "oracle:dataSources:list": { level: "NONE", reason: "registered oracle data-source list" },
  "oracle:dataSources:get": { level: "NONE", reason: "single oracle data-source read" },
  "oracle:drivers:list": { level: "NONE", reason: "driver inventory read" },
  "oracle:drivers:get": { level: "NONE", reason: "driver detail read" },
  "oracle:drivers:usage": { level: "NONE", reason: "driver usage counts" },
  "oracle:java:list": { level: "NONE", reason: "java runtime inventory read" },
  "oracle:java:get": { level: "NONE", reason: "java runtime detail read" },
  "oracle:java:usage": { level: "NONE", reason: "java usage counts" },
  "system:capacityPreview": { level: "NONE", reason: "host capacity estimate for the run form" }
};

{
  // `assertSenderSuperUser` is the stricter session + permission gate used by sensitive export and
  // host-discovery handlers. Treating it as ungated made the verifier report two secured handlers as
  // contract violations while the production code correctly denied non-superusers.
  const PERM_TOKENS = ["assertSenderPermission(", "assertSenderSuperUser(", "authorize("];
  const handlerSlices: Array<{ channel: string; file: string; body: string }> = [];
  const HANDLE_RE = /ipcMain\.handle\(\s*"([^"]+)"/g;
  for (const file of readdirSync(IPC_DIR).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(IPC_DIR, file), "utf8");
    const positions = [...src.matchAll(HANDLE_RE)].map((m) => ({ name: m[1], idx: m.index }));
    for (let i = 0; i < positions.length; i += 1) {
      const end = i + 1 < positions.length ? positions[i + 1].idx : src.length;
      handlerSlices.push({ channel: positions[i].name, file, body: src.slice(positions[i].idx, end) });
    }
  }

  const cardinalityFloor = 150;
  check("the authz scan saw the full registration set", handlerSlices.length >= cardinalityFloor, `${handlerSlices.length} handlers scanned`);

  // "NONE" belongs in the return type: it is one of the two levels `AUTHZ_REGISTRY` can declare, and
  // the check below reads "declares NONE/TRUSTED or enforces a permission". Omitting it made the
  // annotation contradict both the registry and the assertion it feeds.
  const classify = ({ channel, body }: { channel: string; body: string }): "PERMISSION" | "TRUSTED" | "NONE" | undefined => {
    if (PERM_TOKENS.some((t) => body.includes(t))) return "PERMISSION";
    // An explicit trusted-sender check IS a declared TRUSTED level.
    if (body.includes("assertTrustedSender")) return "TRUSTED";
    return AUTHZ_REGISTRY[channel]?.level;
  };

  const ungatedUndeclared = handlerSlices
    .filter(({ channel, body }) => classify({ channel, body }) === undefined)
    .map(({ channel }) => channel)
    .sort();

  check(
    "every registered channel declares NONE/TRUSTED or enforces a permission",
    ungatedUndeclared.length === 0,
    ungatedUndeclared.join(", ")
  );

  const declaredButGated = handlerSlices
    .filter(({ channel, body }) => AUTHZ_REGISTRY[channel] && PERM_TOKENS.some((t) => body.includes(t)))
    .map(({ channel }) => channel)
    .sort();
  check(
    "no channel is BOTH permission-gated and declared open/trusted (registry must match code)",
    declaredButGated.length === 0,
    declaredButGated.join(", ")
  );

  const staleRegistry = Object.keys(AUTHZ_REGISTRY).filter((c) => !handlerSlices.some(({ channel }) => channel === c)).sort();
  check("AUTHZ_REGISTRY has no stale entries", staleRegistry.length === 0, staleRegistry.join(", "));
}

const passed = results.filter((r) => r.pass).length;
console.log(
  `\nIPC contract: ${passed}/${results.length} checks passed ` +
    `(${registered.size} handlers, ${invoked.size} exposed, ${BACKEND_ONLY.size} backend-only).`
);
process.exit(passed === results.length ? 0 : 1);
