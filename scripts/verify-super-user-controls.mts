/**
 * Responsible-layer gate for the Super-User roadmap/debug/session foundation.
 * Regression trip: privileged permissions leak to Administrator, an IPC loses its sender gate,
 * debug output leaks canaries/grows unbounded, timeout policy loses validation, or embedded and
 * standalone roadmap derivations/UI sources diverge.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BUILTIN_ROLES, Permission } from "../src/security/authz/Permissions";
import {
  DEBUG_LOG_MAX_BYTES,
  DEBUG_LOG_MAX_FILES,
  DebugLogService
} from "../src/logging/DebugLogService";
import {
  DEFAULT_SESSION_INACTIVITY_MINUTES,
  MAX_SESSION_INACTIVITY_MINUTES,
  MIN_SESSION_INACTIVITY_MINUTES,
  isValidSessionInactivityMinutes
} from "../src/security/session/SessionPolicy";
import { DEFAULT_SESSION_POLICY, SessionManager } from "../src/security/session/SessionManager";
import { InstalledChromeResolver } from "../src/session/InstalledChromeResolver";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = async (relative: string) => readFile(join(repo, relative), "utf8");

console.log("\nAuthorization:");
for (const permission of [
  Permission.PAGE_ROADMAP,
  Permission.DEBUG_MODE_MANAGE,
  Permission.DEBUG_LOG_VIEW,
  Permission.SESSION_POLICY_MANAGE
]) {
  check(`Super User holds ${permission}`, BUILTIN_ROLES.SuperUser.permissions.includes(permission));
  check(`Administrator is denied ${permission}`, !BUILTIN_ROLES.Administrator.permissions.includes(permission));
}
const [roadmapIpc, debugIpc, settingsIpc, routePermissions, securityKernelSource] = await Promise.all([
  source("app/main/ipc/roadmap.ipc.ts"),
  source("app/main/ipc/debug.ipc.ts"),
  source("app/main/ipc/settings.ipc.ts"),
  source("app/renderer/security/routePermissions.ts"),
  source("app/main/security/securityKernel.ts")
]);
check("roadmap IPC requires PAGE_ROADMAP", roadmapIpc.includes("assertSenderPermission(event, Permission.PAGE_ROADMAP"));
check("debug log IPC requires DEBUG_LOG_VIEW", debugIpc.includes("assertSenderPermission(event, Permission.DEBUG_LOG_VIEW"));
check("debug mutation requires DEBUG_MODE_MANAGE", settingsIpc.includes("Permission.DEBUG_MODE_MANAGE"));
check("timeout mutation requires SESSION_POLICY_MANAGE", settingsIpc.includes("Permission.SESSION_POLICY_MANAGE"));
check("direct roadmap route uses PAGE_ROADMAP", routePermissions.includes("roadmap: Permission.PAGE_ROADMAP"));
check(
  "session startup policy is hydrated from the persisted Super User setting",
  securityKernelSource.includes("sessionInactivityMinutesToMs(settings.superUser.sessionInactivityMinutes)")
);

const [recorderIpc, executionIpc, debugBundleIpc, sessionContextSource, instanceManagerSource] = await Promise.all([
  source("app/main/ipc/recorder.ipc.ts"),
  source("app/main/ipc/execution.ipc.ts"),
  source("app/main/ipc/debug.ipc.ts"),
  source("app/main/security/sessionContext.ts"),
  source("src/instances/InstanceManager.ts")
]);
check("trusted Super User guard checks the exact built-in role", sessionContextSource.includes("isSuperUser(actor.user)"));
check("Recorder installed-Chrome IPC uses the exact Super User guard", recorderIpc.includes("assertSenderSuperUser(event"));
check("execution installed-Chrome IPC uses the exact Super User guard", executionIpc.includes("assertSenderSuperUser(event"));
check("diagnostic export IPC uses the exact Super User guard", debugBundleIpc.includes("assertSenderSuperUser(event"));
check("Recorder installed Chrome uses an AWKIT-owned profile", recorderIpc.includes('"profiles", "installed-chrome-recorder"'));
check(
  "run instances receive an AWKIT-owned per-instance Chrome profile",
  instanceManagerSource.includes('join(dirs.root, "profiles", `instance-${persistentProfileKey}`)')
);

console.log("\nInstalled Chrome resolution:");
const chromeRoot = await mkdtemp(join(tmpdir(), "awkit-chrome-resolver-"));
try {
  const configuredChrome = join(chromeRoot, "configured", "chrome.exe");
  await mkdir(dirname(configuredChrome), { recursive: true });
  await writeFile(configuredChrome, "test executable sentinel", "utf8");
  const configured = await new InstalledChromeResolver({}).resolve(configuredChrome);
  check("valid configured chrome.exe resolves explicitly", configured.available && configured.source === "configured");
  const invalid = await new InstalledChromeResolver({}).resolve(join(chromeRoot, "configured", "not-chrome.exe"));
  check("invalid configured path fails explicitly", !invalid.available && invalid.code === "CHROME_EXECUTABLE_INVALID");
  const unavailable = await new InstalledChromeResolver({}).resolve();
  check("missing Chrome reports CHROME_UNAVAILABLE without fallback", !unavailable.available && unavailable.code === "CHROME_UNAVAILABLE");

  const discoveredChrome = join(chromeRoot, "Google", "Chrome", "Application", "chrome.exe");
  await mkdir(dirname(discoveredChrome), { recursive: true });
  await writeFile(discoveredChrome, "test executable sentinel", "utf8");
  const discovered = await new InstalledChromeResolver({ LOCALAPPDATA: chromeRoot }).resolve();
  check("Chrome discovery checks supported local installation roots", discovered.available && discovered.source === "discovered");
} finally {
  await rm(chromeRoot, { recursive: true, force: true });
}

console.log("\nSession policy:");
check("compatibility default remains 30 minutes", DEFAULT_SESSION_INACTIVITY_MINUTES === 30);
check("lower bound is accepted", isValidSessionInactivityMinutes(MIN_SESSION_INACTIVITY_MINUTES));
check("upper bound is accepted", isValidSessionInactivityMinutes(MAX_SESSION_INACTIVITY_MINUTES));
for (const invalid of [0, -1, 1.5, NaN, Infinity, MAX_SESSION_INACTIVITY_MINUTES + 1, "30"]) {
  check(`invalid timeout ${String(invalid)} is rejected`, !isValidSessionInactivityMinutes(invalid));
}

let clockMs = Date.parse("2026-08-08T12:00:00.000Z");
const sessionRows = new Map<string, any>();
const sessionStore = {
  insertSession: async (session: any) => { sessionRows.set(session.id, { ...session }); },
  getSession: (id: string) => sessionRows.get(id),
  touchSession: async (id: string, at: string) => { const row = sessionRows.get(id); if (row) row.lastActivityAt = at; },
  revokeSession: async (id: string, at: string) => { const row = sessionRows.get(id); if (row) row.revokedAt = at; },
  revokeSessionsForUser: async () => undefined,
  revokeSessionsForUserExcept: async () => undefined,
  touchReauth: async () => undefined
};
const sessions = new SessionManager(sessionStore as never, DEFAULT_SESSION_POLICY, () => clockMs);
check("SessionManager compatibility policy is 30 minutes", sessions.idleTimeoutMs === 30 * 60_000);
sessions.setIdleTimeoutMs(2 * 60_000);
const activeSession = await sessions.create("super-user");
clockMs += 90_000;
check("meaningful validation activity keeps a configured session alive", (await sessions.validate(activeSession)).valid);
clockMs += 90_000;
check("meaningful activity resets the configured idle window", (await sessions.validate(activeSession)).valid);
clockMs += 120_000;
check("background time without user validation expires at the configured boundary", !(await sessions.validate(activeSession)).valid);
check("configured timeout revokes the expired session", Boolean(sessionRows.get(activeSession)?.revokedAt));

console.log("\nStructured debug logs:");
const root = await mkdtemp(join(tmpdir(), "awkit-debug-"));
try {
  const logs = new DebugLogService(() => root, () => new Date("2026-08-08T12:00:00.000Z"));
  await logs.log("info", "off", "must-not-write");
  check("debug-off suppresses optional info logs", (await readdir(root)).length === 0);
  await logs.log("error", "application", "critical failure while debug is off", { password: "DebugOffSecret!" });
  const debugOffEntries = await logs.readEntries();
  check("critical errors persist even while optional debug mode is off", debugOffEntries.some((entry) => entry.level === "error"));
  check("debug-off critical errors are still redacted", !(await readFile(join(root, "debug.jsonl"), "utf8")).includes("DebugOffSecret!"));
  logs.setEnabled(true);
  const canaries = ["CanaryPassword-91!", "CanaryOtp-824611", "CanaryBearer-XYZ", "CanaryCookie-ABC"];
  await Promise.all([
    logs.log("info", "application", "started"),
    logs.log("warn", "recorder", "warning"),
    logs.log("error", "runner", "failure"),
    logs.log("fatal", "application", "fatal condition"),
    logs.log("info", "redaction", "authorization: Bearer CanaryBearer-XYZ", {
      password: canaries[0],
      otp: canaries[1],
      cookie: canaries[3],
      url: "https://example.invalid/path?token=CanaryBearer-XYZ#private"
    })
  ]);
  const entries = await logs.readEntries();
  for (const level of ["info", "warn", "error", "fatal"] as const) {
    check(`${level} entry is persisted`, entries.some((entry) => entry.level === level));
  }
  const initialText = (await Promise.all((await readdir(root)).map((name) => readFile(join(root, name), "utf8")))).join("\n");
  for (const canary of canaries) check(`redaction removes ${canary}`, !initialText.includes(canary));

  const payload = "x".repeat(60_000);
  for (let index = 0; index < 110; index += 1) await logs.log("info", "rotation", payload, { index });
  await logs.flush();
  const files = (await readdir(root)).filter((name) => /^debug(?:\.\d+)?\.jsonl$/.test(name));
  check("retention keeps a bounded file count", files.length <= DEBUG_LOG_MAX_FILES, files.join(", "));
  const sizes = await Promise.all(files.map((name) => stat(join(root, name)).then((value) => value.size)));
  check("every retained file stays within the size bound", sizes.every((size) => size <= DEBUG_LOG_MAX_BYTES), sizes.join(", "));
  const sizeBeforeOff = sizes.reduce((sum, size) => sum + size, 0);
  logs.setEnabled(false);
  await logs.log("info", "off", "must-not-append");
  const sizeAfterOff = (
    await Promise.all(files.map((name) => stat(join(root, name)).then((value) => value.size).catch(() => 0)))
  ).reduce((sum, size) => sum + size, 0);
  check("disabling debug stops optional log writes", sizeAfterOff === sizeBeforeOff);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("\nRoadmap parity and embedding:");
const model = (await import(pathToFileURL(join(repo, "tools/roadmap/lib/model.mjs")).href)) as {
  buildSnapshot: () => Record<string, any>;
};
const live = model.buildSnapshot();
const embedded = JSON.parse(await source("resources/embedded-roadmap-snapshot.json")) as Record<string, any>;
check("embedded and standalone use the same record count", embedded.stats.items === live.stats.items);
check("embedded and standalone use the same ledger tally", JSON.stringify(embedded.ledger.tally) === JSON.stringify(live.ledger.tally));
check("embedded and standalone agree on source consistency", embedded.consistency.agrees === live.consistency.agrees);
const [embeddedPage, standaloneHtml, sharedCss] = await Promise.all([
  source("app/renderer/pages/ImplementationRoadmap.tsx"),
  source("tools/roadmap/public/index.html"),
  source("tools/roadmap/public/dashboard.css")
]);
check("embedded page imports the exact standalone view registry", embeddedPage.includes('tools/roadmap/public/views.js'));
check("Generate is absent from embedded page", !embeddedPage.includes("Generate next portable EXE"));
check("Generate remains present in standalone dashboard", standaloneHtml.includes("Generate next portable EXE"));
check("standalone-only shell overrides are scoped", sharedCss.includes("html[data-roadmap-standalone]"));
check("packaged fallback does not use localhost", !(await source("app/main/roadmapSnapshotService.ts")).includes("127.0.0.1"));

console.log(`\nverify:super-user-controls — ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
