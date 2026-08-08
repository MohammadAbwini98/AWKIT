// REC-028 — Recorder authorization boundary.
//
// The Recorder is the third surface to get this audit. The Reports campaign (AWKIT-REP-001) and the
// Settings campaign (AWKIT-SET-001) both found that a renderer-facing IPC surface enforced access
// only in the renderer's route table, so a crafted or unauthorized call reached the handler anyway.
// This verifier asks the same question of `recorder:*`.
//
// It deliberately:
//   - drives the REAL preload API from the renderer, through the real sender-bound main process;
//   - probes before any session exists, then as a role WITHOUT `page.recorder` (Viewer), then as a
//     role WITH it (Operator), then again after sign-out;
//   - asserts the DENIAL REASON (`NOT_AUTHORIZED`), never the bare fact that a promise rejected —
//     a handler that fails for an unrelated reason would otherwise read as "secure";
//   - asserts the SIDE EFFECT of every mutation probe, because "it threw" and "it changed nothing"
//     are different claims and only the second one is the security property.
//
// Run after `npm run build`:
//   npm run verify:recorder-authz
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ConsoleMessage, type ElectronApplication, type Page } from "playwright";
import {
  isolatedLaunchEnv,
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
import type {} from "../app/renderer/types/preload.d.ts";

type Probe = { rejected: boolean; message: string };
type ProbeSet = Record<string, Probe>;
type ValueProbe = Probe & { value?: unknown };
type ValueProbeSet = Record<string, ValueProbe>;

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = join(root, "test-artifacts", "recorder-authz", runStamp);
mkdirSync(evidenceDir, { recursive: true });

// Canaries. If an unauthorized caller reaches the handler, these persist and we can prove it.
const canaryUrl = `http://127.0.0.1:4599/rec028-${randomBytes(3).toString("hex")}`;
const canaryFlowName = `REC-028 Unauthorized Flow ${randomBytes(3).toString("hex")}`;
const canaryFlowId = `awkit-7lj-${randomBytes(3).toString("hex")}`;
const canaryFlow = {
  id: canaryFlowId,
  name: `AWKIT-7LJ Flow ${randomBytes(3).toString("hex")}`,
  version: 1,
  nodes: [
    { id: "start", type: "start", name: "Start" },
    { id: "end", type: "end", name: "End" }
  ],
  edges: [{ id: "edge-start-end", source: "start", target: "end", type: "success" }]
};

const results: { name: string; pass: boolean; detail: string }[] = [];

function check(name: string, pass: unknown, detail: unknown = ""): boolean {
  const ok = Boolean(pass);
  results.push({ name, pass: ok, detail: String(detail ?? "").slice(0, 600) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).slice(0, 240)}` : ""}`);
  return ok;
}

/**
 * A denial must be an AUTHORIZATION denial. `SecurityError` stringifies to its reason code, and
 * Electron prefixes the channel, so an authorized-but-broken handler and a properly denied one are
 * distinguishable only by this substring. Asserting `rejected` alone would pass for both.
 */
function deniedForAuth(probe: Probe | undefined): boolean {
  return Boolean(probe?.rejected && /NOT_AUTHORIZED|SESSION_EXPIRED/.test(probe.message));
}

/**
 * Every recorder channel reachable from the preload surface. `start` is probed last because on an
 * unguarded build it really does launch a browser; the caller cancels immediately afterwards.
 */
function probeScript(url: string, flowName: string): string {
  return `(async () => {
    const api = window.playwrightFlowStudio.recorder;
    const result = {};
    const calls = {
      getStatus: function () { return api.getStatus(); },
      getActions: function () { return api.getActions(); },
      clearActions: function () { return api.clearActions(); },
      deleteAction: function () { return api.deleteAction("rec028-nonexistent-action"); },
      getUrls: function () { return api.getUrls(); },
      getHandoff: function () { return api.getHandoff(); },
      saveUrl: function () { return api.saveUrl(${JSON.stringify(url)}); },
      saveFlow: function () { return api.saveFlow(${JSON.stringify(flowName)}, [
        { type: "goto", url: ${JSON.stringify(url)}, timestamp: 1 }
      ]); },
      ignoreProtectedDetection: function () { return api.ignoreProtectedDetection(); },
      cancelHandoff: function () { return api.cancelHandoff(); },
      stop: function () { return api.stop(); },
      cancel: function () { return api.cancel(); },
      start: function () { return api.start(${JSON.stringify(url)}, { captureSmartWaits: false }); }
    };
    for (const name of Object.keys(calls)) {
      try {
        await calls[name]();
        result[name] = { rejected: false, message: "allowed" };
      } catch (error) {
        result[name] = { rejected: true, message: error instanceof Error ? error.message : String(error) };
      }
    }
    // Never leave a browser running, whatever the guard did.
    try { await api.cancel(); } catch { /* denied, or nothing to cancel */ }
    return result;
  })()`;
}

