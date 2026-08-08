import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { getRecorderInitScriptContent } from "../src/recorder/recorderInitScript";
import { buildSmartWaits, type RecordedSignal } from "../src/recorder/smartWaitObservation";

const PORT = 4417;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/smart-waits`)).ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Smart Wait causality mock server did not start");
}

const server = spawn(process.execPath, ["mock-site/server.mjs"], {
  env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
  stdio: "ignore"
});

try {
  await waitForServer();
  const signals: RecordedSignal[] = [];
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.exposeBinding("__awtkit_recordSignal", (_source, signal: RecordedSignal) => {
    signals.push(signal);
  });
  await context.exposeBinding("__awtkit_recordAction", () => undefined);
  await context.addInitScript({ content: getRecorderInitScriptContent() });
  const page = await context.newPage();

  console.log("Smart Wait causality red gate:");
  await page.goto(`${BASE}/smart-waits`);
  await page.waitForTimeout(250);
  signals.length = 0;
  const actionAt = Date.now();
  await page.getByTestId("spa-route-button").click();
  await page.waitForURL("**/smart-waits/shorts/local-video");
  await page.waitForTimeout(750);
  const waits = buildSmartWaits(signals, actionAt, Date.now(), { allowFixedDelayFallback: false });
  const route = waits.find((wait) => wait.type === "urlChanged");
  const enabled = waits.find((wait) => wait.type === "elementEnabled");
  const routeEvidence = (route as typeof route & { evidence?: { requirement?: string; confidence?: { level?: string } } })?.evidence;
  const enabledEvidence = (enabled as typeof enabled & { evidence?: { requirement?: string } })?.evidence;
  check("real Recorder observer captures the SPA route", route !== undefined, JSON.stringify(waits));
  check("real Recorder observer also sees the nearby background enable", enabled !== undefined, JSON.stringify(waits));
  check(
    "route is required high-confidence completion evidence",
    routeEvidence?.requirement === "required" && routeEvidence.confidence?.level === "high",
    JSON.stringify(route)
  );
  check(
    "background enable is advisory and cannot gate replay",
    enabledEvidence?.requirement === "advisory" && enabled?.optional === true,
    JSON.stringify(enabled)
  );

  await browser.close();
} finally {
  server.kill();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
