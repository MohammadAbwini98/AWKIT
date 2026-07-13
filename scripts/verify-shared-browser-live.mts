// Live REAL-Chromium proof for the shared browser pool (Concurrency plan Phase A5): leasing several
// isolated contexts through BrowserContextFactory + SharedBrowserPool actually shares a small number
// of real Chromium processes (each SharedBrowserPool "browser" == one real Browser == one process),
// contexts are usable and isolated, and drain/close reclaim them.
//
// Uses Playwright's real Chromium (dev, productionOffline:false). Run after deps are installed:
//   npx tsx scripts/verify-shared-browser-live.mts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserContextFactory } from "../src/runner/BrowserContextFactory";
import { SharedBrowserPool } from "../src/runner/browser/SharedBrowserPool";
import type { InstanceConfig } from "../src/instances/InstanceConfig";
import type { InstanceExecutionContext } from "../src/runner/InstanceExecutionContext";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

function config(i: number): InstanceConfig {
  return { id: `i${i}`, name: `i${i}`, browser: "chromium", headless: true, isolationMode: "browserContext", timeoutMs: 30000, viewport: { width: 1280, height: 720 } };
}
function ctx(root: string, i: number): InstanceExecutionContext {
  return {
    executionId: "live", instanceId: `i${i}`, scenarioId: "s", instanceOrderNumber: i + 1, totalInstances: 4,
    runtimeInputs: {}, instanceInputs: {}, flowOutputs: {},
    paths: { downloads: join(root, `d${i}`), screenshots: join(root, `s${i}`), logs: join(root, `l${i}`), reports: join(root, `r${i}`) }
  };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "awtkit-shared-live-"));
  // 4 contexts, cap 3/browser, up to 2 browsers → must fit on exactly 2 real Chromium processes.
  const pool = new SharedBrowserPool({ maxBrowsers: 2, maxContextsPerBrowser: 3, maxContextsPerBrowserHardLimit: 8, recycleAfterContexts: 999 });
  const factory = new BrowserContextFactory({ productionOffline: false, resourcesRoot: root, sharedBrowserPool: pool });

  const runtimes = [];
  for (let i = 0; i < 4; i++) runtimes.push(await factory.create(config(i), ctx(root, i)));

  const snap = pool.snapshot();
  check("4 leased contexts share <= 2 real Chromium browsers", snap.totalBrowsers <= 2 && snap.totalBrowsers >= 1, `browsers=${snap.totalBrowsers}`);
  check("all 4 contexts are active", snap.activeContexts === 4, `activeContexts=${snap.activeContexts}`);

  // Each context is usable (opens a real page and renders) and the four are distinct context objects
  // (Playwright guarantees per-context cookie/storage isolation for separate newContext() calls).
  let usable = 0;
  for (let i = 0; i < runtimes.length; i++) {
    const page = await runtimes[i].context.newPage();
    await page.goto(`data:text/html,<title>ctx${i}</title><body>ctx${i}</body>`);
    if ((await page.title()) === `ctx${i}`) usable += 1;
  }
  const distinct = new Set(runtimes.map((r) => r.context)).size;
  check("every shared context is usable (opens + renders its own page)", usable === 4, `usable=${usable}/4`);
  check("the four leases are distinct isolated contexts", distinct === 4, `distinct=${distinct}/4`);

  // Release all contexts, then drain — every real browser must close.
  for (const rt of runtimes) await rt.close();
  await pool.drainIdle();
  const after = pool.snapshot();
  check("draining after release closes every real browser", after.totalBrowsers === 0 && after.totalBrowsersClosed >= 1, `browsers=${after.totalBrowsers} closed=${after.totalBrowsersClosed}`);

  await rm(root, { recursive: true, force: true });

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nShared browser (live Chromium): ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
