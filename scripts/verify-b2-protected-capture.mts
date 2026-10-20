/**
 * Security reproduction — does the B2 per-attempt failure capture photograph a protected surface?
 *
 * Verifier class: **Real browser**. Drives the REAL `FlowExecutor.executeWithRetry` (the only production caller of
 * `StepExecutor.captureFailureEvidence`, `src/runner/FlowExecutor.ts:534`) over a REAL `StepExecutor` in real Chromium,
 * against the Feature Test Lab page `mock-site/public/secure-login/protected-login.html` served from a local server.
 *
 * It asserts the SECURITY PROPERTY, not today's behaviour: when a step fails while its page is a protected-login
 * surface, no screenshot, DOM or accessibility file may be written (AGENTS.md: never automate or scrape a protected
 * page; the L5a collector and N0 capture already exclude it). Planned in the N5 plan (finding 2) as a reproduction for
 * a separate security remediation; it is expected to FAIL until that remediation lands, and its result is recorded
 * truthfully, never relaxed. It changes no product code and does not weaken any capture: the control case proves the
 * ordinary failure capture still writes all four files.
 *
 * Cases:
 *   P1 `protectedLoginHandoff` node: the handoff pauses, the operator cancels, the step fails on the protected page.
 *   P2 `goto` to the same page with an MFA title: title-first auto-detection pauses, the operator cancels, the step
 *      fails. (The fixture's own title carries no protected wording, so auto-detection does not pause on it.)
 *   P3 an ordinary `click` fails on a protected page that no detector paused on.
 *   C1 control: the same `click` failure on an ordinary page writes screenshot, DOM, a11y and meta files.
 *   C2 control: a value typed into an ordinary field is not serialized into the DOM file.
 *
 * awkit-3gtj reproductions (each lists the WHOLE evidence root, so a file no returned ref names is caught too):
 *   R1a the page navigates to the protected page and back while the screenshot is being taken (the capture window).
 *   R1b a password field is added and removed again while the screenshot is being taken, with no navigation.
 *   R2  a screenshot that overruns the capture budget completes late; it must not leave an unreferenced PNG.
 *   R4  a password field inside a CLOSED shadow root (invisible to page script) on an otherwise ordinary page.
 *   R5  the user `screenshot` step and `ScreenshotService.capture` on a protected page write no PNG.
 *   C3  control: the user `screenshot` step and `ScreenshotService.capture` on an ordinary page still write the PNG.
 *   Independent-review reproductions (awkit-3gtj review F3/F4), each a field that comes and goes inside the window:
 *   R6a inside a shadow root nested in another open shadow root (existing before the window).
 *   R6b inside a shadow root attached to an existing element during the window.
 *   R6c inside a child frame that stubs `console.debug` and is removed again during the window.
 *   R7  the guard's CDP pass: a frame session that fails for any reason other than "part of the parent's session"
 *       must leave the page unscannable, never clear.
 * The R1/R2 cases wrap the real `page.screenshot` only to place a page change (or a delay) inside the capture window
 * deterministically; the capture itself is still the real Chromium screenshot.
 *
 * Run: npx tsx scripts/verify-b2-protected-capture.mts
 */
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { ManualHandoffController } from "@src/runner/ManualHandoffController";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { StepEvidenceRef, StepExecutionResult } from "@src/runner/RunnerResult";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { detectProtectedLogin } from "@src/security/ProtectedLoginDetector";
import { checkProtectedSurface } from "@src/visual";
import { ScreenshotService } from "@src/reports/ScreenshotService";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TYPED_VALUE = "TYPEDVALUE-7731-NOT-IN-DOM";
const PROTECTED_PATH = "/secure-login/protected-login.html";
/** The same fixture with an MFA title, so the runner's title-first auto-detection pauses on it (P2). */
const PROTECTED_MFA_TITLE_PATH = "/secure-login/protected-login-mfa-title.html";
const PLAIN_HTML = `<!doctype html><html><head><title>Plain form</title></head><body>
  <h1>Plain form</h1><label for="note">Note</label><input id="note" type="text" data-testid="note" />
  <button data-testid="present">Present</button></body></html>`;
/** An ordinary page whose custom element hides a password field inside a CLOSED shadow root (R4). */
const CLOSED_SHADOW_HTML = `<!doctype html><html><head><title>Account</title></head><body>
  <h1>Account</h1><x-vault></x-vault>
  <script>customElements.define("x-vault", class extends HTMLElement { constructor() { super();
    this.attachShadow({ mode: "closed" }).innerHTML = '<input type="password" data-testid="closed-pw" />'; } });</script></body></html>`;

