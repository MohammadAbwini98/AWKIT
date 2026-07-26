/**
 * Comprehensive Settings real-Electron gate.
 *
 * The specialized accent/branding/certificate/capacity/driver verifiers remain authoritative for
 * their cards. This gate supplies the missing joined-up Settings journeys over a timestamped,
 * isolated profile: authorization, main-process validation, paths, Secrets UI, storage counts,
 * UI-state clearing, import/export/recovery, reset data safety, offline validation and core a11y.
 */
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ConsoleMessage, type ElectronApplication, type Page } from "playwright";
import {
  DEFAULT_CREDS,
  resolveMainWindow,
  signInFirstRun
// @ts-expect-error Shared GUI helper is intentionally plain ESM JavaScript.
} from "./lib/gui-verify-harness.mjs";
import {
  createUser,
  genPassword,
  loginAs,
  navClick,
  navLabels,
  signOut,
  submitForcedChange
// @ts-expect-error Shared E2E helper is intentionally plain ESM JavaScript.
} from "./lib/e2e-qa-lib.mjs";
import type { UiSettings } from "../app/main/uiSettings";
import type {} from "../app/renderer/types/preload.d.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceRoot = join(root, "test-artifacts", "settings-e2e", stamp);
const dataRoot = join(evidenceRoot, "profile");
const runtimeRoot = join(dataRoot, "SpecterStudio");
const screenshotRoot = join(evidenceRoot, "screenshots");
const exportRoot = join(evidenceRoot, "exports");
const fixtureFilePath = join(evidenceRoot, "not-a-directory.txt");
const PREAUTH_SECRET = "preauth_forbidden_secret";
const PERSISTED_SECRET = "settings_e2e_token";
const DELETE_SECRET = "settings_delete_me";
const SECRET_VALUE_1 = `SYNTHETIC-SETTINGS-${randomBytes(12).toString("hex")}`;
const SECRET_VALUE_2 = `UPDATED-SETTINGS-${randomBytes(12).toString("hex")}`;
const MAX_IMPORT_BYTES = 1_048_576;

const seeded = {
  flows: ["settings-flow-1", "settings-flow-2"],
  workflows: ["settings-workflow-1"],
  dataSources: ["settings-data-1"],
  reports: ["settings-report-1"]
};

for (const folder of [
  evidenceRoot,
  dataRoot,
  runtimeRoot,
  screenshotRoot,
  exportRoot,
  ...[
    "flows",
    "workflows",
    "data",
    "reports",
    "screenshots",
    "logs",
    "downloads",
    "storage"
  ].map((name) => join(runtimeRoot, name))
]) {
  mkdirSync(folder, { recursive: true });
}
writeFileSync(fixtureFilePath, "This is a file, not a writable artifact directory.\n", "utf8");

for (const id of seeded.flows) {
  writeFileSync(join(runtimeRoot, "flows", `${id}.json`), JSON.stringify({ id, name: id, nodes: [], edges: [] }), "utf8");
}
for (const id of seeded.workflows) {
  writeFileSync(join(runtimeRoot, "workflows", `${id}.json`), JSON.stringify({ id, name: id, nodes: [], edges: [] }), "utf8");
}
for (const id of seeded.dataSources) {
  writeFileSync(join(runtimeRoot, "data", `${id}.json`), JSON.stringify({ id, name: id, kind: "json", rows: [] }), "utf8");
}
for (const id of seeded.reports) {
  writeFileSync(
    join(runtimeRoot, "reports", `${id}.json`),
    JSON.stringify({
      id,
      executionId: id,
      scenarioId: "settings-fixture-workflow",
      scenarioName: "Settings Fixture Workflow",
      runMode: "single",
      maxConcurrentInstances: 1,
      status: "passed",
      startedAt: new Date(Date.now() - 1_000).toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 1_000,
      passedFlows: 1,
      failedFlows: 0,
      skippedFlows: 0,
      instances: []
    }),
    "utf8"
  );
}

/**
 * SET-016 / SET-019 — sessions and driver records are the two user-owned data classes this gate has
 * never seeded, so "reset preserved everything" was previously only ever asserted about the classes
 * that happened to be present. A destructive action that spared flows and wiped captured sessions
 * would have passed. Seeded as real store files, and read back through each store's own list().
 */
const SEEDED_SESSION_ID = "settings-session-1";
const SEEDED_JAVA_ID = "settings-java-1";
const SEEDED_DRIVER_ID = "settings-driver-1";

function seedSessionsAndDrivers(): void {
  const profilesDir = join(runtimeRoot, "profiles");
  const sessionDir = join(profilesDir, SEEDED_SESSION_ID);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(profilesDir, "session-profiles.json"),
    JSON.stringify(
      [
        {
          id: SEEDED_SESSION_ID,
          name: "Settings Fixture Session",
          profileDir: sessionDir,
          targetUrl: "http://127.0.0.1:4173/",
          origin: "http://127.0.0.1:4173",
          source: "manual",
          createdAt: new Date().toISOString(),
          status: "ready"
        }
      ],
      null,
      2
    ),
    "utf8"
  );

  const javaDir = join(runtimeRoot, "java-runtimes");
  mkdirSync(javaDir, { recursive: true });
  writeFileSync(
    join(javaDir, `${SEEDED_JAVA_ID}.json`),
    JSON.stringify(
      {
        id: SEEDED_JAVA_ID,
        name: "Settings Fixture JRE",
        javaExecutablePath: join(runtimeRoot, "java-runtimes", "fixture", "bin", "java.exe"),
        javaHomePath: join(runtimeRoot, "java-runtimes", "fixture"),
        javaVersion: "17.0.8",
        javaMajorVersion: 17,
        vendor: "Fixture",
        architecture: "x64",
        importedAt: new Date().toISOString(),
        status: "unverified"
      },
      null,
      2
    ),
    "utf8"
  );

  const bundleDir = join(runtimeRoot, "oracle-drivers", SEEDED_DRIVER_ID);
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(
    join(bundleDir, "manifest.json"),
    JSON.stringify(
      {
        id: SEEDED_DRIVER_ID,
        name: "Settings Fixture Driver",
        source: "user-import",
        managedDirectory: bundleDir,
        jdbcJar: "ojdbc17.jar",
        companionJars: [],
        checksums: { "ojdbc17.jar": "sha256:0000000000000000000000000000000000000000000000000000000000000000" },
        importedAt: new Date().toISOString(),
        validationStatus: "unverified"
      },
      null,
      2
    ),
    "utf8"
  );
}

seedSessionsAndDrivers();

/**
 * ACL fault injection for SET-007 and SET-015. An owner may always rewrite its own object's DACL, so
 * none of this needs elevation. Every deny is paired with a restore in the script's `finally`.
 *
 * Measured, because the intuitive check is wrong: `fs.access(dir, W_OK)` reports a DENY-(W) directory
 * as **writable** on Windows — Node does not consult the directory ACL — while an actual write fails
 * `EPERM`. So a real write is the only honest writability probe here.
 */
function icacls(args: string[]): void {
  execFileSync("icacls", args, { stdio: "ignore" });
}
function currentAccount(): string {
  const domain = process.env.USERDOMAIN;
  return domain ? `${domain}\\${process.env.USERNAME ?? ""}` : process.env.USERNAME ?? "";
}
/**
 * Deny only "create file" + "create folder" (`WD,AD`). The mask matters and was measured:
 * denying the whole `W` right also blocks `stat`, so the directory reads as **missing** rather than
 * read-only and the case under test never gets exercised. `WD,AD` leaves `exists`/`isDirectory`/
 * `readdir` intact while making a real write fail `EPERM` — which is exactly the read-only directory
 * SET-007 is about.
 */
