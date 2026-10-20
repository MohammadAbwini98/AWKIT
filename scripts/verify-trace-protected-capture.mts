/**
 * Security reproduction — can a retained Playwright failure trace hold a protected-login surface?
 *
 * Verifier class: **Real browser**. Drives the REAL `FlowExecutor.executeWithRetry` over a REAL `StepExecutor` wired
 * to a REAL `TraceService` (the runner's only trace path: `PlaywrightRunner` builds one per run and hands it to every
 * executor) in real Chromium, against the Feature Test Lab page `mock-site/public/secure-login/protected-login.html`
 * served from a local server. Every trace ZIP left in the retained traces directory is opened in this process and
 * inspected for counts and synthetic markers only — no page content is ever printed.
 *
 * It asserts the SECURITY PROPERTY (AGENTS.md: never automate or scrape a protected page): no retained trace holds a
 * protected surface, and where the surface is known before the step starts, no trace chunk is even opened for it
 * (prevention, not deletion). Controls prove ordinary tracing is preserved in every mode.
 *
 * Cases (trace mode in brackets):
 *   T1 [onFailure] `protectedLoginHandoff` node, handoff cancelled, the step fails on the protected page.
 *   T2 [onFailure] `goto` to an MFA-titled copy: title-first auto-detection pauses, cancelled, the step fails.
 *   T3 [onFailure] an ordinary `click` fails on a protected page that no detector paused on.
 *   T4 [onFailure] a popup in the same context shows the protected page while a step on the main page fails.
 *   T5 [onFailure] the protected page sits in a same-origin iframe of an ordinary page; a click fails.
 *   T6 [onFailure] page transition: an ordinary page navigates to the protected page, which redirects away to an
 *                  ordinary landing page before the failing step ends.
 *   T7 [always]    `goto` with auto-detection; the operator continues; the step passes.
 *   T8 [always]    a passing `wait` step on a protected page.
 *   T9 [off]       the T3 failure with tracing off.
 *   T10 [onFailure] `protectedLoginHandoff` node on an ordinary page: no chunk at all (the step-type refusal alone).
 *   T11 [onFailure] an iframe visits the protected page and comes back (per-frame navigation watch alone).
 *   T12 [onFailure] a protected popup opens and closes itself during the step (new-page watch alone).
 *   T13 [onFailure] a one-time-code field is added by script, no navigation (the scan before saving alone).
 *   T14 [onFailure] liveness: a page that never stops navigating still lets the failing step end (bounded wait).
 *   T15 [onFailure] awkit-3gtj: a one-time-code field is added and removed again by script inside one chunk, with
 *                  no navigation (it is gone before any scan runs).
 *   T16 [onFailure] awkit-3gtj: a protected page loaded by an EARLIER step of the same context must not reach the
 *                  trace a later ordinary failing step keeps (Playwright records network for the whole tracing
 *                  session, not per chunk).
 *   T17 [onFailure] awkit-3gtj: after a chunk is discarded for a protected surface, no raw trace file in Playwright's
 *                  own temporary artifacts directory still holds the protected page (checked while the browser is
 *                  still open — a pooled browser can stay open for many runs).
 *   Independent-review reproductions (awkit-3gtj review F1, F2, F4):
 *   T18 [onFailure] a PASSING step on a page that silences `console.debug` and adds a one-time-code field with no
 *                  navigation: no raw file in Playwright's temp artifacts directory may still hold the page.
 *   T19 [onFailure] a protected page whose markup carries a `sha1=".."` attribute (DOM attributes are serialized
 *                  into the raw trace): the purge of its discarded session must still delete its raw files.
 *   T20 [onFailure] a script-created about:blank child frame (no navigation event) shows a password field and empties
 *                  it again; the failing step keeps nothing.
 *   T21 [onFailure] re-review N1: a page that silences `console.debug` shows a one-time-code field and then navigates
 *                  to an ordinary page (the field's document and its sentinel latch are gone); the failing step keeps
 *                  nothing.
 *   Second re-review reproductions (M1, M2). A wrapped `context.newCDPSession` delays only `Runtime.addBinding`
 *   (every other CDP call, the guard's pierce scan included, runs normally), standing in for a slow session under load:
 *   T22 [onFailure] M1: T21's page while the page's binding takes longer than the bind budget; nothing is kept.
 *   T23 [onFailure] M1: a console-silencing cross-origin (out-of-process) child frame shows a one-time-code field and
 *                  navigates away while that frame's binding is slow; nothing is kept.
 *   U2  M2: a non-strict watch finished while a rearm is still binding a late out-of-process frame leaves no CDP
 *       session open and no sentinel armed.
 *   Third re-review follow-ups (L1–L3):
 *   T24 [onFailure] L3 control: T23 WITHOUT the slow binding — the session starts and the frame's own binding (not the
 *                  fail-closed path) refuses the trace.
 *   U3  L1: two concurrent rearms binding the same new out-of-process frame leave no CDP session open after finish.
 *   U4  L2: a page whose main thread is busy past both the bind and the arm budgets still fails closed when its
 *       sentinel finally arms with only the console signal.
 *   U1  `markProtected` stops the open chunk's recording at once and the failed step keeps nothing; T2/T7 also
 *       assert the recording had stopped before the operator could act on the handoff.
 *   O1-O3 the passive CDP observation trace (on by default) writes no screenshot/DOM sample and no live view of a
 *       protected page, still samples ordinary pages, and stops sampling once a page becomes protected.
 *   C1 [onFailure] control: an ordinary failing click keeps a trace with screenshots and DOM snapshots.
 *   C2 [always]    control: an ordinary passing step keeps a trace; one that navigates between ordinary pages too.
 *   C3 [onFailure] control: an ordinary passing step keeps nothing.
 *   C4 [off]       control: an ordinary failing step keeps nothing.
 *
 * Run: npx tsx scripts/verify-trace-protected-capture.mts
 */
import { chromium, type Browser, type BrowserContext, type CDPSession, type Frame, type Page } from "playwright";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import { StepExecutor } from "@src/runner/StepExecutor";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { ManualHandoffController } from "@src/runner/ManualHandoffController";
import { TraceService, type TraceMode } from "@src/runner/artifacts/TraceService";
import { PassiveCdpTrace } from "@src/runner/observation/PassiveCdpTrace";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { StepExecutionResult } from "@src/runner/RunnerResult";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { checkProtectedSurface, watchProtectedWindow } from "@src/security/ProtectedSurfaceGuard";

/**
 * Wrap `context.newCDPSession` so `Runtime.addBinding` on sessions for targets `slow` selects is delayed by `ms`; every
 * other call runs normally. Tracks each wrapped session and whether it was detached.
 */
function slowBindings(context: BrowserContext, ms: number, slow: (target: Page | Frame) => boolean): { open: () => number; restore: () => void } {
  const ctx = context as unknown as { newCDPSession: (target: Page | Frame) => Promise<CDPSession> };
  const original = ctx.newCDPSession.bind(ctx);
  const tracked: Array<{ session: CDPSession; detached: boolean }> = [];
  ctx.newCDPSession = async (target: Page | Frame) => {
    const session = await original(target);
    if (!slow(target)) return session;
    const entry = { session, detached: false };
    tracked.push(entry);
    const send = session.send.bind(session) as (method: string, params?: unknown) => Promise<unknown>;
    (session as unknown as { send: typeof send }).send = async (method: string, params?: unknown) => {
      if (method === "Runtime.addBinding") await new Promise((resolve) => setTimeout(resolve, ms));
      return send(method, params);
    };
    const detach = session.detach.bind(session);
    session.detach = async () => {
      entry.detached = true;
      return detach();
    };
    return session;
  };
  return { open: () => tracked.filter((entry) => !entry.detached).length, restore: () => (ctx.newCDPSession = original) };
}

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

