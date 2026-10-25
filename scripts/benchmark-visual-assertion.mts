/**
 * benchmark:visual-assertion — Phase N, N6.6 (awkit-vra.15.6): ONE calibration session. A measurement gate, not a
 * deterministic test. Plan: docs/plans/ai-upgrade-v5/N6-visual-assertions.md › Enforcement grants (VA-12, VA-16).
 *
 * Starts the mock site, then launches the calibration root (`out/calibration-main`, built by `build:calibration`) in a
 * real Electron main process of the non-packaged acceptance build, with the REAL dev profile, so the master key, the
 * evidence and any grant land where the dev app reads them. The root runs real headed and headless Chromium launches
 * round-robin over every render-mode x DPR cell for SESSION_BUDGET_MS, appends every launch's trials to its session
 * file under `<runtime>/visual-baselines/dev/calibration/sessions/`, decides every cell from all sessions of the same
 * environment, and issues a grant only for a cell that meets every VA-12 criterion.
 *
 * Qualification needs >= 300 passing launches per cell over >= 3 sessions, so it takes many sessions: run this again
 * until a cell qualifies or a criterion fails for good. Nothing is shortened, simulated or carried over from another
 * environment. Close the SpecterStudio app first (both share the profile). On the Parallels share the KNOWN_ISSUES local
 * Electron copy (C:\electron-dist) is used automatically.
 *
 * Run: npm run benchmark:visual-assertion
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** A free local port per run, so a mock server left behind by an interrupted session is never reused by mistake. */
const PORT = await new Promise<number>((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    probe.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("no free port"))));
  });
});
const LAB = `http://127.0.0.1:${PORT}/visual-intelligence/assertion`;
/** One session fits a 10-minute agent command with time to start and decide. */
const SESSION_BUDGET_MS = 7 * 60 * 1000;
/**
 * One lane: launches run one after another. Session 2026-10-25T06-42 ran three parallel lanes; under that load the
 * DPR 2 cells' p95 rose just past 2000 ms and a few primary trials went inconclusive, so parallel load would measure
 * the host, not the trial the plan defines. Its evidence stays recorded and counted.
 */
const SESSION_LANES = 1;
const KNOWN_LOCAL_DIST = "C:\\electron-dist";

function electronExecutable(): string {
  const override = process.env.ELECTRON_OVERRIDE_DIST_PATH ?? (process.platform === "win32" && existsSync(path.join(KNOWN_LOCAL_DIST, "electron.exe")) ? KNOWN_LOCAL_DIST : undefined);
  const installed = readFileSync(path.join(root, "node_modules/electron/dist/version"), "utf8").trim();
  if (override) {
    const local = existsSync(path.join(override, "version")) ? readFileSync(path.join(override, "version"), "utf8").trim() : "unknown";
    if (local !== installed) throw new Error(`the local Electron copy at ${override} is ${local}, not the installed ${installed}`);
    return path.join(override, "electron.exe");
  }
  return path.join(root, "node_modules/electron/dist/electron.exe");
}

const entry = path.join(root, "out", "calibration-main");
if (!existsSync(path.join(entry, "main.js")) || !existsSync(path.join(entry, "package.json"))) {
  console.error("BLOCKED: out/calibration-main is not built (npm run build:calibration)");
  process.exit(2);
}

const server = spawn(process.execPath, ["mock-site/server.mjs"], { cwd: root, env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
let exitCode = 1;
try {
  for (let attempt = 0; attempt < 80 && !(await fetch(LAB).then((r) => r.ok, () => false)); attempt += 1) await new Promise((r) => setTimeout(r, 100));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AWKIT_CALIBRATION_LAB_URL: LAB,
    AWKIT_CALIBRATION_BUDGET_MS: String(SESSION_BUDGET_MS),
    AWKIT_CALIBRATION_CONCURRENCY: String(SESSION_LANES),
    // --audit: launch nothing; read every grant back through the store with the real safeStorage key.
    ...(process.argv.includes("--audit") ? { AWKIT_CALIBRATION_MODE: "audit" } : {})
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = electronExecutable();
  console.log(`Calibration session: ${executable} ${entry}, budget ${SESSION_BUDGET_MS / 60000} min, lab ${LAB}\n`);
  const lines: Array<Record<string, unknown>> = [];
  exitCode = await new Promise<number>((resolve) => {
    const child = spawn(executable, [entry], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("CALIBRATION ")) {
          try {
            lines.push(JSON.parse(line.slice("CALIBRATION ".length)) as Record<string, unknown>);
          } catch {
            // not ours
          }
        }
      }
    });
    child.stderr.on("data", () => undefined);
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
  for (const line of lines) {
    if (line.kind === "cell") {
      const primary = line.primary as { passed: number; failed: number; inconclusive: number } | undefined;
      console.log(
        `  ${String(line.cell).padEnd(14)} ${line.qualified ? "QUALIFIED " : "unqualified"} launches=${line.launches ?? 0} sessions=${line.sessions ?? 0} ` +
          `primary ${primary ? `${primary.passed}/${primary.failed}/${primary.inconclusive}` : "-"} p95=${line.p95Ms ?? "-"}ms` +
          (line.grant ? ` grant expires ${(line.grant as { expiresAt: string }).expiresAt}` : "") +
          (Array.isArray(line.unmet) && line.unmet.length ? `\n${" ".repeat(18)}unmet: ${(line.unmet as string[]).join("; ")}` : "")
      );
    } else {
      console.log(`  [${line.kind}] ${JSON.stringify(line)}`);
    }
  }
  if (process.argv.includes("--audit")) {
    const grants = lines.filter((l) => l.kind === "grant");
    if (grants.length === 0 || grants.some((g) => g.status !== "valid")) exitCode = exitCode || 1;
    console.log(`\nGrant audit: ${grants.filter((g) => g.status === "valid").length} of ${grants.length} valid with the real key.`);
  } else if (!lines.some((l) => l.kind === "done")) {
    console.error("\nThe calibration root did not finish a session (see the lines above).");
  }
} catch (error) {
  console.error(`BLOCKED: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 2;
} finally {
  server.kill();
}
process.exit(exitCode);
