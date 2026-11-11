/**
 * Launch observability for the packaged-application gates.
 *
 * When the packaged main window never appears, the gates used to report only that. On 2026-11-08 the
 * process had in fact exited after 3.4 s (child-process launch error_code=18 from the Parallels share,
 * then "GPU process isn't usable"), and it took a separate diagnostic to see it. This helper records the
 * launched process's exit and the last notable lines of its Chromium log, so a failure message says why.
 *
 * Diagnostic only: it never changes what a gate accepts. `PACKAGED_LAUNCH_LOG_ENV` turns on Chromium's
 * stderr logging and nothing else (no GPU, sandbox or security switch).
 */
import type { ElectronApplication } from "playwright";

export const PACKAGED_LAUNCH_LOG_ENV = { ELECTRON_ENABLE_LOGGING: "1" } as const;

const NOTABLE = /fatal|error|crash|launch.?failed|isn't usable|denied/i;
const KEEP = 12;

export interface PackagedLaunchDiagnostics {
  /** One line: how the process ended (or that it is still running) and its notable log lines. */
  describe(): string;
}

export function watchPackagedLaunch(app: ElectronApplication): PackagedLaunchDiagnostics {
  const child = app.process();
  const notable: string[] = [];
  let partial = "";
  let exit: { code: number | null; signal: string | null } | null =
    child.exitCode !== null || child.signalCode !== null ? { code: child.exitCode, signal: child.signalCode } : null;

  const take = (chunk: Buffer | string): void => {
    const lines = (partial + chunk.toString()).split(/\r?\n/);
    partial = lines.pop() ?? "";
    for (const line of lines) {
      if (!NOTABLE.test(line)) continue;
      notable.push(line.trim().slice(0, 240));
      if (notable.length > KEEP) notable.shift();
    }
  };
  child.stderr?.on("data", take);
  child.stdout?.on("data", take);
  child.once("exit", (code, signal) => {
    exit = { code, signal };
  });

  return {
    describe(): string {
      let status = "the launched process was still running";
      if (exit) {
        const code = exit.code === null ? "none" : exit.code > 255 ? `${exit.code} (0x${(exit.code >>> 0).toString(16)})` : String(exit.code);
        status = `the launched process exited with code ${code}${exit.signal ? `, signal ${exit.signal}` : ""}`;
      }
      return notable.length > 0 ? `${status}; last notable log lines: ${notable.join(" | ")}` : `${status}; no notable log lines`;
    }
  };
}