/** An open shadow root nested inside another open shadow root (R6a). */
const NESTED_SHADOW_HTML = `<!doctype html><html><head><title>Nested</title></head><body><h1>Nested</h1><x-outer></x-outer>
  <script>customElements.define("x-inner", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = '<div id="slot">inner</div>'; } });
  customElements.define("x-outer", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<x-inner></x-inner>"; } });</script></body></html>`;
/** An ordinary element that gets a shadow root only during the window (R6b). */
const LATE_SHADOW_HTML = `<!doctype html><html><head><title>Late</title></head><body><h1>Late</h1><div id="host">host</div></body></html>`;
/** A same-origin child frame that silences console.debug (R6c, R7). */
const FRAME_STUB_HTML = `<!doctype html><html><head><title>Frame</title></head><body><h1>Frame</h1>
  <iframe id="f" srcdoc="<script>console.debug=function(){}</script><p>frame</p>"></iframe></body></html>`;

/** Every file under `root`, recursively (orphans included — not only the ones a ref names). */
async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  };
  await walk(root);
  return out;
}

/** Files that hold rendered or serialized page content (screenshot, DOM, a11y). */
const pageCaptureFiles = (files: string[]): string[] => files.filter((file) => /\.(png|html|ya?ml)$/i.test(file));

/** Files under `root` that no returned evidence ref names. */
const orphanFiles = (files: string[], refs: StepEvidenceRef[]): string[] => {
  const named = new Set(refs.map((ref) => ref.path).filter((path): path is string => !!path));
  return files.filter((file) => !named.has(file));
};

function contextFor(root: string, id: string): InstanceExecutionContext {
  return {
    executionId: `exec-${id}`,
    instanceId: `inst-${id}`,
    scenarioId: "scenario-b2",
    flowId: `flow-${id}`,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: root, screenshots: root, logs: root, reports: root }
  };
}

interface Run {
  result: StepExecutionResult;
  files: StepEvidenceRef[];
  handoffSeen: boolean;
}

