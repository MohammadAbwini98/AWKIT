// Verifies the Recorder-side protected login / protected popup manual Chrome handoff:
//  1. Pure detection (password / OTP / CAPTCHA / passkey / MFA text / no false positives, no secrets).
//  2. Live detection against the offline Mock Site protected scenarios (main page + popups).
//  3. Flow serialization of the inserted Auto Secure Login / Reuse Session nodes (session id linked),
//     and that legacy recorded flows still build unchanged.
//  4. The full Capture Session & Resume lifecycle: pause → manual-browser handoff (synthetic capture
//     service; real Chrome is never launched) → session validated against a REAL captured persistent
//     profile → Playwright relaunches bound to that profile → Recorder resumes → post-login actions
//     append → draft persists with secure nodes first.
//
// Run: npm run verify:protected-login-recorder
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import {
  detectFromRecorderSignals,
  detectRecorderProtectedLogin
} from "@src/security/ProtectedLoginDetector";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { RecorderService } from "@src/recorder/RecorderService";
import type { RecordedAction } from "@src/recorder/RecorderTypes";
import { PlaywrightRunner } from "@src/runner/PlaywrightRunner";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import type { SessionProfile } from "@src/session/SessionProfile";

const PORT = 4407;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  OK ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

async function waitUntil(predicate: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function linearFlow(id: string, steps: FlowStep[]): FlowProfile {
  const nodes: FlowStep[] = [
    { id: "start", type: "start", name: "Start" },
    ...steps,
    { id: "end", type: "end", name: "End" }
  ];
  return {
    id,
    name: id,
    version: 1,
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      id: `${id}-edge-${index}`,
      source: node.id,
      target: nodes[index + 1].id,
      type: "success"
    }))
  };
}

async function makeExecutionContext(flowId: string): Promise<InstanceExecutionContext> {
  const root = await mkdtemp(join(tmpdir(), "awkit-rec022-run-"));
  return {
    executionId: `rec022-${Date.now()}`,
    instanceId: "rec022-instance",
    scenarioId: "rec022-scenario",
    flowId,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: {
      downloads: join(root, "downloads"),
      screenshots: join(root, "screenshots"),
      logs: join(root, "logs"),
      reports: join(root, "reports"),
      sessions: join(root, "sessions")
    }
  };
}

function scenarioFor(flowId: string): ScenarioProfile {
  return {
    id: `scenario-${flowId}`,
    name: `Scenario ${flowId}`,
    executionMode: "sequential",
    maxParallelFlows: 1,
    flows: [{ order: 1, flowId, required: true }],
    links: [],
    failurePolicy: {
      stopOnRequiredFlowFailure: true,
      continueOnOptionalFlowFailure: true,
      takeScreenshotOnFailure: false
    }
  };
}

const runnerConfig: InstanceConfig = {
  id: "rec022-instance",
  name: "REC-022 session replay",
  browser: "chromium",
  headless: true,
  isolationMode: "browserContext",
  timeoutMs: 30_000,
  viewport: { width: 1280, height: 800 }
};

// ── 1. Pure detection (no browser) ───────────────────────────────────────────
console.log("Pure recorder detection:");
const password = detectFromRecorderSignals("http://localhost/app/login", "Sign in", "Please sign in", { passwordField: true });
check("password login detected (login-form)", password.detected && password.reason === "login-form", `${password.detected}/${password.reason}`);
check("password detection lists the password-field signal", password.signals.includes("password field"));
check("password field is medium confidence → pause", password.confidence === "medium" && password.recommendedAction === "pause", `${password.confidence}/${password.recommendedAction}`);

const otp = detectFromRecorderSignals("http://localhost/verify", "Verify", "Enter your code", { oneTimeCodeField: true });
check("OTP field detected (mfa)", otp.detected && otp.reason === "mfa", `${otp.detected}/${otp.reason}`);
check("OTP field is high confidence → pause", otp.confidence === "high" && otp.recommendedAction === "pause");

const captcha = detectFromRecorderSignals("http://localhost/challenge", "Challenge", "", { captchaIframe: true });
check("CAPTCHA iframe detected (captcha)", captcha.detected && captcha.reason === "captcha", `${captcha.detected}/${captcha.reason}`);
check("CAPTCHA iframe is high confidence → pause", captcha.confidence === "high" && captcha.recommendedAction === "pause");

