/**
 * verify:dom-intelligence-gui — L11 (awkit-djnl.19) DOM intelligence in the REAL Electron app.
 *
 *   1. Settings → DOM Intelligence: status, provider, parser-only mode, the pinned version when the dev
 *      runtime is staged, browser and network access disabled.
 *   2. The Designer's "Find current element" runs through the real preload, IPC authorization, flow store
 *      and the Element Spy's live page (the Feature Test Lab): a saved locator that exists reads as found,
 *      one that does not reads as missing, the page/frame context is shown, and with no recorded identity
 *      nothing is offered to apply.
 *   3. Diagnosing never writes: the saved flow file is byte-identical afterwards.
 *   4. With the Spy closed there is no live page, and the Designer says so instead of guessing.
 *
 * The apply gate, the proof and the protected-surface refusal are proven on real pages by
 * verify:locator-diagnosis; this suite proves the product wiring. Needs `npm run build` first.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { SPY_LAB, openSpy, startFeatureTestLab } from "./lib/recorder-spy-harness.mts";
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
const PORT = 4436;
// The isolated LOCALAPPDATA hides Playwright's browser cache from the Recorder, so point it back (as verify:ai-assist-gui does).
const probe = isolatedLaunchEnv("awkit-dom-intelligence-gui", {
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
});
const appData = path.join(probe.dataRoot, "SpecterStudio");
const FLOW_ID = "l11-diagnosis-gui";
const FLOW_NAME = "L11 diagnosis GUI";
const flowFile = path.join(appData, "flows", `${FLOW_ID}.json`);
const devRuntimeStaged = existsSync(path.join(root, "build", "native-hosts", "dom-intelligence", "dom-intelligence-host-manifest.json"));
const pinnedScrapling = (JSON.parse(readFileSync(path.join(root, "src", "offline", "dom-intelligence-runtime.json"), "utf8")) as { scrapling: string }).scrapling;

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 400)}`}`);
  }
}

const now = new Date().toISOString();
mkdirSync(path.dirname(flowFile), { recursive: true });
writeFileSync(
  flowFile,
  `${JSON.stringify(
    {
      id: FLOW_ID,
      name: FLOW_NAME,
      description: "Seeded for verify:dom-intelligence-gui",
      version: 1,
      createdAt: now,
      updatedAt: now,
      nodes: [
        { id: "start", type: "start", name: "Start", position: { x: 280, y: 80 } },
        { id: "found", type: "click", name: "Save profile", locator: { strategy: "testId", value: "spy-save-profile" }, position: { x: 280, y: 220 } },
        { id: "missing", type: "click", name: "Gone button", locator: { strategy: "css", value: "#l11-no-such-element" }, position: { x: 280, y: 360 } },
        { id: "end", type: "end", name: "End", position: { x: 280, y: 500 } }
      ],
      edges: [
        { id: "e0", source: "start", target: "found", type: "success" },
        { id: "e1", source: "found", target: "missing", type: "success" },
        { id: "e2", source: "missing", target: "end", type: "success" }
      ]
    },
    null,
    2
  )}\n`
);
const flowHash = () => createHash("sha256").update(readFileSync(flowFile)).digest("hex");
const seededHash = flowHash();

async function openFlow(win: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await navClick(win, "Flow Designer");
    if (await win.getByRole("button", { name: "Saved flow" }).waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) break;
  }
  await win.getByRole("button", { name: "Saved flow" }).click();
  await win.getByRole("option", { name: FLOW_NAME }).click();
  await win.locator('[data-canvas-node="found"]').waitFor({ state: "visible", timeout: 15_000 });
}

/** Select a node, run the diagnosis, and wait for its result (or its error) to render. */
async function diagnoseNode(win: Page, nodeId: string): Promise<{ recorded: string | null; identity: string | null; provider: string | null; context: string; error: string; uses: number }> {
  await win.locator(`[data-canvas-node="${nodeId}"]`).click();
  const run = win.getByTestId("designer-locator-diagnosis-run");
  await run.waitFor({ state: "visible", timeout: 10_000 });
  await run.click();
  const result = win.getByTestId("designer-locator-diagnosis-result");
  await win
    .waitForFunction(
      () => {
        const box = document.querySelector('[data-testid="designer-locator-diagnosis-result"]');
        return Boolean(box?.querySelector('[data-evidence="recorded"]') || box?.querySelector(".form-message.error"));
      },
      undefined,
      { timeout: 30_000 }
    )
    .catch(() => undefined);
  return {
    recorded: await result.locator('[data-evidence="recorded"]').getAttribute("data-recorded-status").catch(() => null),
    identity: await result.locator('[data-evidence="identity"]').getAttribute("data-snapshot-outcome").catch(() => null),
    provider: await result.locator('[data-evidence="candidates"]').getAttribute("data-provider-outcome").catch(() => null),
    context: (await win.getByTestId("designer-locator-diagnosis-context").innerText().catch(() => "")).trim(),
    error: (await result.locator(".form-message.error").innerText().catch(() => "")).trim(),
    uses: await win.locator('[data-testid^="designer-locator-diagnosis-use-"]').count()
  };
}