/** Synthetic markers. The protected fixture's own test id identifies its DOM and its HTML response body. */
const PROTECTED_MARKER = "protected-login-page";
const ORDINARY_MARKER = "plain-form-marker";
const SYNTH_OTP = "SYNTH-OTP-4471";
const SYNTH_NOTE = "SYNTH-NOTE-9902";

const PROTECTED_PATH = "/secure-login/protected-login.html";
const PROTECTED_MFA_TITLE_PATH = "/secure-login/protected-login-mfa-title.html";
const PLAIN_HTML = `<!doctype html><html><head><title>Plain form</title></head><body data-testid="${ORDINARY_MARKER}">
  <h1>Plain form</h1><label for="note">Note</label><input id="note" type="text" data-testid="note" />
  <button data-testid="present">Present</button><a href="/plain2" data-testid="next">Next</a></body></html>`;
const PLAIN2_HTML = `<!doctype html><html><head><title>Plain two</title></head><body data-testid="${ORDINARY_MARKER}"><h1>Second plain page</h1></body></html>`;
const FRAME_HTML = (origin: string): string =>
  `<!doctype html><html><head><title>Framed</title></head><body><h1>Dashboard</h1><iframe src="${origin}${PROTECTED_PATH}" width="600" height="500"></iframe></body></html>`;
const START_TRANSIENT_HTML = `<!doctype html><html><head><title>Starting</title></head><body><h1>Starting</h1>
  <script>setTimeout(function () { location.href = "/transient"; }, 600);</script></body></html>`;
const LANDING_HTML = `<!doctype html><html><head><title>Landing</title></head><body><h1>Landing complete</h1></body></html>`;
/** An ordinary page whose iframe visits the protected page and comes back, with no main-frame navigation. */
const IFRAME_HOP_HTML = `<!doctype html><html><head><title>Frame hop</title></head><body><h1>Frame hop</h1>
  <iframe id="hop" src="/plain2" width="600" height="500"></iframe>
  <script>var f = document.getElementById("hop");
  setTimeout(function () { f.src = "${PROTECTED_PATH}"; }, 500);
  setTimeout(function () { f.src = "/plain2"; }, 1600);</script></body></html>`;
/** An ordinary page that opens the protected page in a popup which closes itself. */
const POPUP_BLINK_HTML = `<!doctype html><html><head><title>Popup blink</title></head><body><h1>Popup blink</h1>
  <script>setTimeout(function () { var w = window.open("${PROTECTED_PATH}"); setTimeout(function () { w.close(); }, 1200); }, 500);</script></body></html>`;
/** An ordinary page that never stops navigating (hash churn every 20 ms). */
const HASH_CHURN_HTML = `<!doctype html><html><head><title>Hash churn</title></head><body><h1>Hash churn</h1>
  <script>var n = 0; setInterval(function () { location.hash = "h" + (n++); }, 20);</script></body></html>`;
/** An ordinary page that adds a one-time-code field by script, with no navigation at all. */
const INJECT_OTP_HTML = `<!doctype html><html><head><title>Late field</title></head><body><h1>Late field</h1>
  <script>setTimeout(function () { var i = document.createElement("input"); i.setAttribute("autocomplete", "one-time-code"); i.id = "late-otp"; document.body.appendChild(i); }, 500);</script></body></html>`;

/** An ordinary page that adds a one-time-code field and removes it again, with no navigation (T15). */
const INJECT_REMOVE_OTP_HTML = `<!doctype html><html><head><title>Blink field</title></head><body><h1>Blink field</h1>
  <script>window.__otpCycle = "none";
  setTimeout(function () { var i = document.createElement("input"); i.setAttribute("autocomplete", "one-time-code"); i.id = "blink-otp"; document.body.appendChild(i); window.__otpCycle = "added"; }, 1200);
  setTimeout(function () { var i = document.getElementById("blink-otp"); if (i) i.remove(); window.__otpCycle = "removed"; }, 1800);</script></body></html>`;
/** A marker unique to this run, so T17 cannot be confused by another process's Playwright artifacts. */
const UNIQUE_MARKER = `t17-protected-${randomUUID()}`;
const T18_MARKER = `t18-stub-${randomUUID()}`;
const T19_MARKER = `t19-sha1-${randomUUID()}`;
/** Silences console.debug, then adds a one-time-code field with no navigation (T18). */
const STUB_OTP_HTML = `<!doctype html><html><head><title>Quiet</title><script>console.debug = function () {};</script></head><body>
  <h1>Quiet</h1><p>${T18_MARKER}</p>
  <script>setTimeout(function () { var i = document.createElement("input"); i.setAttribute("autocomplete", "one-time-code"); document.body.appendChild(i); }, 1200);</script></body></html>`;
/** Silences console.debug, shows a one-time-code field, then navigates to an ordinary page (T21). */
const STUB_OTP_NAV_HTML = `<!doctype html><html><head><title>Quiet hop</title><script>console.debug = function () {};</script></head><body>
  <h1>Quiet hop</h1>
  <script>setTimeout(function () { var i = document.createElement("input"); i.setAttribute("autocomplete", "one-time-code"); i.id = "hop-otp"; document.body.appendChild(i); }, 1200);
  setTimeout(function () { location.href = "/landing"; }, 1800);</script></body></html>`;
/** An ordinary parent whose child frame is cross-origin (localhost versus 127.0.0.1), so out-of-process (T23). */
const OOPIF_PARENT_HTML = (crossOrigin: string): string =>
  `<!doctype html><html><head><title>Parent</title></head><body><h1>Parent</h1><iframe id="child" src="${crossOrigin}/oopif-child" width="600" height="400"></iframe></body></html>`;
/** The cross-origin child: silences console.debug, shows a one-time-code field, then navigates away (T23). */
const OOPIF_CHILD_HTML = `<!doctype html><html><head><title>Child</title><script>console.debug = function () {};</script></head><body>
  <p>child</p>
  <script>setTimeout(function () { var i = document.createElement("input"); i.setAttribute("autocomplete", "one-time-code"); document.body.appendChild(i); }, 1200);
  setTimeout(function () { location.href = "/landing"; }, 1800);</script></body></html>`;
/** A blank child frame created by script, which shows a password field and empties it again (T20). */
const BLANK_FRAME_HTML = `<!doctype html><html><head><title>Blank frame</title></head><body><h1>Blank frame</h1>
  <script>window.__blankCycle = "none";
  setTimeout(function () { var f = document.createElement("iframe"); f.id = "blank"; document.body.appendChild(f); window.__blankCycle = "frame"; }, 1000);
  setTimeout(function () { var d = document.getElementById("blank").contentDocument; d.body.innerHTML = '<input type="password" id="blank-pw">'; window.__blankCycle = "shown"; }, 1400);
  setTimeout(function () { var d = document.getElementById("blank").contentDocument; d.body.innerHTML = ""; window.__blankCycle = "hidden"; }, 1900);</script></body></html>`;

function contextFor(root: string, id: string): InstanceExecutionContext {
  return {
    executionId: `exec-${id}`,
    instanceId: `inst-${id}`,
    scenarioId: "scenario-trace",
    flowId: `flow-${id}`,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: root, screenshots: root, logs: root, reports: root, traces: join(root, "traces") }
  };
}

/** Minimal in-process ZIP reader (stored + deflate), enough for Playwright's trace archives. */
function readZip(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return entries;
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data) : Buffer.alloc(0));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

interface TraceFacts {
  zips: number;
  frames: number;
  snapshots: number;
  protectedMarker: boolean;
  ordinaryMarker: boolean;
  otpValue: boolean;
  noteValue: boolean;
}