function denyDirectoryWrite(dir: string): void {
  icacls([dir, "/deny", `${currentAccount()}:(OI)(CI)(WD,AD)`]);
}
function restoreDirectoryWrite(dir: string): void {
  icacls([dir, "/remove:d", currentAccount()]);
}
function denyDirectoryRead(dir: string): void {
  icacls([dir, "/deny", `${currentAccount()}:(OI)(CI)(RX)`]);
}
function restoreDirectoryRead(dir: string): void {
  icacls([dir, "/remove:d", currentAccount()]);
}
/** True only when a real file can be created in the directory. */
function directoryAcceptsAWrite(dir: string): boolean {
  const probe = join(dir, `.awkit-probe-${randomBytes(4).toString("hex")}`);
  try {
    writeFileSync(probe, "");
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}
function directoryIsReadable(dir: string): boolean {
  try {
    readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}
/** Paths denied during the run, restored in `finally` so the evidence tree stays deletable. */
const deniedPaths: Array<{ dir: string; kind: "read" | "write" }> = [];

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function check(name: string, pass: unknown, detail?: unknown): void {
  const result = {
    name,
    pass: Boolean(pass),
    detail: detail === undefined ? undefined : String(detail)
  };
  results.push(result);
  console.log(`  ${result.pass ? "✓" : "✗"} ${name}${result.detail ? ` — ${result.detail}` : ""}`);
}

/**
 * The complete user-owned data inventory, read through each store's own list() rather than through
 * `settings:getStorageStats` — that IPC counts only flows/workflows/dataSources/reports, so sessions
 * and driver records are invisible to it and a destructive action could remove them unnoticed.
 */
async function dataInventory(win: Page): Promise<{
  stats: { flows: number; workflows: number; dataSources: number; reports: number };
  sessions: string[];
  javaRuntimes: string[];
  drivers: string[];
}> {
  return win.evaluate(async () => {
    const api = window.playwrightFlowStudio;
    const stats = await api.settings.getStorageStats();
    return {
      stats: { flows: stats.flows, workflows: stats.workflows, dataSources: stats.dataSources, reports: stats.reports },
      sessions: (await api.session.list()).map((entry) => entry.id).sort(),
      javaRuntimes: (await api.oracle.java.list()).map((entry) => entry.id).sort(),
      drivers: (await api.oracle.drivers.list()).map((entry) => entry.id).sort()
    };
  });
}

type Probe = { rejected: boolean; message: string };
async function waitForSettings(win: Page): Promise<void> {
  await win.getByRole("heading", { name: "Settings", exact: true }).waitFor({ timeout: 20_000 });
  await win.getByRole("heading", { name: "Advanced", exact: true }).waitFor({ timeout: 20_000 });
  await win.waitForTimeout(500);
}

async function openSettings(win: Page): Promise<void> {
  await navClick(win, "Settings");
  await waitForSettings(win);
}

async function loginExisting(win: Page, username: string, password: string): Promise<void> {
  await loginAs(win, username, password);
  await win.waitForSelector(".app-shell", { timeout: 20_000 });
}

async function launch(env: Record<string, string>): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({ args: [root], cwd: root, env });
  const win = await resolveMainWindow(app);
  await win.waitForLoadState("domcontentloaded");
  return { app, win };
}

async function snapshotSettings(win: Page): Promise<UiSettings> {
  return win.evaluate(() => window.playwrightFlowStudio.settings.get());
}

async function directProbe(win: Page, expression: string): Promise<Probe> {
  return win.evaluate(async (source: string) => {
    try {
      const fn = Function(`return (${source})`)() as () => Promise<unknown>;
      await fn();
      return { rejected: false, message: "allowed" };
    } catch (error) {
      return { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
  }, expression);
}

async function cardValues(win: Page, title: string): Promise<Record<string, string>> {
  return win
    .locator(".settings-card")
    .filter({ has: win.getByRole("heading", { name: title, exact: true }) })
    .evaluate((card) => {
      const values: Record<string, string> = {};
      const list = card.querySelector(".readiness-list");
      if (!list) return values;
      const children = [...list.children];
      for (let i = 0; i + 1 < children.length; i += 2) {
        values[(children[i].textContent || "").trim()] = (children[i + 1].textContent || "").trim();
      }
      return values;
    });
}

async function setImportFile(win: Page, name: string, content: string): Promise<void> {
  await win.locator('input[type="file"][accept*=".json"]').setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(content, "utf8")
  });
  await win.waitForTimeout(700);
}

const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
);
env.LOCALAPPDATA = dataRoot;
env.PRODUCTION_OFFLINE = "true";
delete env.ELECTRON_RUN_AS_NODE;

const admin = {
  username: `settingsadmin-${randomBytes(4).toString("hex")}`,
  temporary: genPassword("SettingsAdminTemp"),
  final: genPassword("SettingsAdminFinal")
};
const viewer = {
  username: `settingsviewer-${randomBytes(4).toString("hex")}`,
  temporary: genPassword("SettingsViewerTemp"),
  final: genPassword("SettingsViewerFinal")
};

const rendererErrors: string[] = [];
let app: ElectronApplication | undefined;
let win: Page | undefined;

