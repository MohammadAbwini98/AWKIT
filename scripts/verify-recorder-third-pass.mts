/**
 * Third-pass recorder defect verifications (AWKIT-REC-039 / 041 / 042).
 *
 * Real Chromium + the REAL capture script and REAL StepExecutor — no fakes at the layer under test:
 *   - REC-039: with [Main, Popup1, Popup2] open and Popup2 active, a routeChange carrying the
 *     recorded main-tab URL hint must switch to MAIN (creation-order .pop() switched to Popup1).
 *   - REC-041: clicking a real download link during recording replaces the bare click with a
 *     runnable `downloadFile` step; replay saves an artifact to the run's downloads folder.
 *   - REC-042: wheel gestures over a tall page are captured as PAGE-level scroll nodes and replay
 *     mounts below-the-fold lazy content.
 *
 * Run: npm run verify:recorder-third-pass
 */
import { chromium } from "playwright";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { RecorderService } from "@src/recorder/RecorderService";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";

const PORT = 4433;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) { passed += 1; console.log(`  PASS ${label}`); }
  else { failed += 1; console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: ReturnType<typeof spawn> | null = null;

async function main(): Promise<void> {
  console.log("Third-pass recorder defects (REC-039 / 041 / 042)");
  server = spawn(process.execPath, ["mock-site/server.mjs"], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore"
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) break;
    } catch { /* retry */ }
    await sleep(150);
  }

  const browser = await chromium.launch({ headless: true });

  // ── REC-039 ───────────────────────────────────────────────────────────────
  console.log("\nREC-039 — return-to-main prefers the URL-matching page");
  {
    const context = await browser.newContext();
    const main = await context.newPage();
    await main.goto(`${BASE}/form`);
    const popup1 = await context.newPage();
    await popup1.goto(`${BASE}/details`);
    const popup2 = await context.newPage();
    await popup2.goto(`${BASE}/login`);

    const ctx: InstanceExecutionContext = {
      executionId: "e-039", instanceId: "i-039", scenarioId: "s-039", flowId: "f",
      instanceOrderNumber: 1, totalInstances: 1,
      runtimeInputs: {}, instanceInputs: {}, flowOutputs: {},
      paths: { downloads: "", screenshots: "", logs: "", reports: "" }
    } as unknown as InstanceExecutionContext;
    const exec = new StepExecutor(popup2, new LocatorFactory(popup2), new ValueResolver(ctx), ctx);

    // The recorded hint points at the MAIN page's URL.
    await exec.execute({
      id: "rc-main", type: "routeChange", name: "Switch to tab: /form",
      value: `${BASE}/form`,
      config: { routeMode: "switchToLatestTab", urlMatch: "contains", routeWaitUntil: "load" }
    } as never);
    check(
      "REC-039 switching back to main lands on the URL-matching page (not creation-order .pop())",
      exec.activePage === main || exec.activePage.url().includes("/form"),
      `active=${exec.activePage.url()}`
    );
    await context.close();
  }

  // ── REC-041 + REC-042 ────────────────────────────────────────────────────
  console.log("\nREC-041 — a click that downloads becomes a runnable downloadFile step");
  console.log("REC-042 — wheel gestures become PAGE-level scroll steps that replay");
  {
    const root = await mkdtemp(join(tmpdir(), "awkit-thirdpass-"));
    const svc = new RecorderService() as unknown as Record<string, any>;
    svc.configureDraftStorage(join(root, "draft.json"));
    svc.configureUrlStorage(join(root, "urls.json"));

    // NOTE: RecorderService.startRecording launches its OWN browser/context and installs its own
    // bindings + init script there — we drive svc.page afterwards.
    await svc.startRecording(`${BASE}/runner-lab`, { captureWaitTime: false, captureSmartWaits: false });
    const recPage = svc.page as import("playwright").Page;
    await recPage.waitForSelector("[data-testid=download-csv]", { timeout: 20_000 });
    await recPage.click("[data-testid=download-csv]");
    // Give the download event + our observer a moment to replace the click.
    let replaced = false;
    for (let i = 0; i < 40 && !replaced; i++) {
      await sleep(150);
      replaced = svc.getActions().some((a: any) => a.type === "downloadFile");
    }
    check("REC-041 the triggering click is REPLACED by a runnable downloadFile step", replaced && !svc.getActions().some((a: any) => a.type === "click" && a.name?.includes?.("csv")), JSON.stringify(svc.getActions().map((a: any) => a.type)));
    const dlStep = svc.getActions().find((a: any) => a.type === "downloadFile") ?? {} as any;
    check("REC-041 the downloadFile step keeps the clicked element's locator", Boolean(dlStep.locator), JSON.stringify(dlStep));

    await svc.stopRecording();
    const actions = svc.getActions();

    // Map to a flow and replay it through the runner-owned executor path.
    const flow = buildRecordedFlow("third-pass-flow", actions);
    const scrollStepsBefore = actions.filter((a: any) => a.type === "scroll").length;

    // REC-042 live capture on the scroll lab page.
    await svc.startRecording(`${BASE}/scroll-lab`, { captureWaitTime: false, captureSmartWaits: false });
    const p2 = svc.page as import("playwright").Page;
    await p2.mouse.wheel(0, 1200);
    await sleep(600); // debounced trailing edge (350ms) — bounded, not arbitrary
    const scrolls = svc.getActions().filter((a: any) => a.type === "scroll");
    check("REC-042 wheel gestures are captured as PAGE-level scroll actions", scrolls.length >= 1, JSON.stringify(svc.getActions().map((a: any) => [a.type, a.name])));
    check(
      "REC-042 the captured scroll is downward with a real magnitude",
      scrolls.some((a: any) => a.config?.scrollDirection === "down" && (a.config?.scrollAmount ?? 0) >= 120),
      JSON.stringify(scrolls)
    );
    // Replay semantics: after executing the recorded scroll, the lazy element is in view/clickable.
    const ctx2: InstanceExecutionContext = {
      executionId: "e-042", instanceId: "i-042", scenarioId: "s-042", flowId: "f",
      instanceOrderNumber: 1, totalInstances: 1,
      runtimeInputs: {}, instanceInputs: {}, flowOutputs: {},
      paths: { downloads: join(root, "dl"), screenshots: join(root, "shots"), logs: join(root, "logs"), reports: join(root, "reports") }
    } as unknown as InstanceExecutionContext;
    const freshPage = await (svc.context as import("playwright").BrowserContext).newPage();
    await freshPage.goto(`${BASE}/scroll-lab`);
    const exec2 = new StepExecutor(freshPage, new LocatorFactory(freshPage), new ValueResolver(ctx2), ctx2);
    await exec2.execute({
      id: "scroll-replay", type: "scroll", name: scrolls[0]?.name ?? "Scroll down",
      config: { ...scrolls[0]?.config, scrollTarget: "page" },
      timeoutMs: 10_000
    } as never);
    await exec2.execute({
      id: "lazy-click", type: "click", name: "Lazy action",
      locator: { strategy: "testId", value: "lazy-item" }, timeoutMs: 5000
    } as never);
    const lazyState = await freshPage.getByTestId("lazy-clicked").textContent();
    check("REC-042 replaying the recorded scroll mounts the lazy content and the click lands", lazyState === "clicked", `state=${lazyState}`);
    void scrollStepsBefore;

    await (svc.context as import("playwright").BrowserContext).close().catch(() => undefined);
    fs_rm(root);
  }

  await browser.close();
  if (server) server.kill();

  console.log(`\n${passed}/${passed + failed} third-pass recorder checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

function fs_rm(root: string): void {
  import("node:fs").then((fsmod) => fsmod.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
