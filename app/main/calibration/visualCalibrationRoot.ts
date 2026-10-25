/**
 * The N6.6 visual-assertion calibration root (Phase N, awkit-vra.15.6; VA-12, VA-16). An Electron MAIN-PROCESS entry of
 * the NON-PACKAGED acceptance build, built by `electron.vite.calibration.config.ts` to `out/calibration-main/`, which
 * `electron-builder.json` excludes: the packaged app ships no harness and no grant issuer. It refuses to run packaged.
 *
 * One launch of this root is ONE calibration session. Within its time budget it runs real browser launches round-robin
 * over every cell, appends each launch's trials to the session's evidence file as it goes, and at the end decides every
 * cell from ALL recorded sessions of this environment with the pure VA-12 criterion. Only a cell that meets every
 * criterion gets a grant, signed with the dev master key through `safeStorage` (`issueGrantUnchecked`); every other
 * cell stays unqualified and its enforced assertions keep failing closed. Nothing here is reachable from the app's
 * production entry, an IPC channel, a setting, a flow or a workflow run.
 *
 * Inputs come from the benchmark that launches it (`scripts/benchmark-visual-assertion.mts`): the lab URL and the
 * session budget. Results go to stdout as `CALIBRATION ` JSON lines.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { chromium, type Browser } from "playwright";

import type { FlowProfile } from "@src/profiles/FlowProfile";
import { BundledBrowserResolver } from "@src/offline/BundledBrowserResolver";
import { buildChromiumHardeningArgs } from "@src/runner/ChromiumHardening";
import { VisualBaselineStore } from "@src/runner/visualAssertion/VisualBaselineStore";
import { VisualBaselineLayout } from "@src/runner/visualAssertion/visualBaselineLayout";
import { createFlowBaselineHooks } from "@src/runner/visualAssertion/flowBaselineLifecycle";
import { canonicalJson } from "@src/runner/visualAssertion/stepContentDigest";
import {
  VISUAL_CALIBRATION_FLOW_ID,
  VISUAL_CALIBRATION_STEPS,
  VisualCalibrationHarness
} from "@src/runner/visualAssertion/calibration/VisualCalibrationHarness";
import {
  cellId,
  evaluateCalibrationCell,
  type VisualCalibrationCellKey,
  type VisualCalibrationEnvironment,
  type VisualCalibrationLaunch
} from "@src/runner/visualAssertion/calibration/visualCalibrationCriteria";
import { JsonProfileStore } from "@src/storage/ProfileStore";
import { getAppMode, getResourcesRoot, getRuntimePaths, isProductionOffline } from "../appPaths";
import { safeStorageVisualKeyProtector } from "../visualAssertion/visualBaselineKeyProtector";

/** VA-12 cells: render mode x device pixel ratio (the DPRs every earlier N calibration measured). */
export const VISUAL_CALIBRATION_CELLS: readonly VisualCalibrationCellKey[] = (["headless", "headed"] as const).flatMap((renderMode) =>
  [1, 1.25, 2].map((devicePixelRatio) => ({ renderMode, devicePixelRatio }))
);
/** Every fifth launch of a cell also runs the negative, inconclusive and refusal fixtures (>= 60 of 300 launches). */
const FIXTURE_EVERY = 5;
/** A launch (or baseline launch) that has not finished in this time is recorded as an error and abandoned. */
const LAUNCH_LIMIT_MS = 90_000;
/** After the budget, lanes get this long to finish in-flight launches before the session is decided anyway. */
const DRAIN_LIMIT_MS = 120_000;

/** Resolve with the work's value, or reject with `limit` once `ms` passed; the work is abandoned, never awaited. */
function within<T>(work: Promise<T>, ms: number, limit: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  work.catch(() => undefined);
  return Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(limit)), ms)))]).finally(() => clearTimeout(timer));
}

