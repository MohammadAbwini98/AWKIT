import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  console.log("Runner Lab - downloads:");
  await page.goto(`${BASE}/runner-lab`);
  // Exercised the way a downloadFile step does: arm the listener, then click.
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-csv").click();
  const download = await downloadPromise;
  check("clicking the CSV link raises a download event", Boolean(download));
  check("download carries the Content-Disposition filename", download.suggestedFilename() === "awkit-report.csv", download.suggestedFilename());
  const downloadStream = await download.createReadStream();
  let downloadedText = "";
  for await (const chunk of downloadStream) downloadedText += chunk;
  check("downloaded CSV has the fixture rows", downloadedText.includes("lab-alpha,passed") && downloadedText.split("\n").length >= 4);

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-json").click();
  const jsonDownload = await jsonDownloadPromise;
  check("JSON download uses its own filename", jsonDownload.suggestedFilename() === "awkit-payload.json", jsonDownload.suggestedFilename());

  console.log("Runner Lab - controlled HTTP failures:");
  for (const [testId, expected] of [["fail-500", "500"], ["fail-503", "503"], ["fail-429", "429"], ["fail-404", "404"]]) {
    await page.getByTestId(testId).click();
    await page.waitForFunction(
      (code) => document.querySelector('[data-testid="failure-status"]').textContent === code,
      expected,
      { timeout: 5000 }
    );
    check(`${testId} reports status ${expected}`, (await page.getByTestId("failure-status").textContent()) === expected);
  }
  check("a 404 carries no Retry-After", (await page.getByTestId("failure-retry-after").textContent()) === "none");
  await page.getByTestId("fail-503").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="failure-retry-after"]').textContent !== "none", null, { timeout: 5000 });
  check("Retry-After header is readable after a 503", (await page.getByTestId("failure-retry-after").textContent()) === "2");

  console.log("Runner Lab - bounded retry:");
  await page.getByTestId("flaky-reset").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="flaky-attempts"]').textContent === "0", null, { timeout: 5000 });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByTestId("flaky-call").click();
    await page.waitForFunction(
      (n) => document.querySelector('[data-testid="flaky-attempts"]').textContent === String(n),
      attempt,
      { timeout: 5000 }
    );
  }
  await page.waitForFunction(() => !document.querySelector('[data-testid="flaky-success"]').hidden, null, { timeout: 5000 });
  check("flaky endpoint fails twice then succeeds on the third call", await page.getByTestId("flaky-success").isVisible());
  check("flaky outcome names the succeeding attempt", ((await page.getByTestId("flaky-outcome").textContent()) ?? "").startsWith("200"));

  console.log("Runner Lab - multipart upload:");
  const uploadPath = join(tmpdir(), "awkit-mock-upload.txt");
  await writeFile(uploadPath, "lab upload fixture\nsecond line\n", "utf8");
  await page.getByTestId("upload-input").setInputFiles(uploadPath);
  await page.locator("#uploadNote").fill("lab-note");
  await page.getByTestId("upload-submit").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="upload-status"]').textContent === "upload complete", null, { timeout: 5000 });
  check("upload reports completion", (await page.getByTestId("upload-status").textContent()) === "upload complete");
  check("server echoes the uploaded filename", (await page.getByTestId("upload-filename").textContent()) === "awkit-mock-upload.txt");
  check("server echoes a non-zero byte size", /^[1-9]\d* bytes$/.test((await page.getByTestId("upload-size").textContent()) ?? ""));
  check("upload result banner becomes visible", await page.getByTestId("upload-result").isVisible());
  await rm(uploadPath, { force: true });

  console.log("Iframe Lab - frame-scoped locators:");
  await page.goto(`${BASE}/iframe-lab`);
  const frame = page.frameLocator("[data-testid='lab-frame']");
  check("child frame document loads", await frame.getByTestId("child-heading").isVisible());
  // The trap: the same test ids exist in the top document, so an unscoped locator finds two.
  check("top document carries decoy controls with matching labels", (await page.getByLabel("Message").count()) >= 1);
  await frame.getByTestId("child-input").fill("lab-alpha-from-frame");
  await frame.getByTestId("child-select").selectOption("JO");
  await frame.getByTestId("child-checkbox").check();
  await frame.getByTestId("child-submit").click();
  check("frame-scoped interaction updates the child", (await frame.getByTestId("child-status").textContent()) === "applied: JO (agreed)");
  check("child echoes the frame-scoped input", (await frame.getByTestId("child-echo").textContent()) === "lab-alpha-from-frame");
  check("decoy input in the top document is untouched", (await page.getByTestId("outer-input").inputValue()) === "");
  check("top-level decoy status proves the frame was used", (await page.getByTestId("outer-status").textContent()) === "idle - the top button does nothing useful");
  await page.waitForFunction(() => document.querySelector('[data-testid="mirror-message"]').textContent === "lab-alpha-from-frame", null, { timeout: 5000 });
  check("child mirrors its state to the parent document", await page.getByTestId("mirror-applied").isVisible());
  await frame.getByTestId("child-reset").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="mirror-applied"]').hidden, null, { timeout: 5000 });
  check("frame reset clears the parent mirror", !(await page.getByTestId("mirror-applied").isVisible()));

  console.log("Feature Test Lab index registration:");
  await page.goto(`${BASE}/`);
  check("index lists the Runner Lab scenario", await page.getByTestId("scenario-runner-lab").isVisible());
  check("index lists the Iframe Lab scenario", await page.getByTestId("scenario-iframe-lab").isVisible());

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