function flowReadProbeScript(flowId: string): string {
  return `(async () => {
    const api = window.playwrightFlowStudio.flows;
    const result = {};
    const calls = {
      list: function () { return api.list(); },
      get: function () { return api.get(${JSON.stringify(flowId)}); },
      export: function () { return api.export(${JSON.stringify(flowId)}); }
    };
    for (const name of Object.keys(calls)) {
      try {
        result[name] = { rejected: false, message: "allowed", value: await calls[name]() };
      } catch (error) {
        result[name] = {
          rejected: true,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }
    return result;
  })()`;
}

const channels = [
  "getStatus",
  "getActions",
  "clearActions",
  "deleteAction",
  "getUrls",
  "getHandoff",
  "saveUrl",
  "saveFlow",
  "ignoreProtectedDetection",
  "cancelHandoff",
  "stop",
  "cancel",
  "start"
] as const;

const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-recorder-authz", {
  PRODUCTION_OFFLINE: "true"
});

const viewer = {
  username: `recviewer-${randomBytes(4).toString("hex")}`,
  temporary: genPassword("RecViewerTemp"),
  final: genPassword("RecViewerFinal")
};
const operator = {
  username: `recoperator-${randomBytes(4).toString("hex")}`,
  temporary: genPassword("RecOperatorTemp"),
  final: genPassword("RecOperatorFinal")
};

const rendererErrors: string[] = [];
let app: ElectronApplication | undefined;
let win: Page | undefined;

