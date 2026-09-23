/**
 * verify:ai-spy-live — Element Spy's "Find stronger locator with AI" on the REAL Qwen3.5-0.8B, in the
 * real Electron app (Phase L, L3 §1, inside the owner's limited L1 GO: on demand, proven before shown).
 *
 * `verify:ai-assist-gui` proves this path with a scripted provider. This is the same path — the
 * Recorder's own browser, a trusted click, the real preload and IPC, main's loop, compiler, intent guard
 * and proof — with the pinned 0.8B answering through the production AiService and the real ai-host.cjs.
 * It records what a person sees: how long a request takes, what it ends as, and whether any proposal the
 * panel shows is right.
 *
 * A shown proposal is judged by the PAGE, as `verify:ai-locator-quality-live` judges one: on a fresh page
 * of the verifier's own browser, the candidate the panel rendered must match exactly one element, that
 * element's `data-spy` must be the inspected one, and a click on it must land there (`spy-last`).
 * Controls show first that the judge is not vacuous.
 *
 * The pack is seeded into the isolated profile the way an import leaves it (registry + `<sha256>.gguf`,
 * hard-linked); the app still checks its size against the pin and hashes the whole file before it loads
 * it. The import dialog is not exercised here.
 *
 * Model quality is evidence here, not a threshold: a refusal is a truthful outcome. The run FAILS when the
 * product is wrong — a shown proposal the page rejects, an answer past its own deadline, a cancel that
 * does not release the host, anything written. A run that shows no proposal is INCONCLUSIVE for correctness
 * (exit 2, the `gateExitCode` convention), never a pass. NOT RUN (exit 0) without the runtime or the pack at
 * ~/Downloads/Qwen3.5-0.8B-Q4_K_M.gguf (or AWKIT_AI_LIVE_MODEL).
 *
 * Needs `npm run build` first (it launches `out/`). Run: npm run verify:ai-spy-live
 */
import { copyFileSync, existsSync, linkSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, chromium, type Browser, type ElectronApplication, type Page } from "playwright";

import { parseAiOutput } from "@src/ai/AiOutputContract";
import type { InspectionLocatorView } from "@src/ai/contracts/AiApi";
import { AI_HOST_TIMEOUTS } from "@src/ai/contracts/AiHostProtocol";
import { evaluateLocatorPlan } from "@src/ai/locatorPlan";
import { describeCandidate, describeProposedScope } from "@src/ai/locatorStatus";
import { LOCATOR_ATTEMPT_LIMITS, LOCATOR_ATTEMPT_SCHEMA } from "@src/ai/locatorUpgradeAttempts";
import type { ElementInspection } from "@src/recorder/RecorderTypes";
import { AI_MODEL_MANIFEST } from "@src/offline/AiModelManifest";
import { LocatorFactory } from "@src/runner/LocatorFactory";

import { measurePack, runtimeInstalled } from "./ai-harness/launch.mts";
import {
  isolatedLaunchEnv,
  resolveMainWindow,
  signInFirstRun
  // @ts-expect-error Shared GUI helper is intentionally plain ESM JavaScript.
} from "./lib/gui-verify-harness.mjs";
import {
  navClick,
  watchConsole
  // @ts-expect-error Shared E2E helper is intentionally plain ESM JavaScript.
} from "./lib/e2e-qa-lib.mjs";
import {
  SPY_FRAME,
  SPY_LAB,
  aiBusy,
  aiReleased,
  captureRecorderBrowsers,
  inspectInSpy,
  openSpy,
  persistedState,
  startFeatureTestLab,
  until
} from "./lib/recorder-spy-harness.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACK = AI_MODEL_MANIFEST.find((entry) => entry.id === "qwen3.5-0.8b-q4-k-m")!;
/** The whole job: every attempt at its own deadline, plus the first request's hash, spawn and load. */
const JOB_DEADLINE_MS = LOCATOR_ATTEMPT_LIMITS.maxAttempts * LOCATOR_ATTEMPT_LIMITS.timeoutMs + 30_000;
/** L1.8's user-facing cancel ceiling; the host itself is killed after `cancelGraceMs`. */
const CANCEL_CEILING_MS = 3_000;
/** The tool running this stops at 600 s; a step that could not finish inside what is left is NOT RUN. */
const RUN_BUDGET_MS = 570_000;
const runStarted = Date.now();

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string | null): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const notRun = (label: string, why: string) => console.log(`  NOT RUN  ${label} — ${why}`);

