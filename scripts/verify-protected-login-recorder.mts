// Verifies the Recorder-side protected login / protected popup manual Chrome handoff:
//  1. Pure detection (password / OTP / CAPTCHA / passkey / MFA text / no false positives, no secrets).
//  2. Live detection against the offline Mock Site protected scenarios (main page + popups).
//  3. Flow serialization of the inserted Auto Secure Login / Reuse Session nodes (session id linked),
//     and that legacy recorded flows still build unchanged.
//
// Run: npm run verify:protected-login-recorder
import { spawn } from "node:child_process";
import { chromium, type Browser } from "playwright";
import {
  detectFromRecorderSignals,
  detectRecorderProtectedLogin
} from "@src/security/ProtectedLoginDetector";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import type { RecordedAction } from "@src/recorder/RecorderTypes";

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
try {
  await waitForServer();
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
  await page.getByTestId("auth-status").filter({ hasText: "Verified" }).waitFor({ timeout: 2000 });
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
  if (browser) await browser.close().catch(() => undefined);
  server.kill();
}

console.log(`\n${passed}/${passed + failed} protected-login recorder checks passed`);
process.exit(failed === 0 ? 0 : 1);
