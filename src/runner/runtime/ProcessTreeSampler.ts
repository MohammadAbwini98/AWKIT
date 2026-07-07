/**
 * Samples the Chrome/Chromium process tree that AWKIT itself launched (descendants of the Electron
 * main process). Windows-first via a single PowerShell/CIM query; no native deps, no admin required
 * for the app's OWN child processes. Sampling problems yield an `availability` of `partial`/
 * `unavailable` with all-undefined metrics and NEVER throw — reporting must never affect execution.
 *
 * Cost control mirrors ResourceSampler: a single unref'd timer, one query per tick, and the tick is
 * skipped entirely while a previous query is still in flight. Per-process CPU is intentionally NOT
 * collected here (it needs two spaced CIM reads and is expensive); `chromiumCpuPercent` stays
 * undefined and the UI shows the host-level CPU from ResourceSampler instead.
 *
 * See docs/ai/ui-reports-refactor/04_*.md §3 and 06_*.md.
 */
import { execFile } from "node:child_process";
import os from "node:os";

export type SampleAvailability = "full" | "partial" | "unavailable";

export interface ProcessTreeSample {
  sampledAt: string;
  /** Chrome/Chromium processes descended from this app (all helper types included). */
  chromiumProcessCount?: number;
  chromiumMemoryMb?: number;
  /** Electron main process RSS (always available; from process.memoryUsage). */
  electronMainMemoryMb?: number;
  availability: SampleAvailability;
  availabilityReason?: string;
}

const CHROMIUM_IMAGE_NAMES = ["chrome.exe", "chromium.exe", "msedge.exe"];

export class ProcessTreeSampler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private latestSample: ProcessTreeSample | undefined;

  constructor(private readonly intervalMs = 5000) {}

  get latest(): ProcessTreeSample | undefined {
    return this.latestSample;
  }

  /** `onSample` (if given) runs after each tick — used to persist history. Its errors are swallowed. */
  start(onSample?: (sample: ProcessTreeSample) => void): void {
    if (this.timer) return;
    const tick = () => {
      void this.sample().then((sample) => {
        try {
          onSample?.(sample);
        } catch {
          /* reporting must never affect execution */
        }
      });
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
    if (typeof this.timer === "object" && "unref" in this.timer) this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Take one sample now. Never throws; returns a best-effort snapshot. */
  async sample(): Promise<ProcessTreeSample> {
    if (this.inFlight && this.latestSample) return this.latestSample;
    this.inFlight = true;
    const sampledAt = new Date().toISOString();
    const electronMainMemoryMb = safeMainRssMb();

    if (os.platform() !== "win32") {
      const result: ProcessTreeSample = {
        sampledAt,
        electronMainMemoryMb,
        availability: "partial",
        availabilityReason: "Process-tree sampling is implemented for Windows only."
      };
      this.latestSample = result;
      this.inFlight = false;
      return result;
    }

    try {
      const tree = await this.queryChromiumTree();
      const result: ProcessTreeSample = {
        sampledAt,
        electronMainMemoryMb,
        chromiumProcessCount: tree.count,
        chromiumMemoryMb: tree.memoryMb,
        availability: "full"
      };
      this.latestSample = result;
      return result;
    } catch (error) {
      const result: ProcessTreeSample = {
        sampledAt,
        electronMainMemoryMb,
        availability: "unavailable",
        availabilityReason: error instanceof Error ? error.message : String(error)
      };
      this.latestSample = result;
      return result;
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Enumerate Chromium descendants of THIS process via one CIM query. Walks ProcessId/
   * ParentProcessId to keep only the app's own subtree (so a user's separate Chrome is excluded).
   */
  private queryChromiumTree(): Promise<{ count: number; memoryMb: number }> {
    const rootPid = process.pid;
    const script = [
      "$ErrorActionPreference='Stop';",
      "$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize;",
      "$byParent = @{};",
      "foreach ($p in $all) { if (-not $byParent.ContainsKey($p.ParentProcessId)) { $byParent[$p.ParentProcessId] = @() }; $byParent[$p.ParentProcessId] += $p }",
      `$root = ${rootPid};`,
      "$stack = New-Object System.Collections.Stack; $stack.Push($root);",
      "$descendants = @(); $seen = @{};",
      "while ($stack.Count -gt 0) { $cur = $stack.Pop(); if ($byParent.ContainsKey($cur)) { foreach ($c in $byParent[$cur]) { if (-not $seen.ContainsKey($c.ProcessId)) { $seen[$c.ProcessId]=$true; $descendants += $c; $stack.Push($c.ProcessId) } } } }",
      `$names = @(${CHROMIUM_IMAGE_NAMES.map((n) => `'${n}'`).join(",")});`,
      "$chrome = $descendants | Where-Object { $names -contains $_.Name };",
      "$count = @($chrome).Count;",
      "$mem = ($chrome | Measure-Object -Property WorkingSetSize -Sum).Sum;",
      "if (-not $mem) { $mem = 0 };",
      "Write-Output (\"{0}|{1}\" -f $count, [int64]$mem)"
    ].join(" ");

    return new Promise((resolve, reject) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        { timeout: 8000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          const line = String(stdout).trim().split(/\r?\n/).pop() ?? "";
          const [countRaw, memRaw] = line.split("|");
          const count = Number.parseInt(countRaw, 10);
          const memBytes = Number.parseInt(memRaw, 10);
          if (Number.isNaN(count)) {
            reject(new Error(`unparseable process-tree output: ${line.slice(0, 80)}`));
            return;
          }
          resolve({
            count,
            memoryMb: Number.isNaN(memBytes) ? 0 : Math.round(memBytes / (1024 * 1024))
          });
        }
      );
    });
  }
}

function safeMainRssMb(): number | undefined {
  try {
    return Math.round(process.memoryUsage().rss / (1024 * 1024));
  } catch {
    return undefined;
  }
}
