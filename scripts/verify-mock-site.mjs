import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 4401;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  OK ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      /* server not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Mock site did not start");
}

const server = spawn(process.execPath, ["mock-site/server.mjs"], {
  env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
  stdio: "ignore"
});

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage();

  console.log("Feature Test Lab index:");
  await page.goto(`${BASE}/`);
  await page.getByRole("heading", { name: "Feature Test Lab" }).waitFor();
  check("home lists Smart Wait lab", await page.getByTestId("scenario-smart-waits").isVisible());
  check("home lists Recorder lab", await page.getByTestId("scenario-recorder").isVisible());
  check("home lists Designer lab", await page.getByTestId("scenario-designer").isVisible());
  check("home lists Async Results lab", await page.getByTestId("scenario-async-results").isVisible());

  console.log("Smart Wait scenarios:");
  await page.goto(`${BASE}/smart-waits`);
  await page.getByTestId("delay-ms").fill("120");
  check("smart wait page has title", await page.getByRole("heading", { name: "Smart Wait and Runner Lab" }).isVisible());
  check("all smart wait scenario cards exist", (await page.locator("[data-testid^='wait-']").count()) >= 12);

  await page.getByRole("button", { name: "Show delayed element" }).click();
  await page.getByTestId("appeared-element").waitFor({ state: "visible", timeout: 1500 });
  check("element appears after delay", await page.getByTestId("appeared-element").isVisible());

  await page.getByRole("button", { name: "Hide delayed element" }).click();
  await page.getByTestId("disappearing-element").waitFor({ state: "hidden", timeout: 1500 });
  check("element disappears after delay", !(await page.getByTestId("disappearing-element").isVisible().catch(() => false)));

  await page.getByRole("button", { name: "Change text" }).click();
  await page.getByText("Complete text").waitFor({ timeout: 1500 });
  check("text changes after delay", await page.getByTestId("changing-text").textContent() === "Complete text");

  await page.getByRole("button", { name: "Enable action" }).click();
  await page.waitForFunction(() => !document.querySelector("[data-testid='delayed-enabled-button']").disabled, null, { timeout: 1500 });
  check("button becomes enabled", !(await page.getByTestId("delayed-enabled-button").isDisabled()));

  await page.getByRole("button", { name: "Run loader" }).click();
  await page.getByTestId("loaded-content").waitFor({ state: "visible", timeout: 1500 });
  check("loader then content works", await page.getByTestId("loaded-content").isVisible());

  await page.getByRole("button", { name: "Show toast" }).click();
  await page.getByTestId("delayed-toast").waitFor({ state: "visible", timeout: 1500 });
  check("delayed toast appears", await page.getByTestId("delayed-toast").isVisible());

  await page.getByRole("button", { name: "Fetch delayed response" }).click();
  await page.getByText(/Delayed mock response complete/).waitFor({ timeout: 2000 });
  check("network/API delay completes", /Delayed mock response complete/.test((await page.getByTestId("network-result").textContent()) ?? ""));

  await page.getByRole("button", { name: "Run sequence" }).click();
  await page.getByTestId("sequential-done").waitFor({ state: "visible", timeout: 2500 });
  check("multiple sequential waits complete", await page.getByTestId("sequential-done").isVisible());

  await page.getByRole("button", { name: "Run failing scenario" }).click();
  await page.getByTestId("failure-context").waitFor({ state: "visible", timeout: 1500 });
  check("failing wait scenario exposes context", await page.getByTestId("failure-context").isVisible());

  await page.getByRole("button", { name: "Run fast scenario" }).click();
  check("fast scenario has no wait dependency", await page.getByTestId("fast-result").isVisible());

  await page.getByRole("button", { name: "Navigate after delay" }).click();
  await page.waitForURL("**/smart-waits?state=delayed-navigation-complete", { timeout: 2000 });
  check("delayed navigation changes URL", page.url().includes("state=delayed-navigation-complete"));

  console.log("Recorder scenarios:");
  await page.goto(`${BASE}/recorder-lab`);
  check("recorder page has accessible title", await page.getByRole("heading", { name: "Recorder Lab" }).isVisible());
  check("recorder full name field exists", await page.getByLabel("Full name").isVisible());
  check("recorder email placeholder exists", await page.getByPlaceholder("ada@example.test").isVisible());
  check("recorder select exists", await page.getByTestId("recorder-plan").isVisible());
  check("saved URL reuse links exist", (await page.locator("[data-testid^='saved-url-']").count()) >= 4);
  await page.getByRole("button", { name: "Start manual pause" }).click();
  await page.getByText("Pause countdown: 3").waitFor({ timeout: 500 });
  check("manual waiting-time countdown starts", await page.getByTestId("manual-pause-countdown").isVisible());
  await page.getByRole("button", { name: "Render dynamic row" }).click();
  check("dynamic DOM keeps stable test id", await page.getByTestId("dynamic-customer-card").isVisible());

  // Non-unique controls: same role+name/text repeated, distinguishable only by a stable container.
  check("duplicate package cards exist", (await page.locator("[data-testid^='package-']").count()) === 2);
  check("both checkboxes share the same accessible name (non-unique by role)", (await page.getByRole("checkbox", { name: "0796713928" }).count()) === 2);
  check("both cards repeat the same Select button text (non-unique by text)", (await page.getByRole("button", { name: "Select package" }).count()) === 2);
  await page.getByTestId("package-pro").getByRole("button", { name: "Select package" }).click();
  check("container-scoped Select targets the Pro card", ((await page.getByTestId("duplicate-result").textContent()) ?? "").includes("package-pro"));
  await page.getByTestId("package-basic").getByRole("checkbox", { name: "0796713928" }).check();
  check("container-scoped checkbox targets the Basic card", ((await page.getByTestId("duplicate-result").textContent()) ?? "").includes("package-basic"));
  check("customer table repeats Edit per row", (await page.locator("[data-testid='duplicate-customer-table'] .row-edit").count()) === 2);

  console.log("Designer scenarios:");
  await page.goto(`${BASE}/designer-lab`);
  check("designer page has canvas region", await page.getByRole("region", { name: "Mock designer canvas" }).isVisible());
  check("mock nodes are clickable", (await page.locator(".mock-node").count()) === 3);
  check("contextual picker and drawer contract is documented", (await page.locator("[data-testid='contextual-picker-contract'] button").count()) === 3);
  check("workflow cards grid has six cards", (await page.locator("article[data-testid^='workflow-card-']").count()) === 6);
  check("instance monitor workflow run summary exists", await page.getByTestId("mock-workflow-run-record").isVisible());
  await page.getByTestId("mock-workflow-run-record").click();
  check("workflow record opens the all-instances modal", await page.getByTestId("mock-workflow-instances-modal").isVisible());
  check("workflow modal lists every instance in the run", (await page.getByTestId("mock-workflow-instance-row").count()) === 3);
  await page.getByTestId("close-workflow-instances-modal").click();
  check("workflow instances modal closes", !(await page.getByTestId("mock-workflow-instances-modal").isVisible()));
  check("stable saved flow names exist", await page.getByTestId("saved-flow-smart-waits").isVisible());
  check("smart wait JSON example exists", /beforeWaits/.test((await page.getByTestId("smart-wait-json-example").textContent()) ?? ""));

  console.log("Async results / empty state scenarios:");
  await page.goto(`${BASE}/async-results`);
  await page.getByRole("heading", { name: "Async Results and Empty State Lab" }).waitFor();
  // Speed the fixtures up so the verifier stays fast but still exercises the loader.
  await page.getByTestId("results-delay-ms").fill("100");

  // Populated branch: loader appears, then rows render and the empty state stays hidden.
  await page.getByTestId("load-populated").click();
  await page.getByTestId("results-table").waitFor({ state: "visible" });
  check("populated result renders three rows", (await page.locator("[data-testid='results-table'] tbody tr").count()) === 3);
  check("populated result hides the empty state", await page.getByTestId("empty-state").isHidden());
  check("populated result hides the loader when settled", await page.getByTestId("results-loading").isHidden());

  // Valid-empty branch: HTTP 200 with zero rows -> table hidden, empty state visible.
  await page.getByTestId("load-empty").click();
  await page.getByTestId("empty-state").waitFor({ state: "visible" });
  check("empty result hides the results table", await page.getByTestId("results-table").isHidden());
  check("empty result renders zero rows (tableHasRows must fail here)", (await page.locator("[data-testid='results-table'] tbody tr").count()) === 0);
  check("empty result reports a valid empty state", /valid empty state/i.test((await page.getByTestId("results-status").textContent()) ?? ""));

  // Error branch: the endpoint answers with a real status, so this is never a timeout.
  await page.getByTestId("load-error").click();
  await page.getByTestId("error-banner").waitFor({ state: "visible" });
  check("error branch surfaces the HTTP status", /HTTP 500/.test((await page.getByTestId("error-banner").textContent()) ?? ""));
  check("error branch shows neither rows nor empty state", (await page.locator("[data-testid='results-table'] tbody tr").count()) === 0 && (await page.getByTestId("empty-state").isHidden()));

  await page.getByTestId("reset-async-results").click();
  check("reset clears every outcome surface", await page.getByTestId("error-banner").isHidden() && await page.getByTestId("empty-state").isHidden() && await page.getByTestId("results-table").isHidden());

  console.log("Async status/result endpoints:");
  const err500 = await page.request.get(`${BASE}/api/status?code=500`);
  check("/api/status returns the requested error status", err500.status() === 500, `status=${err500.status()}`);
  const ok202 = await page.request.get(`${BASE}/api/status?code=202`);
  check("/api/status supports 202 Accepted", ok202.status() === 202, `status=${ok202.status()}`);
  const bogus = await page.request.get(`${BASE}/api/status?code=799`);
  check("/api/status falls back to 500 for a non-allow-listed code", bogus.status() === 500, `status=${bogus.status()}`);
  const redirect = await page.request.get(`${BASE}/api/status?code=302`, { maxRedirects: 0 });
  check("/api/status refuses 3xx (no open redirect)", redirect.status() === 500, `status=${redirect.status()}`);
  const emptyJson = await (await page.request.get(`${BASE}/api/results?mode=empty&ms=0`)).json();
  check("/api/results empty mode is a 200 with zero rows", emptyJson.ok === true && emptyJson.count === 0 && emptyJson.rows.length === 0);
  const fullJson = await (await page.request.get(`${BASE}/api/results?mode=populated&ms=0`)).json();
  check("/api/results populated mode returns three stable rows", fullJson.count === 3 && fullJson.rows[0].id === "INV-1001");

  await page.close();
} catch (error) {
  failed += 1;
  console.error(error);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  server.kill();
}

console.log(`\n${passed}/${passed + failed} mock-site checks passed`);
process.exit(failed === 0 ? 0 : 1);
