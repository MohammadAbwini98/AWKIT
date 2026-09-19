/**
 * verify:locator-quality-class — Phase L L2: the shared, explainable locator quality class
 * (`src/recorder/LocatorQualityClass.ts`).
 *
 * 1. Rule table: every class boundary, and every reason code reachable (a cardinality check, so a rule
 *    that silently stops firing fails the suite instead of passing vacuously).
 * 2. Real capture: the REAL Recorder page script records clicks on `/recorder-lab/locator-quality`
 *    served by the REAL mock site, and the REAL finalizer (`buildRecordedFlow`, guard hashing included)
 *    produces the saved locators that are classified. Guarded-positional must stay `resolved`.
 * 3. Negative control: the same saved twin locator without its guard is no longer guarded.
 *
 * Run: npm run verify:locator-quality-class
 */
import { spawn, type ChildProcess } from "node:child_process";
import { get as httpGet } from "node:http";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

import type { LocatorQuality, StepLocator } from "@src/profiles/FlowProfile";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { classifyLocatorQuality, type LocatorQualityClass, type LocatorQualityReasonCode } from "@src/recorder/LocatorQualityClass";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import type { RecordedAction } from "@src/recorder/RecorderTypes";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// ── 1. Rule table ─────────────────────────────────────────────────────────────────────────────────

const unique = (strategy: LocatorQuality["strategy"], extra: Partial<LocatorQuality> = {}): LocatorQuality =>
  ({ strategy, isUnique: true, matchCount: 1, visibleMatchCount: 1, confidence: "high", ...extra });
const FINGERPRINT = { tag: "button", tokens: ["h1", "h2"] } as unknown as NonNullable<StepLocator["guard"]>["fingerprint"];
const GUARD = { candidateSelector: "button", fingerprint: FINGERPRINT, siblingCount: 2, index: 1, confidence: "exact" as const };

