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
  check("home lists Blueprint Recovery lab", await page.getByTestId("scenario-blueprint-recovery").isVisible());
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
  check("custom-owner fixture has the named subscriptions link", await page.getByRole("link", { name: "Subscriptions", exact: true }).isVisible());
  check("custom-owner fixture intentionally repeats its internal icon id", (await page.locator("#icon").count()) === 4);
  check("custom-owner fixture includes an explicit custom button", await page.getByRole("button", { name: "Run custom action", exact: true }).isVisible());
  check("custom-owner fixture keeps duplicate named semantic buttons ambiguous", (await page.getByRole("button", { name: "Duplicate owner", exact: true }).count()) === 2);
  await page.getByRole("button", { name: "Start manual pause" }).click();
  await page.getByText("Pause countdown: 3").waitFor({ timeout: 500 });
  check("manual waiting-time countdown starts", await page.getByTestId("manual-pause-countdown").isVisible());
  await page.getByRole("button", { name: "Render dynamic row" }).click();
  check("dynamic DOM keeps stable test id", await page.getByTestId("dynamic-customer-card").isVisible());

  console.log("Blueprint Recovery scenario:");
  await page.goto(`${BASE}/blueprint-recovery-lab`);
  const blueprintLabel =
    "Blueprint recovery threshold target with intentionally repeated accessible identity for deterministic browser coverage alpha bravo charlie";
  check("blueprint page has an accessible title", await page.getByRole("heading", { name: "Blueprint Recovery Lab" }).isVisible());
  check("blueprint target starts beyond 200 filler elements", (await page.locator(".blueprint-scan-filler").count()) === 205);
  check("blueprint target identity is deliberately repeated", (await page.getByRole("button", { name: blueprintLabel, exact: true }).count()) === 2);
  await page.locator('[data-test="blueprint-primary"]').click();
  check("blueprint original target reports its click", (await page.getByTestId("blueprint-result").textContent()) === "clicked-original-target");
  await page.getByTestId("blueprint-mutate").click();
  check("blueprint mutation inserts a node before the target", (await page.getByTestId("blueprint-inserted-node").count()) === 1);
  check("blueprint mutation retires the recorded selector", (await page.locator('[data-test="blueprint-primary"]').count()) === 0);
  await page.locator(".blueprint-mutated-target").click();
  check("blueprint mutated target remains actionable", (await page.getByTestId("blueprint-result").textContent()) === "clicked-mutated-target");
  await page.getByTestId("blueprint-reset").click();
  check("blueprint reset restores the original selector and state", (await page.locator('[data-test="blueprint-primary"]').count()) === 1 && (await page.getByTestId("blueprint-result").textContent()) === "idle");

  await page.goto(`${BASE}/recorder-lab`);

  // Non-unique controls: same role+name/text repeated, distinguishable only by a stable container.
  check("duplicate package cards exist", (await page.locator("[data-testid^='package-']").count()) === 2);
  check("both checkboxes share the same accessible name (non-unique by role)", (await page.getByRole("checkbox", { name: "0796713928" }).count()) === 2);
  check("both cards repeat the same Select button text (non-unique by text)", (await page.getByRole("button", { name: "Select package" }).count()) === 2);
  await page.getByTestId("package-pro").getByRole("button", { name: "Select package" }).click();
  check("container-scoped Select targets the Pro card", ((await page.getByTestId("duplicate-result").textContent()) ?? "").includes("package-pro"));
  await page.getByTestId("package-basic").getByRole("checkbox", { name: "0796713928" }).check();
  check("container-scoped checkbox targets the Basic card", ((await page.getByTestId("duplicate-result").textContent()) ?? "").includes("package-basic"));
  check("customer table repeats Edit per row", (await page.locator("[data-testid='duplicate-customer-table'] .row-edit").count()) === 2);

  // Nested container scoping: the fixture is only meaningful while NEITHER ancestor disambiguates
  // alone, so assert the ambiguity as well as the resolution — otherwise a fixture edit could make
  // the scenario trivially single-container and the locator suite would still look green.
  check("nested scope repeats Approve four times", (await page.getByRole("button", { name: "Approve", exact: true }).count()) === 4);
  check("region alone leaves the Approve buttons ambiguous", (await page.getByTestId("nested-region-south").getByRole("button", { name: "Approve", exact: true }).count()) === 2);
  check("order card alone leaves the Approve buttons ambiguous", (await page.locator("[data-testid='nested-order-card']").filter({ hasText: "Priority order" }).getByRole("button", { name: "Approve", exact: true }).count()) === 2);
  await page.getByTestId("nested-region-south").locator("[data-testid='nested-order-card']").filter({ hasText: "Priority order" }).getByRole("button", { name: "Approve", exact: true }).click();
  check("region + card chain isolates exactly one Approve", (await page.getByTestId("nested-container-result").textContent()) === "south-priority");

  // Increment 6 Shadow DOM lab: Playwright's normal locators pierce open roots, while fixture
  // status nodes prove the intended host/control handled the action.
  check("open-shadow unique role control exists", (await page.getByRole("button", { name: "Unique shadow action" }).count()) === 1);
  check("duplicate open-shadow controls are globally ambiguous", (await page.getByRole("button", { name: "Select", exact: true }).count()) === 2);
  await page.getByTestId("shadow-card-b").getByRole("button", { name: "Select" }).click();
  check("host-scoped shadow action targets the second host", (await page.getByTestId("shadow-card-b-result").textContent()) === "clicked");
  check("host-scoped shadow action leaves the first host unchanged", (await page.getByTestId("shadow-card-a-result").textContent()) === "idle");
  await page.getByRole("button", { name: "Nested shadow action" }).click();
  check("nested open-shadow control is actionable", (await page.getByTestId("shadow-nested-result").textContent()) === "nested-clicked");
  await page.getByTestId("shadow-internal-testid").click();
  check("open-shadow test-id control is actionable", (await page.getByTestId("shadow-testid-result").textContent()) === "testid-clicked");
  await page.getByTestId("attach-dynamic-shadow").click();
  await page.getByRole("button", { name: "Dynamic shadow action" }).click();
  check("dynamically attached open root is actionable", (await page.getByTestId("shadow-dynamic-result").textContent()) === "clicked");
  await page.getByTestId("shadow-slotted-control").click();
  check("slotted light-DOM control is actionable", (await page.getByTestId("shadow-slotted-result").textContent()) === "slotted-clicked");
  check("known closed-root host exists without exposing internals", (await page.getByTestId("shadow-closed-host").count()) === 1 && (await page.getByRole("button", { name: "Closed internal action" }).count()) === 0);
  const sameOriginFrame = page.frameLocator('[data-testid="shadow-same-origin-frame"]');
  await sameOriginFrame.getByRole("button", { name: "Frame shadow action" }).click();
  check("same-origin frame open-shadow control is actionable", (await sameOriginFrame.getByTestId("frame-shadow-result").textContent()) === "frame-shadow-clicked");
  check("cross-origin shadow frame fixture loads from 127.0.0.1", /127\.0\.0\.1/.test(await page.getByTestId("shadow-cross-origin-frame").getAttribute("src")));

  // REC-018 capture harness. Both gates must hold, and the SECOND one is what keeps the REC-018
  // replay assertion honest: with ?rec018=1 but no Recorder attached the harness must stay inert,
  // so a production replay of the saved flow can only fill the form via the replayed steps.
  check(
    "REC-018 harness is idle without the query gate",
    ((await page.getByTestId("rec018-status").textContent()) ?? "").includes("idle")
  );
  await page.request.post(`${BASE}/api/rec018/reset`);
  await page.goto(`${BASE}/recorder-lab?rec018=1`);
  await page.waitForTimeout(1400);
  check(
    "REC-018 harness stays INERT when no recorder binding is present",
    ((await page.getByTestId("rec018-status").textContent()) ?? "").includes("inert")
  );
  check(
    "REC-018 harness does not touch the form without a recorder",
    (await page.inputValue("#recorderFullName")) === "" &&
      ((await page.getByTestId("recorder-form-result").textContent()) ?? "").includes("idle")
  );
  const inertState = await (await page.request.get(`${BASE}/api/rec018/state`)).json();
  check("REC-018 inert branch records no server-side outcome", inertState.count === 0);

  await page.goto(`${BASE}/recorder-lab?rec018=1&fidelityDrift=primary-loss`);
  check(
    "fidelity primary-loss profile removes recorded test ids but keeps accessible controls",
    (await page.locator("[data-testid='recorder-full-name'], [data-testid='recorder-email'], [data-testid='recorder-plan'], [data-testid='recorder-newsletter'], [data-testid='recorder-submit']").count()) === 0 &&
      (await page.getByLabel("Full name").count()) === 1 &&
      (await page.getByRole("button", { name: "Save recorder form" }).count()) === 1
  );

  await page.goto(`${BASE}/recorder-lab?rec018=1&fidelityDrift=structural`);
  check(
    "fidelity structural profile churns fallback attributes and wrappers without changing intent",
    (await page.locator("[data-fidelity-wrapper]").count()) === 5 &&
      (await page.getByPlaceholder("Ada Lovelace").count()) === 0 &&
      (await page.locator('select[name="plan"]').count()) === 0 &&
      (await page.getByRole("textbox", { name: "Email address" }).count()) === 1
  );

  // Positive control: with the binding the Recorder exposes, the harness must drive the form.
  await page.addInitScript(() => {
    window.__awtkit_recordAction = () => {};
  });
  await page.goto(`${BASE}/recorder-lab?rec018=1`);
  await page.waitForTimeout(2000);
  check(
    "REC-018 harness drives the form once a recorder binding exists",
    (await page.inputValue("#recorderFullName")) === "Rec018 Operator" &&
      (await page.inputValue("#recorderPlan")) === "Enterprise" &&
      (await page.isChecked("#recorderNewsletter")) &&
      ((await page.getByTestId("recorder-form-result").textContent()) ?? "").includes("Recorder form saved for Rec018 Operator")
  );
  const capturedState = await (await page.request.get(`${BASE}/api/rec018/state`)).json();
  check(
    "REC-018 capture outcome is observable and resettable for the replay gate",
    capturedState.count === 1 &&
      capturedState.latest?.fullName === "Rec018 Operator" &&
      capturedState.latest?.email === "rec018@example.test" &&
      capturedState.latest?.plan === "Enterprise" &&
      capturedState.latest?.newsletter === true,
    JSON.stringify(capturedState)
  );

  console.log("Session reuse scenario:");
  await page.goto(`${BASE}/mock/session-reuse`);
  check(
    "session reuse starts logged out without persisted origin state",
    (await page.getByTestId("auth-status").getAttribute("data-authenticated")) === "false"
  );
  await page.getByTestId("simulate-login").click();
  await page.reload();
  check(
    "session reuse restores authenticated state from persisted origin storage",
    (await page.getByTestId("auth-status").getAttribute("data-authenticated")) === "true"
  );
  check("persisted session reveals the authenticated dashboard after reload", await page.getByTestId("dashboard").isVisible());
  await page.getByTestId("simulate-logout").click();
  await page.reload();
  check(
    "manual logout clears the persisted origin state",
    (await page.getByTestId("auth-status").getAttribute("data-authenticated")) === "false"
  );

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

  // SSE lifecycle: the stream event is supporting evidence; the visible UI status is the outcome.
  await page.getByTestId("start-sse").click();
  await page.getByText("Stream update complete").waitFor({ timeout: 2000 });
  check("SSE fixture produces the required visible UI outcome", (await page.getByTestId("stream-status").textContent()) === "Stream update complete");
  check("SSE fixture logs its lifecycle without exposing transport payload details", /SSE UI outcome shown/.test((await page.getByTestId("async-results-log").textContent()) ?? ""));

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
  const sseText = await (await page.request.get(`${BASE}/api/events?ms=0`)).text();
  check("/api/events emits a deterministic finite SSE status event", /event: status/.test(sseText) && /\"state\":\"complete\"/.test(sseText));

  // 202 → poll-to-terminal job (awkit-4km C1): first two polls are 202 "processing", third is a
  // terminal 200 "succeeded", then the counter resets so the scenario is repeatable.
  const jobId = `verify-${Date.now()}`;
  const poll1 = await page.request.get(`${BASE}/api/job?id=${jobId}&after=2`);
  const poll2 = await page.request.get(`${BASE}/api/job?id=${jobId}&after=2`);
  const poll3 = await page.request.get(`${BASE}/api/job?id=${jobId}&after=2`);
  check("/api/job returns 202 while processing", poll1.status() === 202 && poll2.status() === 202, `p1=${poll1.status()} p2=${poll2.status()}`);
  const terminal = await poll3.json();
  check("/api/job reaches terminal 200 succeeded", poll3.status() === 200 && terminal.status === "succeeded", `p3=${poll3.status()} status=${terminal.status}`);
  const pollReset = await page.request.get(`${BASE}/api/job?id=${jobId}&after=2`);
  check("/api/job counter resets after terminal (repeatable)", pollReset.status() === 202, `reset=${pollReset.status()}`);
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

  console.log("Drag & Drop Lab - native HTML5 drag fixture:");
  await page.goto(`${BASE}/drag-lab`);
  check("drag lab has an accessible title", await page.getByRole("heading", { name: "Drag & Drop Lab" }).isVisible());
  check("three draggable cards start in the To Do column", (await page.getByTestId("drag-col-todo").locator(".drag-card").count()) === 3);
  check("cards are marked draggable", (await page.locator(".drag-card[draggable='true']").count()) === 3);
  check("the Doing column starts empty", (await page.getByTestId("drag-col-doing").locator(".drag-card").count()) === 0);
  // Drive a real native drag: move the Build card into the Doing column.
  await page.dragAndDrop("[data-testid='drag-card-build']", "[data-testid='drag-col-doing']");
  check("dragging a card into another column moves it", (await page.getByTestId("drag-col-doing").locator("[data-testid='drag-card-build']").count()) === 1);
  check("the drop is reported deterministically", (await page.getByTestId("drag-result").textContent()) === "build → doing");
  check("the source column no longer holds the moved card", (await page.getByTestId("drag-col-todo").locator("[data-testid='drag-card-build']").count()) === 0);
  // Reset restores the initial layout; the delegated listeners survive the innerHTML swap.
  await page.getByTestId("drag-reset").click();
  check("reset returns every card to To Do", (await page.getByTestId("drag-col-todo").locator(".drag-card").count()) === 3);
  check("reset clears the move result", (await page.getByTestId("drag-result").textContent()) === "idle");
  await page.dragAndDrop("[data-testid='drag-card-ship']", "[data-testid='drag-col-done']");
  check("drag still works after reset (delegated listeners survive)", (await page.getByTestId("drag-result").textContent()) === "ship → done");

  console.log("Drag & Drop Lab - pointer-driven sortable (no native draggable):");
  // The list sits below the fold; scroll it into view so mouse coordinates (viewport-relative) line up
  // with the items (and elementFromPoint resolves the real drop target).
  await page.getByTestId("pointer-list").scrollIntoViewIfNeeded();
  // Drive a real pointer gesture (pointerdown → pointermove → pointerup) with raw mouse events — the
  // mouse path fires pointer events, which is exactly what the pointer recognizer + this fixture use.
  const pointerReorder = async (fromSel, toSel) => {
    const a = await page.locator(fromSel).boundingBox();
    const b = await page.locator(toSel).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 4, a.y + a.height / 2 + 4, { steps: 2 }); // cross the 8px threshold
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
    await page.mouse.up();
  };
  check("pointer sortable starts in order a,b,c", (await page.getByTestId("pointer-order").textContent()) === "a,b,c");
  check("three pointer items, none natively draggable", (await page.locator(".pointer-item").count()) === 3 && (await page.locator(".pointer-item[draggable='true']").count()) === 0);
  await pointerReorder("[data-testid='pointer-item-c']", "[data-testid='pointer-item-a']");
  check("a pointer drag reorders the correct item (c before a)", (await page.getByTestId("pointer-order").textContent()) === "c,a,b");
  check("the pointer move is reported", (await page.getByTestId("pointer-result").textContent()) === "c before a");
  // A tiny movement must NOT reorder (fixture threshold), mirroring the recognizer's guard.
  const jitterBox = await page.locator("[data-testid='pointer-item-b']").boundingBox();
  await page.mouse.move(jitterBox.x + 10, jitterBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(jitterBox.x + 12, jitterBox.y + 11, { steps: 1 });
  await page.mouse.up();
  check("a tiny pointer movement does not reorder (stays a click)", (await page.getByTestId("pointer-order").textContent()) === "c,a,b");
  // Reset, then a SECOND successful pointer drag.
  await page.getByTestId("pointer-reset").click();
  check("pointer reset restores a,b,c", (await page.getByTestId("pointer-order").textContent()) === "a,b,c");
  await pointerReorder("[data-testid='pointer-item-a']", "[data-testid='pointer-item-c']");
  check("a second pointer drag after reset works (a before c)", (await page.getByTestId("pointer-order").textContent()) === "b,a,c");

  console.log("Feature Test Lab index registration:");
  await page.goto(`${BASE}/`);
  check("index lists the Runner Lab scenario", await page.getByTestId("scenario-runner-lab").isVisible());
  check("index lists the Iframe Lab scenario", await page.getByTestId("scenario-iframe-lab").isVisible());
  check("index lists the Drag & Drop Lab scenario", await page.getByTestId("scenario-drag").isVisible());

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
