/**
 * verify:visual-diagnosis-gui — N5.5 (awkit-vra.14.5): the text-only *Visual diagnosis* section of the run-detail
 * drawer, in the real Electron app, read through the real PAGE_REPORTS `reports:get` from a seeded stored report.
 * Plan: docs/plans/ai-upgrade-v5/N5-visual-failure-diagnosis.md › Accessibility and UI, Verification (VD-6, VD-10).
 *
 * Three failed instances of one stored run:
 *  - A: L5a evidence plus two records, one observed over a truncated examined set with hostile extra keys, one
 *    refused as sensitive;
 *  - B: no L5a evidence, a calibrated identity record that also carries the pruned `viewport-uniform`, a record
 *    whose code is markup, and a record of another version;
 *  - C: L5a evidence and no block.
 *
 * Asserted: placement after Captured evidence and before AI analysis; presence only with the block; the basis, the
 * unproven note, the examined-scope and truncation copy ending with the not-compared sentence, the caveat; no
 * "only", "unique" or "the element"; text on every line (never colour alone); no image, canvas or un-hidden icon;
 * the pruned code shown as inconclusive; hostile keys and markup gone after the read-side sanitizer; nothing
 * focusable in the section and real Tab kept inside the dialog; no motion with reduced motion on or off. The copy and
 * media checks are pure functions over a snapshot, so each mutant below must turn them red.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type Locator, type Page } from "playwright";

import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { EvidenceBuffer, EvidenceRunBudget } from "@src/runner/evidence/ExecutionEvidence";
import { deriveFailureCause } from "@src/runner/evidence/FailureCauseBaseline";
import { INSTANCE_DIAGNOSTICS_SCHEMA_VERSION, type InstanceDiagnostics } from "@src/runner/evidence/FailureEvidenceCollector";
import type { DurableRunRecord } from "@src/runner/store/RuntimeStoreSchema";
import { SqliteRuntimeStore } from "@src/runner/store/SqliteRuntimeStore";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { env, electronArgs, dataRoot, cleanup } = isolatedLaunchEnv("awkit-visual-diagnosis-gui");
const appData = path.join(dataRoot, "SpecterStudio");

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

// ── Seed ─────────────────────────────────────────────────────────────────────────────────────────
const RUN_EXEC = "exec-n5-gui";
const A = "run-n5-gui-a";
const B = "run-n5-gui-b";
const C = "run-n5-gui-c";
const SECRET_URL = "https://secret.example/orders?token=n5-gui-secret";
const SECRET_DIGEST = "f00dfeedcafe0123";

function capturedFailure(instanceId: string): InstanceDiagnostics {
  let clock = 0;
  const buffer = new EvidenceBuffer({ executionId: RUN_EXEC, instanceId }, new EvidenceRunBudget(), { redactor: new SemanticRedactor(), now: () => clock });
  clock = 1_000;
  buffer.add({ source: "runner.failure", severity: "error", context: { flowId: "flow-n5-gui", nodeId: "n-tool", stepIndex: 1 }, payload: { kind: "locator", message: "The tool button was not found." } });
  const evidence = [...buffer.list()];
  const runnerEvent = evidence.find((event) => event.source === "runner.failure");
  const cause = deriveFailureCause(evidence, { kind: "locator", stepStartOffsetMs: 500, failedAtOffsetMs: 1_000, ...(runnerEvent ? { evidenceId: runnerEvent.id } : {}) });
  return { schemaVersion: INSTANCE_DIAGNOSTICS_SCHEMA_VERSION, evidence, summary: buffer.summary(), cause };
}

const record = (fields: Record<string, unknown>) => ({
  version: 1,
  stepId: "n-tool",
  attempt: 3,
  failureKind: "locator",
  outcome: "observed",
  conditions: "unproven",
  referenceSource: "runtime",
  examined: 1,
  domNamed: 1,
  truncated: false,
  ms: 420,
  ...fields
});
const visualFor: Record<string, unknown[]> = {
  [A]: [
    record({
      observations: ["conditions-unproven", "target-multiple-matches", "other-examined-identical"],
      examined: 32,
      domNamed: 40,
      truncated: true,
      identicalOthers: "2+",
      url: SECRET_URL,
      fingerprint: SECRET_DIGEST,
      selector: "[data-testid=vf-tool-0]"
    }),
    record({ stepId: "n-approve", attempt: 1, failureKind: "timeout", outcome: "refused", conditions: "none", referenceSource: "none", examined: 0, domNamed: 0, observations: ["sensitive"] })
  ],
  [B]: [
    record({ referenceSource: "recorded", observations: ["conditions-unproven", "target-identical-to-reference", "viewport-uniform"] }),
    record({ stepId: "n-other", observations: ["<img src=x onerror=alert(1)>"] }),
    record({ version: 2, stepId: "n-future", observations: ["target-occluded"] })
  ]
};

const failedAt = Date.now() - 10 * 60_000;
const storedRun = {
  id: RUN_EXEC,
  executionId: RUN_EXEC,
  scenarioId: "wf-n5-gui",
  scenarioName: "N5 GUI workflow",
  runMode: "dataDrivenConcurrent",
  maxConcurrentInstances: 3,
  status: "failed",
  startedAt: new Date(failedAt).toISOString(),
  endedAt: new Date(failedAt + 3_000).toISOString(),
  durationMs: 3_000,
  passedFlows: 0,
  failedFlows: 3,
  skippedFlows: 0,
  instances: [A, B, C].map((instanceId) => ({
    instanceId,
    status: "failed",
    durationMs: 1_500,
    error: "The tool button was not found.",
    screenshots: [],
    downloadedFiles: [],
    ...(instanceId === B ? {} : { diagnostics: capturedFailure(instanceId) }),
    ...(visualFor[instanceId] ? { visualDiagnosis: visualFor[instanceId] } : {})
  })),
  runtimeInputs: {}
} as unknown as ConcurrentRunReport & { id: string };
const reportFile = path.join(appData, "reports", `${RUN_EXEC}.json`);
mkdirSync(path.dirname(reportFile), { recursive: true });
writeFileSync(reportFile, `${JSON.stringify(storedRun, null, 2)}\n`, "utf8");
mkdirSync(path.join(appData, "runtime"), { recursive: true });
{
  const runtime = await SqliteRuntimeStore.open(path.join(appData, "runtime", "runtime.sqlite"), () => undefined);
  const iso = (ms: number) => new Date(ms).toISOString();
  for (const [index, instanceId] of [A, B, C].entries()) {
    runtime.upsertRun({
      instanceId,
      executionId: RUN_EXEC,
      scenarioId: "wf-n5-gui",
      scenarioName: "N5 GUI workflow",
      triggerType: "manual",
      status: "failed",
      flowRunStatus: "failed",
      startedAt: iso(failedAt + index),
      endedAt: iso(failedAt + 1_500 + index),
      updatedAt: iso(failedAt + 1_500 + index),
      durationMs: 1_500,
      queueWaitMs: 10,
      retryCount: 2,
      reportCategory: "locator",
      errorClass: "locator",
      error: "The tool button was not found.",
      machineId: "fixture-machine",
      logicalCpuCount: 8,
      totalMemoryMb: 8192,
      executionMode: "auto",
      browserPoolMode: "shared",
      configuredConcurrency: 3,
      observedPeakConcurrency: 3,
      workloadClass: "light",
      headed: false,
      resourceProfile: "balanced",
      isolationClass: "SHARED_CONTEXT",
      workloadWeight: 1,
      pressureStateAtRun: "healthy"
    } as Partial<DurableRunRecord> as DurableRunRecord);
  }
  await runtime.persistNow();
  await runtime.close();
}

// ── Pure checks over a snapshot of the section (also fed the mutants) ────────────────────────────
interface Snapshot {
  present: boolean;
  text: string;
  records: number;
  lines: { code: string | null; text: string }[];
  scope: string[];
  basis: string[];
  caveat: string;
  media: number;
  unhiddenIcons: number;
  icons: number;
  focusables: number;
  motion: string[];
}

const UNIQUENESS = /\b(only|unique|uniquely|sole)\b|\bthe element\b/i;
const CAVEAT = "Advisory. This does not identify an element to use, and it does not change the run.";
const NOT_COMPARED = "Elements the run did not examine were not compared.";

function copyProblems(snap: Snapshot): string[] {
  const problems: string[] = [];
  if (!snap.present) return ["absent"];
  if (snap.records === 0) problems.push("a section with no records");
  if (snap.caveat !== CAVEAT) problems.push("caveat");
  if (UNIQUENESS.test(snap.text)) problems.push("uniqueness wording");
  if (snap.lines.some((line) => line.text.trim().length === 0)) problems.push("a line without text");
  if (snap.scope.some((scope) => !scope.endsWith(NOT_COMPARED))) problems.push("scope without the not-compared sentence");
  return problems;
}
function mediaProblems(snap: Snapshot): string[] {
  const problems: string[] = [];
  if (snap.media > 0) problems.push("an image, canvas, picture or video");
  if (snap.unhiddenIcons > 0) problems.push("an icon not aria-hidden");
  if (snap.focusables > 0) problems.push("focusable content");
  if (snap.motion.length > 0) problems.push(`motion: ${snap.motion.join(",")}`);
  return problems;
}

async function snapshot(drawer: Locator): Promise<Snapshot> {
  return drawer.evaluate((dialog) => {
    const section = dialog.querySelector('[data-testid="visual-diagnosis-section"]');
    if (!section) return { present: false, text: "", records: 0, lines: [], scope: [], basis: [], caveat: "", media: 0, unhiddenIcons: 0, icons: 0, focusables: 0, motion: [] };
    const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const icons = [...section.querySelectorAll("svg")];
    const motion: string[] = [];
    for (const el of [section, ...section.querySelectorAll("*")]) {
      const style = getComputedStyle(el);
      const busy = (value: string) => value.split(",").some((part) => parseFloat(part) > 0);
      if (style.animationName !== "none" && busy(style.animationDuration)) motion.push(`${el.tagName}:animation`);
      if (busy(style.transitionDuration)) motion.push(`${el.tagName}:transition`);
    }
    return {
      present: true,
      text: text(section),
      records: section.querySelectorAll('[data-testid="visual-diagnosis-record"]').length,
      lines: [...section.querySelectorAll('[data-testid="visual-diagnosis-observation"]')].map((li) => ({ code: li.getAttribute("data-code"), text: text(li) })),
      scope: [...section.querySelectorAll('[data-testid="visual-diagnosis-scope"]')].map(text),
      basis: [...section.querySelectorAll('[data-testid="visual-diagnosis-basis"]')].map(text),
      caveat: text(section.querySelector('[data-testid="visual-diagnosis-caveat"]') ?? section),
      media: section.querySelectorAll("img, canvas, picture, video, image").length,
      unhiddenIcons: icons.filter((icon) => icon.getAttribute("aria-hidden") !== "true").length,
      icons: icons.length,
      focusables: section.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]').length,
      motion
    };
  });
}

async function headings(drawer: Locator): Promise<string[]> {
  return drawer.evaluate((dialog) => [...dialog.querySelectorAll("h3")].map((h) => (h.textContent ?? "").trim()));
}

let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
const mainErrors: string[] = [];
try {
  app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env });
  app.process().stderr?.on("data", (chunk: Buffer) => mainErrors.push(chunk.toString().trim()));
  app.process().on("exit", (code) => mainErrors.push(`main process exited with ${code}`));
  app.on("close", () => {
    if (passed + failed === 0) console.error(`  (Electron closed before any check: ${mainErrors.filter(Boolean).slice(-8).join(" | ").slice(0, 1200)})`);
  });
  // A cold start of the dev bundle under ARM64 x64 emulation can exceed the harness's 40 s default.
  const win: Page = await resolveMainWindow(app, 120_000);
  const console_ = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  console_.setLabel("first-run super user");
  await signInFirstRun(win);

  const openDrawer = async (instanceId: string) => {
    if ((await win.getByRole("dialog", { name: "Run detail" }).count()) > 0) {
      await win.keyboard.press("Escape");
      await win.getByRole("dialog", { name: "Run detail" }).waitFor({ state: "detached", timeout: 10_000 });
    }
    if ((await win.locator("button.nav-item", { hasText: "Failure Analytics" }).count()) === 0) await navClick(win, "Reports");
    await navClick(win, "Failure Analytics");
    const open = win.getByTestId(`failure-evidence-open-${instanceId}`);
    await open.waitFor({ state: "visible", timeout: 15_000 });
    await open.click();
    const drawer = win.getByRole("dialog", { name: "Run detail" });
    await drawer.waitFor({ state: "visible", timeout: 15_000 });
    await drawer.getByTestId("failure-evidence-section").waitFor({ state: "visible", timeout: 15_000 });
    return drawer;
  };

  console.log("\nA: L5a evidence, a truncated observed record with hostile keys, and a refusal");
  console_.setLabel("instance A");
  let drawer = await openDrawer(A);
  await drawer.getByTestId("visual-diagnosis-section").waitFor({ state: "visible", timeout: 10_000 });
  const a = await snapshot(drawer);
  const order = await headings(drawer);
  const at = (prefix: string) => order.findIndex((h) => h.startsWith(prefix));
  check("the section is shown when the report carries the block", a.present);
  check(
    "it comes after Captured evidence and before AI analysis",
    at("Visual diagnosis") > at("Captured evidence") && at("Captured evidence") >= 0 && (at("AI analysis") === -1 || at("AI analysis") > at("Visual diagnosis")),
    JSON.stringify(order)
  );
  check("the L5a deterministic cause still shows", (await drawer.getByTestId("failure-cause").count()) === 1);
  check("one block per record, each labelled with its step", a.records === 2 && /Step n-tool, attempt 3/.test(a.text) && /Step n-approve, attempt 1/.test(a.text), a.text.slice(0, 300));
  check("the basis names the last passing run", a.basis[0] === "Compared with the reference from the last passing run.", JSON.stringify(a.basis));
  check(
    "the unproven note says a difference is never reported",
    a.lines.some((line) => line.code === "conditions-unproven" && /does not record how it was rendered/.test(line.text) && /difference is never reported/.test(line.text))
  );
  check("the multiple-matches fact is a sentence", a.lines.some((line) => line.code === "target-multiple-matches" && /matched more than one element/.test(line.text)));
  check(
    "the identity copy names the examined scope and the count as 2 or more",
    a.scope[0]?.startsWith("Of the 32 elements the run examined, 2 or more others are pixel-identical to the reference."),
    a.scope[0]
  );
  check("...adds the truncation sentence", a.scope[0]?.includes("The run stopped after examining the first 32 of the elements it found."), a.scope[0]);
  check("...and ends with the not-compared sentence", a.scope[0]?.endsWith(NOT_COMPARED), a.scope[0]);
  check(
    "the refusal reads as not diagnosed, with no basis",
    a.lines.some((line) => line.code === "sensitive" && /^Not diagnosed: the step acts on a sensitive or committing control/.test(line.text)) && a.basis.length === 1
  );
  check("copy checks pass (caveat, no uniqueness wording, text on every line)", copyProblems(a).length === 0, copyProblems(a).join("; "));
  check("media checks pass (no image or canvas, icons aria-hidden, nothing focusable, no motion)", mediaProblems(a).length === 0 && a.icons >= 3, `${mediaProblems(a).join("; ")} icons=${a.icons}`);
  const drawerText = await drawer.innerText();
  check("no URL, digest or selector from the hostile record reaches the drawer", !/secret\.example|n5-gui-secret|f00dfeed|vf-tool-0/.test(drawerText));

  console.log("\nFocus by containment with real Tab");
  const walk: { inDialog: boolean; inVisual: boolean }[] = [];
  for (let i = 0; i < 25; i += 1) {
    await win.keyboard.press("Tab");
    walk.push(
      await win.evaluate(() => {
        const active = document.activeElement;
        const dialog = document.querySelector('[role="dialog"][aria-label="Run detail"]');
        const visual = document.querySelector('[data-testid="visual-diagnosis-section"]');
        return { inDialog: Boolean(active && active !== document.body && dialog?.contains(active)), inVisual: Boolean(active && visual?.contains(active)) };
      })
    );
  }
  check("real Tab stays inside the dialog for 25 presses", walk.every((step) => step.inDialog), JSON.stringify(walk.filter((step) => !step.inDialog).length));
  check("...and never lands inside the text-only section", walk.every((step) => !step.inVisual));

  console.log("\nReduced motion");
  await win.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await snapshot(drawer);
  check("no animation or transition in the section with reduced motion on", reduced.motion.length === 0, reduced.motion.join(","));
  await win.emulateMedia({ reducedMotion: "no-preference" });
  check("...nor with it off", (await snapshot(drawer)).motion.length === 0);

  console.log("\nB: no L5a evidence, the pruned code, markup as a code, another version");
  console_.setLabel("instance B");
  drawer = await openDrawer(B);
  check("the L5a section says no failure evidence was captured", (await drawer.getByTestId("failure-evidence-section").getAttribute("data-evidence-state")) === "none");
  await drawer.getByTestId("visual-diagnosis-section").waitFor({ state: "visible", timeout: 10_000 });
  const b = await snapshot(drawer);
  check("the visual section still shows without L5a", b.present);
  check("the record of another version is dropped on read", b.records === 2 && !/n-future/.test(b.text), `records=${b.records}`);
  check("the basis names the Recorder", b.basis[0] === "Compared with the reference the Recorder captured.", JSON.stringify(b.basis));
  check(
    "a single examined target is worded over its scope",
    b.scope[0] === `Of the 1 element the run examined, the step's target is pixel-identical to the reference. ${NOT_COMPARED}`,
    b.scope[0]
  );
  check("the pruned viewport-uniform is never shown", !b.lines.some((line) => line.code === "viewport-uniform") && !/blank|uniform/i.test(b.text));
  check("...it reads as inconclusive instead", b.lines.some((line) => line.code === "inconclusive" && line.text === "The check ran, but nothing it can report applies."));
  check("markup as a code reads as an unreadable observation", b.lines.some((line) => line.code === "invalid" && line.text === "An observation in this report could not be read.") && !/onerror|<img/.test(b.text));
  check("copy and media checks pass", copyProblems(b).length === 0 && mediaProblems(b).length === 0, [...copyProblems(b), ...mediaProblems(b)].join("; "));

  console.log("\nC: L5a evidence and no block");
  console_.setLabel("instance C");
  drawer = await openDrawer(C);
  check("the drawer shows the captured evidence", (await drawer.getByTestId("failure-evidence-section").getAttribute("data-evidence-state")) === "captured");
  check("the section is absent when the field is absent", (await drawer.getByTestId("visual-diagnosis-section").count()) === 0 && !(await snapshot(drawer)).present);
  await win.keyboard.press("Escape");

  console.log("\nMutants (each must turn the checks red)");
  const mutants: [string, (snap: Snapshot) => Snapshot, (snap: Snapshot) => string[]][] = [
    ["a uniqueness word introduced", (s) => ({ ...s, text: `${s.text} The only match.` }), copyProblems],
    ['"the element" in identity copy', (s) => ({ ...s, text: s.text.replace("2 or more others are", "the element is") }), copyProblems],
    ["the not-compared sentence dropped", (s) => ({ ...s, scope: s.scope.map((x) => x.replace(NOT_COMPARED, "")) }), copyProblems],
    ["the caveat dropped", (s) => ({ ...s, caveat: "" }), copyProblems],
    ["a colour-only status line", (s) => ({ ...s, lines: [...s.lines, { code: "target-occluded", text: "" }] }), copyProblems],
    ["a section rendered with no data", (s) => ({ ...s, records: 0 }), copyProblems],
    ["an image in the section", (s) => ({ ...s, media: 1 }), mediaProblems],
    ["an icon not aria-hidden", (s) => ({ ...s, unhiddenIcons: 1 }), mediaProblems],
    ["a focusable control in the section", (s) => ({ ...s, focusables: 1 }), mediaProblems],
    ["a transition in the section", (s) => ({ ...s, motion: ["LI:transition"] }), mediaProblems]
  ];
  // A's truncated record must carry its truncation sentence; dropping it must be seen.
  const truncationProblems = (s: Snapshot) => (s.scope[0]?.includes("The run stopped after examining the first 32 of the elements it found.") ? [] : ["truncation sentence"]);
  mutants.push(["the truncation sentence dropped", (s) => ({ ...s, scope: s.scope.map((x) => x.replace(/The run stopped after examining[^.]*\. /, "")) }), truncationProblems]);
  check("the unmutated A snapshot passes the truncation check", truncationProblems(a).length === 0);
  for (const [name, mutate, problems] of mutants) check(`MUTATION: ${name} is caught`, problems(mutate(a)).length > 0);

  const errors = console_.errors ?? [];
  check("no renderer error was logged across the journey", errors.length === 0, JSON.stringify(errors).slice(0, 400));
} catch (error) {
  failed += 1;
  console.error(`  ✗ unexpected error — ${error instanceof Error ? error.stack : String(error)}`);
  const tail = mainErrors.filter(Boolean).slice(-8);
  if (tail.length) console.error(`    main process stderr (last ${tail.length}): ${tail.join(" | ").slice(0, 1200)}`);
} finally {
  await app?.close().catch(() => undefined);
  try {
    cleanup();
  } catch {
    /* the profile is a temp dir; a Windows file lock here is not a product failure */
  }
}

console.log(`\nverify:visual-diagnosis-gui — ${passed} passed, ${failed} failed`);
if (passed === 0) failed += 1;
process.exit(failed === 0 ? 0 : 1);
