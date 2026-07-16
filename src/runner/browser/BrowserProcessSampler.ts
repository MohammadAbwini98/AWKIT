/**
 * Attributes real memory to individual pooled Chromium browsers by summing each browser's process SUBTREE
 * (the root browser process + its renderer/gpu/utility children) via one Windows CIM query that walks
 * ParentProcessId — the same reliable mechanism `ProcessTreeSampler` uses for the app-wide tree, here
 * rooted at each given browser PID instead of the app PID.
 *
 * This is what makes memory-based shared-browser recycling trustworthy: `SharedBrowserPool` owns the
 * `Browser` objects, `browser.process()?.pid` gives each one's root PID, and this returns per-root subtree
 * RSS so a browser can be DRAINED when its own footprint (not a global figure) stays over budget.
 *
 * Windows-only; on other platforms (or on any query error) it returns an empty map so the caller keeps
 * memory recycling DISABLED rather than acting on unattributable numbers — reporting never throws.
 */
import { execFile } from "node:child_process";
import os from "node:os";

const CHROMIUM_IMAGE_NAMES = ["chrome.exe", "chromium.exe", "msedge.exe", "chrome-headless-shell.exe"];

export interface BrowserSubtreeSampler {
  /** Map<rootPid → subtree RSS MB> for the given browser root PIDs. Empty when attribution is unavailable. */
  sample(rootPids: number[]): Promise<Map<number, number>>;
}

/** Real Windows sampler. Non-Windows → always empty (attribution unavailable → recycling stays off). */
export function createBrowserSubtreeSampler(): BrowserSubtreeSampler {
  if (os.platform() !== "win32") {
    return { sample: async () => new Map() };
  }
  return {
    sample: (rootPids: number[]) => sampleWindows(rootPids)
  };
}

function sampleWindows(rootPids: number[]): Promise<Map<number, number>> {
  const roots = [...new Set(rootPids.filter((p) => Number.isFinite(p) && p > 0))];
  if (roots.length === 0) return Promise.resolve(new Map());

  // Build the descendant map once, then for each root sum its own + all descendants' WorkingSetSize,
  // counting only Chromium image names (so the browser's own subtree is measured, not unrelated children).
  const script = [
    "$ErrorActionPreference='Stop';",
    "$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize;",
    "$byParent=@{}; $byPid=@{};",
    "foreach($p in $all){ if(-not $byParent.ContainsKey($p.ParentProcessId)){$byParent[$p.ParentProcessId]=@()}; $byParent[$p.ParentProcessId]+=$p; $byPid[$p.ProcessId]=$p }",
    `$names=@(${CHROMIUM_IMAGE_NAMES.map((n) => `'${n}'`).join(",")});`,
    `$roots=@(${roots.join(",")});`,
    "foreach($root in $roots){",
    "  $sum=[int64]0; $stack=New-Object System.Collections.Stack; $stack.Push($root); $seen=@{};",
    "  if($byPid.ContainsKey($root)){ $r=$byPid[$root]; if($names -contains $r.Name){ $sum+=[int64]$r.WorkingSetSize } }",
    "  while($stack.Count -gt 0){ $cur=$stack.Pop(); if($byParent.ContainsKey($cur)){ foreach($c in $byParent[$cur]){ if(-not $seen.ContainsKey($c.ProcessId)){ $seen[$c.ProcessId]=$true; if($names -contains $c.Name){ $sum+=[int64]$c.WorkingSetSize }; $stack.Push($c.ProcessId) } } } }",
    "  Write-Output ('{0}|{1}' -f $root,$sum)",
    "}"
  ].join(" ");

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return void resolve(new Map());
        const out = new Map<number, number>();
        for (const line of String(stdout).trim().split(/\r?\n/)) {
          const [pidRaw, bytesRaw] = line.split("|");
          const pid = Number.parseInt(pidRaw, 10);
          const bytes = Number.parseInt(bytesRaw, 10);
          if (Number.isFinite(pid) && Number.isFinite(bytes)) out.set(pid, Math.round(bytes / (1024 * 1024)));
        }
        resolve(out);
      }
    );
  });
}