const CASES: Array<{ name: string; locator: StepLocator; expected: LocatorQualityClass; code: LocatorQualityReasonCode }> = [
  { name: "unique test id", locator: { strategy: "testId", value: "save", quality: unique("testId") }, expected: "strong-semantic", code: "unique-semantic" },
  { name: "unique role and name", locator: { strategy: "role", value: "button", name: "Save", quality: unique("role") }, expected: "strong-semantic", code: "unique-semantic" },
  { name: "unique label inside one frame", locator: { strategy: "label", value: "Email", quality: unique("label"), context: { frame: { selector: "iframe#pay" } } }, expected: "strong-semantic", code: "in-frame" },
  { name: "a guard on a non-positional locator is ignored, as at runtime", locator: { strategy: "placeholder", value: "Search", quality: unique("placeholder"), guard: GUARD }, expected: "strong-semantic", code: "unique-semantic" },
  { name: "role without a name", locator: { strategy: "role", value: "button", quality: unique("role") }, expected: "acceptable-semantic", code: "role-without-name" },
  { name: "visible text", locator: { strategy: "text", value: "Weekly digest", quality: unique("text") }, expected: "acceptable-semantic", code: "text-content" },
  { name: "no capture evidence (hand-authored or legacy)", locator: { strategy: "label", value: "Email" }, expected: "acceptable-semantic", code: "no-capture-evidence" },
  { name: "low capture confidence", locator: { strategy: "testId", value: "x", quality: unique("testId", { confidence: "low" }) }, expected: "acceptable-semantic", code: "low-capture-confidence" },
  { name: "unique only among visible elements", locator: { strategy: "role", value: "button", name: "Apply", quality: unique("role", { matchCount: 2, visibleMatchCount: 1 }) }, expected: "acceptable-semantic", code: "unique-when-visible" },
  { name: "container-scoped", locator: { strategy: "role", value: "button", name: "Edit", quality: unique("role", { disambiguation: "container" }), context: { containers: [{ type: "tableRow", strategy: "role", value: "row", hasText: "INV-1002" }] } }, expected: "acceptable-semantic", code: "container-scoped" },
  { name: "closed shadow root", locator: { strategy: "testId", value: "x", quality: unique("testId"), context: { shadow: { boundary: "closed" } } }, expected: "acceptable-semantic", code: "closed-shadow" },
  { name: "nested frames", locator: { strategy: "testId", value: "x", quality: unique("testId"), context: { frameChain: [{ selector: "iframe#a" }, { selector: "iframe#b" }] } }, expected: "acceptable-semantic", code: "nested-frames" },
  { name: "guarded positional", locator: { strategy: "css", value: "button >> nth=1", quality: unique("fallback", { disambiguation: "positional", confidence: "low" }), guard: GUARD, resolution: "resolved" }, expected: "guarded-positional", code: "guarded-positional" },
  { name: "positional with a malformed guard is not re-proven", locator: { strategy: "css", value: "button >> nth=1", quality: unique("fallback", { disambiguation: "positional" }), guard: { ...GUARD, fingerprint: undefined as unknown as typeof FINGERPRINT } }, expected: "review-required", code: "positional-unguarded" },
  { name: "unguarded positional", locator: { strategy: "css", value: "li:nth-child(2) > button" }, expected: "review-required", code: "positional-unguarded" },
  { name: "user-approved positional fallback", locator: { strategy: "css", value: "button >> nth=0", resolution: "user-approved-fallback" }, expected: "review-required", code: "user-approved-fallback" },
  { name: "not unique at capture", locator: { strategy: "text", value: "Delete", quality: { strategy: "text", isUnique: false, matchCount: 4, confidence: "low" } }, expected: "review-required", code: "not-unique" },
  { name: "explicit XPath", locator: { strategy: "xpath", value: "//button[@name='go']", quality: unique("xpath") }, expected: "review-required", code: "xpath-opt-in" },
  { name: "structural CSS", locator: { strategy: "css", value: "form.checkout button.primary", quality: unique("css", { disambiguation: "compound" }) }, expected: "review-required", code: "structural-selector" },
  { name: "needs review", locator: { strategy: "testId", value: "x", resolution: "needs-review", reviewReason: "identity not proven" }, expected: "review-required", code: "resolution-needs-review" },
  { name: "invalid", locator: { strategy: "testId", value: "", resolution: "invalid" }, expected: "review-required", code: "resolution-invalid" },
  {
    name: "a captured identity fingerprint is reported",
    locator: { strategy: "testId", value: "x", quality: unique("testId"), identity: { schemaVersion: 1, primary: { strategy: "testId", value: "x" }, owner: { tag: "button" }, fingerprint: FINGERPRINT } as unknown as StepLocator["identity"] },
    expected: "strong-semantic",
    code: "identity-fingerprint"
  }
];
const ALL_CODES: LocatorQualityReasonCode[] = [
  "resolution-invalid", "resolution-needs-review", "user-approved-fallback", "guarded-positional", "positional-unguarded", "not-unique",
  "structural-selector", "xpath-opt-in", "unique-semantic", "text-content", "role-without-name", "no-capture-evidence", "low-capture-confidence",
  "unique-when-visible", "container-scoped", "closed-shadow", "nested-frames", "in-frame", "identity-fingerprint"
];

console.log("1. Rule table");
const seen = new Set<LocatorQualityReasonCode>();
for (const testCase of CASES) {
  const result = classifyLocatorQuality(testCase.locator);
  for (const reason of result?.reasons ?? []) seen.add(reason.code);
  check(
    `${testCase.name} → ${testCase.expected} (${testCase.code})`,
    result?.class === testCase.expected && result.reasons.some((reason) => reason.code === testCase.code) && result.reasons.every((reason) => reason.detail.length > 0),
    result
  );
}
check("no locator has no class", classifyLocatorQuality(undefined) === undefined);
check("every reason code is reachable from the table", ALL_CODES.every((code) => seen.has(code)), ALL_CODES.filter((code) => !seen.has(code)));

// ── 2. Real Recorder capture ─────────────────────────────────────────────────────────────────────

const PORT = await new Promise<number>((done, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address() as { port: number };
    probe.close(() => done(port));
  });
});
const LAB = `http://127.0.0.1:${PORT}/recorder-lab/locator-quality`;