const passkey = detectFromRecorderSignals("http://localhost/auth", "Use your passkey", "Use your security key or passkey to continue", {});
check("passkey / security-key text detected (passkey)", passkey.detected && passkey.reason === "passkey", `${passkey.detected}/${passkey.reason}`);
check("passkey is high confidence → pause", passkey.confidence === "high" && passkey.recommendedAction === "pause");

const mfaText = detectFromRecorderSignals("http://localhost/2fa", "Two-step verification", "Enter a verification code", {});
check("MFA text detected (mfa)", mfaText.detected && mfaText.reason === "mfa", `${mfaText.detected}/${mfaText.reason}`);

// FALSE-POSITIVE FIX: a page that merely contains "single sign-on" text (no password field, no known
// provider host, no DOM affordance) must NOT pause the recorder.
const ssoText = detectFromRecorderSignals("https://internal.corp.example/portal", "Company Portal", "Access your apps with single sign-on.", {});
check("text-only SSO detected but LOW confidence", ssoText.detected && ssoText.reason === "sso" && ssoText.confidence === "low", `${ssoText.detected}/${ssoText.reason}/${ssoText.confidence}`);
check("text-only SSO recommends CONTINUE (recorder keeps recording)", ssoText.recommendedAction === "continue", ssoText.recommendedAction);
// A password field alongside SSO text is a real login → still pauses.
const ssoWithPassword = detectFromRecorderSignals("https://internal.corp.example/login", "Sign in", "Sign in with single sign-on.", { passwordField: true });
check("SSO text + password field still pauses (login-form)", ssoWithPassword.recommendedAction === "pause" && ssoWithPassword.reason === "login-form", `${ssoWithPassword.recommendedAction}/${ssoWithPassword.reason}`);

const normal = detectFromRecorderSignals("http://localhost/form", "Mock Site — Form", "First name Last name Email Submit", {});
check("normal simple page NOT detected (no false positive)", normal.detected === false, `${normal.detected}/${normal.reason}`);
check("normal page recommends continue", normal.recommendedAction === "continue");

check(
  "detection output stores no secrets (no cookie/token/password fields)",
  !("cookies" in (password as object)) && !("token" in (password as object)) && !("password" in (password as object))
);
check(
  "signals are safe descriptors only (no values)",
  password.signals.every((s) => !/=|:\s*\S+@|\d{4,}/.test(s.replace("password field", "")))
);

// ── 3. Flow serialization of the secure-session nodes ────────────────────────
console.log("Secure-session node serialization:");
const sessionId = "session-abc123";
const secureActions: RecordedAction[] = [
  { id: "a1", type: "autoSecureLogin", name: "Auto Secure Login", valueSource: { type: "static", value: "https://app.example.test" } },
  { id: "a2", type: "reuseSession", name: "Reuse Session", config: { reuseSessionMode: "selected", reuseSessionId: sessionId } },
  { id: "a3", type: "goto", name: "Navigate", valueSource: { type: "static", value: "https://app.example.test/dashboard" } },
  { id: "a4", type: "click", name: "Click Reports", locator: { strategy: "role", value: "link", name: "Reports" } }
];
const secureFlow = buildRecordedFlow("Secure Flow", secureActions);
const autoNode = secureFlow.nodes.find((n) => n.type === "autoSecureLogin");
const reuseNode = secureFlow.nodes.find((n) => n.type === "reuseSession");
check("Auto Secure Login node present", !!autoNode);
check("Auto Secure Login carries target URL in value", autoNode?.value === "https://app.example.test", autoNode?.value);
check("Reuse Session node present", !!reuseNode);
check("Reuse Session linked to captured session id", reuseNode?.config?.reuseSessionId === sessionId, reuseNode?.config?.reuseSessionId);
check("Reuse Session uses selected mode", reuseNode?.config?.reuseSessionMode === "selected");
check(
  "secure nodes sit before recorded business actions",
  secureFlow.nodes.findIndex((n) => n.type === "autoSecureLogin") < secureFlow.nodes.findIndex((n) => n.type === "goto")
);
// Round-trip serialize/deserialize keeps the session id.
const roundTrip = JSON.parse(JSON.stringify(secureFlow));
check("serialize/deserialize keeps session id", roundTrip.nodes.find((n: any) => n.type === "reuseSession")?.config?.reuseSessionId === sessionId);

