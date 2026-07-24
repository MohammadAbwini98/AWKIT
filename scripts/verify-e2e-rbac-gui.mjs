// E2E-RBAC — per-role authorization in the REAL Electron app (specs/e2e/E2E-RBAC.md, bd awkit-xyo).
// One launch: the Super User provisions Administrator / Operator / Viewer accounts, then each role
// signs in (completing its forced password change) and is checked on three surfaces:
//   1. nav visibility (permission-filtered groups),
//   2. the route-mount guard via a restored `lastRouteId` pointing at an unpermitted route — the
//      desktop equivalent of typing a direct URL,
//   3. DIRECT preload-IPC calls (`security.admin.*`, `licensing.*`) — the desktop equivalent of
//      direct API access; hiding a control is never accepted as the check.
// awkit-b92 landed: non-admin IPC (`settings:*`, `execution:*`, and the flow/workflow/data-source CRUD
// channels) is now authorization-enforced via a main-owned, sender-bound session context, and the pinned
// footer nav is permission-filtered. The checks below assert those denials + the footer/Help Center fix
// (they previously documented the gap as a product finding in docs/testing/E2E_DEFECTS.md).
//
// Run: node scripts/verify-e2e-rbac-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun, DEFAULT_CREDS } from "./lib/gui-verify-harness.mjs";
import {
  repoRoot,
  makeChecker,
  genPassword,
  watchConsole,
  loginAs,
  signOut,
  navClick,
  navLabels,
  createUser,
  submitForcedChange,
  directLogin,
  directLogout
} from "./lib/e2e-qa-lib.mjs";

const { check, note, shotDir, summarize } = makeChecker("e2e-rbac");

const ROLES = [
  {
    role: "Administrator",
    username: "adminuser",
    presentNav: ["Dashboard", "Recorder", "Roadmap", "Roles", "Permissions", "Audit Log", "Help Center"],
    absentNav: ["Users", "Licensing"]
  },
  {
    role: "Operator",
    username: "opuser2",
    presentNav: ["Dashboard", "Recorder", "Workflows", "Instances", "Help Center"],
    absentNav: ["Roadmap", "Users", "Roles", "Permissions", "Audit Log", "Licensing"]
  },
  {
    role: "Viewer",
    username: "viewuser",
    presentNav: ["Dashboard", "Workflows", "Flows", "Data Sources", "Instances", "Reports", "Help Center"],
    absentNav: ["Recorder", "Roadmap", "Users", "Roles", "Permissions", "Audit Log", "Licensing"]
  }
].map((r) => ({ ...r, temp: genPassword(`T${r.role[0]}`), final: genPassword(`F${r.role[0]}`) }));