let app: ElectronApplication | undefined;
const site = await startFeatureTestLab(root, PORT);
try {
  app = await electron.launch({ args: [root, ...probe.electronArgs], cwd: root, env: probe.env });
  const win: Page = await resolveMainWindow(app);
  const console_ = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  await signInFirstRun(win);

  console.log("\n1 — Settings → DOM Intelligence");
  const card = win.getByTestId("dom-intelligence-status");
  for (let attempt = 0; attempt < 3 && !(await card.isVisible().catch(() => false)); attempt += 1) {
    await navClick(win, "Settings");
    await card.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  }
  check("the DOM Intelligence card renders", await card.isVisible());
  await win.waitForFunction(() => document.querySelector('[data-testid="dom-intelligence-state"]')?.textContent !== "Checking…", undefined, { timeout: 20_000 }).catch(() => undefined);
  const cardText = await card.innerText();
  const state = (await win.getByTestId("dom-intelligence-state").innerText()).trim();
  check("the status is one of Available / Disabled / Unavailable", ["Available", "Disabled", "Unavailable"].includes(state), state);
  if (devRuntimeStaged) {
    check("with the dev runtime staged, the status is Available", state === "Available", cardText);
    check(`the version is the pinned Scrapling ${pinnedScrapling}`, (await win.getByTestId("dom-intelligence-version").innerText()).trim() === pinnedScrapling);
  } else {
    console.log("  (info) no staged dev runtime under build/native-hosts: Available and version checks NOT RUN");
  }
  check("the provider is Scrapling", /Provider\s*Scrapling/.test(cardText), cardText);
  check("the mode is parser only", /Mode\s*Parser only/.test(cardText));
  check("browser access is disabled", /Browser access\s*Disabled/.test(cardText));
  check("network access is disabled", /Network access\s*Disabled/.test(cardText));
  check("the recovery engine in effect is shown", /Locator recovery\s*Single snapshot/.test(cardText));

  console.log("\n2 — Designer diagnosis on the Element Spy's live page");
  await navClick(win, "Recorder");
  await win.waitForSelector(".recorder-page", { timeout: 20_000 });
  const url = win.getByLabel("Target URL");
  await url.fill(`http://127.0.0.1:${PORT}${SPY_LAB}`);
  await url.blur();
  const opened = await openSpy(win);
  check("the Element Spy opens on the Feature Test Lab", Boolean(opened), {
    message: await win.getByTestId("element-spy-message").innerText().catch(() => ""),
    status: await win.getByTestId("element-spy-status").innerText().catch(() => ""),
    startEnabled: await win.getByTestId("element-spy-start").isEnabled().catch(() => null)
  });

  await openFlow(win);
  const found = await diagnoseNode(win, "found");
  check("an existing saved locator reads as found (exactly one element)", found.recorded === "resolved", found);
  check("the page/frame context is shown", /Page\s*“main”\s*·\s*top document/.test(found.context), found.context);
  check("with no recorded identity there is no proof", found.identity === "none", found);
  check("with no recorded reference DOM intelligence is skipped", found.provider === "skipped", found);
  check("nothing is offered to apply without a proof", found.uses === 0, found);

  const missing = await diagnoseNode(win, "missing");
  check("a saved locator that finds nothing reads as missing", missing.recorded === "missing", missing);
  check("nothing is offered to apply for the missing step", missing.uses === 0, missing);

  console.log("\n3 — the diagnosis writes nothing");
  check("the saved flow file is byte-identical after both diagnoses", flowHash() === seededHash);

  console.log("\n4 — no live page, no diagnosis");
  await navClick(win, "Recorder");
  if (opened) await win.getByTestId("element-spy-stop").click();
  await win.getByTestId("element-spy-start").waitFor({ state: "visible", timeout: 15_000 });
  await openFlow(win);
  const closed = await diagnoseNode(win, "found");
  check("with the Spy closed the Designer asks for a live page", /Open the Element Spy/.test(closed.error), closed);
  check("and shows no result", closed.recorded === null, closed);
  check("the saved flow file is still byte-identical", flowHash() === seededHash);

  const errors = (console_.errors as { text: string }[]).filter((entry) => !/Autofill|DevTools/i.test(entry.text));
  check("no renderer errors", errors.length === 0, console_.summary());
} finally {
  await app?.close().catch(() => undefined);
  site.kill();
  probe.cleanup();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