const TARGETS: Array<{ name: string; expected: LocatorQualityClass; click: (page: Page) => Promise<void> }> = [
  { name: "unique test id (Save draft)", expected: "strong-semantic", click: (page) => page.getByTestId("lq-save-draft").click() },
  { name: "unique role and name (Publish report)", expected: "strong-semantic", click: (page) => page.getByRole("button", { name: "Publish report" }).click() },
  { name: "text chip (Weekly digest)", expected: "acceptable-semantic", click: (page) => page.getByText("Weekly digest").click() },
  // The hidden duplicate counts at capture, so the Recorder falls back to a guarded position: exactly
  // the kind of target the class flags for an L3 semantic upgrade.
  { name: "Apply coupon beside a hidden duplicate", expected: "guarded-positional", click: (page) => page.getByRole("button", { name: "Apply coupon" }).click() },
  { name: "Edit in the INV-1002 row", expected: "acceptable-semantic", click: (page) => page.getByRole("row", { name: /INV-1002/ }).getByRole("button", { name: "Edit" }).click() },
  { name: "second of two identical Remove twins", expected: "guarded-positional", click: (page) => page.locator(".lq-twins button").nth(1).click() }
];

let mockSite: ChildProcess | undefined;
const browser = await chromium.launch();
try {
  console.log("\n2. Real Recorder capture on /recorder-lab/locator-quality");
  mockSite = spawn(process.execPath, [join(ROOT, "mock-site", "server.mjs")], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: "ignore", windowsHide: true });
  const up = await (async () => {
    for (const deadline = Date.now() + 20_000; Date.now() < deadline; await sleep(200)) {
      const ok = await new Promise<boolean>((done) => {
        httpGet(LAB, (response) => {
          response.resume();
          done(response.statusCode === 200);
        }).on("error", () => done(false));
      });
      if (ok) return true;
    }
    return false;
  })();
  if (!up) throw new Error(`mock site never served ${LAB}`);

  const context = await browser.newContext();
  await context.addInitScript({ content: getRecorderInitScriptContent() });
  const page = await context.newPage();
  const actions: RecordedAction[] = [];
  await page.exposeBinding("__awtkit_recordAction", (_source, action) => actions.push(action as RecordedAction));
  await page.exposeBinding("__awtkit_recordSignal", () => undefined);
  await page.goto(LAB);
  await page.waitForTimeout(400);
  const clickIndexes: number[] = [];
  for (const target of TARGETS) {
    const before = actions.length;
    await target.click(page);
    for (const deadline = Date.now() + 5_000; Date.now() < deadline && !actions.slice(before).some((action) => action.type === "click"); ) await sleep(50);
    clickIndexes.push(actions.findIndex((action, index) => index >= before && action.type === "click"));
  }
  await context.close();
  check("the Recorder captured one click per target", clickIndexes.every((index) => index >= 0) && clickIndexes.length === TARGETS.length, clickIndexes);

  // The single finalizer produces the saved steps (guard hashing, sensitivity policy, resolution).
  const flow = buildRecordedFlow("L2 locator quality", clickIndexes.map((index) => actions[index]));
  const clickSteps = flow.nodes.filter((step) => step.type === "click");
  check("buildRecordedFlow finalized every captured click", clickSteps.length === TARGETS.length, clickSteps.length);
  TARGETS.forEach((target, index) => {
    const step = clickSteps[index];
    const result = classifyLocatorQuality(step?.locator);
    check(`${target.name} → ${target.expected}`, result?.class === target.expected, { class: result?.class, reasons: result?.reasons.map((reason) => reason.code), locator: step?.locator && { strategy: step.locator.strategy, value: step.locator.value, name: step.locator.name, quality: step.locator.quality, context: step.locator.context, resolution: step.locator.resolution, guard: Boolean(step.locator.guard) } });
  });
  const twin = clickSteps[TARGETS.length - 1]?.locator;
  check("guarded-positional stays resolved (L2 changes no resolution)", twin?.resolution === "resolved" && Boolean(twin.guard), { resolution: twin?.resolution, guard: Boolean(twin?.guard) });

  console.log("\n3. Negative control");
  if (twin) {
    const { guard: _guard, ...unguarded } = twin;
    const result = classifyLocatorQuality(unguarded as StepLocator);
    check("the same saved twin locator without its guard is review-required, not guarded", result?.class === "review-required" && result.reasons[0]?.code === "positional-unguarded", result);
  } else {
    check("the same saved twin locator without its guard is review-required, not guarded", false, "no twin locator was captured");
  }
} catch (error) {
  check("the capture harness completed without throwing", false, error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  await browser.close();
  mockSite?.kill();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