const { env, cleanup } = isolatedLaunchEnv("awkit-e2e-rbac");
const app = await electron.launch({ args: [repoRoot], cwd: repoRoot, env });
try {
  const win = await resolveMainWindow(app);
  const consoleWatch = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  await signInFirstRun(win);
  await win.waitForTimeout(400);

  // ── Seed: SU creates the three role accounts ────────────────────────────────
  consoleWatch.setLabel("seed users");
  await navClick(win, "Users");
  await win.getByRole("heading", { name: "Add a user" }).first().waitFor({ timeout: 10000 });
  for (const r of ROLES) {
    await createUser(win, { username: r.username, displayName: `${r.role} E2E`, password: r.temp, roles: [r.role] });
    check(`seed: ${r.role} account created`, (await win.getByText(`@${r.username}`).count()) >= 1);
  }

  // ── Per-role pass ───────────────────────────────────────────────────────────
  for (const r of ROLES) {
    consoleWatch.setLabel(`role ${r.role}`);
    await signOut(win);

    // "Direct URL": point the restored route at an unpermitted page BEFORE this role signs in.
    await win.evaluate(() => window.playwrightFlowStudio.settings.update({ lastRouteId: "userManagement" }));
    await loginAs(win, r.username, r.temp);
    await win.getByRole("heading", { name: "Update your password" }).waitFor({ timeout: 15000 });
    await submitForcedChange(win, r.temp, r.final);
    await win.waitForSelector(".app-shell", { timeout: 20000 });

    // 2 — route-mount guard: the unpermitted restored route renders NotAuthorized, not the page.
    check(
      `${r.role}: restored unpermitted route mounts NotAuthorized (route guard)`,
      (await win.locator(".awkit-not-authorized").count()) === 1 &&
        (await win.getByRole("heading", { name: "Add a user" }).count()) === 0
    );
    await win.screenshot({ path: path.join(shotDir, `not-authorized-${r.role}.png`) }).catch(() => undefined);
    await win.getByRole("button", { name: "Go to Dashboard" }).click();
    await win.waitForTimeout(500);
    check(`${r.role}: Go to Dashboard recovers from NotAuthorized`, (await win.locator(".awkit-not-authorized").count()) === 0);

    // 1 — nav visibility matches the role's permissions exactly on the sentinel items.
    const labels = await navLabels(win);
    const missing = r.presentNav.filter((l) => !labels.includes(l));
    const leaked = r.absentNav.filter((l) => labels.includes(l));
    check(`${r.role}: permitted nav items are present`, missing.length === 0, missing.join(", ") || undefined);
    check(`${r.role}: unpermitted nav items are hidden`, leaked.length === 0, leaked.join(", ") || undefined);

    // DEF-005 FIXED: the pinned footer Settings is now permission-filtered (hidden without page.settings),
    // and Help Center (the Project Contract doc page) is universal — it mounts for every role instead of
    // dead-ending at NotAuthorized.
    if (r.role !== "Administrator") {
      check(`${r.role}: footer Settings is hidden without page.settings`, !labels.includes("Settings"));
      check(`${r.role}: footer Help Center is available to all roles`, labels.includes("Help Center"));
      await navClick(win, "Help Center");
      check(
        `${r.role}: Help Center mounts its doc page (no NotAuthorized)`,
        (await win.locator(".awkit-not-authorized").count()) === 0
      );
    }

    // 3 — direct preload-IPC calls from this role (fresh direct session; ref released after).
    const direct = await directLogin(win, r.username, r.final);
    check(`${r.role}: direct IPC login works for the checks`, direct.ok === true, direct.reason);
    if (direct.ok) {
      const ipc = await win.evaluate(async ({ ref, sneak, pw }) => {
        const api = window.playwrightFlowStudio;
        const listUsers = await api.security.admin.listUsers(ref);
        const create = await api.security.admin.createUser({ sessionRef: ref, username: sneak, password: pw, roles: ["Viewer"] });
        const licStatus = await api.licensing.getStatus(ref);
        const licImport = await api.licensing.import({ sessionRef: ref, license: {} });
        return {
          listUsers: { ok: listUsers.ok, reason: listUsers.reason, gotData: Array.isArray(listUsers.value) },
          create: { ok: create.ok, reason: create.reason },
          licStatus: { ok: licStatus.ok, reason: licStatus.reason },
          licImport: { ok: licImport.ok, reason: licImport.reason }
        };
      }, { ref: direct.sessionRef, sneak: `sneak-${r.username}`, pw: genPassword("Sn") });

      check(`${r.role}: direct admin.listUsers denied with no data`, !ipc.listUsers.ok && !ipc.listUsers.gotData, ipc.listUsers.reason);
      check(`${r.role}: direct admin.createUser denied`, !ipc.create.ok, ipc.create.reason);
      check(`${r.role}: direct licensing.getStatus denied (SU-only)`, !ipc.licStatus.ok, ipc.licStatus.reason);
      check(`${r.role}: direct licensing.import denied before validation`, !ipc.licImport.ok, ipc.licImport.reason);

      if (r.role === "Viewer") {
        // awkit-b92 FIXED: the sender-bound authorization boundary now enforces non-admin IPC. The window
        // is bound to this Viewer's session (directLogin re-bound it), so these direct calls act as the
        // Viewer. UI-state settings stay OPEN for every role; substantive settings + a real run are DENIED.
        const gaps = await win.evaluate(async () => {
          const api = window.playwrightFlowStudio;
          const rejected = async (p) => {
            try {
              await p;
              return false;
            } catch {
              return true;
            }
          };
          const before = await api.settings.get();

          // (a) UI-state patch (lastRouteId) is written implicitly on navigation for every role → still applies.
          await api.settings.update({ lastRouteId: "dashboard" });
          const afterUi = await api.settings.get();
          await api.settings.update({ lastRouteId: before.lastRouteId });

          // (b) Substantive settings (paths) require SETTINGS_EDIT → rejected AND must not apply.
          const origLogs = before.paths?.logsPath ?? "";
          const substantiveRejected = await rejected(
            api.settings.update({ paths: { logsPath: "C:/awkit-e2e-should-not-apply" } })
          );
          const afterSubstantive = await api.settings.get();

          // (c) A REAL run (dryRun:false) requires WORKFLOW_EXECUTE → rejected for a Viewer window.
          const runRejected = await rejected(
            api.executions.runWorkflow({ workflowId: "e2e-nonexistent-workflow", dryRun: false })
          );

          // (d) Oracle data-source mutators require DATASOURCE_MANAGE (awkit-b3w) → rejected for a Viewer,
          // matching the JSON data-source surface + the DataSourceManager UI gate (deny precedes existence).
          const oracleRefreshRejected = await rejected(api.oracle.refreshSnapshot("e2e-nonexistent-oracle-ds"));
          const oracleDeleteRejected = await rejected(api.oracle.deleteDataSource("e2e-nonexistent-oracle-ds"));

          return {
            uiPrefApplied: afterUi.lastRouteId === "dashboard",
            substantiveRejected,
            substantiveNotApplied: (afterSubstantive.paths?.logsPath ?? "") === origLogs,
            runRejected,
            oracleRefreshRejected,
            oracleDeleteRejected
          };
        });
        check("Viewer: UI-state settings.update stays open (lastRouteId patch applies)", gaps.uiPrefApplied === true);
        check("Viewer: substantive settings.update (paths) is DENIED (sender-bound authz)", gaps.substantiveRejected === true);
        check("Viewer: denied substantive settings.update did not apply", gaps.substantiveNotApplied === true);
        check("Viewer: execution:runWorkflow (real run, dryRun:false) is DENIED", gaps.runRejected === true);
        check("Viewer: oracle.refreshSnapshot is DENIED (DATASOURCE_MANAGE, awkit-b3w)", gaps.oracleRefreshRejected === true);
        check("Viewer: oracle.deleteDataSource is DENIED (DATASOURCE_MANAGE, awkit-b3w)", gaps.oracleDeleteRejected === true);
      }

      if (r.role === "Operator") {
        // Operator can build/run/stop but NOT delete (lacks workflow.delete). The window is bound as the
        // Operator, so a direct delete is rejected by the sender-bound authorization boundary.
        const opDelete = await win.evaluate(async () => {
          const api = window.playwrightFlowStudio;
          try {
            await api.workflows.delete("e2e-nonexistent-workflow");
            return { rejected: false };
          } catch {
            return { rejected: true };
          }
        });
        check("Operator: workflows.delete is DENIED (Operator lacks workflow.delete)", opDelete.rejected === true);
      }
      await directLogout(win, direct.sessionRef);
    }
    check(`${r.role}: zero renderer console errors in this role's session`, consoleWatch.errors.length === 0, consoleWatch.summary());
    consoleWatch.errors.length = 0;
  }

  // ── Super User control pass: the same direct calls succeed (or fail only for domain reasons) ─
  consoleWatch.setLabel("SU control pass");
  await signOut(win);
  await loginAs(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
  await win.waitForSelector(".app-shell", { timeout: 20000 });
  const su = await directLogin(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
  if (su.ok) {
    const control = await win.evaluate(async (ref) => {
      const api = window.playwrightFlowStudio;
      const listUsers = await api.security.admin.listUsers(ref);
      const licStatus = await api.licensing.getStatus(ref);
      const usernames = (listUsers.value ?? []).map((u) => u.username);
      return {
        listOk: listUsers.ok,
        usernames,
        licOk: licStatus.ok,
        licStatusValue: licStatus.value?.status
      };
    }, su.sessionRef);
    check("SU control: admin.listUsers succeeds", control.listOk === true);
    check(
      "SU control: all three role accounts exist",
      ROLES.every((r) => control.usernames.includes(r.username))
    );
    check(
      "SU control: no denied createUser slipped through (no sneak-* accounts)",
      control.usernames.every((u) => !u.startsWith("sneak-")),
      control.usernames.join(",")
    );
    check(
      "SU control: licensing.getStatus returns a DOMAIN status (not FORBIDDEN)",
      control.licOk === true && typeof control.licStatusValue === "string",
      `status=${control.licStatusValue}`
    );
    await directLogout(win, su.sessionRef);
  } else {
    check("SU control: direct login", false, su.reason);
  }
  check("SU control: zero renderer console errors", consoleWatch.errors.length === 0, consoleWatch.summary());

  note("OBS-002 reauth override landed: AWKIT_REAUTH_WINDOW_MS shrinks the sensitive-op reauth window for");
  note("tests (mirrors AWKIT_SESSION_IDLE_MS). The REAUTH_REQUIRED → retry-after-reauth contract is covered");
  note("deterministically by verify:authz (40/40); the live ReauthDialog GUI flow (spec step 10, awkit-2d8)");
  note("now runs as its own launch — npm run verify:e2e-reauth — kept separate so a globally-short reauth");
  note("window never destabilizes this multi-user seeding run.");
} finally {
  await app.close().catch(() => undefined);
  cleanup();
}

process.exit(summarize() > 0 ? 1 : 0);
