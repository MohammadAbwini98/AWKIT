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
 * Run: npx tsx scripts/verify-b2-protected-capture.mts
 */
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const root of roots) await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
