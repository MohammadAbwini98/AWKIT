/**
 * Element Spy in the real Electron app: open it, inspect through the Recorder's own browser, and watch
 * main's AI job. Shared by `verify:ai-assist-gui` (scripted provider) and `verify:ai-spy-live` (the real
 * 0.8B), so both drive the one path a person uses.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ElectronApplication, Page } from "playwright";

export const SPY_LAB = "/recorder-lab/element-spy";
export const SPY_FRAME = '[data-testid="spy-frame"]';

export async function until<T>(probe: () => Promise<T | null | undefined | false>, timeout = 15_000): Promise<T | null> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The Feature Test Lab on `port`, ready once it serves the Element Spy lab. */
export async function startFeatureTestLab(root: string, port: number): Promise<ChildProcess> {
  const site = spawn(process.execPath, ["mock-site/server.mjs"], {
    cwd: root,
    env: { ...process.env, MOCK_SITE_PORT: String(port) },
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true
  });
  if (!(await until(async () => (await fetch(`http://127.0.0.1:${port}${SPY_LAB}`).catch(() => null))?.ok, 30_000))) {
    site.kill();
    throw new Error(`the Feature Test Lab did not start on port ${port}`);
  }
  return site;
}

/**
 * Element Spy inspects only a TRUSTED click (`event.isTrusted`), which no page script can forge, and the
 * renderer has no reach into the Recorder's browser. So the harness goes through the Recorder's OWN
 * Playwright connection: in the Electron main process it wraps `chromium.launch` on the shared
 * `playwright` module before the Spy opens, keeping the Browser the product itself launched — never a
 * second one — and a click through it arrives exactly as a person's does. Main's ESM import and this
 * `createRequire` resolve to one cached `playwright-core`, so this is the `chromium` RecorderService
 * calls. Verifier-only: no product code knows about it. (No named inner functions: esbuild's `__name`
 * does not exist in main.)
 */
export async function captureRecorderBrowsers(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ app: mainApp }) => {
    const store = globalThis as unknown as { __awkitRecorderBrowsers?: unknown[] };
    if (store.__awkitRecorderBrowsers) return;
    const browsers: unknown[] = [];
    store.__awkitRecorderBrowsers = browsers;
    const nodeModule = (process as unknown as { getBuiltinModule(id: string): typeof import("node:module") }).getBuiltinModule("node:module");
    const { chromium } = nodeModule.createRequire(`${mainApp.getAppPath()}/package.json`)("playwright") as typeof import("playwright");
    const launch = chromium.launch.bind(chromium);
    chromium.launch = async (...args: Parameters<typeof chromium.launch>) => {
      const browser = await launch(...args);
      browsers.push(browser);
      return browser;
    };
  });
}

export type RecorderPageOp = { op: "count" | "goto" | "close" | "click" | "text" | "data-spy"; path?: string; to?: string; selector?: string; frame?: string };

/** One operation on the live Recorder page at `path`, through the Recorder's own connection. */
export async function recorderPage(electronApp: ElectronApplication, request: RecorderPageOp): Promise<string> {
  return electronApp.evaluate(async (_electron, a) => {
    const browsers = (globalThis as unknown as { __awkitRecorderBrowsers?: import("playwright").Browser[] }).__awkitRecorderBrowsers ?? [];
    const pages = browsers.flatMap((browser) => browser.contexts()).flatMap((context) => context.pages()).filter((page) => !page.isClosed());
    if (a.op === "count") return `${browsers.length} browser(s), open pages: ${pages.map((page) => new URL(page.url()).pathname).join(" ")}`;
    const page = pages.find((candidate) => new URL(candidate.url()).pathname === a.path);
    if (!page) throw new Error(`no open Recorder page at ${a.path}; open: ${pages.map((candidate) => candidate.url()).join(", ")}`);
    if (a.op === "goto") {
      await page.goto(a.to ?? page.url());
      return page.url();
    }
    if (a.op === "close") {
      await page.close();
      return "";
    }
    const target = (a.frame ? page.frameLocator(a.frame) : page).locator(a.selector ?? "");
    if (a.op === "click") {
      await target.click({ timeout: 10_000 });
      return "";
    }
    if (a.op === "data-spy") return `${await target.count()}:${(await target.first().getAttribute("data-spy", { timeout: 5_000 })) ?? ""}`;
    return target.innerText({ timeout: 10_000 });
  }, request);
}

/**
 * Click an element while inspecting and wait until main holds a NEW inspection of it and the Spy panel
 * shows it. Consecutive inspections are of differently named elements wherever the renderer's 800 ms
 * poll would otherwise be indistinguishable from "already shown".
 */