console.log(`Element Spy on the real ${PACK.displayName} — the Recorder's own browser, the product's own request\n`);
const runtime = runtimeInstalled();
if (!runtime.installed) {
  console.log("NOT RUN: node-llama-cpp and its Windows CPU prebuilt are not installed (owner step 1 in L1-ai-foundation.md).");
  process.exit(0);
}
const source = process.env.AWKIT_AI_LIVE_MODEL ?? path.join(os.homedir(), "Downloads", PACK.fileName);
if (!existsSync(source)) {
  console.log(`NOT RUN: no model pack at ${source}.`);
  process.exit(0);
}
const measured = await measurePack(source);
if (measured.sizeBytes !== PACK.sizeBytes || measured.sha256 !== PACK.sha256) {
  console.error(`REFUSED: ${source} is not the pinned ${PACK.fileName} (${measured.sizeBytes} bytes, sha256 ${measured.sha256}).`);
  process.exit(1);
}

// ── An isolated profile with local AI on and the pinned pack installed ─────────────────────────────
const probe = isolatedLaunchEnv("awkit-ai-spy-live");
const env: Record<string, string | undefined> = {
  ...probe.env,
  // As in verify:ai-assist-gui: the isolated LOCALAPPDATA would also move Playwright's browser cache.
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
};
delete env.AWKIT_TEST_AI_PROVIDER; // never the scripted provider
const appData = path.join(probe.dataRoot, "SpecterStudio");
const models = path.join(appData, "ai", "models");
mkdirSync(models, { recursive: true });
writeFileSync(path.join(appData, "ai", "ai-settings.json"), `${JSON.stringify({ enabled: true, yieldDuringRuns: true, idleUnloadMinutes: 10, featureTiers: {} }, null, 2)}\n`);
let linked = true;
try {
  linkSync(source, path.join(models, `${PACK.sha256}.gguf`));
} catch {
  copyFileSync(source, path.join(models, `${PACK.sha256}.gguf`));
  linked = false;
}
writeFileSync(path.join(models, "registry.json"), `${JSON.stringify({ schemaVersion: 1, active: { sha256: PACK.sha256, installedAt: new Date().toISOString() } }, null, 2)}\n`);
console.log(`  runtime ${runtime.build}, pack ${PACK.sha256.slice(0, 16)}… ${linked ? "hard-linked" : "copied"} into the isolated profile\n`);

const port = Number(process.env.AWKIT_AI_SPY_LIVE_PORT ?? 4437);
const origin = `http://127.0.0.1:${port}`;
const spyAi = (win: Page) => win.getByTestId("element-spy-ai");

type Phase = { kind: "idle" | "loading" | "done" | "failed"; view?: InspectionLocatorView };

/**
 * The phase the Spy's AI panel is rendering, read from its React props: the exact proposal a person is
 * shown, including the scope the panel only summarizes. Read-only. (No named inner functions.)
 */
async function shownPhase(win: Page): Promise<Phase | null> {
  return win.evaluate(() => {
    const bar = document.querySelector('[data-testid="element-spy-ai"]');
    if (!bar) return null;
    const key = Object.keys(bar).find((name) => name.startsWith("__reactFiber$"));
    type Fiber = { memoizedProps?: { phase?: { kind?: unknown } }; return?: Fiber | null };
    let fiber = key ? ((bar as unknown as Record<string, Fiber>)[key] ?? null) : null;
    while (fiber) {
      const phase = fiber.memoizedProps?.phase;
      if (phase && typeof phase.kind === "string") return JSON.parse(JSON.stringify(phase));
      fiber = fiber.return ?? null;
    }
    return null;
  });
}