// Legacy recorded flow still builds unchanged.
const legacy = buildRecordedFlow("Legacy", [
  { id: "l1", type: "goto", name: "Navigate", valueSource: { type: "static", value: "https://example.com" } },
  { id: "l2", type: "click", name: "Click Login", locator: { strategy: "role", value: "button", name: "Login" } }
]);
check("legacy flow still has Start + End", legacy.nodes[0].type === "start" && legacy.nodes[legacy.nodes.length - 1].type === "end");
check("legacy flow wires Start → actions → End", legacy.nodes.length === 4 && legacy.edges.length === 3);

// ── 2. Live detection against the Mock Site ──────────────────────────────────
const server = spawn(process.execPath, ["mock-site/server.mjs"], {
  env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
  stdio: "ignore"
});

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Mock site did not start");
}

let browser: Browser | undefined;
let recorder: RecorderService | undefined;
let capturedProfileDir: string | undefined;
const resumeProfileDirs: string[] = [];
let resumeDraftDir = "";
try {
  await waitForServer();

  console.log("Recorder pause boundary:");
  recorder = new RecorderService();
  await recorder.startRecording(`${BASE}/mock/sso-text-app`, {
    executablePath: chromium.executablePath(),
    captureSmartWaits: false
  });
  const recorderInternals = recorder as unknown as {
    browser: Browser | null;
    page: Page | null;
    recordActionFromPage(sourcePage: Page, action: Omit<RecordedAction, "id">): void;
  };
  const recorderPage = recorderInternals.page;
  if (!recorderPage) throw new Error("Recorder did not expose its live page to the verification seam.");

  await recorderPage.getByTestId("open-reports").click();
  await waitUntil(() => (recorder?.getActions().length ?? 0) > 1, "a non-navigation business action");
  const preDetectionCount = recorder.getActions().length;
  check("pre-detection draft contains a non-zero business action", preDetectionCount > 1, String(preDetectionCount));

  await recorderPage.goto(`${BASE}/mock/protected-login`);
  await waitUntil(() => recorder?.getHandoff()?.phase === "detected", "protected-login handoff detection");
  check("protected-login detection pauses the Recorder", recorder.getStatus().isRecording === false);
  check(
    "automation browser remains open during the detected phase",
    recorderInternals.browser?.isConnected() === true && recorderPage.isClosed() === false
  );

  await recorderPage.getByTestId("password").fill("not-a-real-password");
  await recorderPage.getByTestId("otp").fill("123456");
  await recorderPage.waitForTimeout(150);
  check(
    "password/OTP input cannot change the preserved non-empty draft",
    recorder.getActions().length === preDetectionCount,
    `${recorder.getActions().length}/${preDetectionCount}`
  );

  const identicalAction: Omit<RecordedAction, "id"> = {
    type: "click",
    name: "Click Open Reports",
    locator: { strategy: "testId", value: "open-reports" }
  };
  recorderInternals.recordActionFromPage(recorderPage, identicalAction);
  check(
    "private recordActionFromPage drops an action while paused",
    recorder.getActions().length === preDetectionCount,
    `${recorder.getActions().length}/${preDetectionCount}`
  );

  /*
   * Count the IDENTICAL ACTION, not the draft length.
   *
   * This assertion is about one thing: an action that was dropped while paused is recorded once the
   * pause is lifted. A raw `length === preDetectionCount + 1` only expressed that while nothing else
   * could be added in between — and something can be, since `eeb7a21`: the `goto` on the line below is
   * an INDEPENDENT navigation (no recorded action explains it), so the recorder now correctly captures
   * it as a replayable step. The draft therefore grows by two, and the check failed 4/3 while both the
   * feature and the behaviour under test were right.
   *
   * Matching on type + name + locator is also strictly stronger than a count: a length test passes if
   * some entirely different action is appended, whereas this fails unless THIS action arrives exactly
   * once. The added actions are reported as evidence so an unexpected extra is still visible.
   */
  const matchesIdenticalAction = (candidate: RecordedAction): boolean =>
    candidate.type === identicalAction.type &&
    candidate.name === identicalAction.name &&
    candidate.locator?.strategy === identicalAction.locator?.strategy &&
    candidate.locator?.value === identicalAction.locator?.value;

  const identicalBeforeUnpause = recorder.getActions().filter(matchesIdenticalAction).length;
  const draftBeforeUnpause = recorder.getActions().length;

  recorder.ignoreCurrentProtectedDetection();
  await recorderPage.goto(`${BASE}/mock/sso-text-app`);
  recorderInternals.recordActionFromPage(recorderPage, identicalAction);

  const addedAfterUnpause = recorder
    .getActions()
    .slice(draftBeforeUnpause)
    .map((action) => `${action.type}:${action.name}`);
  console.log(`    · after unpausing, the draft gained: [${addedAfterUnpause.join(", ")}]`);
  check(
    "the identical private action records after unpausing",
    recorder.getActions().filter(matchesIdenticalAction).length === identicalBeforeUnpause + 1,
    `identical action ${recorder.getActions().filter(matchesIdenticalAction).length}/${identicalBeforeUnpause + 1}; ` +
      `added after unpausing: [${addedAfterUnpause.join(", ")}]`
  );
  await recorder.cancelRecording();
  recorder = undefined;

  console.log("Capture Session & Resume — recorder resume lifecycle:");
  {
    resumeDraftDir = await mkdtemp(join(tmpdir(), "awkit-rec022-resumedraft-"));
    // A REAL captured profile: a persistent context seeded with the persisted authentication signal,
    // exactly the state a completed manual Chrome login leaves behind. The synthetic capture service
    // below only stands in for spawning real Chrome (never done from automation) — everything after
    // "Capture Session & Resume" runs through the product's real Playwright/Recorder layers.
    const resumeProfileDir = await mkdtemp(join(tmpdir(), "awkit-rec022-resume-"));
    resumeProfileDirs.push(resumeProfileDir);
    const seededContext = await chromium.launchPersistentContext(resumeProfileDir, { headless: true });
    const seededPage = seededContext.pages()[0] ?? (await seededContext.newPage());
    await seededPage.goto(`${BASE}/mock/session-reuse`);
    await seededPage.evaluate(() => {
      localStorage.setItem("awkit.mock.session-reuse.authenticated", "true");
    });
    await seededPage.close();
    await seededContext.close();
    const seededProbe = await chromium.launchPersistentContext(resumeProfileDir, { headless: true });
    const probePage = seededProbe.pages()[0] ?? (await seededProbe.newPage());
    await probePage.goto(`${BASE}/mock/session-reuse`);
    check(
      "captured resume profile carries the persisted authentication signal",
      (await probePage.getByTestId("auth-status").getAttribute("data-authenticated")) === "true"
    );
    await seededProbe.close();

    const RESUME_SESSION_ID = "rec022-resume-session";
    let startCaptureCalls = 0;
    let stopCaptureCalls = 0;
    let renamedTo = "";
    const resumeProfile: SessionProfile = {
      id: RESUME_SESSION_ID,
      name: "REC-022 handoff session",
      profileDir: resumeProfileDir,
      targetUrl: `${BASE}/mock/session-reuse`,
      loginUrl: `${BASE}/mock/session-reuse`,
      origin: BASE,
      source: "manualChromeHandoff",
      createdAt: new Date().toISOString(),
      status: "ready"
    };
    const syntheticCapture = {
      list: async () => [resumeProfile],
      // AWKIT-REC-037: continueWithNormalBrowser now validates Chrome availability BEFORE closing
      // the automation browser; the double must answer the probe.
      detectBrowser: () => ({ found: true, path: "C:/fake/chrome.exe", browser: "chrome" as const }),
      startCapture: async () => {
        startCaptureCalls += 1;
        return { active: true, sessionId: RESUME_SESSION_ID, sessionName: resumeProfile.name, status: "running" as const };
      },
      stopCapture: () => {
        stopCaptureCalls += 1;
      },
      getStatus: () => ({ active: false, status: "closed" as const }),
      getById: async (id: string) => (id === RESUME_SESSION_ID ? resumeProfile : null),
      hasCapturedData: (id: string) => id === RESUME_SESSION_ID,
      rename: async (_id: string, newName: string) => {
        renamedTo = newName;
        return { ...resumeProfile, name: newName };
      },
      markUsed: async () => undefined
    } as any;

    const resumeDraftPath = join(resumeDraftDir, "recorder-draft.json");
    recorder = new RecorderService();
    recorder.configureSessionCapture(syntheticCapture);
    recorder.configureDraftStorage(resumeDraftPath);
    await recorder.startRecording(`${BASE}/mock/sso-text-app`, {
      executablePath: chromium.executablePath(),
      captureSmartWaits: false
    });
    const resumeInternals = recorder as unknown as {
      browser: Browser | null;
      page: Page | null;
    };
    const preLoginPage = resumeInternals.page;
    if (!preLoginPage) throw new Error("Resume recorder did not expose its live page.");

    await preLoginPage.getByTestId("open-reports").click();
    await waitUntil(() => (recorder?.getActions().length ?? 0) > 1, "pre-handoff business action");
    const preHandoffCount = recorder!.getActions().length;
    check("pre-handoff draft holds recorded business actions", preHandoffCount > 1, String(preHandoffCount));

    await preLoginPage.goto(`${BASE}/mock/protected-login`);
    await waitUntil(() => recorder?.getHandoff()?.phase === "detected", "protected detection before handoff");
    check("handoff lifecycle starts paused", recorder!.getStatus().isRecording === false);

    await recorder!.continueWithNormalBrowser();
    await waitUntil(() => recorder?.getHandoff()?.phase === "capturingSession", "manual capture phase");
    // SECURITY BOUNDARY: the automation browser must be really CLOSED, not merely forgotten.
    // `closeBrowser()` nulls browser/context/page together, so `page !== preLoginPage` is
    // unconditionally true and proves nothing; only the live page's own closed state does.
    check(
      "automation browser closes before the manual browser opens",
      preLoginPage.isClosed() === true && resumeInternals.browser === null,
      `pageClosed=${preLoginPage.isClosed()} browser=${resumeInternals.browser === null ? "null" : "live"}`
    );
    check("manual session capture started exactly once", startCaptureCalls === 1 && stopCaptureCalls === 0, `${startCaptureCalls}/${stopCaptureCalls}`);

    await recorder!.captureSessionAndResume("REC-022 resumed session");
    await waitUntil(() => recorder?.getHandoff()?.phase === "resumed", "recorder resume on captured session");
    check("capture stopped the manual browser exactly once", stopCaptureCalls === 1, String(stopCaptureCalls));
    check("captured session was renamed through the service seam", renamedTo === "REC-022 resumed session", renamedTo);
    check("recorder is recording again after resume", recorder!.getStatus().isRecording === true);

    const actionsAfterResume = recorder!.getActions();
    check(
      "secure nodes were inserted at the front of the resumed draft",
      actionsAfterResume[0]?.type === "autoSecureLogin" && actionsAfterResume[1]?.type === "reuseSession",
      actionsAfterResume.slice(0, 2).map((a) => a.type).join(",")
    );
    // The Auto Secure Login node must carry the LOGIN url (the detected protected page), not the
    // recorded-site url: replay reuses sessions by ORIGIN match, and IdP redirects mean the login
    // origin differs from the site origin. A site-url value spawns a redundant manual login.
    const autoLoginValue = String(actionsAfterResume[0]?.valueSource?.value ?? "");
    check(
      "Auto Secure Login carries the LOGIN url so replay origin-matches the captured session",
      autoLoginValue.includes("/mock/protected-login"),
      autoLoginValue
    );
    check(
      "Reuse Session links the captured session id",
      actionsAfterResume[1]?.config?.reuseSessionId === RESUME_SESSION_ID,
      String(actionsAfterResume[1]?.config?.reuseSessionId)
    );

    // Prove the resumed context actually uses the captured profile's storage state: navigating to
    // the reuse scenario shows authenticated with NO login interaction performed by anyone.
    const resumedPage = resumeInternals.page;
    if (!resumedPage) throw new Error("Resumed recorder page disappeared.");
    await resumedPage.goto(`${BASE}/mock/session-reuse`);
    await resumedPage
      .getByTestId("auth-status")
      .filter({ hasText: "Authenticated" })
      .waitFor({ timeout: 5_000 });
    check(
      "resumed Playwright context reuses the captured session state",
      (await resumedPage.getByTestId("auth-status").getAttribute("data-authenticated")) === "true"
    );

    // Append one ordinary post-login business action through the live bindings.
    const countAfterResume = recorder!.getActions().length;
    await resumedPage.getByTestId("dashboard").click({ force: true });
    await waitUntil(() => (recorder?.getActions().length ?? 0) > countAfterResume, "post-resume action");
    const postResumeActions = recorder!.getActions();
    check(
      "ordinary post-login actions append after resume",
      postResumeActions.length > countAfterResume && postResumeActions[postResumeActions.length - 1].type === "click",
      `${postResumeActions.length}/${countAfterResume}`
    );

    // Save/reload: stopRecording flushes the draft; the file must round-trip secure-first ordering.
    const finalActions = await recorder!.stopRecording();
    recorder = undefined;
    check("stop returns the full resumed flow", finalActions.length >= 4 && finalActions[0].type === "autoSecureLogin" && finalActions[1].type === "reuseSession", `${finalActions.length}`);
    const persistedResumeDraft = JSON.parse(await readFile(resumeDraftPath, "utf8"));
    check(
      "the resumed draft persists to disk secure-nodes-first",
      Array.isArray(persistedResumeDraft.actions) &&
        persistedResumeDraft.actions.length === finalActions.length &&
        persistedResumeDraft.actions[0].type === "autoSecureLogin" &&
        persistedResumeDraft.actions[1].config.reuseSessionId === RESUME_SESSION_ID,
      `${persistedResumeDraft.actions?.length}/${finalActions.length}`
    );
    check(
      "no login interaction exists anywhere in the resumed draft",
      !finalActions.some((a) => /simulate.?login|complete.?login/i.test(a.name)),
      finalActions.map((a) => a.name).join("|").slice(0, 120)
    );
  }

  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Mock protected-login page:");
  await page.goto(`${BASE}/mock/protected-login`);
  await page.getByRole("heading", { name: "Protected login required" }).waitFor();
  check("protected-login page has password field", await page.locator('input[type="password"]').count() === 1);
  check("protected-login page has one-time-code field", await page.locator('input[autocomplete="one-time-code"]').count() === 1);
  check("protected-login page has Complete Manual Login button", await page.getByTestId("complete-login").isVisible());
  const mainDetect = await detectRecorderProtectedLogin(page);
  check("recorder detects protected-login page", mainDetect.detected, `${mainDetect.detected}/${mainDetect.reason}`);

  console.log("Mock protected popup login:");
  await page.goto(`${BASE}/mock/protected-popup-login`);
  const [loginPopup] = await Promise.all([
    context.waitForEvent("page"),
    page.getByTestId("open-popup").click()
  ]);
  await loginPopup.waitForLoadState("domcontentloaded");
  check("popup login has password field", await loginPopup.locator('input[type="password"]').count() === 1);
  const popupDetect = await detectRecorderProtectedLogin(loginPopup);
  check("recorder detects protected popup login", popupDetect.detected, `${popupDetect.detected}/${popupDetect.reason}`);
  await loginPopup.getByTestId("popup-complete").click();
  await page.getByTestId("auth-status").filter({ hasText: "Authenticated" }).waitFor({ timeout: 2000 });
  check("main page shows authenticated after manual popup login", (await page.getByTestId("auth-status").getAttribute("data-authenticated")) === "true");

  console.log("Mock protected popup CAPTCHA:");
  await page.goto(`${BASE}/mock/protected-popup-captcha`);
  const [captchaPopup] = await Promise.all([
    context.waitForEvent("page"),
    page.getByTestId("open-popup").click()
  ]);
  await captchaPopup.waitForLoadState("domcontentloaded");
  check("captcha popup has recaptcha iframe", await captchaPopup.locator('iframe[src*="recaptcha"]').count() === 1);
  const captchaDetect = await detectRecorderProtectedLogin(captchaPopup);
  check("recorder detects CAPTCHA popup (captcha)", captchaDetect.detected && captchaDetect.reason === "captcha", `${captchaDetect.detected}/${captchaDetect.reason}`);
  await captchaPopup.close();

  console.log("Mock protected popup OTP:");
  await page.goto(`${BASE}/mock/protected-popup-otp`);
  const [otpPopup] = await Promise.all([
    context.waitForEvent("page"),
    page.getByTestId("open-popup").click()
  ]);
  await otpPopup.waitForLoadState("domcontentloaded");
  check("otp popup has one-time-code field", await otpPopup.locator('input[autocomplete="one-time-code"]').count() === 1);
  const otpDetect = await detectRecorderProtectedLogin(otpPopup);
  check("recorder detects OTP popup (mfa)", otpDetect.detected && otpDetect.reason === "mfa", `${otpDetect.detected}/${otpDetect.reason}`);
  await otpPopup.getByTestId("popup-complete").click();
  // Wait for the SIGNAL THIS CHECK ASSERTS, not a neighbouring one. The page updates the visible
  // text and the data-authenticated attribute separately, so waiting on the text and then reading the
  // attribute can lose that race — seen once as an intermittent failure of this exact check while five
  // consecutive runs passed. Predicate is deliberately synchronous: waitForFunction does not await an
  // async one (see verify:async-wait-hygiene).
  await page.waitForFunction(
    () => document.querySelector("[data-testid=\"auth-status\"]")?.getAttribute("data-authenticated") === "true",
    undefined,
    { timeout: 2000, polling: 100 }
  );
  check("main page shows verified after manual OTP entry", (await page.getByTestId("auth-status").getAttribute("data-authenticated")) === "true");

  console.log("Mock session-reuse scenario:");
  await page.goto(`${BASE}/mock/session-reuse`);
  await page.getByRole("heading", { name: "Session reuse scenario" }).waitFor();
  const reuseDetect = await detectRecorderProtectedLogin(page);
  check("recorder does NOT pause on session-reuse page", reuseDetect.detected === false, `${reuseDetect.detected}/${reuseDetect.reason}`);
  check("session-reuse starts not authenticated", (await page.getByTestId("auth-status").getAttribute("data-authenticated")) === "false");
  await page.getByTestId("simulate-login").click();
  check("session-reuse shows authenticated marker after login", (await page.getByTestId("auth-status").getAttribute("data-authenticated")) === "true");
  check("session-reuse reveals a dashboard marker", await page.getByTestId("dashboard").isVisible());

  console.log("Captured-session runner replay:");
  capturedProfileDir = await mkdtemp(join(tmpdir(), "awkit-rec022-session-"));
  const capturedContext = await chromium.launchPersistentContext(capturedProfileDir, { headless: true });
  const capturedPage = capturedContext.pages()[0] ?? await capturedContext.newPage();
  await capturedPage.goto(`${BASE}/mock/session-reuse`);
  await capturedPage.evaluate(() => {
    localStorage.setItem("awkit.mock.session-reuse.authenticated", "true");
  });
  await capturedPage.reload();
  check(
    "captured profile fixture carries the persisted authentication signal",
    (await capturedPage.getByTestId("auth-status").getAttribute("data-authenticated")) === "true"
  );
  await capturedContext.close();

  const capturedProfile: SessionProfile = {
    id: "rec022-captured-session",
    name: "REC-022 captured session",
    profileDir: capturedProfileDir,
    targetUrl: `${BASE}/mock/session-reuse`,
    loginUrl: `${BASE}/mock/session-reuse`,
    origin: BASE,
    source: "manualChromeHandoff",
    createdAt: new Date().toISOString(),
    status: "ready"
  };
  let manualCaptureCalls = 0;
  let markedSessionId = "";
  const capturedSessionService = {
    list: async () => [capturedProfile],
    startCapture: async () => {
      manualCaptureCalls += 1;
      throw new Error("The authenticated replay must not launch a login capture.");
    },
    getStatus: () => ({ active: false, status: "closed" as const }),
    getById: async (id: string) => id === capturedProfile.id ? capturedProfile : null,
    markUsed: async (id: string) => {
      markedSessionId = id;
    }
  } as any;
  const authenticatedFlow = linearFlow("rec022-authenticated-replay", [
    {
      id: "auto-login",
      type: "autoSecureLogin",
      name: "Auto Secure Login",
      value: `${BASE}/mock/session-reuse`
    },
    {
      id: "reuse-session",
      type: "reuseSession",
      name: "Reuse Session",
      config: { reuseSessionMode: "selected", reuseSessionId: capturedProfile.id }
    },
    {
      id: "open-dashboard",
      type: "goto",
      name: "Open authenticated dashboard",
      url: `${BASE}/mock/session-reuse`
    },
    {
      id: "assert-authenticated",
      type: "assertText",
      name: "Assert authenticated state",
      locator: { strategy: "testId", value: "auth-status" },
      config: { assertionType: "text", comparisonOperator: "equals", expectedValue: "Authenticated" }
    },
    {
      id: "assert-dashboard",
      type: "assertVisible",
      name: "Assert dashboard visible",
      locator: { strategy: "testId", value: "dashboard" }
    }
  ]);
  const authenticatedRunner = new PlaywrightRunner({
    flows: [authenticatedFlow],
    productionOffline: false,
    resourcesRoot: join(process.cwd(), "resources"),
    sessionService: capturedSessionService
  });
  const authenticatedResult = await authenticatedRunner.executeScenario(
    scenarioFor(authenticatedFlow.id),
    await makeExecutionContext(authenticatedFlow.id),
    runnerConfig
  );
  check(
    "runner replays Auto Secure Login + Reuse Session into the authenticated dashboard",
    authenticatedResult.status === "passed" &&
      authenticatedResult.flows[0]?.steps.some((step) => step.stepId === "assert-dashboard" && step.status === "passed"),
    authenticatedResult.error ?? authenticatedResult.flows[0]?.error
  );
  check(
    "authenticated replay performs no login interaction",
    manualCaptureCalls === 0 &&
      !authenticatedFlow.nodes.some((node) => node.type === "click" || node.type === "fill"),
    `captureCalls=${manualCaptureCalls}`
  );
  check("Reuse Session marks the captured profile used", markedSessionId === capturedProfile.id, markedSessionId);

  let missingSessionCaptureCalls = 0;
  const missingSessionService = {
    list: async () => [],
    startCapture: async () => {
      missingSessionCaptureCalls += 1;
      throw new Error("No captured session is available in the negative control.");
    },
    getStatus: () => ({ active: false, status: "closed" as const }),
    getById: async () => null,
    markUsed: async () => undefined
  } as any;
  const missingSessionRunner = new PlaywrightRunner({
    flows: [authenticatedFlow],
    productionOffline: false,
    resourcesRoot: join(process.cwd(), "resources"),
    sessionService: missingSessionService
  });
  const missingSessionResult = await missingSessionRunner.executeScenario(
    scenarioFor(authenticatedFlow.id),
    await makeExecutionContext(authenticatedFlow.id),
    runnerConfig
  );
  check(
    "the identical Auto Secure Login + Reuse Session flow fails when its captured session is removed",
    missingSessionResult.status === "failed" && missingSessionCaptureCalls === 1,
    missingSessionResult.error ?? missingSessionResult.flows[0]?.error
  );

  const noSessionFlow = linearFlow("rec022-no-session-control", [
    {
      id: "open-dashboard",
      type: "goto",
      name: "Open dashboard without a session",
      url: `${BASE}/mock/session-reuse`
    },
    {
      id: "assert-authenticated",
      type: "assertText",
      name: "Assert authenticated state",
      locator: { strategy: "testId", value: "auth-status" },
      config: { assertionType: "text", comparisonOperator: "equals", expectedValue: "Authenticated" }
    }
  ]);
  const noSessionRunner = new PlaywrightRunner({
    flows: [noSessionFlow],
    productionOffline: false,
    resourcesRoot: join(process.cwd(), "resources")
  });
  const noSessionResult = await noSessionRunner.executeScenario(
    scenarioFor(noSessionFlow.id),
    await makeExecutionContext(noSessionFlow.id),
    runnerConfig
  );
  check(
    "the same dashboard assertion fails without the captured session",
    noSessionResult.status === "failed" &&
      (noSessionResult.error ?? noSessionResult.flows[0]?.error ?? "").includes("Assertion failed"),
    noSessionResult.error ?? noSessionResult.flows[0]?.error
  );

  console.log("Mock SSO-text false-positive scenario:");
  await page.goto(`${BASE}/mock/sso-text-app`);
  await page.getByRole("heading", { name: "Company Portal" }).waitFor();
  const ssoAppDetect = await detectRecorderProtectedLogin(page);
  check(
    "recorder does NOT pause on an SSO-text-only app page",
    ssoAppDetect.recommendedAction === "continue",
    `${ssoAppDetect.detected}/${ssoAppDetect.reason}/${ssoAppDetect.confidence}/${ssoAppDetect.recommendedAction}`
  );
  check("SSO-text page has no password field (not a real login)", await page.locator('input[type="password"]').count() === 0);
  await page.getByTestId("open-reports").click();
  check("normal interaction still works on the SSO-text page", await page.getByTestId("reports-panel").isVisible());

  await context.close();
} catch (error) {
  failed += 1;
  console.error(error);
} finally {
  if (recorder) await recorder.cancelRecording().catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
  if (capturedProfileDir) await rm(capturedProfileDir, { recursive: true, force: true }).catch(() => undefined);
  for (const dir of resumeProfileDirs) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  if (resumeDraftDir) await rm(resumeDraftDir, { recursive: true, force: true }).catch(() => undefined);
  server.kill();
}

console.log(`\n${passed}/${passed + failed} protected-login recorder checks passed`);
process.exit(failed === 0 ? 0 : 1);
