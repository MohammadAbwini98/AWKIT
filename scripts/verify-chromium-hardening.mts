/**
 * Phase 5.1C — Chromium no-egress hardening verification.
 * Run with: npm run verify:chromium-hardening
 *
 * Proves, against the BUNDLED Chromium (resources/browsers/chromium/chrome.exe):
 *  A. arg construction: env contract (AWKIT_CHROMIUM_OFFLINE_HARDENING /
 *     AWKIT_CHROMIUM_EXTRA_ARGS), Playwright disable-features superset rule
 *  B. hardened launch emits ZERO non-loopback TCP connections during a 20s idle window
 *     (baseline Playwright defaults are known to emit a Google-service burst)
 *  C. hardening does NOT break user navigation — external sites (including google.com,
 *     whose SERVICE hosts are loopback-mapped) still load (skipped when offline)
 *
 * Requires internet for part C's positive proof; when offline, part C reports skipped —
 * part B is still meaningful (no egress is trivially true offline, so part B also notes it).
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildChromiumHardeningArgs, isChromiumHardeningEnabled } from "@src/runner/ChromiumHardening";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const exePath = join(root, "resources", "browsers", "chromium", "chrome.exe");

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bundledChromePids(): Promise<number[]> {
  return new Promise((res) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.ExecutablePath -like '*resources\\browsers\\chromium*' } | Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress"
      ],
      { maxBuffer: 1e7, windowsHide: true },
      (e, out) => {
        if (e || !out.trim()) return res([]);
        try {
          const v = JSON.parse(out);
          res(Array.isArray(v) ? v : [v]);
        } catch {
          res([]);
        }
      }
    );
  });
}

/** Sample established/syn-sent TCP connections owned by the given pids for `durationMs`. */
async function sampleEgress(pids: number[], durationMs: number): Promise<Map<string, number>> {
  const remotes = new Map<string, number>();
  if (pids.length === 0) return remotes;
  const sampler = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$pids=@(${pids.join(",")}); while($true){ Get-NetTCPConnection -State Established,SynSent -ErrorAction SilentlyContinue | Where-Object { $pids -contains $_.OwningProcess } | ForEach-Object { \"$($_.RemoteAddress)|$($_.RemotePort)\" }; Start-Sleep -Milliseconds 350 }`
    ],
    { windowsHide: true }
  );
  sampler.stdout.on("data", (d: Buffer) => {
    for (const line of String(d).trim().split("\n")) {
      const [addr, port] = line.trim().split("|");
      if (!addr) continue;
      if (addr.startsWith("127.") || addr === "::1" || addr === "0.0.0.0" || addr === "::" || addr === "") continue;
      remotes.set(`${addr}:${port}`, (remotes.get(`${addr}:${port}`) ?? 0) + 1);
    }
  });
  await sleep(durationMs);
  sampler.kill();
  return remotes;
}

async function main(): Promise<void> {
  console.log("Chromium no-egress hardening verification (Phase 5.1C)");

  console.log("\nPart A — arg construction & env contract");
  const on = buildChromiumHardeningArgs({ AWKIT_CHROMIUM_OFFLINE_HARDENING: "true" } as NodeJS.ProcessEnv);
  const off = buildChromiumHardeningArgs({ AWKIT_CHROMIUM_OFFLINE_HARDENING: "false" } as NodeJS.ProcessEnv);
  const offExtra = buildChromiumHardeningArgs({
    AWKIT_CHROMIUM_OFFLINE_HARDENING: "false",
    AWKIT_CHROMIUM_EXTRA_ARGS: "--foo --bar=1"
  } as NodeJS.ProcessEnv);
  const onExtra = buildChromiumHardeningArgs({
    AWKIT_CHROMIUM_OFFLINE_HARDENING: "true",
    AWKIT_CHROMIUM_EXTRA_ARGS: "--foo"
  } as NodeJS.ProcessEnv);
  check("hardening enabled by default", isChromiumHardeningEnabled({} as NodeJS.ProcessEnv));
  check("AWKIT_CHROMIUM_OFFLINE_HARDENING=false disables hardening args", off.length === 0);
  check("hardened arg set is non-empty and includes --disable-background-networking", on.includes("--disable-background-networking"));
  const disableFeatures = on.find((a) => a.startsWith("--disable-features="));
  check(
    "--disable-features is a SUPERSET of Playwright's list (last-wins rule)",
    Boolean(disableFeatures?.includes("MediaRouter") && disableFeatures?.includes("Translate") && disableFeatures?.includes("OptimizationHints")),
    disableFeatures?.slice(0, 120)
  );
  check(
    "search-preconnect features disabled (netlog-verified www.google.com source)",
    Boolean(disableFeatures?.includes("PreconnectToSearch") && disableFeatures?.includes("PrewarmDefaultSearchEngine"))
  );
  check(
    "host-resolver-rules map service hosts to loopback",
    on.some((a) => a.startsWith("--host-resolver-rules=") && a.includes("MAP update.googleapis.com 127.0.0.1"))
  );
  check("AWKIT_CHROMIUM_EXTRA_ARGS appended when hardening disabled", offExtra.join(" ") === "--foo --bar=1");
  check("AWKIT_CHROMIUM_EXTRA_ARGS appended last when hardening enabled", onExtra[onExtra.length - 1] === "--foo");

  if (!existsSync(exePath)) {
    check("bundled Chromium present", false, exePath);
    console.log(`\nResult: ${passed} passed, ${failed} failed.`);
    process.exit(1);
  }

  console.log("\nPart B — hardened idle launch emits zero non-loopback connections (20s window)");
  const preexisting = await bundledChromePids();
  check("no pre-existing bundled-Chromium processes contaminate the sample", preexisting.length === 0, preexisting.join(","));
  const browser = await chromium.launch({ executablePath: exePath, headless: true, args: on });
  let hardenedEgress = new Map<string, number>();
  let navResults: Array<{ url: string; ok: boolean; detail: string }> = [];
  try {
    await sleep(1000);
    const pids = await bundledChromePids();
    check("bundled Chromium launched under hardened args", pids.length > 0, `pids: ${pids.join(",")}`);
    const page = await browser.newPage();
    await page.goto("about:blank");
    hardenedEgress = await sampleEgress(pids, 20000);
    check(
      "ZERO non-loopback TCP connections during hardened idle window",
      hardenedEgress.size === 0,
      [...hardenedEgress.keys()].slice(0, 6).join(", ")
    );

    console.log("\nPart C — user navigation still works under hardening (needs internet)");
    for (const url of ["https://www.google.com/", "https://example.com/"]) {
      try {
        const resp = await page.goto(url, { timeout: 15000 });
        navResults.push({ url, ok: (resp?.status() ?? 0) === 200, detail: `${resp?.status()} ${await page.title()}` });
      } catch (error) {
        navResults.push({ url, ok: false, detail: error instanceof Error ? error.message.split("\n")[0] : String(error) });
      }
    }
    const offline = navResults.every((r) => !r.ok && /ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|PROXY|NETWORK)/.test(r.detail));
    if (offline) {
      console.log("  ⚠ machine appears OFFLINE — navigation proof skipped (part B egress check is trivially true offline)");
      check("navigation check skipped while offline (rerun online for the positive proof)", true);
    } else {
      for (const r of navResults) check(`navigation to ${r.url} works under hardening`, r.ok, r.detail);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`✗ Unhandled failure: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