/** The page's verdict on a candidate, outside the product's gates, on a fresh page of the judge's own browser. */
async function judge(browser: Browser, proposal: NonNullable<InspectionLocatorView["proposal"]>) {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}${SPY_LAB}`);
    const locator = await new LocatorFactory(page).locateCandidate(proposal.candidate, proposal.context).catch(() => null);
    const matches = locator ? await locator.count().catch(() => 0) : 0;
    const selected = locator && matches === 1 ? await locator.getAttribute("data-spy").catch(() => null) : null;
    let clicked: string | null = null;
    if (locator && matches === 1 && (await locator.click({ timeout: 5_000 }).then(() => true, () => false))) clicked = await page.getByTestId("spy-last").textContent();
    return { matches, selected, clicked };
  } finally {
    await page.close();
  }
}

/**
 * Why a refused request was refused. The panel says only "none could be proven", and main keeps no record,
 * so the verifier keeps the AI host's traffic (a `utilityProcess.fork` wrap in main, as `chromium.launch`
 * is wrapped): each infer request's host id, job id and prompt, and each reply by host id. `attemptsOf`
 * pairs them here, so a reply is an attempt only when it answers an infer request this ask sent. Every
 * reply is then re-classified exactly as the loop does: the output contract, the compiler and intent guard,
 * the duplicate rule, then the page. Held in memory; only codes, shapes and compiled locators are printed.
 * (No named inner functions.)
 */
type HostTraffic = {
  requests: { child: number; id: string; jobId: string; user: string }[];
  replies: { child: number; id: string; ok: boolean; text?: string; reason?: string }[];
};
async function captureHostTraffic(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate((electronModule) => {
    const store = globalThis as unknown as { __awkitHostTraffic?: HostTraffic };
    if (store.__awkitHostTraffic) return;
    const traffic: HostTraffic = { requests: [], replies: [] };
    store.__awkitHostTraffic = traffic;
    type Child = { on(event: string, listener: (message: unknown) => void): unknown; postMessage(message: unknown, ...rest: unknown[]): void };
    const utility = electronModule.utilityProcess as unknown as { fork: (...args: unknown[]) => Child };
    const fork = utility.fork.bind(utility);
    let forks = 0;
    utility.fork = (...args: unknown[]) => {
      const child = fork(...args);
      const index = forks++;
      const post = child.postMessage.bind(child);
      child.postMessage = (message: unknown, ...rest: unknown[]) => {
        const sent = message as { type?: unknown; id?: unknown; jobId?: unknown; user?: unknown } | null;
        if (sent?.type === "infer" && typeof sent.id === "string" && typeof sent.jobId === "string") {
          traffic.requests.push({ child: index, id: sent.id, jobId: sent.jobId, user: typeof sent.user === "string" ? sent.user : "" });
        }
        post(message, ...rest);
      };
      child.on("message", (message: unknown) => {
        const reply = message as { id?: unknown; ok?: unknown; value?: { text?: unknown }; reason?: unknown } | null;
        if (typeof reply?.id !== "string" || typeof reply.ok !== "boolean") return;
        traffic.replies.push({
          child: index,
          id: reply.id,
          ok: reply.ok,
          ...(typeof reply.value?.text === "string" ? { text: reply.value.text } : {}),
          ...(typeof reply.reason === "string" ? { reason: reply.reason } : {})
        });
      });
      return child;
    };
  });
}
async function takeHostTraffic(electronApp: ElectronApplication): Promise<HostTraffic> {
  return electronApp.evaluate(() => {
    const store = globalThis as unknown as { __awkitHostTraffic?: HostTraffic };
    return { requests: (store.__awkitHostTraffic?.requests ?? []).splice(0), replies: (store.__awkitHostTraffic?.replies ?? []).splice(0) };
  });
}

type Attempt = { attempt: number; ok: boolean; text?: string; reason?: string };
/**
 * The attempts one ask made, in order: each reply paired with the infer request it answers by host and id.
 * Anything else — a load or hello reply, another utility host, a job asked before this one (a cancelled
 * request answering late) — answers no request of this ask and is left out. `jobs` counts the §7 jobs
 * (`<job>.a<n>#<host try>`) this ask's requests belong to.
 */