/** Drive the real retry loop once. `cancelHandoff` cancels the first pause the step registers. */
async function runStep(page: Page, root: string, id: string, step: FlowStep, cancelHandoff: boolean): Promise<Run> {
  const context = contextFor(root, id);
  const controller = new ManualHandoffController();
  const stepExecutor = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(context), context, controller);
  const flowExecutor = new FlowExecutor(stepExecutor);
  let handoffSeen = false;
  let stop = false;
  const watcher = (async () => {
    if (!cancelHandoff) return;
    const deadline = Date.now() + 20_000;
    while (!stop && Date.now() < deadline) {
      if (controller.getPending(context.executionId, context.instanceId)) {
        handoffSeen = true;
        controller.cancel(context.executionId, context.instanceId);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  })();
  const result = await (
    flowExecutor as unknown as { executeWithRetry(s: FlowStep, c: InstanceExecutionContext): Promise<StepExecutionResult> }
  ).executeWithRetry(step, context);
  stop = true;
  await watcher;
  const files = (result.evidence ?? []).filter((ref) => ref.path && existsSync(ref.path));
  return { result, files, handoffSeen };
}

const pageKinds = (files: StepEvidenceRef[]): string =>
  files
    .filter((ref) => ref.kind !== "meta")
    .map((ref) => ref.kind)
    .join(",") || "none";

async function main(): Promise<void> {
  console.log("B2 failure capture versus protected surfaces (N5 finding 2)\n");
  const protectedHtml = await readFile(join(process.cwd(), "mock-site", "public", "secure-login", "protected-login.html"), "utf8");
  const mfaTitleHtml = protectedHtml.replace(/<title>[^<]*<\/title>/, "<title>Two-step verification</title>");
  const server: Server = createServer((req, res) => {
    const body = req.url?.startsWith(PROTECTED_MFA_TITLE_PATH)
      ? mfaTitleHtml
      : req.url?.startsWith(PROTECTED_PATH)
        ? protectedHtml
        : req.url?.startsWith("/plain")
          ? PLAIN_HTML
          : req.url?.startsWith("/closed-shadow")
            ? CLOSED_SHADOW_HTML
            : req.url?.startsWith("/nested-shadow")
              ? NESTED_SHADOW_HTML
              : req.url?.startsWith("/late-shadow")
                ? LATE_SHADOW_HTML
                : req.url?.startsWith("/frame-stub")
                  ? FRAME_STUB_HTML
                  : null;
    if (body === null) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  let browser: Browser | undefined;
  const roots: string[] = [];
  const newRoot = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), "awkit-b2p-"));
    roots.push(root);
    return root;
  };
  try {
    browser = await chromium.launch({ headless: true });

    // Preconditions: the fixture IS a protected surface for both independent detectors.
    console.log("Preconditions:");
    const probe = await browser.newPage();
    await probe.goto(`${origin}${PROTECTED_PATH}`, { waitUntil: "load" });
    const deep = await detectProtectedLogin(probe, { deepScan: true }).catch(() => null);
    check("the runner detector (deep scan) classifies the fixture as protected and recommends pause", !!deep?.detected && deep.recommendedAction === "pause", `${deep?.reason}/${deep?.recommendedAction}`);
    const guard = await checkProtectedSurface(probe);
    check("the N0 protected-surface guard also flags the fixture", guard.protected === true, guard.reason ?? "clear");
    // Recorded fact, not a security assertion: the runner's title-first auto-detection does not pause on this fixture.
    const shallow = await detectProtectedLogin(probe).catch(() => null);
    console.log(`  · title-first auto-detection on the fixture: ${shallow?.recommendedAction ?? "error"} (this is why P3 exists)`);
    await probe.goto(`${origin}${PROTECTED_MFA_TITLE_PATH}`, { waitUntil: "load" });
    const titled = await detectProtectedLogin(probe).catch(() => null);
    check("the MFA-titled variant is paused on by title-first auto-detection (P2 precondition)", !!titled?.detected && titled.recommendedAction === "pause", `${titled?.reason}/${titled?.recommendedAction}`);
    await probe.close();

    // P1: protectedLoginHandoff node, cancelled.
    console.log("\nP1 protectedLoginHandoff node, handoff cancelled:");
    const p1 = await browser.newPage();
    await p1.goto(`${origin}${PROTECTED_PATH}`, { waitUntil: "load" });
    const run1 = await runStep(p1, await newRoot(), "p1", { id: "p1", type: "protectedLoginHandoff", name: "Protected login", config: { handoffMode: "pauseAndAsk" } } as unknown as FlowStep, true);
    check("P1 precondition: the handoff paused and was cancelled", run1.handoffSeen);
    check("P1 precondition: the step failed on the protected page", run1.result.status === "failed", run1.result.status);
    check("P1 security: no screenshot, DOM or a11y file of the protected page is written", run1.files.every((ref) => ref.kind === "meta"), `written: ${pageKinds(run1.files)}`);
    await p1.close();

    // P2: goto the protected page; auto-detection pauses; cancelled.
    console.log("\nP2 goto with auto-detection, handoff cancelled:");
    const p2 = await browser.newPage();
    await p2.goto(`${origin}/plain`, { waitUntil: "load" });
    const run2 = await runStep(p2, await newRoot(), "p2", { id: "p2", type: "goto", name: "Open login", url: `${origin}${PROTECTED_MFA_TITLE_PATH}` } as unknown as FlowStep, true);
    check("P2 precondition: auto-detection paused and the handoff was cancelled", run2.handoffSeen);
    check("P2 precondition: the step failed on the protected page", run2.result.status === "failed", run2.result.status);
    check("P2 security: no screenshot, DOM or a11y file of the protected page is written", run2.files.every((ref) => ref.kind === "meta"), `written: ${pageKinds(run2.files)}`);
    await p2.close();

    // P3: an ordinary click fails on a protected page no detector paused on.
    console.log("\nP3 click failure on an undetected protected page:");
    const p3 = await browser.newPage();
    await p3.goto(`${origin}${PROTECTED_PATH}`, { waitUntil: "load" });
    const run3 = await runStep(p3, await newRoot(), "p3", { id: "p3", type: "click", name: "Missing", timeoutMs: 1500, locator: { strategy: "testId", value: "does-not-exist" } } as unknown as FlowStep, false);
    check("P3 precondition: the step failed", run3.result.status === "failed", run3.result.status);
    check("P3 security: no screenshot, DOM or a11y file of the protected page is written", run3.files.every((ref) => ref.kind === "meta"), `written: ${pageKinds(run3.files)}`);
    await p3.close();

    // C1: the ordinary capture is intact (not weakened).
    console.log("\nC1 control, ordinary page:");
    const c1 = await browser.newPage();
    await c1.goto(`${origin}/plain`, { waitUntil: "load" });
    await c1.fill("#note", TYPED_VALUE);
    const runC = await runStep(c1, await newRoot(), "c1", { id: "c1", type: "click", name: "Missing", timeoutMs: 1500, locator: { strategy: "testId", value: "does-not-exist" } } as unknown as FlowStep, false);
    const kinds = new Set(runC.files.map((ref) => ref.kind));
    check("C1: the step failed", runC.result.status === "failed", runC.result.status);
    check("C1: screenshot, DOM, a11y and meta files are all written on an ordinary page", ["screenshot", "dom", "a11y", "meta"].every((kind) => kinds.has(kind as StepEvidenceRef["kind"])), `kinds=${[...kinds].join(",")}`);

    // C2: typed input values are properties, not attributes, so the DOM file does not carry them.
    const dom = runC.files.find((ref) => ref.kind === "dom");
    const domText = dom?.path ? await readFile(dom.path, "utf8") : "";
    check("C2: a value typed into a field is not serialized into the DOM file", domText.length > 0 && !domText.includes(TYPED_VALUE));
    await c1.close();

    // awkit-3gtj — every case below lists the whole evidence root, not only the files a ref names.
    const missing = (id: string): FlowStep =>
      ({ id, type: "click", name: "Missing", timeoutMs: 1500, locator: { strategy: "testId", value: "does-not-exist" } }) as unknown as FlowStep;
    /** Wrap the real screenshot so `around` runs inside the capture window; the capture itself stays real. */
    const wrapScreenshot = (page: Page, around: (shoot: () => Promise<Buffer>) => Promise<Buffer>): { calls: () => number } => {
      const original = page.screenshot.bind(page);
      let calls = 0;
      page.screenshot = (async (options?: Parameters<Page["screenshot"]>[0]) => {
        calls += 1;
        return around(() => original(options));
      }) as Page["screenshot"];
      return { calls: () => calls };
    };

    console.log("\nR1a the page visits the protected page and comes back inside the capture window:");
    {
      const page = await browser.newPage();
      await page.goto(`${origin}/plain`, { waitUntil: "load" });
      let sawProtected = false;
      const spy = wrapScreenshot(page, async (shoot) => {
        await page.goto(`${origin}${PROTECTED_PATH}`, { waitUntil: "load" });
        sawProtected = (await checkProtectedSurface(page)).protected;
        const shot = await shoot();
        await page.goto(`${origin}/plain`, { waitUntil: "load" });
        return shot;
      });
      const root = await newRoot();
      const run = await runStep(page, root, "r1a", missing("r1a"), false);
      const files = await listFiles(root);
      check("R1a precondition: the step failed and the window really showed the protected page", run.result.status === "failed" && spy.calls() >= 1 && sawProtected, `${run.result.status} calls=${spy.calls()} protected=${sawProtected}`);
      check("R1a security: no screenshot, DOM or a11y file exists anywhere under the evidence root", pageCaptureFiles(files).length === 0, `files: ${pageCaptureFiles(files).length}`);
      check("R1a: every file under the evidence root is named by a returned ref (no orphans)", orphanFiles(files, run.result.evidence ?? []).length === 0, `orphans: ${orphanFiles(files, run.result.evidence ?? []).length}`);
      await page.close();
    }

    console.log("\nR1b a password field appears and disappears inside the capture window (no navigation):");
    {
      const page = await browser.newPage();
      await page.goto(`${origin}/plain`, { waitUntil: "load" });
      let sawProtected = false;
      const spy = wrapScreenshot(page, async (shoot) => {
        await page.evaluate(() => {
          const field = document.createElement("input");
          field.type = "password";
          field.id = "window-pw";
          document.body.appendChild(field);
        });
        sawProtected = (await checkProtectedSurface(page)).protected;
        const shot = await shoot();
        await page.evaluate(() => document.getElementById("window-pw")?.remove());
        return shot;
      });
      const root = await newRoot();
      const run = await runStep(page, root, "r1b", missing("r1b"), false);
      const files = await listFiles(root);
      const gone = (await page.locator("#window-pw").count()) === 0;
      check("R1b precondition: the step failed, the field was protected while shown and is gone afterwards", run.result.status === "failed" && spy.calls() >= 1 && sawProtected && gone, `${run.result.status} calls=${spy.calls()} protected=${sawProtected} gone=${gone}`);
      check("R1b security: no screenshot, DOM or a11y file exists anywhere under the evidence root", pageCaptureFiles(files).length === 0, `files: ${pageCaptureFiles(files).length}`);
      await page.close();
    }

    console.log("\nR2 a screenshot that overruns the capture budget completes late:");
    {
      const page = await browser.newPage();
      await page.goto(`${origin}/plain`, { waitUntil: "load" });
      let lateDone: () => void = () => undefined;
      const late = new Promise<void>((resolve) => {
        lateDone = resolve;
      });
      wrapScreenshot(page, async (shoot) => {
        await new Promise((resolve) => setTimeout(resolve, 6_500));
        try {
          return await shoot();
        } finally {
          lateDone();
        }
      });
      const root = await newRoot();
      const run = await runStep(page, root, "r2", missing("r2"), false);
      const timedOut = (run.result.evidence ?? []).some((ref) => ref.kind === "screenshot" && !ref.path && /timed out/.test(ref.note ?? ""));
      await Promise.race([late, new Promise((resolve) => setTimeout(resolve, 15_000))]);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const files = await listFiles(root);
      const pngs = files.filter((file) => file.endsWith(".png"));
      check("R2 precondition: the step failed and its screenshot was recorded as timed out", run.result.status === "failed" && timedOut, `${run.result.status} timedOut=${timedOut}`);
      check("R2: no PNG appears under the evidence root after the late screenshot completes", pngs.length === 0, `pngs: ${pngs.length}`);
      check("R2: every file under the evidence root is named by a returned ref (no orphans)", orphanFiles(files, run.result.evidence ?? []).length === 0, `orphans: ${orphanFiles(files, run.result.evidence ?? []).length}`);
      check("R2 control: the DOM and a11y captures of the ordinary page are still written", ["dom", "a11y"].every((kind) => run.files.some((ref) => ref.kind === kind)), pageKinds(run.files));
      await page.close();
    }

    console.log("\nR4 a password field inside a closed shadow root:");
    {
      const page = await browser.newPage();
      await page.goto(`${origin}/closed-shadow`, { waitUntil: "load" });
      const hidden = await page.evaluate(() => {
        const host = document.querySelector("x-vault");
        return !!host && host.shadowRoot === null && document.querySelector('input[type="password"]') === null;
      });
      const root = await newRoot();
      const run = await runStep(page, root, "r4", missing("r4"), false);
      const files = await listFiles(root);
      check("R4 precondition: the field is invisible to page script (closed root) and the step failed", hidden && run.result.status === "failed", `hidden=${hidden} ${run.result.status}`);
      check("R4 security: no screenshot, DOM or a11y file exists anywhere under the evidence root", pageCaptureFiles(files).length === 0, `written: ${pageKinds(run.files)}`);
      await page.close();
    }

    console.log("\nR5 the user screenshot step and ScreenshotService on a protected page:");
    {
      const page = await browser.newPage();
      await page.goto(`${origin}${PROTECTED_PATH}`, { waitUntil: "load" });
      const root = await newRoot();
      const run = await runStep(page, root, "r5", { id: "r5", type: "screenshot", name: "Shot", config: { fullPage: true } } as unknown as FlowStep, false);
      const reported = (run.result as { screenshotPath?: string }).screenshotPath;
      const pngs = (await listFiles(root)).filter((file) => file.endsWith(".png"));
      check("R5 security: the user screenshot step writes no PNG of the protected page", pngs.length === 0, `pngs: ${pngs.length} status=${run.result.status}`);
      check("R5 security: the user screenshot step reports no screenshot path", !reported, reported ?? "");
      check("R5: the refused user screenshot step fails (it never passes without its screenshot)", run.result.status === "failed", run.result.status);
      const serviceRoot = await newRoot();
      const outcome = await new ScreenshotService(serviceRoot).capture(page, "exec-r5", "inst-r5", "flow-r5", "step-r5").then(
        (path) => `wrote ${path}`,
        (error: unknown) => `refused: ${error instanceof Error ? error.message : String(error)}`
      );
      const servicePngs = (await listFiles(serviceRoot)).filter((file) => file.endsWith(".png"));
      check("R5 security: ScreenshotService.capture writes no PNG of the protected page", servicePngs.length === 0 && outcome.startsWith("refused"), outcome.startsWith("wrote") ? "wrote a PNG" : `pngs: ${servicePngs.length}`);
      await page.close();
    }

    /** A field shown and removed again inside the capture window; nothing of the page may be written. */
    const transientInWindow = async (id: string, path: string, show: (page: Page) => Promise<void>, hide: (page: Page) => Promise<void>): Promise<void> => {
      const page = await browser!.newPage();
      await page.goto(`${origin}${path}`, { waitUntil: "load" });
      let sawProtected = false;
      wrapScreenshot(page, async (shoot) => {
        await show(page);
        sawProtected = (await checkProtectedSurface(page)).protected;
        const shot = await shoot();
        await hide(page);
        return shot;
      });
      const root = await newRoot();
      const run = await runStep(page, root, id, missing(id));
      const files = await listFiles(root);
      check(`${id} precondition: the step failed and the field was protected while shown`, run.result.status === "failed" && sawProtected, `${run.result.status} protected=${sawProtected}`);
      check(`${id} security: no screenshot, DOM or a11y file exists anywhere under the evidence root`, pageCaptureFiles(files).length === 0, `files: ${pageCaptureFiles(files).length}`);
      await page.close();
    };

    console.log("\nR6a a password field inside a nested open shadow root comes and goes inside the window:");
    await transientInWindow(
      "r6a",
      "/nested-shadow",
      (page) =>
        page.evaluate(() => {
          const inner = document.querySelector("x-outer")?.shadowRoot?.querySelector("x-inner")?.shadowRoot;
          const field = document.createElement("input");
          field.type = "password";
          field.id = "nested-pw";
          inner?.getElementById("slot")?.appendChild(field);
        }),
      (page) => page.evaluate(() => document.querySelector("x-outer")?.shadowRoot?.querySelector("x-inner")?.shadowRoot?.getElementById("nested-pw")?.remove())
    );

    console.log("\nR6b a shadow root holding a password field is attached during the window, then emptied:");
    await transientInWindow(
      "r6b",
      "/late-shadow",
      (page) =>
        page.evaluate(() => {
          const root = document.getElementById("host")?.attachShadow({ mode: "open" });
          if (root) root.innerHTML = '<input type="password" id="late-pw" />';
        }),
      (page) => page.evaluate(() => document.getElementById("host")?.shadowRoot?.getElementById("late-pw")?.remove())
    );

    console.log("\nR6c a console-silencing child frame shows a password field and is removed inside the window:");
    await transientInWindow(
      "r6c",
      "/frame-stub",
      (page) =>
        page.evaluate(() => {
          const doc = (document.getElementById("f") as HTMLIFrameElement | null)?.contentDocument;
          const field = doc?.createElement("input");
          if (doc && field) {
            field.type = "password";
            doc.body.appendChild(field);
          }
        }),
      (page) => page.evaluate(() => document.getElementById("f")?.remove())
    );

    console.log("\nR7 the guard's CDP pass when a frame session fails for another reason:");
    {
      const page = await browser.newPage();
      await page.goto(`${origin}/frame-stub`, { waitUntil: "load" });
      const clean = await checkProtectedSurface(page);
      const context = page.context() as unknown as { newCDPSession: (target: unknown) => Promise<unknown> };
      const original = context.newCDPSession.bind(context);
      context.newCDPSession = async (target: unknown) => {
        if (target !== page) throw new Error("Target page, context or browser has been closed");
        return original(target);
      };
      const failing = await checkProtectedSurface(page);
      context.newCDPSession = original;
      check("R7 precondition: the framed ordinary page is clear when every session works", clean.protected === false, clean.reason ?? "clear");
      check("R7 security: a frame session that fails for any other reason leaves the page unscannable", failing.protected === true, failing.reason ?? "clear");
      await page.close();
    }

    console.log("\nC3 control, the user screenshot step and ScreenshotService on an ordinary page:");
    {
      const page = await browser.newPage();
      await page.goto(`${origin}/plain`, { waitUntil: "load" });
      const root = await newRoot();
      const run = await runStep(page, root, "c3", { id: "c3", type: "screenshot", name: "Shot", config: { fullPage: true } } as unknown as FlowStep, false);
      const reported = (run.result as { screenshotPath?: string }).screenshotPath;
      check("C3: the user screenshot step passes and writes the PNG it reports", run.result.status === "passed" && !!reported && existsSync(reported), `${run.result.status} ${reported ?? "no path"}`);
      const servicePath = await new ScreenshotService(await newRoot()).capture(page, "exec-c3", "inst-c3", "flow-c3", "step-c3").catch(() => undefined);
      check("C3: ScreenshotService.capture writes the PNG on an ordinary page", !!servicePath && existsSync(servicePath), servicePath ?? "refused");
      await page.close();
    }
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const root of roots) await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