function emit(kind: string, data: unknown): void {
  console.log(`CALIBRATION ${JSON.stringify({ kind, ...(data as object) })}`);
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

interface SessionFile {
  version: 1;
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  budgetMs: number;
  concurrency?: number;
  launches: VisualCalibrationLaunch[];
  errors: Array<{ cell: string; at: string; message: string }>;
  grants: Array<{ cell: string; evidenceDigest: string; expiresAt: string }>;
}

async function readSessions(directory: string): Promise<SessionFile[]> {
  const out: SessionFile[] = [];
  for (const name of (await readdir(directory).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort()) {
    try {
      const parsed = JSON.parse(await readFile(join(directory, name), "utf8")) as SessionFile;
      if (parsed?.version === 1 && Array.isArray(parsed.launches)) out.push(parsed);
    } catch {
      // An unreadable session file contributes no evidence (never guessed).
    }
  }
  return out;
}

async function run(): Promise<number> {
  if (app.isPackaged || getAppMode() !== "dev") {
    emit("refused", { reason: "the calibration harness runs only in the non-packaged acceptance build" });
    return 3;
  }
  if (process.env.AWKIT_CALIBRATION_MODE === "audit") return audit();
  const labUrl = process.env.AWKIT_CALIBRATION_LAB_URL;
  const budgetMs = Number.parseInt(process.env.AWKIT_CALIBRATION_BUDGET_MS ?? "", 10);
  if (!labUrl || !/^http:\/\/127\.0\.0\.1:\d+\//.test(labUrl) || !Number.isFinite(budgetMs) || budgetMs <= 0) {
    emit("refused", { reason: "AWKIT_CALIBRATION_LAB_URL (a 127.0.0.1 lab) and AWKIT_CALIBRATION_BUDGET_MS are required" });
    return 2;
  }
  if (!safeStorageVisualKeyProtector.isAvailable()) {
    emit("blocked", { reason: "safeStorage encryption is unavailable: no key, no grant" });
    return 4;
  }

  const runtimeRoot = getRuntimePaths().root;
  const flowsFolder = join(runtimeRoot, "visual-calibration", "flows");
  const layout = new VisualBaselineLayout({ flowsFolder, runtimeRoot });
  const flows = new JsonProfileStore<FlowProfile>({ folder: flowsFolder, hooks: createFlowBaselineHooks({ flowsFolder, runtimeRoot }) });
  if (!(await flows.get(VISUAL_CALIBRATION_FLOW_ID))) {
    await flows.create({ id: VISUAL_CALIBRATION_FLOW_ID, name: "N6.6 visual assertion calibration", version: 1, nodes: Object.values(VISUAL_CALIBRATION_STEPS), edges: [] } as FlowProfile);
  }
  const store = new VisualBaselineStore({ layout, appMode: "dev", protector: safeStorageVisualKeyProtector, readFlow: (id) => flows.get(id) });

  const sessionsDir = join(layout.modeRoot("dev"), "calibration", "sessions");
  await mkdir(sessionsDir, { recursive: true });
  const sessionId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`;
  const sessionPath = join(sessionsDir, `${sessionId}.json`);
  const session: SessionFile = { version: 1, sessionId, startedAt: new Date().toISOString(), budgetMs, launches: [], errors: [], grants: [] };
  await writeJsonAtomically(sessionPath, session);

  const os = userInfo().username;
  const executablePath = isProductionOffline() ? new BundledBrowserResolver(getResourcesRoot()).resolveChromium().executablePath : undefined;
  const launch = (renderMode: "headed" | "headless"): Promise<Browser> =>
    chromium.launch({ headless: renderMode === "headless", args: buildChromiumHardeningArgs(process.env), ...(executablePath ? { executablePath } : {}) });
  const harness = new VisualCalibrationHarness({
    store,
    appVersion: app.getVersion(),
    operator: { userId: `windows-user:${os}`, username: os },
    sessionId,
    labUrl,
    launch
  });

  // Prior evidence decides how many launches each cell already has, so fixtures keep their every-fifth cadence.
  const prior = (await readSessions(sessionsDir)).flatMap((s) => s.launches);
  const counts = new Map<string, number>(VISUAL_CALIBRATION_CELLS.map((cell) => [cellId(cell), prior.filter((l) => cellId(l.cell) === cellId(cell)).length]));
  const ready = new Set<string>();
  const deadline = Date.now() + budgetMs;
  // Independent launches may run in parallel lanes (each lane owns a fixed subset of cells); concurrency only adds
  // load, so a trial's measured duration is never flattered by it. Session writes are serialized.
  const requested = Number.parseInt(process.env.AWKIT_CALIBRATION_CONCURRENCY ?? "1", 10);
  const lanes = Math.max(1, Math.min(VISUAL_CALIBRATION_CELLS.length, Number.isFinite(requested) ? requested : 1));
  session.concurrency = lanes;
  emit("session", { sessionId, budgetMs, lanes, priorLaunches: prior.length, browser: executablePath ?? "playwright-default" });
  let writing: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => (writing = writing.then(() => writeJsonAtomically(sessionPath, session)));

  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const drained = new Promise<void>((resolve) => (drainTimer = setTimeout(() => {
    session.errors.push({ cell: "session", at: new Date().toISOString(), message: `lanes still running ${DRAIN_LIMIT_MS} ms after the budget; decided on what was recorded` });
    resolve();
  }, budgetMs + DRAIN_LIMIT_MS)));
  const lanesDone = Promise.all(
    Array.from({ length: lanes }, async (_, lane) => {
      const mine = VISUAL_CALIBRATION_CELLS.filter((_, index) => index % lanes === lane);
      while (Date.now() < deadline) {
        for (const cell of mine) {
          if (Date.now() >= deadline) break;
          const id = cellId(cell);
          try {
            if (!ready.has(id)) {
              const refused = await within(harness.ensureBaselines(cell), LAUNCH_LIMIT_MS, `baseline launch exceeded ${LAUNCH_LIMIT_MS} ms`);
              if (refused) throw new Error(`baseline not approved: ${refused}`);
              ready.add(id);
            }
            const n = counts.get(id) ?? 0;
            counts.set(id, n + 1);
            session.launches.push(await within(harness.runLaunch(cell, n % FIXTURE_EVERY === 0), LAUNCH_LIMIT_MS, `launch exceeded ${LAUNCH_LIMIT_MS} ms`));
          } catch (error) {
            session.errors.push({ cell: id, at: new Date().toISOString(), message: (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 300) });
          }
          await persist();
        }
      }
    })
  );
  await Promise.race([lanesDone, drained]);
  clearTimeout(drainTimer);
  await writing.catch(() => undefined);

  // Decide every cell from every recorded session of this environment, then issue only for a qualified cell.
  const sessions = await readSessions(sessionsDir);
  const all = sessions.flatMap((s) => s.launches);
  const report: Array<Record<string, unknown>> = [];
  for (const cell of VISUAL_CALIBRATION_CELLS) {
    const id = cellId(cell);
    const environment: VisualCalibrationEnvironment | undefined = [...session.launches].reverse().find((l) => cellId(l.cell) === id)?.environment;
    if (!environment) {
      emit("cell", { cell: id, qualified: false, unmet: ["no launch in this session"] });
      continue;
    }
    const summary = evaluateCalibrationCell(cell, environment, all);
    let grant: { evidenceDigest: string; expiresAt: string } | undefined;
    if (summary.qualified) {
      const counted = all.filter((l) => cellId(l.cell) === id && canonicalJson(l.environment) === canonicalJson(environment));
      const evidenceDigest = createHash("sha256").update(canonicalJson(counted), "utf8").digest("hex");
      const issued = await store.issueGrantUnchecked({ cell, environment, evidenceDigest, issuedAt: new Date() });
      if (issued.ok) {
        grant = { evidenceDigest, expiresAt: issued.expiresAt };
        session.grants.push({ cell: id, ...grant });
      } else {
        summary.unmet.push(`grant-refused ${issued.reason}`);
      }
    }
    const entry = { ...summary, cell: id, environment, ...(grant ? { grant } : {}) };
    report.push(entry);
    emit("cell", entry);
  }
  session.endedAt = new Date().toISOString();
  await writeJsonAtomically(sessionPath, session);
  // The evidence report (awkit-vra.15.6 acceptance): per-cell counts, bound, observe usefulness and any grant, beside
  // the per-session trial files it was decided from.
  await writeJsonAtomically(join(layout.modeRoot("dev"), "calibration", "report.json"), {
    version: 1,
    generatedAt: session.endedAt,
    decidedBySession: sessionId,
    sessions: sessions.map((s) => ({ sessionId: s.sessionId, launches: s.launches.length, errors: s.errors.length, concurrency: s.concurrency ?? 1 })),
    cells: report
  });
  emit("done", { sessionId, launches: session.launches.length, errors: session.errors.length, grants: session.grants.length, evidence: sessionPath });
  return 0;
}

/**
 * Audit mode (no launch, no write): every grant file is read back through the store with the real safeStorage key, so
 * its MAC, mode, key generation and expiry are proven by the same code the runtime gate uses. The environment checked is
 * the grant's own; `verify:visual-calibration-evidence` proves that environment is the recorded one.
 */
async function audit(): Promise<number> {
  if (!safeStorageVisualKeyProtector.isAvailable()) {
    emit("blocked", { reason: "safeStorage encryption is unavailable" });
    return 4;
  }
  const runtimeRoot = getRuntimePaths().root;
  const flowsFolder = join(runtimeRoot, "visual-calibration", "flows");
  const layout = new VisualBaselineLayout({ flowsFolder, runtimeRoot });
  const store = new VisualBaselineStore({ layout, appMode: "dev", protector: safeStorageVisualKeyProtector, readFlow: async () => null });
  const grantsDir = join(layout.modeRoot("dev"), "grants");
  const files = (await readdir(grantsDir).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort();
  emit("audit", { grants: files.length, keyState: await store.keyState() });
  for (const name of files) {
    const grant = JSON.parse(await readFile(join(grantsDir, name), "utf8")) as { cell: VisualCalibrationCellKey; environment: VisualCalibrationEnvironment; expiresAt: string };
    emit("grant", { cell: cellId(grant.cell), status: await store.grantStatus(grant.cell, grant.environment), expiresAt: grant.expiresAt });
  }
  return 0;
}

app.on("window-all-closed", () => undefined);
void app.whenReady().then(async () => {
  let code = 1;
  try {
    code = await run();
  } catch (error) {
    emit("error", { message: (error instanceof Error ? error.message : String(error)).split("\n")[0] });
  }
  app.exit(code);
});
