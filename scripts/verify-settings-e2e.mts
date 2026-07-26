/**
 * Comprehensive Settings real-Electron gate.
 *
 * The specialized accent/branding/certificate/capacity/driver verifiers remain authoritative for
 * their cards. This gate supplies the missing joined-up Settings journeys over a timestamped,
 * isolated profile: authorization, main-process validation, paths, Secrets UI, storage counts,
 * UI-state clearing, import/export/recovery, reset data safety, offline validation and core a11y.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