/** Counts and booleans about every retained trace ZIP — never the content itself. */
async function inspectTraces(dir: string): Promise<TraceFacts> {
  const facts: TraceFacts = { zips: 0, frames: 0, snapshots: 0, protectedMarker: false, ordinaryMarker: false, otpValue: false, noteValue: false };
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return facts;
  }
  for (const name of names.filter((n) => n.endsWith(".zip"))) {
    facts.zips += 1;
    for (const [entry, body] of readZip(await readFile(join(dir, name)))) {
      if (/\.(jpe?g|png)$/i.test(entry)) facts.frames += 1;
      const text = body.toString("latin1");
      if (entry.endsWith(".trace")) facts.snapshots += (text.match(/"type":"frame-snapshot"/g) ?? []).length;
      if (text.includes(PROTECTED_MARKER)) facts.protectedMarker = true;
      if (text.includes(ORDINARY_MARKER)) facts.ordinaryMarker = true;
      if (text.includes(SYNTH_OTP)) facts.otpValue = true;
      if (text.includes(SYNTH_NOTE)) facts.noteValue = true;
    }
  }
  return facts;
}

const describe = (f: TraceFacts): string =>
  `zips=${f.zips} frames=${f.frames} snapshots=${f.snapshots} protectedMarker=${f.protectedMarker} typedOtp=${f.otpValue}`;

interface Run {
  result: StepExecutionResult;
  traces: TraceFacts;
  chunksOpened: number;
  handoffSeen: boolean;
  /** Chunk stops issued by the time the operator could first act on the handoff (recording must already be off). */
  stopsAtHandoff: number;
}

/**
 * Count recording starts and stops made after this point on a context. `tracing.start` opens a chunk itself and
 * `tracing.stop` stops the open one, so both are counted alongside `startChunk`/`stopChunk`.
 */
function spyChunks(context: BrowserContext): { starts: () => number; stops: () => number } {
  let starts = 0;
  let stops = 0;
  const tracing = context.tracing as unknown as Record<"start" | "startChunk" | "stop" | "stopChunk", (...args: unknown[]) => Promise<unknown>>;
  for (const name of ["start", "startChunk"] as const) {
    const original = tracing[name].bind(tracing);
    tracing[name] = async (...args: unknown[]) => {
      starts += 1;
      return original(...args);
    };
  }
  for (const name of ["stop", "stopChunk"] as const) {
    const original = tracing[name].bind(tracing);
    tracing[name] = async (...args: unknown[]) => {
      stops += 1;
      return original(...args);
    };
  }
  return { starts: () => starts, stops: () => stops };
}

/** Every file under `root`, recursively. */
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

interface Harness {
  context: BrowserContext;
  page: Page;
  root: string;
  traceDir: string;
}