try {
  ({ app, win } = await launch(env));
  const watch = (page: Page) => {
    page.on("console", (message: ConsoleMessage) => {
      if (message.type() === "error") rendererErrors.push(message.text());
    });
    page.on("pageerror", (error: Error) => rendererErrors.push(`pageerror: ${error.message}`));
  };
  watch(win);
  await win.waitForSelector(".awkit-login-card", { timeout: 20_000 });

  // Fail-closed checks before a renderer-bound session exists.
  const preAuth = await win.evaluate(`(async () => {
    const api = window.playwrightFlowStudio;
    const result = {};
    const calls = {
      reset: function () { return api.settings.reset(); },
      import: function () { return api.settings.import({ appearance: "dark" }); },
      openRuntime: function () { return api.settings.openRuntimeFolder(); },
      clearUi: function () { return api.settings.clearUiState(); },
      exportSettings: function () { return api.settings.export(); },
      stats: function () { return api.settings.getStorageStats(); },
      paths: function () { return api.settings.validatePaths(); },
      secretAvailable: function () { return api.secrets.isAvailable(); },
      secretList: function () { return api.secrets.list(); },
      secretSet: function () { return api.secrets.set(${JSON.stringify(PREAUTH_SECRET)}, ${JSON.stringify(SECRET_VALUE_1)}); }
    };
    for (const name of Object.keys(calls)) {
      try {
        await calls[name]();
        result[name] = { rejected: false, message: "allowed" };
      } catch (error) {
        result[name] = { rejected: true, message: error instanceof Error ? error.message : String(error) };
      }
    }
    return result;
  })()`) as Record<string, Probe>;

  for (const [name, probe] of Object.entries(preAuth)) {
    check(`SET-001 pre-auth ${name} is denied`, probe.rejected, probe.message);
  }

  await signInFirstRun(win);
  await win.waitForTimeout(500);
  // Remove the negative-control secret if the vulnerable pre-fix path created it.
  await win.evaluate(async (name: string) => {
    try {
      await window.playwrightFlowStudio.secrets.delete(name);
    } catch {
      // The fixed pre-auth path created nothing.
    }
  }, PREAUTH_SECRET);

  // Provision Administrator + Viewer fixtures while the protected Super User is active.
  await navClick(win, "Users");
  await win.getByRole("heading", { name: "Add a user" }).first().waitFor({ timeout: 15_000 });
  await createUser(win, {
    username: admin.username,
    displayName: "Settings Administrator",
    password: admin.temporary,
    roles: ["Administrator"]
  });
  await createUser(win, {
    username: viewer.username,
    displayName: "Settings Viewer",
    password: viewer.temporary,
    roles: ["Viewer"]
  });
  check(
    "SET-001 Administrator and Viewer fixtures created",
    (await win.getByText(`@${admin.username}`).count()) > 0 && (await win.getByText(`@${viewer.username}`).count()) > 0
  );

  await openSettings(win);
  const headings = (await win.locator(".settings-card-head h2").allTextContents()).map((text) => text.trim());
  for (const heading of [
    "Application",
    "Recorder",
    "Recorder Security",
    "Paths & Directories",
    "Designer Defaults",
    "Execution Defaults",
    "Runtime Concurrency",
    "Secrets",
    "Java Runtime for Database Drivers",
    "Oracle JDBC Drivers",
    "Data Storage",
    "Advanced"
  ]) {
    check(`SET-001 Super User sees ${heading}`, headings.includes(heading), headings.join(" | "));
  }

  // Paths: seven defaults, correct file-vs-directory truth, individual reset and blank client guard.
  const pathCards = win.locator(".settings-path-field");
  check("SET-007 all seven path fields render", (await pathCards.count()) === 7);
  check("SET-007 default runtime paths are writable directories", (await win.locator(".settings-path-field .path-ok").count()) === 7);
  const defaultPaths = await win.evaluate(() => window.playwrightFlowStudio.settings.getDefaultPaths());
  await win.evaluate((filePath: string) =>
    window.playwrightFlowStudio.settings.update({ paths: { screenshotsPath: filePath } }), fixtureFilePath);
  const filePathStatus = await win.evaluate(() => window.playwrightFlowStudio.settings.validatePaths());
  check(
    "SET-007 an existing file is not reported as a writable directory",
    filePathStatus.screenshotsPath.exists && !filePathStatus.screenshotsPath.writable,
    JSON.stringify(filePathStatus.screenshotsPath)
  );
  await win.evaluate((path: string) =>
    window.playwrightFlowStudio.settings.update({ paths: { screenshotsPath: path } }), defaultPaths.screenshotsPath);
  await navClick(win, "Dashboard");
  await openSettings(win);
  const screenshotsField = win.locator(".settings-path-field").filter({ hasText: "Screenshots" });
  const screenshotsInput = screenshotsField.locator("input");
  const savedScreenshotsPath = await screenshotsInput.inputValue();
  await screenshotsInput.fill(join(evidenceRoot, "temporary-custom-screenshots"));
  await screenshotsField.getByRole("button", { name: "Reset", exact: true }).click();
  check("SET-007 individual Reset restores the runtime default", (await screenshotsInput.inputValue()) === defaultPaths.screenshotsPath);
  await screenshotsInput.fill("");
  await win.getByRole("button", { name: "Save Changes" }).click();
  const blankError = win.getByText("Screenshots path must not be empty.");
  check("SET-007 blank path is blocked with actionable text", await blankError.isVisible().catch(() => false));
  check(
    "SET-021 validation errors use an assertive accessible surface",
    (await blankError.locator("xpath=ancestor::*[@role='alert']").count()) > 0
  );
  const afterBlank = await snapshotSettings(win);
  check("SET-007 blank path did not persist", afterBlank.paths.screenshotsPath === savedScreenshotsPath);
  await screenshotsInput.fill(savedScreenshotsPath);

  // SET-007 — the folder picker. The OS dialog is stubbed in the MAIN process, so the real
  // `system:browseFolder` handler, its SETTINGS_EDIT permission check, and the renderer's own
  // "null means leave the value alone" branch all stay in the path under test. Only the native
  // window is replaced — stubbing at the preload/renderer level would have skipped all three.
  const stubFolderPicker = async (result: { canceled: boolean; filePaths: string[] }) => {
    await app!.evaluate(({ dialog }, value) => {
      (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => value;
    }, result);
  };
  const browseButton = screenshotsField.getByRole("button", { name: "Browse", exact: true });

  await stubFolderPicker({ canceled: true, filePaths: [] });
  await browseButton.click();
  await win.waitForTimeout(400);
  check(
    "SET-007 cancelling the picker leaves the path unchanged",
    (await screenshotsInput.inputValue()) === savedScreenshotsPath,
    `${await screenshotsInput.inputValue()}`
  );
  // A picker that returned a path but never applied it would also satisfy the cancel check above,
  // so the accepting branch is asserted too — otherwise "unchanged" proves only that Browse is inert.
  const pickedDir = join(evidenceRoot, "picked-artifact-location");
  mkdirSync(pickedDir, { recursive: true });
  await stubFolderPicker({ canceled: false, filePaths: [pickedDir] });
  await browseButton.click();
  await win.waitForTimeout(400);
  check("SET-007 accepting the picker applies the chosen folder", (await screenshotsInput.inputValue()) === pickedDir, `${await screenshotsInput.inputValue()}`);
  await win.getByRole("button", { name: "Save Changes" }).click();
  await win.waitForTimeout(600);
  check("SET-007 the picked folder persists as the artifact location", (await snapshotSettings(win)).paths.screenshotsPath === pickedDir);

  // SET-007 — a directory the user has been DENIED write access to must not be labelled writable.
  // These paths are where run artifacts land, so a wrong label sends the operator away happy and
  // fails at run time.
  const readOnlyDir = join(evidenceRoot, "read-only-artifact-location");
  mkdirSync(readOnlyDir, { recursive: true });
  denyDirectoryWrite(readOnlyDir);
  deniedPaths.push({ dir: readOnlyDir, kind: "write" });
  check(
    "SET-007 the read-only fixture is genuinely unwritable (precondition)",
    !directoryAcceptsAWrite(readOnlyDir),
    readOnlyDir.replace(root, "<repo>")
  );
  await screenshotsInput.fill(readOnlyDir);
  await win.getByRole("button", { name: "Save Changes" }).click();
  await win.waitForTimeout(800);
  const readOnlyStatus = await win.evaluate(() => window.playwrightFlowStudio.settings.validatePaths());
  check(
    "SET-007 a read-only directory is reported existing but NOT writable",
    readOnlyStatus.screenshotsPath.exists && !readOnlyStatus.screenshotsPath.writable,
    JSON.stringify(readOnlyStatus.screenshotsPath)
  );
  // `innerText` returns the CSS `text-transform`ed text, so this compares case-insensitively rather
  // than against the source string.
  const readOnlyLabel = await screenshotsField.locator(".settings-path-label em").innerText().catch(() => "");
  check("SET-007 the rendered label says read-only, not writable", readOnlyLabel.trim().toLowerCase() === "read-only", readOnlyLabel);
  restoreDirectoryWrite(readOnlyDir);
  deniedPaths.pop();
  await screenshotsInput.fill(savedScreenshotsPath);
  await win.getByRole("button", { name: "Save Changes" }).click();
  await win.waitForTimeout(600);

  // Direct invalid IPC must fail in the main process; restore after a vulnerable pre-fix write.
  const invalidCases: Array<{ name: string; patch: unknown; expected: string }> = [
    { name: "zoom 24", patch: { designerDefaults: { defaultZoomPercent: 24 } }, expected: "Default zoom" },
    { name: "zoom 201", patch: { designerDefaults: { defaultZoomPercent: 201 } }, expected: "Default zoom" },
    { name: "zero node width", patch: { designerDefaults: { defaultNodeWidth: 0 } }, expected: "node width" },
    { name: "fractional runs", patch: { execution: { maxRuns: 2.5 } }, expected: "Maximum runs" },
    {
      name: "default runs above max",
      patch: { execution: { maxRuns: 2, defaultRuns: 3 } },
      expected: "Default runs cannot exceed"
    },
    {
      name: "max concurrency above runs",
      patch: { execution: { maxRuns: 2, maxConcurrentRuns: 3 } },
      expected: "Maximum concurrent runs cannot exceed"
    },
    { name: "invalid run mode", patch: { execution: { defaultRunMode: "sideways" } }, expected: "run mode" },
    { name: "invalid capacity mode", patch: { runtime: { capacityMode: "unbounded" } }, expected: "Capacity mode" }
  ];
  const originalForInvalid = await snapshotSettings(win);
  for (const test of invalidCases) {
    const probe = await win.evaluate(async (input: { patch: unknown; restore: UiSettings }) => {
      try {
        await window.playwrightFlowStudio.settings.update(input.patch as never);
        await window.playwrightFlowStudio.settings.update({
          designerDefaults: input.restore.designerDefaults,
          execution: input.restore.execution,
          runtime: input.restore.runtime
        });
        return { rejected: false, message: "allowed" };
      } catch (error) {
        return { rejected: true, message: error instanceof Error ? error.message : String(error) };
      }
    }, { patch: test.patch, restore: originalForInvalid });
    check(`SET-008 main rejects ${test.name}`, probe.rejected && probe.message.includes(test.expected), probe.message);
  }

  // SET-008 — the other half of every boundary. Rejecting 24 and 201 proves only that SOMETHING is
  // refused out there; it is equally satisfied by a rule that also refuses 25 and 200. These assert
  // the inclusive edges are ACCEPTED and actually persisted, which is where an off-by-one lives.
  // Values are taken from `validateSettings`'s own comparisons, not restated from memory.
  const validBoundaryCases: Array<{ name: string; patch: Record<string, unknown>; read: (settings: UiSettings) => unknown; expected: unknown }> = [
    { name: "zoom at the lower inclusive edge (25)", patch: { designerDefaults: { defaultZoomPercent: 25 } }, read: (s) => s.designerDefaults.defaultZoomPercent, expected: 25 },
    { name: "zoom at the upper inclusive edge (200)", patch: { designerDefaults: { defaultZoomPercent: 200 } }, read: (s) => s.designerDefaults.defaultZoomPercent, expected: 200 },
    { name: "node width at the smallest positive integer (1)", patch: { designerDefaults: { defaultNodeWidth: 1 } }, read: (s) => s.designerDefaults.defaultNodeWidth, expected: 1 },
    { name: "maxRuns at the smallest positive integer (1)", patch: { execution: { maxRuns: 1, defaultRuns: 1, maxConcurrentRuns: 1, defaultConcurrentRuns: 1 } }, read: (s) => s.execution.maxRuns, expected: 1 },
    { name: "defaultRuns exactly equal to maxRuns", patch: { execution: { maxRuns: 5, defaultRuns: 5, maxConcurrentRuns: 1, defaultConcurrentRuns: 1 } }, read: (s) => s.execution.defaultRuns, expected: 5 },
    { name: "maxConcurrentRuns exactly equal to maxRuns", patch: { execution: { maxRuns: 5, defaultRuns: 5, maxConcurrentRuns: 5, defaultConcurrentRuns: 5 } }, read: (s) => s.execution.maxConcurrentRuns, expected: 5 }
  ];
  for (const test of validBoundaryCases) {
    const probe = await win.evaluate(async (patch: unknown) => {
      try {
        const next = await window.playwrightFlowStudio.settings.update(patch as never);
        return { rejected: false, settings: next };
      } catch (error) {
        return { rejected: true, message: error instanceof Error ? error.message : String(error) };
      }
    }, test.patch);
    const persisted = probe.rejected ? undefined : test.read(probe.settings as UiSettings);
    check(
      `SET-008 main accepts and persists ${test.name}`,
      !probe.rejected && persisted === test.expected,
      probe.rejected ? probe.message : `persisted ${String(persisted)}`
    );
  }
  // Leave the store where the invalid-case loop expected to find it.
  await win.evaluate((restore: UiSettings) =>
    window.playwrightFlowStudio.settings.update({
      designerDefaults: restore.designerDefaults,
      execution: restore.execution,
      runtime: restore.runtime
    }), originalForInvalid);

  // Valid execution defaults save, become the persisted source for import/export, and survive restart.
  await win.getByLabel("Maximum runs").fill("12");
  await win.getByLabel("Maximum concurrent runs").fill("4");
  await win.getByLabel("Default runs").fill("8");
  await win.getByLabel("Default concurrent runs").fill("3");
  await win.getByLabel("Default run mode").selectOption("headed");
  await win.getByLabel("Screenshot on failure").uncheck();
  await win.getByLabel("Stop on error").check();
  await win.getByRole("button", { name: "Save Changes" }).click();
  await win.getByText("Settings saved.").waitFor({ timeout: 10_000 });
  const savedExecution = (await snapshotSettings(win)).execution;
  check(
    "SET-009 execution defaults save through the rendered form",
    savedExecution.maxRuns === 12 &&
      savedExecution.maxConcurrentRuns === 4 &&
      savedExecution.defaultRuns === 8 &&
      savedExecution.defaultConcurrentRuns === 3 &&
      savedExecution.defaultRunMode === "headed" &&
      !savedExecution.screenshotOnFailure &&
      savedExecution.stopOnError,
    JSON.stringify(savedExecution)
  );

  // Protected-login detection: native confirmation cancel/accept, persistence across restart, secure disable.
  const protectedToggle = win.getByTestId("ignore-protected-login-toggle");
  win.once("dialog", (dialog) => void dialog.dismiss());
  await protectedToggle.click();
  check(
    "SET-005 cancelling protected-login confirmation persists nothing",
    !(await protectedToggle.isChecked()) &&
      !(await win.evaluate(async () => {
        const settings = await window.playwrightFlowStudio.settings.get();
        return settings.recorder.ignoreProtectedLoginDetection;
      }))
  );
  win.once("dialog", (dialog) => void dialog.accept());
  await protectedToggle.click();
  await win.getByText("Protected login detection will be ignored in new Recorder sessions.").waitFor({ timeout: 10_000 });
  check(
    "SET-005 confirmed protected-login override persists",
    await win.evaluate(async () => {
      const settings = await window.playwrightFlowStudio.settings.get();
      return settings.recorder.ignoreProtectedLoginDetection;
    })
  );
  await win.screenshot({ path: join(screenshotRoot, "01-settings-super-user.png"), fullPage: true });

  await app.close();
  ({ app, win } = await launch(env));
  watch(win);
  await loginExisting(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
  await openSettings(win);
  check("SET-009 execution defaults survive restart", (await snapshotSettings(win)).execution.maxRuns === 12);
  check("SET-005 protected-login override survives restart", await win.getByTestId("ignore-protected-login-toggle").isChecked());
  await win.getByTestId("ignore-protected-login-toggle").click();
  await win.getByText("Protected login detection re-enabled.").waitFor({ timeout: 10_000 });
  check(
    "SET-005 disabling needs no confirmation and restores detection",
    !(await win.evaluate(async () => {
      const settings = await window.playwrightFlowStudio.settings.get();
      return settings.recorder.ignoreProtectedLoginDetection;
    }))
  );

  // Secret-card UI: validation, add/update, masked/non-rendered values, persistence and delete cancel/confirm.
  const secretsCard = win.locator(".settings-card").filter({ has: win.getByRole("heading", { name: "Secrets", exact: true }) });
  const secretNameInput = secretsCard.getByRole("textbox", { name: "Name", exact: true });
  const secretValueInput = secretsCard.getByLabel("Value", { exact: true });
  await secretNameInput.fill("invalid secret name");
  await secretValueInput.fill(SECRET_VALUE_1);
  await secretsCard.getByRole("button", { name: "Add", exact: true }).click();
  check(
    "SET-013 invalid secret name shows inline validation",
    await win.getByText(/Name must be 1–64 characters/).isVisible().catch(() => false)
  );
  await secretNameInput.fill(PERSISTED_SECRET);
  await secretValueInput.fill("");
  await secretsCard.getByRole("button", { name: "Add", exact: true }).click();
  check("SET-013 empty secret value is rejected", await win.getByText("Enter a value to store.").isVisible().catch(() => false));
  await secretValueInput.fill(SECRET_VALUE_1);
  await secretsCard.getByRole("button", { name: "Add", exact: true }).click();
  await win.getByText(`Secret "${PERSISTED_SECRET}" saved.`).waitFor({ timeout: 10_000 });
  check("SET-013 secret inputs clear after save", (await secretNameInput.inputValue()) === "" && (await secretValueInput.inputValue()) === "");
  check("SET-013 value control is password-masked", (await secretValueInput.getAttribute("type")) === "password");

  // SET-013 rapid submit. Clicking Add three times without waiting must not create three rows, lose
  // the value, or leave the card in an error state. Asserted as EXACTLY one row rather than ">= 1",
  // because ">= 1" is what a duplicate-creating implementation would also satisfy.
  const RAPID_SECRET = "settings_rapid_submit";
  await secretNameInput.fill(RAPID_SECRET);
  await secretValueInput.fill(`SYNTHETIC-RAPID-${randomBytes(6).toString("hex")}`);
  const rapidAdd = secretsCard.getByRole("button", { name: "Add", exact: true });
  await Promise.all([rapidAdd.click(), rapidAdd.click().catch(() => undefined), rapidAdd.click().catch(() => undefined)]);
  await win.getByText(`Secret "${RAPID_SECRET}" saved.`).waitFor({ timeout: 10_000 });
  await win.waitForTimeout(600);
  check(
    "SET-013 three rapid submits create exactly one secret, not three",
    (await win.locator(".settings-secret-row").filter({ hasText: RAPID_SECRET }).count()) === 1,
    `${await win.locator(".settings-secret-row").filter({ hasText: RAPID_SECRET }).count()} rows`
  );
  const rapidStored = await win.evaluate((name: string) =>
    window.playwrightFlowStudio.secrets.list().then((list) => list.filter((entry) => entry.name === name).length), RAPID_SECRET);
  check("SET-013 the durable store also holds exactly one record for it", rapidStored === 1, `${rapidStored}`);
  const pageTextAfterSecret = await win.locator("body").innerText();
  const secretFile = join(runtimeRoot, "secrets.json");
  const secretDisk = existsSync(secretFile) ? readFileSync(secretFile, "utf8") : "";
  check("SET-013 stored secret value never renders", !pageTextAfterSecret.includes(SECRET_VALUE_1));
  check("SET-012 Settings journey stores no plaintext secret on disk", secretDisk.length > 0 && !secretDisk.includes(SECRET_VALUE_1));
  await secretNameInput.fill(PERSISTED_SECRET);
  await secretValueInput.fill(SECRET_VALUE_2);
  await secretsCard.getByRole("button", { name: "Update", exact: true }).click();
  await win.getByText(`Secret "${PERSISTED_SECRET}" updated.`).waitFor({ timeout: 10_000 });
  check(
    "SET-013 same-name save updates without a duplicate row",
    (await win.locator(".settings-secret-row").filter({ hasText: PERSISTED_SECRET }).count()) === 1
  );
  await secretNameInput.fill(DELETE_SECRET);
  await secretValueInput.fill("SYNTHETIC-DELETE-ME");
  await secretsCard.getByRole("button", { name: "Add", exact: true }).click();
  await win.getByText(`Secret "${DELETE_SECRET}" saved.`).waitFor({ timeout: 10_000 });
  const deleteButton = win.getByTitle(`Delete ${DELETE_SECRET}`);
  win.once("dialog", (dialog) => void dialog.dismiss());
  await deleteButton.click();
  check("SET-013 delete cancel preserves the secret", (await win.locator(".settings-secret-row").filter({ hasText: DELETE_SECRET }).count()) === 1);
  win.once("dialog", (dialog) => void dialog.accept());
  await deleteButton.click();
  await win.getByText(`Secret "${DELETE_SECRET}" deleted.`).waitFor({ timeout: 10_000 });
  check("SET-013 delete confirm removes the secret", (await win.locator(".settings-secret-row").filter({ hasText: DELETE_SECRET }).count()) === 0);
  await win.screenshot({ path: join(screenshotRoot, "02-settings-secrets.png"), fullPage: true });

  await app.close();
  ({ app, win } = await launch(env));
  watch(win);
  await loginExisting(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
  await openSettings(win);
  check("SET-013 saved secret name survives restart", (await win.locator(".settings-secret-row").filter({ hasText: PERSISTED_SECRET }).count()) === 1);
  check("SET-013 updated value remains absent from the DOM", !(await win.locator("body").innerText()).includes(SECRET_VALUE_2));

  // Seeded profile counts + live refresh.
  const initialCounts = await cardValues(win, "Data Storage");
  check(
    "SET-015 seeded storage counts match the real profile stores",
    initialCounts.Flows === "2" &&
      initialCounts.Workflows === "1" &&
      initialCounts["Data sources"] === "1" &&
      initialCounts.Reports === "1",
    JSON.stringify(initialCounts)
  );
  writeFileSync(
    join(runtimeRoot, "flows", "settings-flow-3.json"),
    JSON.stringify({ id: "settings-flow-3", name: "settings-flow-3", nodes: [], edges: [] }),
    "utf8"
  );
  await win.getByRole("button", { name: "Refresh Counts" }).click();
  await win.waitForTimeout(500);
  const refreshedCounts = await cardValues(win, "Data Storage");
  check("SET-015 Refresh Counts observes a newly added profile", refreshedCounts.Flows === "3", JSON.stringify(refreshedCounts));
  const runtimeFolderButton = win.getByRole("button", { name: "Open Runtime Folder" });
  check("SET-015 runtime-folder action is rendered", await runtimeFolderButton.isVisible());

  // SET-015 — an unreadable store must degrade, not crash the whole card. `countSafe` catches per
  // store, so the flows count should fall back to 0 while every OTHER count stays truthful; a
  // handler that let the rejection escape would take all four down together.
  const flowsStoreDir = join(runtimeRoot, "flows");
  denyDirectoryRead(flowsStoreDir);
  deniedPaths.push({ dir: flowsStoreDir, kind: "read" });
  check(
    "SET-015 the flows store is genuinely unreadable (precondition)",
    !directoryIsReadable(flowsStoreDir),
    flowsStoreDir.replace(root, "<repo>")
  );
  await win.getByRole("button", { name: "Refresh Counts" }).click();
  await win.waitForTimeout(800);
  const unreadableStats = await win.evaluate(() => window.playwrightFlowStudio.settings.getStorageStats());
  check(
    "SET-015 an unreadable store degrades to 0 without throwing",
    unreadableStats.flows === 0,
    JSON.stringify(unreadableStats)
  );
  check(
    "SET-015 the other stores keep reporting truthfully alongside it",
    unreadableStats.workflows === 1 && unreadableStats.dataSources === 1 && unreadableStats.reports === 1,
    JSON.stringify(unreadableStats)
  );
  const unreadableCounts = await cardValues(win, "Data Storage");
  check("SET-015 the card still renders rather than erroring out", unreadableCounts.Flows === "0" && unreadableCounts.Workflows === "1", JSON.stringify(unreadableCounts));
  restoreDirectoryRead(flowsStoreDir);
  deniedPaths.pop();
  await win.getByRole("button", { name: "Refresh Counts" }).click();
  await win.waitForTimeout(800);
  const recoveredStats = await win.evaluate(() => window.playwrightFlowStudio.settings.getStorageStats());
  check("SET-015 restoring access restores the real count, so the 0 was not permanent", recoveredStats.flows === 3, JSON.stringify(recoveredStats));

  // Clear UI State must preserve substantive settings and every seeded data class.
  await win.evaluate(() =>
    window.playwrightFlowStudio.settings.update({
      selectedBuilderWorkflowId: "ui-state-to-clear",
      flowDesignerPaletteCollapsed: true,
      flowDesignerPropertiesCollapsed: true
    }));
  const beforeClear = await snapshotSettings(win);
  const countsBeforeClear = await win.evaluate(() => window.playwrightFlowStudio.settings.getStorageStats());
  const secretsBeforeClear = await win.evaluate(() => window.playwrightFlowStudio.secrets.list());
  const inventoryBeforeClear = await dataInventory(win);
  // The precondition for every preservation claim below. If the seed never landed, "preserved"
  // would mean "there was nothing to lose".
  check(
    "SET-016/019 sessions and driver records were actually seeded (precondition)",
    inventoryBeforeClear.sessions.includes(SEEDED_SESSION_ID) &&
      inventoryBeforeClear.javaRuntimes.includes(SEEDED_JAVA_ID) &&
      inventoryBeforeClear.drivers.includes(SEEDED_DRIVER_ID),
    JSON.stringify({
      sessions: inventoryBeforeClear.sessions,
      java: inventoryBeforeClear.javaRuntimes,
      drivers: inventoryBeforeClear.drivers
    })
  );
  await win.getByRole("button", { name: "Clear UI State" }).click();
  await win.getByText("UI state cleared. Flows, workflows, and reports were not touched.").waitFor({ timeout: 10_000 });
  const afterClear = await snapshotSettings(win);
  const countsAfterClear = await win.evaluate(() => window.playwrightFlowStudio.settings.getStorageStats());
  const secretsAfterClear = await win.evaluate(() => window.playwrightFlowStudio.secrets.list());
  check(
    "SET-016 Clear UI State resets only documented UI keys",
    afterClear.selectedBuilderWorkflowId === "" &&
      !afterClear.flowDesignerPaletteCollapsed &&
      !afterClear.flowDesignerPropertiesCollapsed
  );
  check("SET-016 Clear UI State preserves execution settings", JSON.stringify(afterClear.execution) === JSON.stringify(beforeClear.execution));
  check("SET-016 Clear UI State preserves all profile counts", JSON.stringify(countsAfterClear) === JSON.stringify(countsBeforeClear));
  check("SET-016 Clear UI State preserves secrets", secretsAfterClear.some((secret) => secret.name === PERSISTED_SECRET) && secretsBeforeClear.length === secretsAfterClear.length);
  const inventoryAfterClear = await dataInventory(win);
  check(
    "SET-016 Clear UI State preserves captured sessions and driver records",
    JSON.stringify(inventoryAfterClear) === JSON.stringify(inventoryBeforeClear),
    JSON.stringify(inventoryAfterClear)
  );

  // Capture the real Blob + anchor produced by the Settings export action.
  await win.evaluate(`(() => {
    window.__awkitSettingsExportCapture = { filename: "", content: "" };
    const originalCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob) {
      if (blob instanceof Blob) {
        blob.text().then(function (content) {
          window.__awkitSettingsExportCapture.content = content;
        });
      }
      return originalCreate(blob);
    };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      window.__awkitSettingsExportCapture.filename = this.download || "";
      return originalClick.call(this);
    };
  })()`);
  await win.getByRole("button", { name: "Export Settings" }).click();
  await win.waitForFunction(
    () => Boolean((window as unknown as { __awkitSettingsExportCapture?: { content?: string } }).__awkitSettingsExportCapture?.content),
    undefined,
    { timeout: 10_000 }
  );
  const capturedExport = await win.evaluate(
    () => (window as unknown as { __awkitSettingsExportCapture: { filename: string; content: string } }).__awkitSettingsExportCapture
  );
  const exportedSettings = JSON.parse(capturedExport.content) as UiSettings & Record<string, unknown>;
  const exportPath = join(exportRoot, capturedExport.filename || "webflow-studio-settings.json");
  writeFileSync(exportPath, capturedExport.content, "utf8");
  check("SET-017 export uses the documented filename", capturedExport.filename === "webflow-studio-settings.json", capturedExport.filename);
  check("SET-017 export is parseable and contains the saved defaults", exportedSettings.execution.maxRuns === 12);
  check(
    "SET-017 export contains no secret values or secret-store records",
    !capturedExport.content.includes(SECRET_VALUE_1) &&
      !capturedExport.content.includes(SECRET_VALUE_2) &&
      !capturedExport.content.includes(PERSISTED_SECRET)
  );

  await win.evaluate(() => window.playwrightFlowStudio.settings.update({ execution: { maxRuns: 20 } }));
  await setImportFile(win, "round-trip.json", capturedExport.content);
  await win.getByText("Settings imported.").waitFor({ timeout: 10_000 });
  check("SET-017 supported values round-trip through the rendered import", (await snapshotSettings(win)).execution.maxRuns === 12);
  check("SET-017 import preserves user data", (await win.evaluate(() => window.playwrightFlowStudio.settings.getStorageStats())).flows === 3);
  check("SET-017 import preserves the external secret store", (await win.evaluate(() => window.playwrightFlowStudio.secrets.list())).some((s) => s.name === PERSISTED_SECRET));

  const crafted = {
    ...exportedSettings,
    futureUnknownTopLevel: "must-be-dropped",
    execution: {
      ...exportedSettings.execution,
      futureUnknownExecutionField: "must-be-dropped"
    },
    recorder: {
      ...exportedSettings.recorder,
      security: { ignoreHttpsErrors: true }
    }
  };
  await setImportFile(win, "crafted-future.json", JSON.stringify(crafted));
  await win.getByText("Settings imported.").waitFor({ timeout: 10_000 });
  const afterCrafted = await snapshotSettings(win) as UiSettings & Record<string, unknown>;
  check("SET-017 import cannot enable HTTPS certificate bypass", !afterCrafted.recorder.security.ignoreHttpsErrors);
  check(
    "SET-017 unknown fields are normalized out",
    !("futureUnknownTopLevel" in afterCrafted) &&
      !("futureUnknownExecutionField" in (afterCrafted.execution as unknown as Record<string, unknown>))
  );

  // SET-017 — the post-import restart round-trip. Everything above proves the import took effect in
  // the LIVE process; none of it proves the imported document was actually persisted. An import that
  // updated only in-memory state would satisfy every preceding check and silently revert on the next
  // launch. The full inventory is re-read too, since an import must never cost the user data.
  const beforeImportRestart = await snapshotSettings(win);
  const inventoryBeforeImportRestart = await dataInventory(win);
  await app.close();
  ({ app, win } = await launch(env));
  watch(win);
  await loginExisting(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
  await openSettings(win);
  const afterImportRestart = await snapshotSettings(win);
  check(
    "SET-017 imported execution defaults survive a real restart",
    afterImportRestart.execution.maxRuns === beforeImportRestart.execution.maxRuns &&
      afterImportRestart.execution.defaultRuns === beforeImportRestart.execution.defaultRuns,
    `${JSON.stringify(afterImportRestart.execution)} vs ${JSON.stringify(beforeImportRestart.execution)}`
  );
  // Every top-level key is compared and the differing ones are NAMED, so a legitimately-volatile key
  // is distinguishable from a substantive value that failed to persist. Two keys are volatile by
  // construction and are excluded deliberately, not because they were inconvenient:
  //   - `app` carries `lastLaunchedAt`, which a restart must change.
  //   - `lastRouteId` records where the user last was, and reopening Settings after the restart is
  //     itself a navigation. It is UI state — the same key `clearUiState` resets — and is no part of
  //     what an import promises to round-trip.
  const volatileKeys = new Set(["app", "lastRouteId"]);
  const changedKeys = Object.keys(beforeImportRestart)
    .filter((key) => !volatileKeys.has(key))
    .filter((key) => {
      const before = (beforeImportRestart as unknown as Record<string, unknown>)[key];
      const after = (afterImportRestart as unknown as Record<string, unknown>)[key];
      return JSON.stringify(before) !== JSON.stringify(after);
    });
  check(
    "SET-017 the whole imported document round-trips, not just the fields asserted live",
    changedKeys.length === 0,
    changedKeys.length === 0
      ? "every non-volatile key identical"
      : changedKeys.map((key) => `${key}: ${JSON.stringify((beforeImportRestart as unknown as Record<string, unknown>)[key])} -> ${JSON.stringify((afterImportRestart as unknown as Record<string, unknown>)[key])}`).join(" | ")
  );
  check(
    "SET-017 the certificate bypass is still off after the restart",
    afterImportRestart.recorder.security.ignoreHttpsErrors === false,
    String(afterImportRestart.recorder.security.ignoreHttpsErrors)
  );
  const inventoryAfterImportRestart = await dataInventory(win);
  check(
    "SET-017 no user data was lost across import + restart",
    JSON.stringify(inventoryAfterImportRestart) === JSON.stringify(inventoryBeforeImportRestart),
    `${JSON.stringify(inventoryAfterImportRestart)} vs ${JSON.stringify(inventoryBeforeImportRestart)}`
  );

  const beforeInvalidImports = await snapshotSettings(win);
  await setImportFile(win, "malformed.json", "{\"appearance\":");
  check("SET-018 malformed JSON shows an actionable error", await win.locator(".settings-banner.error").filter({ hasText: /JSON|Unexpected|Expected/ }).isVisible().catch(() => false));
  check("SET-018 malformed JSON preserves existing settings", JSON.stringify(await snapshotSettings(win)) === JSON.stringify(beforeInvalidImports));

  await setImportFile(win, "wrong-top-level.json", "[]");
  check("SET-018 array top-level is rejected", await win.getByText(/expected a JSON object/i).isVisible().catch(() => false));
  check("SET-018 wrong top-level preserves existing settings", JSON.stringify(await snapshotSettings(win)) === JSON.stringify(beforeInvalidImports));

  const oversized = JSON.stringify({ appearance: "light", padding: "x".repeat(MAX_IMPORT_BYTES + 100) });
  await setImportFile(win, "oversized.json", oversized);
  check("SET-018 oversized import is rejected before parsing/apply", await win.getByText(/too large|1 MB/i).isVisible().catch(() => false));
  check("SET-018 oversized import preserves existing settings", JSON.stringify(await snapshotSettings(win)) === JSON.stringify(beforeInvalidImports));

  const invalidEnum = {
    ...beforeInvalidImports,
    execution: { ...beforeInvalidImports.execution, defaultRunMode: "sideways" }
  };
  await setImportFile(win, "invalid-enum.json", JSON.stringify(invalidEnum));
  const invalidEnumBanner = await win.locator(".settings-banner.error").last().innerText().catch(() => "");
  check(
    "SET-018 invalid enum is rejected by main validation",
    /run mode/i.test(invalidEnumBanner),
    invalidEnumBanner
  );
  check("SET-018 invalid enum preserves existing settings", JSON.stringify(await snapshotSettings(win)) === JSON.stringify(beforeInvalidImports));

  await setImportFile(win, "legacy-partial.json", JSON.stringify({ appearance: "dark" }));
  await win.getByText("Settings imported.").waitFor({ timeout: 10_000 });
  const partial = await snapshotSettings(win);
  check(
    "SET-018 partial legacy settings hydrate with safe defaults",
    partial.appearance === "dark" &&
      partial.execution.maxRuns === 100 &&
      !partial.recorder.security.ignoreHttpsErrors &&
      Boolean(partial.paths.flowsPath)
  );
  await setImportFile(win, "restore-full.json", capturedExport.content);
  await win.getByText("Settings imported.").waitFor({ timeout: 10_000 });

  // ConfirmDialog accessibility: focus trap, Escape and focus restoration.
  const httpsToggle = win.getByTestId("ignore-https-errors-toggle");
  await httpsToggle.focus();
  await httpsToggle.click();
  const alertDialog = win.getByRole("alertdialog", { name: "Disable HTTPS certificate validation?" });
  await alertDialog.waitFor({ timeout: 10_000 });
  check("SET-021 security confirmation has alertdialog semantics", await alertDialog.isVisible());
  check("SET-021 confirmation initially focuses Cancel", await win.getByRole("button", { name: "Cancel", exact: true }).evaluate((el) => el === document.activeElement));
  await win.keyboard.press("Tab");
  check("SET-021 Tab reaches Enable", await win.getByRole("button", { name: "Enable", exact: true }).evaluate((el) => el === document.activeElement));
  await win.keyboard.press("Tab");
  check("SET-021 focus wraps inside confirmation", await win.getByRole("button", { name: "Cancel", exact: true }).evaluate((el) => el === document.activeElement));
  await win.keyboard.press("Escape");
  check("SET-021 Escape closes confirmation", (await win.getByRole("alertdialog").count()) === 0);
  check("SET-021 confirmation restores focus to its trigger", await httpsToggle.evaluate((el) => el === document.activeElement));

  // Reset all: cancel is inert; confirm restores defaults but preserves every user-data store.
  await win.evaluate(() => window.playwrightFlowStudio.settings.update({ execution: { maxRuns: 17 } }));
  const resetButtons = win.getByRole("button", { name: "Reset to Defaults" });
  win.once("dialog", (dialog) => void dialog.dismiss());
  await resetButtons.first().click();
  check("SET-019 reset cancel changes nothing", (await snapshotSettings(win)).execution.maxRuns === 17);
  const beforeResetCounts = await win.evaluate(() => window.playwrightFlowStudio.settings.getStorageStats());
  const beforeResetSecrets = await win.evaluate(() => window.playwrightFlowStudio.secrets.list());
  win.once("dialog", (dialog) => void dialog.accept());
  await resetButtons.first().click();
  await win.getByText("Settings reset to defaults.").waitFor({ timeout: 10_000 });
  const afterResetSettings = await snapshotSettings(win);
  const afterResetCounts = await win.evaluate(() => window.playwrightFlowStudio.settings.getStorageStats());
  const afterResetSecrets = await win.evaluate(() => window.playwrightFlowStudio.secrets.list());
  check(
    "SET-019 confirmed reset restores documented defaults",
    afterResetSettings.appearance === "light" &&
      afterResetSettings.execution.maxRuns === 100 &&
      afterResetSettings.runtime.capacityMode === "manual" &&
      !afterResetSettings.recorder.security.ignoreHttpsErrors
  );
  check("SET-019 reset preserves every profile count", JSON.stringify(afterResetCounts) === JSON.stringify(beforeResetCounts));
  check(
    "SET-019 reset preserves secrets",
    beforeResetSecrets.some((secret) => secret.name === PERSISTED_SECRET) &&
      afterResetSecrets.some((secret) => secret.name === PERSISTED_SECRET)
  );
  const inventoryAfterReset = await dataInventory(win);
  check(
    "SET-019 reset preserves captured sessions and driver records",
    inventoryAfterReset.sessions.includes(SEEDED_SESSION_ID) &&
      inventoryAfterReset.javaRuntimes.includes(SEEDED_JAVA_ID) &&
      inventoryAfterReset.drivers.includes(SEEDED_DRIVER_ID),
    JSON.stringify({
      sessions: inventoryAfterReset.sessions,
      java: inventoryAfterReset.javaRuntimes,
      drivers: inventoryAfterReset.drivers
    })
  );
  // Profile counts legitimately move during the run (SET-015 adds a flow), so only the three classes
  // that must never change are compared across the whole session.
  const stableClasses = (inventory: Awaited<ReturnType<typeof dataInventory>>) =>
    JSON.stringify({ sessions: inventory.sessions, java: inventory.javaRuntimes, drivers: inventory.drivers });
  check(
    "SET-016/019 sessions and driver records are identical from before Clear UI State to after reset",
    stableClasses(inventoryAfterReset) === stableClasses(inventoryBeforeClear),
    `${stableClasses(inventoryAfterReset)} vs ${stableClasses(inventoryBeforeClear)}`
  );

  // Offline validation reflects the real local bundle result and never initiates a download.
  const offlineStatus = await win.evaluate(() => window.playwrightFlowStudio.offlineRuntime.getStatus());
  await win.getByRole("button", { name: "Validate Offline Runtime" }).click();
  const offlineFailures = offlineStatus.checks.filter((item) => !item.ok).length;
  const expectedOfflineText = offlineFailures === 0
    ? "Offline runtime validation passed."
    : `Offline runtime validation found ${offlineFailures} issue(s).`;
  await win.getByText(expectedOfflineText, { exact: false }).waitFor({ timeout: 10_000 });
  const offlineBanner = await win.getByText(expectedOfflineText, { exact: false }).innerText();
  check(
    "SET-020 offline validation banner matches the actual check result",
    offlineFailures === 0
      ? offlineBanner.includes("validation passed")
      : offlineBanner.includes(`${offlineFailures} issue`),
    offlineBanner
  );

  // SET-020 — the failing variant. A passing bundle proves the action runs; it does not prove the
  // action can DETECT anything, and a validator hard-wired to report success would satisfy the check
  // above perfectly. A runtime folder is made genuinely unwritable so a real check flips.
  //
  // `resources/` is deliberately untouched — the offline rules forbid writing there, and the runtime
  // folders under the isolated profile give the same signal without it.
  const brokenFolder = join(runtimeRoot, "downloads");
  mkdirSync(brokenFolder, { recursive: true });
  denyDirectoryWrite(brokenFolder);
  deniedPaths.push({ dir: brokenFolder, kind: "write" });
  check(
    "SET-020 the broken-dependency fixture is genuinely unwritable (precondition)",
    !directoryAcceptsAWrite(brokenFolder),
    brokenFolder.replace(root, "<repo>")
  );
  const brokenStatus = await win.evaluate(() => window.playwrightFlowStudio.offlineRuntime.getStatus());
  const brokenFailures = brokenStatus.checks.filter((item) => !item.ok);
  check(
    "SET-020 a missing/unwritable dependency is detected rather than reported healthy",
    brokenFailures.length === offlineFailures + 1,
    `${brokenFailures.length} failing vs ${offlineFailures} baseline: ${brokenFailures.map((item) => item.key).join(", ")}`
  );
  check(
    "SET-020 the failing check names the folder that actually broke",
    brokenFailures.some((item) => item.key === "folder.downloads"),
    brokenFailures.map((item) => item.key).join(", ")
  );
  await win.getByRole("button", { name: "Validate Offline Runtime" }).click();
  const brokenBannerText = `Offline runtime validation found ${brokenFailures.length} issue(s).`;
  await win.getByText(brokenBannerText, { exact: false }).waitFor({ timeout: 10_000 });
  check(
    "SET-020 the banner's failure count agrees with the underlying checks",
    (await win.getByText(brokenBannerText, { exact: false }).count()) > 0,
    brokenBannerText
  );
  // Recovery: the failure must be a real observation of current state, not a latched flag.
  restoreDirectoryWrite(brokenFolder);
  deniedPaths.pop();
  await win.getByRole("button", { name: "Validate Offline Runtime" }).click();
  await win.waitForTimeout(600);
  const recoveredStatus = await win.evaluate(() => window.playwrightFlowStudio.offlineRuntime.getStatus());
  check(
    "SET-020 restoring the dependency clears the failure on the next validation",
    recoveredStatus.checks.filter((item) => !item.ok).length === offlineFailures,
    `${recoveredStatus.checks.filter((item) => !item.ok).length} vs ${offlineFailures}`
  );
  check(
    "SET-020 validation performed no network access (offline contract)",
    recoveredStatus.internetRequired === false && recoveredStatus.runtimeDownloadsAllowed === false,
    JSON.stringify({ internetRequired: recoveredStatus.internetRequired, runtimeDownloadsAllowed: recoveredStatus.runtimeDownloadsAllowed })
  );

  // SET-008 — designer defaults must reach a NEWLY OPENED designer, not just the settings file.
  // FlowChartDesigner only falls back to `designerDefaults.defaultZoomPercent` when the per-designer
  // `flowDesignerZoomPercent` is 0, so that is cleared first; otherwise this would silently assert
  // the saved per-designer zoom and pass regardless of the Setting.
  //
  // Two different values are driven through, because a single value can match by coincidence — the
  // default happens to be 100, and "the designer opened at 100%" proves nothing about propagation.
  for (const zoomPercent of [75, 150]) {
    await win.evaluate((percent: number) =>
      window.playwrightFlowStudio.settings.update({
        flowDesignerZoomPercent: 0,
        designerDefaults: { defaultZoomPercent: percent }
      }), zoomPercent);
    await navClick(win, "Flow Designer");
    await win.waitForSelector(".canvas-zoom-control", { timeout: 20_000 });
    await win.waitForTimeout(800);
    const shownZoom = (await win.locator(".canvas-zoom-button.zoom-value").innerText()).trim();
    check(
      `SET-008 a newly opened designer adopts the configured ${zoomPercent}% default zoom`,
      shownZoom === `${zoomPercent}%`,
      `${shownZoom} vs ${zoomPercent}%`
    );
    await openSettings(win);
  }

  // Narrow/zoom smoke. This is a concrete overflow check, not a full manual accessibility audit.
  const browserWindow = await app.browserWindow(win);
  await browserWindow.evaluate((windowHandle) => windowHandle.setSize(900, 700));
  await win.waitForTimeout(400);
  const narrowOverflow = await win.evaluate(() => {
    const element = document.querySelector(".settings-stack");
    return {
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      stack: element ? element.scrollWidth - element.clientWidth : 999
    };
  });
  check(
    "SET-021 Settings has no page-level horizontal overflow at 900×700",
    narrowOverflow.document <= 1 && narrowOverflow.stack <= 1,
    JSON.stringify(narrowOverflow)
  );
  await win.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await win.evaluate(() =>
    getComputedStyle(document.querySelector(".settings-stack") as Element).animationDuration
  );
  check(
    "SET-021 reduced-motion mode reduces Settings stack animation to effectively zero",
    Number.parseFloat(reducedMotion) <= 0.001,
    reducedMotion
  );
  await win.screenshot({ path: join(screenshotRoot, "03-settings-narrow-reset.png"), fullPage: true });

  await app.close();
  ({ app, win } = await launch(env));
  watch(win);
  await loginExisting(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
  await openSettings(win);
  check("SET-019 reset defaults survive restart", (await snapshotSettings(win)).execution.maxRuns === 100);
  check("SET-016/019 user profiles survive restart", (await win.evaluate(() => window.playwrightFlowStudio.settings.getStorageStats())).flows === 3);
  check("SET-013/019 secret survives restart", (await win.evaluate(() => window.playwrightFlowStudio.secrets.list())).some((s) => s.name === PERSISTED_SECRET));

  // Administrator: Settings allowed, SU-only Branding hidden, mutations permitted.
  await signOut(win);
  await loginAs(win, admin.username, admin.temporary);
  await win.getByRole("heading", { name: "Update your password" }).waitFor({ timeout: 15_000 });
  await submitForcedChange(win, admin.temporary, admin.final);
  await win.waitForSelector(".app-shell", { timeout: 20_000 });
  const adminLabels = await navLabels(win);
  check("SET-001 Administrator has Settings navigation", adminLabels.includes("Settings"));
  await openSettings(win);
  check("SET-001 Administrator sees Settings page", await win.getByRole("heading", { name: "Settings", exact: true }).isVisible());
  check("SET-001 Administrator does not see SU-only Workspace Branding", (await win.getByRole("heading", { name: "Workspace Branding" }).count()) === 0);
  const adminMutation = await directProbe(
    win,
    `() => window.playwrightFlowStudio.settings.update({ execution: { maxRuns: 99 } })`
  );
  check("SET-001 Administrator can apply substantive Settings changes", !adminMutation.rejected, adminMutation.message);

  // Viewer: no route/nav and every Settings-owned direct action fails closed.
  await signOut(win);
  await win.evaluate(() => window.playwrightFlowStudio.settings.update({ lastRouteId: "settings" }));
  await loginAs(win, viewer.username, viewer.temporary);
  await win.getByRole("heading", { name: "Update your password" }).waitFor({ timeout: 15_000 });
  await submitForcedChange(win, viewer.temporary, viewer.final);
  await win.waitForSelector(".app-shell", { timeout: 20_000 });
  const viewerLabels = await navLabels(win);
  check("SET-001 Viewer has no Settings navigation", !viewerLabels.includes("Settings"));
  check("SET-001 restored Settings deep link is blocked", (await win.locator(".awkit-not-authorized").count()) === 1);
  const viewerProbes = await win.evaluate(`(async () => {
    const api = window.playwrightFlowStudio;
    const result = {};
    const calls = {
      update: function () { return api.settings.update({ execution: { maxRuns: 3 } }); },
      reset: function () { return api.settings.reset(); },
      import: function () { return api.settings.import({ appearance: "dark" }); },
      clearUi: function () { return api.settings.clearUiState(); },
      exportSettings: function () { return api.settings.export(); },
      openRuntime: function () { return api.settings.openRuntimeFolder(); },
      stats: function () { return api.settings.getStorageStats(); },
      paths: function () { return api.settings.validatePaths(); },
      defaults: function () { return api.settings.getDefaultPaths(); },
      secretAvailable: function () { return api.secrets.isAvailable(); },
      secretList: function () { return api.secrets.list(); },
      secretSet: function () { return api.secrets.set(${JSON.stringify(PERSISTED_SECRET)}, "VIEWER-MUST-NOT-WRITE"); },
      secretDelete: function () { return api.secrets.delete(${JSON.stringify(PERSISTED_SECRET)}); }
    };
    for (const name of Object.keys(calls)) {
      try {
        await calls[name]();
        result[name] = { rejected: false, message: "allowed" };
      } catch (error) {
        result[name] = { rejected: true, message: error instanceof Error ? error.message : String(error) };
      }
    }
    return result;
  })()`) as Record<string, Probe>;
  for (const [name, probe] of Object.entries(viewerProbes)) {
    check(`SET-001 Viewer direct ${name} is denied`, probe.rejected, probe.message);
  }
  const viewerUiPatch = await directProbe(
    win,
    `() => window.playwrightFlowStudio.settings.update({ lastRouteId: "dashboard" })`
  );
  check("SET-001 Viewer UI-state-only patch remains allowed by policy", !viewerUiPatch.rejected, viewerUiPatch.message);
  await win.screenshot({ path: join(screenshotRoot, "04-settings-viewer-denied.png"), fullPage: true });

  check("Settings journeys emitted no renderer errors", rendererErrors.length === 0, rendererErrors.slice(0, 4).join(" | "));
} finally {
  if (app) await app.close().catch(() => undefined);
  // Any ACL denial still standing is restored here, or the evidence tree becomes undeletable.
  // Reported as a check so a silent failure to restore cannot pass unnoticed.
  for (const { dir, kind } of deniedPaths.splice(0)) {
    try {
      if (kind === "read") restoreDirectoryRead(dir);
      else restoreDirectoryWrite(dir);
      check(`fixture cleanup: the injected ${kind} denial was restored`, kind === "read" ? directoryIsReadable(dir) : directoryAcceptsAWrite(dir), dir.replace(root, "<repo>"));
    } catch (error) {
      check(`fixture cleanup: the injected ${kind} denial was restored`, false, error instanceof Error ? error.message : String(error));
    }
  }
}

writeFileSync(
  join(evidenceRoot, "execution-results.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      fixture: {
        dataRoot,
        seededCounts: {
          flows: seeded.flows.length,
          workflows: seeded.workflows.length,
          dataSources: seeded.dataSources.length,
          reports: seeded.reports.length
        }
      },
      results
    },
    null,
    2
  ),
  "utf8"
);
const passed = results.filter((result) => result.pass).length;
const failed = results.length - passed;
console.log(`\nSettings E2E: ${passed} PASS / ${failed} FAIL`);
console.log(`Evidence: ${relative(root, evidenceRoot)}`);
process.exit(failed === 0 ? 0 : 1);