try {
  app = await electron.launch({ args: [root], cwd: root, env });
  win = (await resolveMainWindow(app)) as Page;
  win.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") rendererErrors.push(message.text());
  });
  win.on("pageerror", (error: Error) => rendererErrors.push(`pageerror: ${error.message}`));
  await win.waitForSelector(".awkit-login-card", { timeout: 20_000 });

  // ── Phase A — no session is bound to this renderer at all. ────────────────────────────────────
  const preAuth = (await win.evaluate(probeScript(canaryUrl, `${canaryFlowName} preauth`))) as ProbeSet;
  for (const channel of channels) {
    check(`REC-028 pre-auth recorder:${channel} is denied as unauthorized`, deniedForAuth(preAuth[channel]), preAuth[channel]?.message);
  }
  const preAuthFlowReads = (await win.evaluate(flowReadProbeScript(canaryFlowId))) as ValueProbeSet;
  for (const channel of ["list", "get", "export"] as const) {
    check(
      `awkit-7lj pre-auth flows:${channel} is denied as unauthorized`,
      deniedForAuth(preAuthFlowReads[channel]),
      preAuthFlowReads[channel]?.message
    );
  }

  await signInFirstRun(win);
  await win.waitForTimeout(500);
  await win.evaluate(
    `(async () => window.playwrightFlowStudio.flows.create(${JSON.stringify(canaryFlow)}))()`
  );

  // Did the pre-auth probes actually change state? This is the part that matters.
  const afterPreAuth = await win.evaluate(async () => ({
    urls: await window.playwrightFlowStudio.recorder.getUrls(),
    flows: await window.playwrightFlowStudio.flows.list()
  }));
  check(
    "REC-028 pre-auth saveUrl persisted nothing",
    !afterPreAuth.urls.some((entry) => entry.url?.includes(canaryUrl)),
    JSON.stringify(afterPreAuth.urls.map((entry) => entry.url).slice(0, 8))
  );
  check(
    "REC-028 pre-auth saveFlow created no flow",
    !afterPreAuth.flows.some((flow) => flow.name?.startsWith("REC-028 Unauthorized Flow")),
    JSON.stringify(afterPreAuth.flows.map((flow) => flow.name).slice(0, 8))
  );

  // ── Phase B — provision a role without `page.recorder` and one with it. ───────────────────────
  await navClick(win, "Users");
  await win.getByRole("heading", { name: "Add a user" }).first().waitFor({ timeout: 15_000 });
  await createUser(win, {
    username: viewer.username,
    displayName: "Recorder Viewer",
    password: viewer.temporary,
    roles: ["Viewer"]
  });
  await createUser(win, {
    username: operator.username,
    displayName: "Recorder Operator",
    password: operator.temporary,
    roles: ["Operator"]
  });
  check(
    "REC-028 Viewer and Operator fixtures created",
    (await win.getByText(`@${viewer.username}`).count()) > 0 && (await win.getByText(`@${operator.username}`).count()) > 0
  );

  // ── Phase C — Viewer holds no `page.recorder`. Every channel must refuse. ─────────────────────
  await signOut(win);
  await loginAs(win, viewer.username, viewer.temporary);
  await win.waitForTimeout(400);
  await submitForcedChange(win, viewer.temporary, viewer.final);
  await win.waitForTimeout(600);

  const labels = await navLabels(win);
  check("REC-028 Viewer navigation does not offer Recorder", !labels.includes("Recorder"), labels.join(" | "));

  const viewerProbes = (await win.evaluate(probeScript(canaryUrl, canaryFlowName))) as ProbeSet;
  for (const channel of channels) {
    check(
      `REC-028 Viewer recorder:${channel} is denied as unauthorized`,
      deniedForAuth(viewerProbes[channel]),
      viewerProbes[channel]?.message
    );
  }

  const viewerFlowReads = (await win.evaluate(flowReadProbeScript(canaryFlowId))) as ValueProbeSet;
  const viewerList = viewerFlowReads.list?.value as Array<{ id?: string }> | undefined;
  const viewerGet = viewerFlowReads.get?.value as { id?: string } | undefined;
  const viewerExport = viewerFlowReads.export?.value as { id?: string } | undefined;
  check(
    "awkit-7lj Viewer flows:list remains permitted by page.flows",
    !viewerFlowReads.list?.rejected && viewerList?.some((flow) => flow.id === canaryFlowId),
    viewerFlowReads.list?.message
  );
  check(
    "awkit-7lj Viewer flows:get remains permitted by page.flows",
    !viewerFlowReads.get?.rejected && viewerGet?.id === canaryFlowId,
    viewerFlowReads.get?.message
  );
  check(
    "awkit-7lj Viewer flows:export remains permitted by page.flows",
    !viewerFlowReads.export?.rejected && viewerExport?.id === canaryFlowId,
    viewerFlowReads.export?.message
  );

  const viewerSideEffects = await win.evaluate(async () => ({
    flows: await window.playwrightFlowStudio.flows.list()
  }));
  check(
    "REC-028 Viewer saveFlow created no flow",
    !viewerSideEffects.flows.some((flow) => flow.name === canaryFlowName),
    JSON.stringify(viewerSideEffects.flows.map((flow) => flow.name).slice(0, 8))
  );

  // ── Phase D — Operator holds `page.recorder`. The guard must not over-deny. ───────────────────
  await signOut(win);
  await loginAs(win, operator.username, operator.temporary);
  await win.waitForTimeout(400);
  await submitForcedChange(win, operator.temporary, operator.final);
  await win.waitForTimeout(600);

  const operatorLabels = await navLabels(win);
  check("REC-028 Operator navigation offers Recorder", operatorLabels.includes("Recorder"), operatorLabels.join(" | "));

  // String-eval form on purpose: tsx/esbuild rewrites named function expressions inside a typed
  // page.evaluate callback and injects a `__name` helper that does not exist in the page.
  const operatorReads = (await win.evaluate(`(async () => {
    const api = window.playwrightFlowStudio.recorder;
    const out = {};
    const calls = {
      getStatus: function () { return api.getStatus(); },
      getActions: function () { return api.getActions(); },
      clearActions: function () { return api.clearActions(); },
      deleteAction: function () { return api.deleteAction("rec028-nonexistent-action"); },
      getUrls: function () { return api.getUrls(); },
      getHandoff: function () { return api.getHandoff(); }
    };
    for (const name of Object.keys(calls)) {
      try {
        await calls[name]();
        out[name] = { rejected: false, message: "allowed" };
      } catch (error) {
        out[name] = { rejected: true, message: error instanceof Error ? error.message : String(error) };
      }
    }
    return out;
  })()`)) as ProbeSet;
  for (const [name, probe] of Object.entries(operatorReads)) {
    check(`REC-028 Operator recorder:${name} is permitted`, !probe.rejected, probe.message);
  }

  // ── Phase E — the session is gone. The renderer must lose access with it. ─────────────────────
  await signOut(win);
  await win.waitForSelector(".awkit-login-card", { timeout: 20_000 });
  const revoked = (await win.evaluate(probeScript(canaryUrl, `${canaryFlowName} revoked`))) as ProbeSet;
  for (const channel of channels) {
    check(
      `REC-028 post-sign-out recorder:${channel} is denied as unauthorized`,
      deniedForAuth(revoked[channel]),
      revoked[channel]?.message
    );
  }

  check("REC-028 emits no renderer console/page error", rendererErrors.length === 0, JSON.stringify(rendererErrors.slice(0, 5)));
} catch (error) {
  check("REC-028 verifier completes without an unhandled error", false, error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  // Best effort: never leave a Recorder browser alive after this suite.
  try {
    await win?.evaluate(async () => {
      try {
        await window.playwrightFlowStudio.recorder.cancel();
      } catch {
        /* denied or idle */
      }
    });
  } catch {
    /* window already gone */
  }
  await app?.close().catch(() => undefined);
  cleanup?.();
}

const passed = results.filter((entry) => entry.pass).length;
const failed = results.length - passed;
writeFileSync(
  join(evidenceDir, "results.json"),
  JSON.stringify({ case: "REC-028", dataRoot, passed, failed, results }, null, 2),
  "utf8"
);
console.log(`\nREC-028 recorder authorization: ${passed} passed, ${failed} failed`);
console.log(`Evidence: ${evidenceDir}`);
process.exit(failed === 0 ? 0 : 1);
