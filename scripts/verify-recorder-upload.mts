/**
 * Deterministic regression for Recorder file-chooser capture (`awkit-11ii`).
 *
 * A `change` on `input[type=file]` fell through to the generic input branch, so the Recorder stored
 * `type: "fill"` carrying `C:\fakepath\<name>` — the placeholder the DOM exposes because browsers
 * deliberately withhold the real path. Playwright refuses to type into a file input, so the step was
 * unrunnable by construction; and because the `input` and `change` handlers both fire for one
 * selection, it was stored TWICE. The flow saved clean and failed at replay.
 *
 * Drives the real recorder init script against `mock-site/runner-lab`, installed the way production
 * installs it. The upload replay itself is already covered by `verify:runner`; what is measured here
 * is what the Recorder STORES, and that the stored form is one the product refuses before it runs
 * rather than one that fails halfway through.
 *
 * WHAT REGRESSION MAKES THIS FAIL: recording a file input as a fill, recording the fake path,
 * emitting two actions for one selection, or attaching an empty value source that satisfies the
 * required-value rule and lets the flow save clean.
 *
 * MUTATION CONTRACT (measured, not asserted). Against 13 checks:
 *   - restore the generic-input fall-through (the defect) ................ 11 fail
 *   - keep the fix but attach `valueSource: { type: "static", value: "" }` . 2 fail ([C1], [C2])
 *   - keep the fix but let the `input` handler run for file inputs ........ 4 fail
 *
 * Run with: npx tsx scripts/verify-recorder-upload.mts
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { validateFlowDefinition, errorsOf } from "@src/validation/FlowValidator";
import { JsonProfileStore } from "@src/storage/ProfileStore";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import type { FlowProfile } from "@src/profiles/FlowProfile";

const PORT = 4425;
const LAB = `http://127.0.0.1:${PORT}/runner-lab`;

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

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(LAB)).ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Mock site did not start");
}

async function main(): Promise<void> {
  const server = spawn(process.execPath, ["mock-site/server.mjs"], {
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore"
  });
  await waitForServer();

  const dir = await mkdtemp(join(tmpdir(), "awkit-rec-upload-"));
  const filePath = join(dir, "evidence.txt");
  await writeFile(filePath, "recorder upload evidence", "utf8");

  const script = await getRecorderInitScriptContent();
  const browser = await chromium.launch({ headless: true });

  try {
    const ctx = await browser.newContext();
    await ctx.addInitScript({ content: script });
    const page = await ctx.newPage();
    const actions: RecordedAction[] = [];
    await page.exposeBinding("__awtkit_recordAction", (_s, a) => {
      actions.push(a as RecordedAction);
    });
    await page.exposeBinding("__awtkit_recordSignal", () => {});
    await page.goto(LAB, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    await page.getByTestId("upload-input").setInputFiles(filePath);
    await page.waitForTimeout(400);
    await ctx.close();

    console.log("\n[A] what the Recorder stores for a file selection");
    const upload = actions.find((a) => a.type === "uploadFile");
    check("[A1] the selection is stored as an uploadFile action", !!upload, JSON.stringify(actions.map((a) => a.type)));
    check("[A2] ...not as a fill", !actions.some((a) => a.type === "fill"), JSON.stringify(actions.map((a) => `${a.type}=${a.valueSource?.value ?? ""}`)));
    check(
      "[A3] no action anywhere carries the browser's fake path",
      !JSON.stringify(actions).includes("fakepath"),
      JSON.stringify(actions.map((a) => a.valueSource?.value))
    );
    check("[A4] one selection produces exactly one action", actions.length === 1, String(actions.length));
    check("[A5] the file input's own locator is stored", upload?.locator?.value === "upload-input", JSON.stringify(upload?.locator));
    check("[A6] the chosen file name is preserved in the step title", /evidence\.txt/.test(upload?.name ?? ""), upload?.name);

    console.log("\n[B] the built flow");
    const flow = buildRecordedFlow("Recorded upload", actions);
    const step = flow.nodes.find((n) => n.type === "uploadFile");
    check("[B1] the flow carries an uploadFile step", !!step, JSON.stringify(flow.nodes.map((n) => n.type)));
    check("[B2] it holds no fabricated path", !step?.value && !step?.valueSource?.value, JSON.stringify({ value: step?.value, valueSource: step?.valueSource }));
    check("[B3] the flow has no leftover fill for the same gesture", flow.nodes.filter((n) => n.type === "fill").length === 0, JSON.stringify(flow.nodes.map((n) => n.type)));

    console.log("\n[C] the product refuses it BEFORE a browser launches");
    const issues = errorsOf(validateFlowDefinition(flow));
    const missingValue = issues.find((i) => i.code === "missingRequiredValue" && i.nodeId === step?.id);
    check("[C1] validation reports the upload step as missing its value", !!missingValue, JSON.stringify(issues.map((i) => i.code)));
    check("[C2] ...naming the step, so the user knows which path to supply", /evidence\.txt/.test(missingValue?.message ?? ""), missingValue?.message);

    console.log("\n[D] supplying the path makes it runnable, and it survives a round trip");
    const supplied: FlowProfile = {
      ...flow,
      id: "recorded-upload",
      nodes: flow.nodes.map((n) => (n.type === "uploadFile" ? { ...n, value: filePath } : n))
    };
    check("[D1] the same flow validates once a path is supplied", errorsOf(validateFlowDefinition(supplied)).length === 0, JSON.stringify(errorsOf(validateFlowDefinition(supplied)).map((i) => i.code)));
    const storeDir = await mkdtemp(join(tmpdir(), "awkit-rec-upload-store-"));
    const store = new JsonProfileStore<FlowProfile>({ folder: storeDir });
    await store.create(supplied);
    const reloaded = (await store.get("recorded-upload"))?.nodes.find((n) => n.type === "uploadFile");
    check("[D2] save → reload keeps the step type, locator and supplied path", reloaded?.type === "uploadFile" && reloaded?.value === filePath && !!reloaded?.locator, JSON.stringify({ type: reloaded?.type, value: reloaded?.value }));
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