function attemptsOf(traffic: HostTraffic): { jobs: number; attempts: Attempt[] } {
  const sent = new Map(traffic.requests.map((request) => [`${request.child}:${request.id}`, request.jobId]));
  const attempts: Attempt[] = [];
  for (const { child, id, ...reply } of traffic.replies) {
    const jobId = sent.get(`${child}:${id}`);
    if (jobId) attempts.push({ attempt: Number(/\.a(\d+)#\d+$/.exec(jobId)?.[1] ?? NaN), ...reply });
  }
  return { jobs: new Set(traffic.requests.map((request) => request.jobId.replace(/\.a\d+#\d+$/, ""))).size, attempts: attempts.sort((a, b) => a.attempt - b.attempt) };
}

/** What one request showed the model: its line kinds, candidate strategies and match counts, container kinds. Never its text. */
function requestShape(user: string): string {
  const kinds = new Map<string, number>();
  for (const line of user.split("\n")) {
    const candidate = /^candidate: (\w+)=.* matches=(\d+)$/.exec(line);
    const container = /^container: (\w+)/.exec(line);
    const kind = candidate
      ? `candidate ${candidate[1]} (matches ${candidate[2]})`
      : container
        ? `container ${container[1]}`
        : /^(current locator|target|heading|sibling action|data-bound, not shown|refused attempt \d+):/.exec(line)?.[1];
    if (kind) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  return [...kinds].map(([kind, n]) => (n > 1 ? `${kind} ×${n}` : kind)).join("; ");
}

/** The refused field's strategy and the SHAPE of its text (every word run is `a`), which names the compiler branch without the text. */
function refusedShape(plan: unknown, field: string): string {
  const source = plan as { target?: Record<string, unknown>; scopes?: Record<string, unknown>[] };
  const at = field.startsWith("scopes.") ? source.scopes?.[Number(field.split(".")[1])] : source.target;
  const key = /\.(name|hasText)$/.exec(field)?.[1] ?? "value";
  const text = typeof at?.[key] === "string" ? (at[key] as string) : "";
  return `strategy ${String(at?.strategy)}, ${key} shaped "${text.replace(/[A-Za-z0-9_]+/g, "a").slice(0, 40)}"`;
}

/** Each attempt as the loop saw it, and what the page says about any plan that compiled. */
async function classifyAttempts(browser: Browser, attempts: readonly Attempt[], baseline: ElementInspection["locator"], intended: string) {
  const seen = new Set<string>();
  const lines: string[] = [];
  let rightButWithheld = 0;
  for (const reply of attempts) {
    const at = `attempt ${reply.attempt}`;
    if (!reply.ok || reply.text === undefined) {
      lines.push(`${at}: host ${reply.reason}`);
      continue;
    }
    const parsed = parseAiOutput(reply.text, LOCATOR_ATTEMPT_SCHEMA);
    if (!parsed.ok) {
      lines.push(`${at}: ${parsed.code} (${parsed.errors.slice(0, 2).join("; ")})`);
      continue;
    }
    const compiled = evaluateLocatorPlan(parsed.value, { boundValues: [], baseline, captured: baseline.context });
    if (!compiled.ok) {
      lines.push(`${at}: ${compiled.code === "INTENT_BOUND_VALUE" ? "intent" : "compiler"} ${compiled.code} on ${compiled.field} (${refusedShape(parsed.value, compiled.field)})`);
      continue;
    }
    const shown = `${describeCandidate(compiled.candidate)}${describeProposedScope(compiled.context) ? ` within ${describeProposedScope(compiled.context)}` : ""}`;
    const key = JSON.stringify([compiled.candidate, compiled.context ?? null]);
    if (seen.has(key)) {
      lines.push(`${at}: DUPLICATE of an earlier attempt (${shown})`);
      continue;
    }
    seen.add(key);
    const verdict = await judge(browser, { candidate: compiled.candidate, ...(compiled.context ? { context: compiled.context } : {}), meaningChange: compiled.meaningChange });
    const right = verdict.matches === 1 && verdict.selected === intended;
    if (right) rightButWithheld += 1;
    const page = verdict.matches === 0 ? "NO_MATCH" : verdict.matches > 1 ? `NOT_UNIQUE (${verdict.matches})` : right ? "THE INSPECTED ELEMENT" : `WRONG_ELEMENT (${verdict.selected})`;
    lines.push(`${at}: compiled ${shown} → page: ${page}`);
  }
  return { lines, rightButWithheld };
}

type Outcome = { element: string; state: string | null; ms: number; code: string | null; attempts: number | null; modelId: string | null; shown: string | null; judged: string; why?: string[] };
const outcomes: Outcome[] = [];

/**
 * Ask through the button, as a person does, and wait for what the panel settles on. `mentions` are
 * fixture texts whose presence in the first request is reported as yes/no, never shown.
 */
async function askReal(electronApp: ElectronApplication, win: Page, judgeBrowser: Browser, element: string, intended: string, mentions: string[] = []): Promise<void> {
  const baseline = (await win.evaluate(() => window.playwrightFlowStudio.recorder.getInspection())).inspection?.locator;
  await takeHostTraffic(electronApp);
  const started = Date.now();
  await win.getByTestId("element-spy-ai-propose").click();
  const loading = await until(async () => (await spyAi(win).getAttribute("data-assist-state")) === "loading", 5_000);
  const settled = await until(async () => {
    const state = await spyAi(win).getAttribute("data-assist-state");
    return state && state !== "loading" && state !== "idle" ? state : null;
  }, JOB_DEADLINE_MS);
  const ms = Date.now() - started;
  const phase = await shownPhase(win);
  const view = phase?.view;
  const message = await win.getByTestId("element-spy-ai-message").innerText().catch(() => "");
  check(`${element}: the request shows loading, then settles inside its own deadline (${Math.round(JOB_DEADLINE_MS / 1000)} s)`, Boolean(loading) && settled !== null, `${settled} after ${ms} ms`);
  check(`${element}: (precondition) the panel's rendered phase was read`, phase !== null && phase.kind === settled);
  const outcome: Outcome = { element, state: settled, ms, code: view?.code ?? null, attempts: view?.attemptsUsed ?? null, modelId: view?.modelId ?? null, shown: null, judged: "nothing shown" };
  if (settled === "done" && view?.proposal) {
    outcome.shown = await win.getByTestId("element-spy-ai-proposal").innerText().catch(() => null);
    check(`${element}: the answer came from the pinned ${PACK.displayName}`, view.modelId === PACK.id, String(view.modelId));
    check(`${element}: it is labelled an AI suggestion and says nothing was saved or applied`, /^AI suggestion/.test(await win.getByTestId("element-spy-ai-result").innerText()) && /Nothing was saved or applied/.test(message));
    const verdict = await judge(judgeBrowser, view.proposal);
    outcome.judged = `matches ${verdict.matches}, selected ${verdict.selected}, click reached ${verdict.clicked}`;
    check(
      `${element}: the page confirms the shown proposal — one element, the inspected one, and a click lands there`,
      verdict.matches === 1 && verdict.selected === intended && verdict.clicked === intended,
      outcome.judged
    );
  } else {
    check(`${element}: a refusal shows its reason and no proposal`, settled === "failed" && message.trim().length > 0 && (await win.getByTestId("element-spy-ai-result").count()) === 0, `${view?.code}: ${message}`);
    check(`${element}: the refusal is the model's or the proof's, not a broken runtime`, view?.code !== "UNAVAILABLE" && view?.code !== "INVALID_REQUEST", `${view?.code}: ${message}`);
  }
  check(`${element}: main let the job go`, await aiReleased(win, 10_000));
  const traffic = await takeHostTraffic(electronApp);
  const { jobs, attempts } = attemptsOf(traffic);
  check(
    `${element}: (precondition) one reply per attempt, each paired with this job's own request`,
    baseline !== undefined && jobs === 1 && attempts.length === (view?.attemptsUsed ?? -1) && attempts.every((a, i) => a.attempt === i + 1),
    `${jobs} job(s), attempts ${attempts.map((a) => a.attempt).join(",")}, panel says ${view?.attemptsUsed}`
  );
  if (baseline) {
    const why = await classifyAttempts(judgeBrowser, attempts, baseline, intended);
    const first = traffic.requests[0]?.user ?? "";
    outcome.why = [
      `request 1 showed: ${requestShape(first) || "nothing parsable"}${mentions.map((text) => `; mentions ${text}: ${first.includes(text) ? "yes" : "no"}`).join("")}`,
      ...why.lines
    ];
    if (settled !== "done") check(`${element}: no plan the page proves right was withheld`, why.rightButWithheld === 0, why.lines.join(" | "));
  }
  outcomes.push(outcome);
}

const budgetLeft = () => RUN_BUDGET_MS - (Date.now() - runStarted);

let app: ElectronApplication | undefined;
let judgeBrowser: Browser | undefined;
let site: Awaited<ReturnType<typeof startFeatureTestLab>> | undefined;
try {
  site = await startFeatureTestLab(root, port);
  judgeBrowser = await chromium.launch();

  console.log("The judge is not vacuous");
  const right = await judge(judgeBrowser, { candidate: { strategy: "role", value: "button", name: "Save profile", exact: true }, meaningChange: false });
  check("control: a right candidate is judged right", right.matches === 1 && right.selected === "save-profile" && right.clicked === "save-profile", JSON.stringify(right));
  const wrong = await judge(judgeBrowser, { candidate: { strategy: "role", value: "button", name: "Keep", exact: true }, meaningChange: false });
  check("control: a unique but different element is judged not the inspected one", wrong.matches === 1 && wrong.selected === "dialog-keep" && wrong.clicked === "dialog-keep", JSON.stringify(wrong));
  const ambiguous = await judge(judgeBrowser, { candidate: { strategy: "role", value: "button", name: "Edit", exact: true }, meaningChange: false });
  check("control: an unscoped duplicate matches more than one element", ambiguous.matches > 1 && ambiguous.selected === null, JSON.stringify(ambiguous));

  console.log("\nThe attempt accounting is not vacuous");
  // Replies out of order, a load reply, another host reusing an id, and a cancelled job answering late.
  const paired = attemptsOf({
    requests: [
      { child: 0, id: "a7", jobId: "ai-assist:1:x.a2#3", user: "" },
      { child: 0, id: "a5", jobId: "ai-assist:1:x.a1#2", user: "" }
    ],
    replies: [
      { child: 0, id: "a1", ok: true },
      { child: 1, id: "a5", ok: false, reason: "OTHER_HOST" },
      { child: 0, id: "a7", ok: true, text: "second" },
      { child: 0, id: "a4", ok: false, reason: "AI_CANCELLED" },
      { child: 0, id: "a5", ok: true, text: "first" }
    ]
  });
  check(
    "control: only replies to this job's own requests count, in attempt order",
    paired.jobs === 1 && paired.attempts.map((a) => `${a.attempt}:${a.text}`).join(" ") === "1:first 2:second",
    JSON.stringify(paired)
  );

  app = await electron.launch({ args: [root, ...probe.electronArgs], cwd: root, env: env as Record<string, string> });
  await captureHostTraffic(app);
  const win: Page = await resolveMainWindow(app);
  const console_ = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  console_.setLabel("first-run super user");
  await signInFirstRun(win);

  console.log("\nPreconditions");
  const status = await win.evaluate(() => window.playwrightFlowStudio.ai.getStatus());
  check(`main reports local AI on with ${PACK.displayName} installed`, status.enabled && status.modelPack.status === "installed" && status.modelPack.modelId === PACK.id, JSON.stringify(status));

  console_.setLabel("element spy");
  await navClick(win, "Recorder");
  await win.waitForSelector(".recorder-page", { timeout: 20_000 });
  const before = persistedState(appData);
  const actionsBefore = JSON.stringify(await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions()));
  await captureRecorderBrowsers(app);
  await win.getByLabel("Target URL").fill(`${origin}${SPY_LAB}`);
  check("Open Element Spy opens the Recorder's browser on the Feature Test Lab", Boolean(await openSpy(win)), await win.getByTestId("element-spy-message").innerText().catch(() => ""));

  console.log("\nA sensitive element is refused before the model is asked");
  const approve = await inspectInSpy(app, win, { frame: SPY_FRAME, selector: '[data-testid="spy-frame-approve"]' }, "Approve in frame");
  const t3Started = Date.now();
  await win.getByTestId("element-spy-ai-propose").click();
  const t3 = await until(async () => ((await spyAi(win).getAttribute("data-assist-state")) === "failed" ? true : null), 10_000);
  const t3Ms = Date.now() - t3Started;
  check("(precondition) the approval control is inspected", Boolean(approve));
  check("it is refused at once, with the reason", Boolean(t3) && /never proposes locators for sensitive or sign-in elements/.test(await win.getByTestId("element-spy-ai-message").innerText()), `${t3Ms} ms`);
  check("...and main never started the model", (await win.evaluate(() => window.playwrightFlowStudio.ai.getStatus())).state !== "busy");
  outcomes.push({ element: "Approve in frame (T3)", state: t3 ? "failed" : null, ms: t3Ms, code: (await shownPhase(win))?.view?.code ?? null, attempts: 0, modelId: null, shown: null, judged: "nothing shown" });

  console.log("\nA duplicated control: Edit in the INV-2002 row");
  const edit = await inspectInSpy(app, win, { selector: '[data-spy="edit-2002"]' }, "Edit");
  check("(precondition) the row's Edit button is inspected", Boolean(edit), JSON.stringify(edit?.owner ?? null));
  console.log(`  (the Recorder's own locator: ${await win.getByTestId("element-spy-primary").innerText().catch(() => "?")} — ${await win.getByTestId("element-spy-class").innerText().catch(() => "?")})`);
  await askReal(app, win, judgeBrowser, "Edit (INV-2002)", "edit-2002", ["INV-2002"]);

  console.log("\nCancel a real inference");
  const display = await inspectInSpy(app, win, { selector: '[data-testid="spy-display-name"]' }, "Display name");
  check("(precondition) the Display name field is inspected", Boolean(display));
  await win.getByTestId("element-spy-ai-propose").click();
  const inferring = await aiBusy(win, 60_000);
  check("(precondition) main is running the model", inferring);
  // Cancel mid-generation, not the instant the job is admitted: 3 s into the model's work.
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const cancelAt = Date.now();
  await win.getByTestId("element-spy-ai-cancel").click();
  const released = await aiReleased(win, 15_000);
  const releaseMs = Date.now() - cancelAt;
  check("Cancel shows cancelled at once", (await spyAi(win).getAttribute("data-assist-state")) === "failed" && /Cancelled/.test(await win.getByTestId("element-spy-ai-message").innerText()));
  check(`...and releases the model within ${CANCEL_CEILING_MS} ms (host grace ${AI_HOST_TIMEOUTS.cancelGraceMs} ms)`, released && releaseMs <= CANCEL_CEILING_MS, `${releaseMs} ms`);
  outcomes.push({ element: "Display name (cancelled)", state: "failed", ms: releaseMs, code: "CANCELLED", attempts: null, modelId: null, shown: null, judged: "nothing shown" });

  console.log("\nA uniquely named control: Save profile");
  if (budgetLeft() < JOB_DEADLINE_MS + 20_000) {
    notRun("Save profile on the real model", `${Math.round(budgetLeft() / 1000)} s of the run budget left, a job may need ${Math.round(JOB_DEADLINE_MS / 1000)} s`);
  } else {
    const save = await inspectInSpy(app, win, { selector: '[data-testid="spy-save-profile"]' }, "Save profile");
    check("(precondition) Save profile is inspected", Boolean(save));
    await askReal(app, win, judgeBrowser, "Save profile", "save-profile");
  }

  console.log("\nNothing was written");
  check("no flow, fragment, report or Recorder draft on disk changed", persistedState(appData) === before);
  check("...and no recorded step changed", JSON.stringify(await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions())) === actionsBefore);
  await win.getByTestId("element-spy-stop").click();
  const errors = console_.errors ?? [];
  check("no renderer error was logged", errors.length === 0, JSON.stringify(errors).slice(0, 400));
} catch (error) {
  failed += 1;
  console.error(`  ✗ unexpected error — ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  await app?.close().catch(() => undefined);
  await judgeBrowser?.close().catch(() => undefined);
  site?.kill();
  try {
    probe.cleanup();
  } catch {
    /* the profile is a temp dir; a Windows file lock here is not a product failure */
  }
}

console.log("\nWhat a person saw (no model text beyond the locator the panel shows):");
for (const o of outcomes) {
  console.log(`  ${o.element}: ${o.state ?? "never settled"} ${o.code ?? ""} in ${(o.ms / 1000).toFixed(1)} s${o.attempts !== null ? `, ${o.attempts} attempt(s)` : ""}${o.shown ? ` — shown: ${o.shown}` : ""}${o.shown ? ` — judged: ${o.judged}` : ""}`);
  for (const line of o.why ?? []) console.log(`      ${line}`);
}
const shown = outcomes.filter((o) => o.shown);
console.log(
  shown.length
    ? `\n${shown.length} proposal(s) shown, each judged by the page above.`
    : "\nINCONCLUSIVE for correctness: the real model's proposals were all refused, so no shown proposal was there to judge."
);
const inconclusive = shown.length === 0;
console.log(`\nverify:ai-spy-live — ${passed} passed, ${failed} failed${inconclusive ? ", proposal correctness INCONCLUSIVE" : ""} (${Math.round((Date.now() - runStarted) / 1000)} s)`);
// The repository's gate convention (`gateExitCode`): 1 on any failure or nothing passed, 2 when INCONCLUSIVE.
process.exit(failed > 0 || passed === 0 ? 1 : inconclusive ? 2 : 0);