export async function inspectInSpy(electronApp: ElectronApplication, win: Page, target: { selector: string; frame?: string }, name: string) {
  const before = (await win.evaluate(() => window.playwrightFlowStudio.recorder.getInspection())).inspection?.inspectedAt ?? null;
  await recorderPage(electronApp, { op: "click", path: SPY_LAB, ...target });
  const inspection = await until(async () => {
    const state = await win.evaluate(() => window.playwrightFlowStudio.recorder.getInspection());
    return state.inspection && state.inspection.inspectedAt !== before && state.inspection.owner.name === name ? state.inspection : null;
  });
  if (inspection) {
    await win.getByTestId("element-spy-name").filter({ hasText: name }).waitFor({ state: "visible", timeout: 10_000 });
    await win.getByTestId("element-spy-ai").waitFor({ state: "visible", timeout: 10_000 });
  }
  return inspection;
}

/**
 * Open Element Spy through its button. The service reports `inspecting` before its browser has even
 * launched, so the signal is the page's own confirmation, set once the Target URL has loaded.
 */
export async function openSpy(win: Page): Promise<string | null> {
  await win.getByTestId("element-spy-start").click();
  return until(async () => {
    const message = await win.getByTestId("element-spy-message").innerText();
    return /^Element Spy opened/.test(message) ? message : null;
  }, 60_000);
}

/** Main holds the AI job, then lets it go: the precondition and the proof of every cancel. */
export async function aiBusy(win: Page, timeout = 10_000): Promise<boolean> {
  return Boolean(await until(async () => (await win.evaluate(() => window.playwrightFlowStudio.ai.getStatus())).state === "busy", timeout));
}
export async function aiReleased(win: Page, timeout = 5_000): Promise<boolean> {
  return Boolean(
    await until(async () => {
      const now = await win.evaluate(() => window.playwrightFlowStudio.ai.getStatus());
      return now.state !== "busy" && now.queueDepth === 0;
    }, timeout)
  );
}

/** Every file a proposal must not touch under `appData`: flows, fragments, reports, and any Recorder draft. */
export function persistedState(appData: string): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^(flows|fragments|reports)[\\/]/.test(path.relative(appData, full)) || /draft/i.test(entry.name)) {
        files.push(`${path.relative(appData, full)}=${createHash("sha256").update(readFileSync(full)).digest("hex")}`);
      }
    }
  };
  walk(appData);
  return files.sort().join("\n");
}

/** The AI host's traffic for one ask: each infer request's host id, job id and prompt, and each reply by host id. */
export type HostTraffic = {
  requests: { child: number; id: string; jobId: string; user: string }[];
  replies: { child: number; id: string; ok: boolean; text?: string; reason?: string }[];
};
export type HostAttempt = { attempt: number; ok: boolean; text?: string; reason?: string };

/**
 * The attempts one ask made, in order: each reply paired with the infer request it answers by host and id.
 * Anything else — a load or hello reply, another utility host, a job asked before this one (a cancelled
 * request answering late) — answers no request of this ask and is left out. `jobs` counts the §7 jobs
 * (`<job>.a<n>#<host try>`) this ask's requests belong to.
 */
export function attemptsOf(traffic: HostTraffic): { jobs: number; attempts: HostAttempt[] } {
  const sent = new Map(traffic.requests.map((request) => [`${request.child}:${request.id}`, request.jobId]));
  const attempts: HostAttempt[] = [];
  for (const { child, id, ...reply } of traffic.replies) {
    const jobId = sent.get(`${child}:${id}`);
    if (jobId) attempts.push({ attempt: Number(/\.a(\d+)#\d+$/.exec(jobId)?.[1] ?? NaN), ...reply });
  }
  return { jobs: new Set(traffic.requests.map((request) => request.jobId.replace(/\.a\d+#\d+$/, ""))).size, attempts: attempts.sort((a, b) => a.attempt - b.attempt) };
}

/**
 * One ask's counts, each from its own source: the host's requests and replies, and `refused` — the
 * panel's `attemptsUsed`, L3 §7's budget, which only a refusal spends. They are not interchangeable: a
 * proposal proven after a refusal is two replies and one refusal. What the loop's own contract
 * (`LocatorAttemptResult.calls`) does promise is that every call but the last spends, so the replies
 * exceed the refusals by at most one — by exactly one when a proposal is shown, since the shown answer
 * spent nothing. `consistent` is that, plus every request of this one job answered once, in attempt order.
 */
export function askAccounting(traffic: HostTraffic, refused: number | undefined, shown: boolean) {
  const { jobs, attempts } = attemptsOf(traffic);
  const unspent = attempts.length - (refused ?? Number.NaN);
  const consistent =
    jobs === 1 && attempts.length === traffic.requests.length && attempts.every((a, i) => a.attempt === i + 1) && (shown ? unspent === 1 : unspent === 0 || unspent === 1);
  return { jobs, requests: traffic.requests.length, replies: attempts.length, refused, shown, attempts, consistent };
}