/** Drive one step through the real retry loop with a real TraceService on the harness context. */
async function runTraced(
  h: Harness,
  id: string,
  mode: TraceMode,
  step: FlowStep,
  handoff: "none" | "cancel" | "continue"
): Promise<Run> {
  const context = contextFor(h.root, id);
  const traceService = new TraceService(h.traceDir, mode, () => undefined);
  await traceService.attach(h.context);
  // Count chunk starts from here on: a refused step must not open one at all (prevention, not deletion).
  const chunks = spyChunks(h.context);
  let stopsAtHandoff = -1;
  const controller = new ManualHandoffController();
  const stepExecutor = new StepExecutor(
    h.page,
    new LocatorFactory(h.page),
    new ValueResolver(context),
    context,
    controller,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    traceService
  );
  const flowExecutor = new FlowExecutor(stepExecutor);
  let handoffSeen = false;
  let stop = false;
  const watcher = (async () => {
    if (handoff === "none") return;
    const deadline = Date.now() + 20_000;
    while (!stop && Date.now() < deadline) {
      if (controller.getPending(context.executionId, context.instanceId)) {
        handoffSeen = true;
        stopsAtHandoff = chunks.stops();
        if (handoff === "cancel") controller.cancel(context.executionId, context.instanceId);
        else controller.resume(context.executionId, context.instanceId);
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
  return { result, traces: await inspectTraces(h.traceDir), chunksOpened: chunks.starts(), handoffSeen, stopsAtHandoff };
}

const missingClick = (id: string): FlowStep =>
  ({ id, type: "click", name: "Missing", timeoutMs: 1500, locator: { strategy: "testId", value: "does-not-exist" } }) as unknown as FlowStep;

async function main(): Promise<void> {
  console.log("Playwright failure traces versus protected surfaces\n");
  const protectedHtml = await readFile(join(process.cwd(), "mock-site", "public", "secure-login", "protected-login.html"), "utf8");
  const mfaTitleHtml = protectedHtml.replace(/<title>[^<]*<\/title>/, "<title>Two-step verification</title>");
  const transientHtml = protectedHtml.replace(
    "</body>",
    `<script>setTimeout(function () { location.replace("/landing"); }, 900);</script></body>`
  );
  let origin = "";
  const routes = (url: string): string | null => {
    if (url.startsWith(PROTECTED_MFA_TITLE_PATH)) return mfaTitleHtml;
    if (url.startsWith(PROTECTED_PATH)) return protectedHtml;
    if (url.startsWith("/plain2")) return PLAIN2_HTML;
    if (url.startsWith("/plain")) return PLAIN_HTML;
    if (url.startsWith("/framed")) return FRAME_HTML(origin);
    if (url.startsWith("/start-transient")) return START_TRANSIENT_HTML;
    if (url.startsWith("/transient")) return transientHtml;
    if (url.startsWith("/landing")) return LANDING_HTML;
    if (url.startsWith("/iframe-hop")) return IFRAME_HOP_HTML;
    if (url.startsWith("/popup-blink")) return POPUP_BLINK_HTML;
    if (url.startsWith("/inject-otp")) return INJECT_OTP_HTML;
    if (url.startsWith("/hash-churn")) return HASH_CHURN_HTML;
    if (url.startsWith("/inject-remove-otp")) return INJECT_REMOVE_OTP_HTML;
    if (url.startsWith("/protected-unique")) return protectedHtml.replace("</body>", `<p data-testid="${UNIQUE_MARKER}">${UNIQUE_MARKER}</p></body>`);
    if (url.startsWith("/stub-otp-nav")) return STUB_OTP_NAV_HTML;
    if (url.startsWith("/oopif-parent")) return OOPIF_PARENT_HTML(origin.replace("127.0.0.1", "localhost"));
    if (url.startsWith("/oopif-child")) return OOPIF_CHILD_HTML;
    if (url.startsWith("/oopif-idle")) return PLAIN2_HTML;
    if (url.startsWith("/stub-otp")) return STUB_OTP_HTML;
    if (url.startsWith("/protected-sha1")) return protectedHtml.replace("</body>", `<div sha1="..">${T19_MARKER}</div></body>`);
    if (url.startsWith("/blank-frame")) return BLANK_FRAME_HTML;
    return null;
  };
  const server: Server = createServer((req, res) => {
    const body = routes(req.url ?? "");
    if (body === null) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  let browser: Browser | undefined;
  const roots: string[] = [];
  const harness = async (startPath: string): Promise<Harness> => {
    const root = await mkdtemp(join(tmpdir(), "awkit-trace-"));
    roots.push(root);
    const context = await browser!.newContext();
    const page = await context.newPage();
    await page.goto(`${origin}${startPath}`, { waitUntil: "load" });
    return { context, page, root, traceDir: join(root, "traces") };
  };
  try {
    browser = await chromium.launch({ headless: true });

    console.log("Preconditions:");
    const probe = await browser.newPage();
    await probe.goto(`${origin}${PROTECTED_PATH}`, { waitUntil: "load" });
    check("the protected-surface guard flags the fixture", (await checkProtectedSurface(probe)).protected === true);
    await probe.goto(`${origin}/plain`, { waitUntil: "load" });
    check("the guard clears the ordinary page", (await checkProtectedSurface(probe)).protected === false);
    await probe.close();

    // T1
    console.log("\nT1 [onFailure] protectedLoginHandoff node, handoff cancelled:");
    {
      const h = await harness(PROTECTED_PATH);
      await h.page.fill("#otp", SYNTH_OTP);
      const run = await runTraced(h, "t1", "onFailure", { id: "t1", type: "protectedLoginHandoff", name: "Protected login", config: { handoffMode: "pauseAndAsk" } } as unknown as FlowStep, "cancel");
      check("T1 precondition: the handoff paused, was cancelled, and the step failed", run.handoffSeen && run.result.status === "failed", run.result.status);
      check("T1 security: no trace is retained and none is reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      check("T1 prevention: no trace chunk is opened for a protected-login step", run.chunksOpened === 0, `chunks=${run.chunksOpened}`);
      await h.context.close();
    }

    // T2
    console.log("\nT2 [onFailure] goto with title-first auto-detection, handoff cancelled:");
    {
      const h = await harness("/plain");
      const run = await runTraced(h, "t2", "onFailure", { id: "t2", type: "goto", name: "Open login", url: `${origin}${PROTECTED_MFA_TITLE_PATH}` } as unknown as FlowStep, "cancel");
      check("T2 precondition: auto-detection paused, the handoff was cancelled, and the step failed", run.handoffSeen && run.result.status === "failed", run.result.status);
      check("T2 security: no trace holding the protected page is retained or reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      check("T2 security: recording had stopped before the operator could act on the handoff", run.stopsAtHandoff >= 1, `stops=${run.stopsAtHandoff}`);
      await h.context.close();
    }

    // T3
    console.log("\nT3 [onFailure] click failure on an undetected protected page:");
    {
      const h = await harness(PROTECTED_PATH);
      await h.page.fill("#otp", SYNTH_OTP);
      const run = await runTraced(h, "t3", "onFailure", missingClick("t3"), "none");
      check("T3 precondition: the step failed", run.result.status === "failed", run.result.status);
      check("T3 security: no trace is retained and none is reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      check("T3 security: no retained trace carries the typed one-time code", !run.traces.otpValue);
      check("T3 prevention: no trace chunk is opened while the page is already protected", run.chunksOpened === 0, `chunks=${run.chunksOpened}`);
      await h.context.close();
    }

    // T4
    console.log("\nT4 [onFailure] protected popup in the same context, failing step on the main page:");
    {
      const h = await harness("/plain");
      const [popup] = await Promise.all([h.context.waitForEvent("page"), h.page.evaluate((url) => void window.open(url), `${origin}${PROTECTED_PATH}`)]);
      await popup.waitForLoadState("load");
      await popup.fill("#otp", SYNTH_OTP);
      await popup.focus("#password");
      const run = await runTraced(h, "t4", "onFailure", missingClick("t4"), "none");
      check("T4 precondition: the step failed", run.result.status === "failed", run.result.status);
      check("T4 security: no trace holding the protected popup is retained or reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      check("T4 prevention: no trace chunk is opened while a page of the context is protected", run.chunksOpened === 0, `chunks=${run.chunksOpened}`);
      await h.context.close();
    }

    // T5
    console.log("\nT5 [onFailure] protected page inside a same-origin iframe:");
    {
      const h = await harness("/framed");
      await h.page.frameLocator("iframe").locator("#otp").fill(SYNTH_OTP);
      const run = await runTraced(h, "t5", "onFailure", missingClick("t5"), "none");
      check("T5 precondition: the step failed", run.result.status === "failed", run.result.status);
      check("T5 security: no trace holding the protected frame is retained or reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      check("T5 prevention: no trace chunk is opened while a frame is protected", run.chunksOpened === 0, `chunks=${run.chunksOpened}`);
      await h.context.close();
    }

    // T6
    console.log("\nT6 [onFailure] transient protected page between two ordinary pages:");
    {
      const h = await harness("/start-transient");
      const run = await runTraced(h, "t6", "onFailure", { id: "t6", type: "wait", name: "Never appears", timeoutMs: 4000, value: "This text never appears", config: { waitType: "textVisible" } } as unknown as FlowStep, "none");
      const landed = h.page.url().endsWith("/landing");
      check("T6 precondition: the step failed after the page left the protected surface", run.result.status === "failed" && landed, `${run.result.status} landed=${landed}`);
      check("T6 security: no trace holding the transient protected page is retained or reported", !run.traces.protectedMarker && !run.result.tracePath, describe(run.traces));
      await h.context.close();
    }

    // T7
    console.log("\nT7 [always] goto with auto-detection, the operator continues:");
    {
      const h = await harness("/plain");
      const run = await runTraced(h, "t7", "always", { id: "t7", type: "goto", name: "Open login", url: `${origin}${PROTECTED_MFA_TITLE_PATH}` } as unknown as FlowStep, "continue");
      check("T7 precondition: auto-detection paused, the operator continued, and the step passed", run.handoffSeen && run.result.status === "passed", run.result.status);
      check("T7 security: no trace holding the protected page is retained or reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      check("T7 security: recording had stopped before the operator continued", run.stopsAtHandoff >= 1, `stops=${run.stopsAtHandoff}`);
      await h.context.close();
    }

    // T8
    console.log("\nT8 [always] passing step on a protected page:");
    {
      const h = await harness(PROTECTED_PATH);
      await h.page.fill("#otp", SYNTH_OTP);
      const run = await runTraced(h, "t8", "always", { id: "t8", type: "wait", name: "Heading", timeoutMs: 3000, value: "Protected login required", config: { waitType: "textVisible" } } as unknown as FlowStep, "none");
      check("T8 precondition: the step passed", run.result.status === "passed", run.result.status);
      check("T8 security: no trace is retained and none is reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      check("T8 prevention: no trace chunk is opened while the page is protected", run.chunksOpened === 0, `chunks=${run.chunksOpened}`);
      await h.context.close();
    }

    // T9
    console.log("\nT9 [off] click failure on a protected page:");
    {
      const h = await harness(PROTECTED_PATH);
      const run = await runTraced(h, "t9", "off", missingClick("t9"), "none");
      check("T9: tracing off keeps nothing and opens no chunk", run.result.status === "failed" && run.traces.zips === 0 && run.chunksOpened === 0, describe(run.traces));
      await h.context.close();
    }

    const neverAppears = (id: string): FlowStep =>
      ({ id, type: "wait", name: "Never appears", timeoutMs: 3000, value: "This text never appears", config: { waitType: "textVisible" } }) as unknown as FlowStep;

    // T10 — only the protected-step refusal can hold here: the page is ordinary when the step starts.
    console.log("\nT10 [onFailure] protectedLoginHandoff node on an ordinary page, handoff cancelled:");
    {
      const h = await harness("/plain");
      const run = await runTraced(h, "t10", "onFailure", { id: "t10", type: "protectedLoginHandoff", name: "Protected login", config: { handoffMode: "pauseAndAsk" } } as unknown as FlowStep, "cancel");
      check("T10 precondition: the handoff paused, was cancelled, and the step failed", run.handoffSeen && run.result.status === "failed", run.result.status);
      check("T10 prevention: no trace chunk is opened for a protected-login step on any page", run.chunksOpened === 0 && run.traces.zips === 0 && !run.result.tracePath, `chunks=${run.chunksOpened} ${describe(run.traces)}`);
      await h.context.close();
    }

    // T11 — no main-frame navigation: only the per-frame navigation watch sees the protected document.
    console.log("\nT11 [onFailure] an iframe visits the protected page and comes back:");
    {
      const h = await harness("/iframe-hop");
      const run = await runTraced(h, "t11", "onFailure", neverAppears("t11"), "none");
      check("T11 precondition: the step failed", run.result.status === "failed", run.result.status);
      check("T11 security: no trace holding the protected frame document is retained or reported", !run.traces.protectedMarker && !run.result.tracePath, describe(run.traces));
      await h.context.close();
    }

    // T12 — the popup is gone by the end of the step: only the new-page watch sees it.
    console.log("\nT12 [onFailure] a protected popup opens and closes during the step:");
    {
      const h = await harness("/popup-blink");
      const run = await runTraced(h, "t12", "onFailure", neverAppears("t12"), "none");
      check("T12 precondition: the step failed and the popup closed", run.result.status === "failed" && h.context.pages().length === 1, `${run.result.status} pages=${h.context.pages().length}`);
      check("T12 security: no trace holding the protected popup is retained or reported", !run.traces.protectedMarker && run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      await h.context.close();
    }

    // T13 — a protected field added by script, no navigation: only the scan before saving sees it.
    console.log("\nT13 [onFailure] a one-time-code field is added by script during the step:");
    {
      const h = await harness("/inject-otp");
      const run = await runTraced(h, "t13", "onFailure", neverAppears("t13"), "none");
      check("T13 precondition: the step failed with the field present", run.result.status === "failed" && (await h.page.locator("#late-otp").count()) === 1, run.result.status);
      check("T13 security: no trace is retained and none is reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      await h.context.close();
    }

    // T14 — liveness: waiting for the chunk's scans is bounded even when the page never stops navigating.
    console.log("\nT14 [onFailure] liveness on a page that never stops navigating:");
    {
      const h = await harness("/hash-churn");
      const started = Date.now();
      const run = await runTraced(h, "t14", "onFailure", neverAppears("t14"), "none");
      const elapsed = Date.now() - started;
      check("T14: the failing step still ends within its timeout plus the bounded scan wait", run.result.status === "failed" && elapsed < 3000 + 25_000, `${run.result.status} in ${elapsed} ms`);
      await h.context.close();
    }

    // T15 — the field is gone again before the step ends, and no navigation happens: no end-of-step scan can see it.
    console.log("\nT15 [onFailure] a one-time-code field is added and removed by script inside one chunk:");
    {
      const h = await harness("/inject-remove-otp");
      const run = await runTraced(h, "t15", "onFailure", neverAppears("t15"), "none");
      const cycle = await h.page.evaluate(() => (window as unknown as { __otpCycle?: string }).__otpCycle);
      check("T15 precondition: the step failed after the field was added and removed again", run.result.status === "failed" && cycle === "removed" && run.chunksOpened >= 1, `${run.result.status} cycle=${cycle} chunks=${run.chunksOpened}`);
      check("T15 security: no trace is retained and none is reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      await h.context.close();
    }

    /** Run several steps through ONE executor and ONE TraceService on the harness context, as a real run does. */
    const runSequence = async (h: Harness, id: string, steps: FlowStep[]): Promise<{ results: StepExecutionResult[]; starts: () => number }> => {
      const context = contextFor(h.root, id);
      const service = new TraceService(h.traceDir, "onFailure", () => undefined);
      await service.attach(h.context);
      const chunks = spyChunks(h.context);
      const stepExecutor = new StepExecutor(h.page, new LocatorFactory(h.page), new ValueResolver(context), context, new ManualHandoffController(), undefined, undefined, undefined, undefined, undefined, undefined, service);
      const flowExecutor = new FlowExecutor(stepExecutor) as unknown as { executeWithRetry(s: FlowStep, c: InstanceExecutionContext): Promise<StepExecutionResult> };
      const results: StepExecutionResult[] = [];
      for (const step of steps) results.push(await flowExecutor.executeWithRetry(step, context));
      return { results, starts: chunks.starts };
    };

    // T16 — the protected page is only ever loaded by an earlier step; the later failing step is on an ordinary page.
    console.log("\nT16 [onFailure] a protected page from an earlier step must not reach a later step's trace:");
    {
      const h = await harness("/plain");
      const { results } = await runSequence(h, "t16", [
        { id: "t16a", type: "goto", name: "Open login", url: `${origin}${PROTECTED_PATH}` } as unknown as FlowStep,
        { id: "t16b", type: "goto", name: "Back", url: `${origin}/plain` } as unknown as FlowStep,
        missingClick("t16c")
      ]);
      const traces = await inspectTraces(h.traceDir);
      const statuses = results.map((r) => r.status).join(",");
      check("T16 precondition: the two navigations passed, the ordinary click failed and kept its trace", statuses === "passed,passed,failed" && traces.zips === 1 && !!results[2].tracePath, `${statuses} ${describe(traces)}`);
      check("T16 security: the kept ordinary trace holds nothing of the earlier protected page", !traces.protectedMarker, describe(traces));
      await h.context.close();
    }

    // T17 — Playwright stages every chunk (trace events, network log, resources) in its own temp artifacts directory.
    console.log("\nT17 [onFailure] Playwright's temporary trace files after a discarded protected chunk:");
    {
      const before = new Set((await readdir(tmpdir()).catch(() => [])).filter((name) => name.startsWith("playwright-artifacts-")));
      const ownBrowser = await chromium.launch({ headless: true });
      try {
        const artifactDirs = (await readdir(tmpdir()).catch(() => [])).filter((name) => name.startsWith("playwright-artifacts-") && !before.has(name)).map((name) => join(tmpdir(), name));
        const root = await mkdtemp(join(tmpdir(), "awkit-trace-"));
        roots.push(root);
        const context = await ownBrowser.newContext();
        const page = await context.newPage();
        await page.goto(`${origin}/plain`, { waitUntil: "load" });
        const h: Harness = { context, page, root, traceDir: join(root, "traces") };
        const { results, starts } = await runSequence(h, "t17", [{ id: "t17", type: "goto", name: "Open login", url: `${origin}/protected-unique` } as unknown as FlowStep]);
        const files = (await Promise.all(artifactDirs.map((dir) => listFiles(dir)))).flat();
        const holdingNames: string[] = [];
        for (const file of files) if ((await readFile(file).catch(() => Buffer.alloc(0))).toString("latin1").includes(UNIQUE_MARKER)) holdingNames.push(file.slice(file.lastIndexOf("playwright-artifacts-")));
        const holding = holdingNames.length;
        const kept = await inspectTraces(h.traceDir);
        check("T17 precondition: this browser's artifacts directory was found, a chunk was opened and the step passed", artifactDirs.length >= 1 && starts() >= 1 && results[0].status === "passed", `dirs=${artifactDirs.length} starts=${starts()} ${results[0].status}`);
        check("T17 precondition: nothing was kept in the retained traces directory", kept.zips === 0, describe(kept));
        check("T17 security: no raw file in Playwright's temp artifacts directory still holds the protected page", holding === 0, `files holding it: ${holding} of ${files.length} (${holdingNames.join(", ")})`);
        await context.close();
      } finally {
        await ownBrowser.close().catch(() => undefined);
      }
    }

    /** Run steps in a browser of their own, then count raw files in ITS Playwright artifacts directory holding `marker`. */
    const inOwnBrowser = async (
      id: string,
      startPath: string,
      steps: FlowStep[],
      marker: string,
      after?: (page: Page) => Promise<boolean>
    ): Promise<{ statuses: string; starts: number; dirs: number; holding: string[]; files: number; kept: TraceFacts; afterOk: boolean }> => {
      const before = new Set((await readdir(tmpdir()).catch(() => [])).filter((name) => name.startsWith("playwright-artifacts-")));
      const ownBrowser = await chromium.launch({ headless: true });
      try {
        const artifactDirs = (await readdir(tmpdir()).catch(() => [])).filter((name) => name.startsWith("playwright-artifacts-") && !before.has(name)).map((name) => join(tmpdir(), name));
        const root = await mkdtemp(join(tmpdir(), "awkit-trace-"));
        roots.push(root);
        const context = await ownBrowser.newContext();
        const page = await context.newPage();
        await page.goto(`${origin}${startPath}`, { waitUntil: "load" });
        const h: Harness = { context, page, root, traceDir: join(root, "traces") };
        const { results, starts } = await runSequence(h, id, steps);
        const afterOk = after ? await after(page) : true;
        const files = (await Promise.all(artifactDirs.map((dir) => listFiles(dir)))).flat();
        const holding: string[] = [];
        for (const file of files) if ((await readFile(file).catch(() => Buffer.alloc(0))).toString("latin1").includes(marker)) holding.push(file.slice(file.lastIndexOf("playwright-artifacts-")));
        const kept = await inspectTraces(h.traceDir);
        await context.close();
        return { statuses: results.map((r) => r.status).join(","), starts: starts(), dirs: artifactDirs.length, holding, files: files.length, kept, afterOk };
      } finally {
        await ownBrowser.close().catch(() => undefined);
      }
    };

    // T18 — the passing path: no save, no end scan before; the page silences the console signal.
    console.log("\nT18 [onFailure] a passing step on a console-silencing page that adds a one-time-code field:");
    {
      const r = await inOwnBrowser(
        "t18",
        "/stub-otp",
        [{ id: "t18", type: "wait", name: "Field", timeoutMs: 4000, locator: { strategy: "css", value: 'input[autocomplete="one-time-code"]' }, config: { waitType: "selector" } } as unknown as FlowStep],
        T18_MARKER,
        async (page) => (await page.locator('input[autocomplete="one-time-code"]').count()) === 1
      );
      check("T18 precondition: a session was started, the step passed and the field is present", r.dirs >= 1 && r.starts >= 1 && r.statuses === "passed" && r.afterOk, `dirs=${r.dirs} starts=${r.starts} ${r.statuses} field=${r.afterOk}`);
      check("T18 security: no raw file in Playwright's temp artifacts directory still holds the page", r.holding.length === 0, `files holding it: ${r.holding.length} of ${r.files} (${r.holding.join(", ")})`);
    }

    // T19 — page markup must not be able to steer (or abort) the purge.
    console.log("\nT19 [onFailure] a protected page whose markup carries a sha1 attribute:");
    {
      const r = await inOwnBrowser("t19", "/plain", [{ id: "t19", type: "goto", name: "Open login", url: `${origin}/protected-sha1` } as unknown as FlowStep], T19_MARKER);
      check("T19 precondition: a session was started, the step passed and nothing was kept", r.dirs >= 1 && r.starts >= 1 && r.statuses === "passed" && r.kept.zips === 0, `dirs=${r.dirs} starts=${r.starts} ${r.statuses} ${describe(r.kept)}`);
      check("T19 security: the discarded session's raw files are still purged", r.holding.length === 0, `files holding it: ${r.holding.length} of ${r.files} (${r.holding.join(", ")})`);
    }

    // T20 — a frame that never navigates is never scanned on navigation; only a sentinel armed in it can see the field.
    console.log("\nT20 [onFailure] a script-created blank frame shows a password field and empties it again:");
    {
      const h = await harness("/blank-frame");
      const run = await runTraced(h, "t20", "onFailure", neverAppears("t20"), "none");
      const cycle = await h.page.evaluate(() => (window as unknown as { __blankCycle?: string }).__blankCycle);
      check("T20 precondition: the step failed after the field was shown and emptied, with a session open", run.result.status === "failed" && cycle === "hidden" && run.chunksOpened >= 1, `${run.result.status} cycle=${cycle} chunks=${run.chunksOpened}`);
      check("T20 security: no trace is retained and none is reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      await h.context.close();
    }

    // T21 — the field's document is replaced before any end-of-step check; only a signal the page cannot silence helps.
    console.log("\nT21 [onFailure] a console-silencing page shows a one-time-code field, then navigates away:");
    {
      const h = await harness("/stub-otp-nav");
      const run = await runTraced(h, "t21", "onFailure", neverAppears("t21"), "none");
      const landed = h.page.url().endsWith("/landing");
      check("T21 precondition: the step failed after the page left for an ordinary page, with a session open", run.result.status === "failed" && landed && run.chunksOpened >= 1, `${run.result.status} landed=${landed} chunks=${run.chunksOpened}`);
      check("T21 security: no trace is retained and none is reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      await h.context.close();
    }

    // T22 — M1: the page's binding is slower than the bind budget, so its sentinel arms without it.
    console.log("\nT22 [onFailure] T21's page while the page's CDP binding is slower than the bind budget:");
    {
      const h = await harness("/stub-otp-nav");
      const slow = slowBindings(h.context, 2_500, (target) => target === h.page);
      const run = await runTraced(h, "t22", "onFailure", neverAppears("t22"), "none");
      slow.restore();
      const landed = h.page.url().endsWith("/landing");
      check("T22 precondition: the step failed after the page left for an ordinary page", run.result.status === "failed" && landed, `${run.result.status} landed=${landed}`);
      check("T22 security: no trace is retained and none is reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      await h.context.close();
    }

    // T23 — M1: the same for an out-of-process child frame whose own binding is slow.
    // Playwright launches Chromium with site isolation off, so a cross-origin child shares its parent's session;
    // T23 and U2 need a browser with --site-per-process for their child frames to be out-of-process.
    const isolatedBrowser = await chromium.launch({ headless: true, args: ["--site-per-process"] });
    const isolatedHarness = async (startPath: string): Promise<Harness> => {
      const root = await mkdtemp(join(tmpdir(), "awkit-trace-"));
      roots.push(root);
      const context = await isolatedBrowser.newContext();
      const page = await context.newPage();
      await page.goto(`${origin}${startPath}`, { waitUntil: "load" });
      return { context, page, root, traceDir: join(root, "traces") };
    };
    console.log("\nT23 [onFailure] a console-silencing out-of-process child frame shows a field and navigates away:");
    {
      const h = await isolatedHarness("/oopif-parent");
      const child = h.page.frames().find((frame) => frame !== h.page.mainFrame());
      const outOfProcess = child
        ? await h.context.newCDPSession(child).then(
            async (session) => {
              await session.detach().catch(() => undefined);
              return true;
            },
            () => false
          )
        : false;
      const slow = slowBindings(h.context, 2_500, (target) => target !== h.page);
      const run = await runTraced(h, "t23", "onFailure", neverAppears("t23"), "none");
      slow.restore();
      const left = h.page.frames().some((frame) => frame.url().endsWith("/landing"));
      check("T23 precondition: the child frame is out-of-process and the step failed after the child left", outOfProcess && run.result.status === "failed" && left, `oopif=${outOfProcess} ${run.result.status} left=${left}`);
      // Recorded fact: with the slow binding the session is refused before it starts (prevention), so 0 is expected.
      console.log(`  · trace sessions started: ${run.chunksOpened}`);
      check("T23 security: no trace is retained and none is reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      await h.context.close();
    }

    // U2 — M2: finish() while a rearm is still binding a late out-of-process frame.
    // T24 — L3: the happy path of an out-of-process frame's binding (no slow seam).
    console.log("\nT24 [onFailure] T23's page with working bindings (the frame's own binding refuses the trace):");
    {
      const h = await isolatedHarness("/oopif-parent");
      const run = await runTraced(h, "t24", "onFailure", neverAppears("t24"), "none");
      const left = h.page.frames().some((frame) => frame.url().endsWith("/landing"));
      check("T24 precondition: a session started and the step failed after the child left", run.chunksOpened >= 1 && run.result.status === "failed" && left, `chunks=${run.chunksOpened} ${run.result.status} left=${left}`);
      check("T24 security: no trace is retained and none is reported", run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      await h.context.close();
    }

    /** Hub sentinel states still registered in every frame of `page`. */
    const armedSentinels = async (page: Page): Promise<number> =>
      (
        await Promise.all(
          page.frames().map((frame) =>
            frame
              .evaluate(() => {
                const host = window as unknown as Record<string, { states?: unknown[] } | undefined>;
                let count = 0;
                for (const name of Object.getOwnPropertyNames(window)) if (name.startsWith("awkit-protected-hub-")) count += host[name]?.states?.length ?? 0;
                return count;
              })
              .catch(() => 0)
          )
        )
      ).reduce((sum, value) => sum + value, 0);

    // U3 — L1: a frameattached rearm and a scan rearm racing to bind the same new frame.
    console.log("\nU3 two concurrent rearms binding the same new out-of-process frame leave nothing behind:");
    {
      const h = await isolatedHarness("/plain");
      const tracked = slowBindings(h.context, 0, (target) => target !== h.page);
      const watch = await watchProtectedWindow(h.page, { strict: false });
      await h.page.evaluate((src) => {
        const frame = document.createElement("iframe");
        frame.src = src;
        document.body.appendChild(frame);
      }, `${origin.replace("127.0.0.1", "localhost")}/oopif-idle`);
      await h.page.waitForFunction(() => document.querySelector("iframe")?.contentWindow !== null);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await Promise.all([watch.rearm(), watch.rearm()]);
      await watch.finish();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const open = tracked.open();
      const armed = await armedSentinels(h.page);
      tracked.restore();
      check("U3 precondition: the late frame is in the page", h.page.frames().length === 2, `frames=${h.page.frames().length}`);
      check("U3: no CDP session either rearm opened is left open after finish", open === 0, `open=${open}`);
      check("U3: no sentinel is left armed after finish", armed === 0, `armed=${armed}`);
      await h.context.close();
    }

    // U4 — L2: both budgets overrun on a busy main thread; the sentinel arms later with only the console signal.
    console.log("\nU4 a sentinel that arms only after both budgets overran still fails closed:");
    {
      const h = await harness("/plain");
      await h.page.evaluate(() => {
        setTimeout(() => {
          const end = Date.now() + 4_500;
          while (Date.now() < end) {
            // Busy main thread: no evaluate or binding can run until this ends.
          }
        }, 0);
      });
      let signalled = false;
      const watch = await watchProtectedWindow(h.page, { strict: false, onProtected: () => (signalled = true) });
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const consoleOnly = await h.page.evaluate(() => {
        const host = window as unknown as Record<string, { states?: Array<{ bound?: boolean }> } | undefined>;
        for (const name of Object.getOwnPropertyNames(window)) if (name.startsWith("awkit-protected-hub-")) return (host[name]?.states ?? []).some((state) => state.bound === false);
        return false;
      });
      const verdict = await watch.finish();
      check("U4 precondition: the sentinel armed late, with only the console signal", consoleOnly, `consoleOnly=${consoleOnly}`);
      check("U4 security: the watch fails closed (signalled and protected)", signalled && verdict.protected === true, `signalled=${signalled} ${verdict.reason ?? "clear"}`);
      await h.context.close();
    }

    console.log("\nU2 a watch finished while a rearm is still binding a late frame leaves nothing behind:");
    {
      const h = await isolatedHarness("/plain");
      const slow = slowBindings(h.context, 2_500, (target) => target !== h.page);
      const watch = await watchProtectedWindow(h.page, { strict: false });
      await h.page.evaluate((src) => {
        const frame = document.createElement("iframe");
        frame.src = src;
        document.body.appendChild(frame);
      }, `${origin.replace("127.0.0.1", "localhost")}/oopif-idle`);
      await h.page.waitForFunction(() => document.querySelector("iframe")?.contentWindow !== null);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const rearming = watch.rearm();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await watch.finish();
      await rearming;
      await new Promise((resolve) => setTimeout(resolve, 3_500));
      const armed = (
        await Promise.all(
          h.page.frames().map((frame) =>
            frame
              .evaluate(() => {
                const host = window as unknown as Record<string, { states?: unknown[] } | undefined>;
                let count = 0;
                for (const name of Object.getOwnPropertyNames(window)) if (name.startsWith("awkit-protected-hub-")) count += host[name]?.states?.length ?? 0;
                return count;
              })
              .catch(() => 0)
          )
        )
      ).reduce((sum, value) => sum + value, 0);
      const open = slow.open();
      slow.restore();
      const lateFrame = h.page.frames().find((frame) => frame !== h.page.mainFrame());
      const lateOutOfProcess = lateFrame
        ? await h.context.newCDPSession(lateFrame).then(
            async (session) => {
              await session.detach().catch(() => undefined);
              return true;
            },
            () => false
          )
        : false;
      check("U2 precondition: the late frame is in the page and out-of-process", h.page.frames().length === 2 && lateOutOfProcess, `frames=${h.page.frames().length} oopif=${lateOutOfProcess}`);
      check("U2: no CDP session the watch opened is left open after it finished", open === 0, `open=${open}`);
      check("U2: no sentinel is left armed after the watch finished", armed === 0, `armed=${armed}`);
      await h.context.close();
    }
    await isolatedBrowser.close();

    // U1 — markProtected on its own (as a handoff in another executor sharing the run's TraceService would call it).
    console.log("\nU1 [onFailure] markProtected stops the open chunk at once and nothing is kept:");
    {
      const h = await harness("/plain");
      const service = new TraceService(h.traceDir, "onFailure", () => undefined);
      await service.attach(h.context);
      const chunks = spyChunks(h.context);
      const armed = await service.beginStep();
      service.markProtected();
      const stopsAfterMark = chunks.stops();
      const path = await service.endStep("u1", true);
      const traces = await inspectTraces(h.traceDir);
      check("U1 precondition: a chunk was opened on the ordinary page", armed && chunks.starts() === 1);
      check("U1 security: the recording is stopped by markProtected itself, before the step ends", stopsAfterMark === 1, `stops=${stopsAfterMark}`);
      check("U1 security: the failed step keeps and reports nothing", path === undefined && traces.zips === 0, describe(traces));
      await h.context.close();
    }

    // O1–O3 — the passive CDP observation trace (on by default) samples screenshots and, optionally, DOM.
    const observe = async (startPath: string, then?: (h: Harness) => Promise<void>): Promise<{ screenshots: number; doms: number; live: boolean; firstScreenshots: number }> => {
      const h = await harness(startPath);
      const root = join(h.root, "observation");
      const trace = new PassiveCdpTrace({ root, executionId: "exec-o", instanceId: "inst-o", scenarioId: "scenario-o", captureDom: true, sampleIntervalMs: 60_000 });
      await trace.startGeneration({ context: h.context }, 1);
      await trace.sampleNow();
      const firstScreenshots = (await readdir(join(root, "screenshots")).catch(() => [])).length;
      if (then) {
        await then(h);
        await trace.sampleNow();
        await trace.sampleNow();
      }
      const live = !!trace.snapshot().screenshotDataUrl;
      await trace.stop();
      const screenshots = (await readdir(join(root, "screenshots")).catch(() => [])).length;
      const doms = (await readdir(join(root, "dom")).catch(() => [])).length;
      await h.context.close();
      return { screenshots, doms, live, firstScreenshots };
    };
    console.log("\nO1 passive observation samples on a protected page:");
    {
      const o = await observe(PROTECTED_PATH);
      check("O1 security: no screenshot or DOM sample of the protected page is written, and the live view stays empty", o.screenshots === 0 && o.doms === 0 && !o.live, `screenshots=${o.screenshots} doms=${o.doms} live=${o.live}`);
    }
    console.log("\nO2 control, passive observation samples on an ordinary page:");
    {
      const o = await observe("/plain");
      check("O2: ordinary pages are still sampled (screenshot, DOM and live view)", o.screenshots > 0 && o.doms > 0 && o.live, `screenshots=${o.screenshots} doms=${o.doms} live=${o.live}`);
    }
    console.log("\nO3 passive observation after the page navigates to a protected surface:");
    {
      const o = await observe("/plain", async (h) => {
        await h.page.goto(`${origin}${PROTECTED_PATH}`, { waitUntil: "load" });
      });
      check("O3 precondition: the ordinary page was sampled first", o.firstScreenshots > 0, `first=${o.firstScreenshots}`);
      check("O3 security: no sample is added once the page is protected", o.screenshots === o.firstScreenshots, `before=${o.firstScreenshots} after=${o.screenshots}`);
    }

    // O4/O5 — awkit-2het V1: the element shown only inside the sampler's own CDP screenshot call (the R1b shape). The
    // trace's session is wrapped so the element is added right before the real Page.captureScreenshot and removed right
    // after it, with no navigation; both guard scans see an ordinary page.
    const observeWindow = async (
      makeElement: "password" | "benign" | "visit"
    ): Promise<{ wrapped: number; shownProtected: boolean; gone: boolean; before: number; after: number; doms: number; domsBefore: number; liveChanged: boolean }> => {
      const h = await harness("/plain");
      const root = join(h.root, "observation");
      const trace = new PassiveCdpTrace({ root, executionId: "exec-w", instanceId: "inst-w", scenarioId: "scenario-w", captureDom: true, sampleIntervalMs: 60_000 });
      await trace.startGeneration({ context: h.context }, 1);
      const before = (await readdir(join(root, "screenshots")).catch(() => [])).length;
      const domsBefore = (await readdir(join(root, "dom")).catch(() => [])).length;
      const liveBefore = trace.snapshot().screenshotDataUrl;
      let wrapped = 0;
      let shownProtected = false;
      const sessions = (trace as unknown as { sessions: Map<string, { page: Page; session: { send: (method: string, params?: unknown) => Promise<unknown> } }> }).sessions;
      for (const entry of sessions.values()) {
        const send = entry.session.send.bind(entry.session);
        entry.session.send = async (method: string, params?: unknown) => {
          if (method !== "Page.captureScreenshot") return send(method, params);
          wrapped += 1;
          if (makeElement === "visit") {
            // R1a shape: the page is on the protected route only while the real screenshot runs.
            await entry.page.goto(`${origin}${PROTECTED_PATH}`, { waitUntil: "load" });
            shownProtected = (await checkProtectedSurface(entry.page)).protected;
            const shot = await send(method, params);
            await entry.page.goto(`${origin}/plain`, { waitUntil: "load" });
            return shot;
          }
          await entry.page.evaluate((kind) => {
            const el = document.createElement(kind === "password" ? "input" : "div");
            if (kind === "password") (el as HTMLInputElement).type = "password";
            else el.textContent = "Benign banner";
            el.id = "window-el";
            document.body.appendChild(el);
          }, makeElement);
          shownProtected = (await checkProtectedSurface(entry.page)).protected;
          const shot = await send(method, params);
          await entry.page.evaluate(() => document.getElementById("window-el")?.remove());
          return shot;
        };
      }
      await trace.sampleNow();
      const liveChanged = trace.snapshot().screenshotDataUrl !== liveBefore;
      const gone = (await h.page.locator("#window-el").count()) === 0;
      await trace.stop();
      const after = (await readdir(join(root, "screenshots")).catch(() => [])).length;
      const doms = (await readdir(join(root, "dom")).catch(() => [])).length;
      await h.context.close();
      return { wrapped, shownProtected, gone, before, after, doms, domsBefore, liveChanged };
    };
    console.log("\nO4 passive observation: a password field exists only inside the sample's own screenshot call (awkit-2het V1):");
    {
      const o = await observeWindow("password");
      check("O4 precondition: the screenshot call was wrapped, the field was protected while shown and is gone afterwards", o.wrapped >= 1 && o.shownProtected && o.gone && o.before > 0, `wrapped=${o.wrapped} protected=${o.shownProtected} gone=${o.gone} before=${o.before}`);
      check("O4 security: no screenshot or DOM sample is written for that window", o.after === o.before && o.doms === o.domsBefore, `screenshots ${o.before}->${o.after} doms ${o.domsBefore}->${o.doms}`);
      check("O4 security: the Instance Monitor live view is not updated with that frame", !o.liveChanged);
    }
    console.log("\nO6 passive observation: the page visits the protected route and comes back inside the screenshot call (R1a shape):");
    {
      const o = await observeWindow("visit");
      check("O6 precondition: the screenshot call was wrapped, the protected route was shown and the page is ordinary again", o.wrapped >= 1 && o.shownProtected && o.before > 0, `wrapped=${o.wrapped} protected=${o.shownProtected} before=${o.before}`);
      check("O6 security: no screenshot or DOM sample is written for that window", o.after === o.before && o.doms === o.domsBefore, `screenshots ${o.before}->${o.after} doms ${o.domsBefore}->${o.doms}`);
      check("O6 security: the Instance Monitor live view is not updated with that frame", !o.liveChanged);
    }
    console.log("\nO5 control, passive observation: a benign element shown only inside the screenshot call still samples:");
    {
      const o = await observeWindow("benign");
      check("O5 precondition: the screenshot call was wrapped and the element was not protected", o.wrapped >= 1 && !o.shownProtected && o.gone, `wrapped=${o.wrapped} protected=${o.shownProtected} gone=${o.gone}`);
      check("O5: the sample is still written and the live view updated", o.after === o.before + 1 && o.doms === o.domsBefore + 1 && o.liveChanged, `screenshots ${o.before}->${o.after} doms ${o.domsBefore}->${o.doms} live=${o.liveChanged}`);
    }

    // C1
    console.log("\nC1 [onFailure] control, ordinary failing click:");
    {
      const h = await harness("/plain");
      await h.page.fill("#note", SYNTH_NOTE);
      const run = await runTraced(h, "c1", "onFailure", missingClick("c1"), "none");
      check("C1: the step failed", run.result.status === "failed", run.result.status);
      check("C1: exactly one trace is retained and reported", run.traces.zips === 1 && !!run.result.tracePath, describe(run.traces));
      check("C1: the trace keeps screenshots and DOM snapshots of the ordinary page", run.traces.frames > 0 && run.traces.snapshots > 0 && run.traces.ordinaryMarker, describe(run.traces));
      // Recorded fact, not a security assertion: Playwright snapshots carry values typed into ordinary fields.
      console.log(`  · a value typed into an ordinary field appears in the ordinary trace: ${run.traces.noteValue}`);
      await h.context.close();
    }

    // C2
    console.log("\nC2 [always] control, ordinary passing steps:");
    {
      const h = await harness("/plain");
      const run = await runTraced(h, "c2", "always", { id: "c2", type: "wait", name: "Heading", timeoutMs: 3000, value: "Plain form", config: { waitType: "textVisible" } } as unknown as FlowStep, "none");
      check("C2: a passing ordinary step keeps a trace in always mode", run.result.status === "passed" && run.traces.zips === 1 && !!run.result.tracePath, describe(run.traces));
      await h.context.close();
      // Tracing starts once per context, so the navigation case gets its own context.
      const h2 = await harness("/plain");
      const nav = await runTraced(h2, "c2b", "always", { id: "c2b", type: "goto", name: "Next", url: `${origin}/plain2` } as unknown as FlowStep, "none");
      check("C2: a passing step that navigates between ordinary pages keeps its trace too", nav.result.status === "passed" && nav.traces.zips === 1 && !!nav.result.tracePath && nav.traces.ordinaryMarker, describe(nav.traces));
      await h2.context.close();
    }

    // C3
    console.log("\nC3 [onFailure] control, ordinary passing step:");
    {
      const h = await harness("/plain");
      const run = await runTraced(h, "c3", "onFailure", { id: "c3", type: "wait", name: "Heading", timeoutMs: 3000, value: "Plain form", config: { waitType: "textVisible" } } as unknown as FlowStep, "none");
      check("C3: a passing step keeps nothing in onFailure mode", run.result.status === "passed" && run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      await h.context.close();
    }

    // C4
    console.log("\nC4 [off] control, ordinary failing step:");
    {
      const h = await harness("/plain");
      const run = await runTraced(h, "c4", "off", missingClick("c4"), "none");
      check("C4: tracing off keeps nothing", run.result.status === "failed" && run.traces.zips === 0 && !run.result.tracePath, describe(run.traces));
      await h.context.close();
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
