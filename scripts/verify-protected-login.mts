/**
 * Unit verification for the Protected Login detector (no browser needed — uses the pure
 * detectFromSignals core). Run with: npx tsx scripts/verify-protected-login.mts
 */
import { detectFromSignals, providerFromHost } from "@src/security/ProtectedLoginDetector";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("Provider URL detection:");
check("accounts.google.com → google", providerFromHost("accounts.google.com") === "google");
check("login.microsoftonline.com → microsoft", providerFromHost("login.microsoftonline.com") === "microsoft");
check("dev-123.okta.com → okta", providerFromHost("dev-123.okta.com") === "okta");
check("tenant.auth0.com → auth0", providerFromHost("tenant.auth0.com") === "auth0");
check("api-abc.duosecurity.com → duo", providerFromHost("api-abc.duosecurity.com") === "duo");
check("example.com → unknown", providerFromHost("example.com") === "unknown");

console.log("Google insecure-browser rejection page:");
const google = detectFromSignals(
  "https://accounts.google.com/v3/signin/rejected?continue=...",
  "Couldn't sign you in",
  "Couldn’t sign you in. This browser or app may not be secure. Try using a different browser."
);
check("detected", google.detected);
check("provider google", google.provider === "google");
check("reason blocked-automation-browser", google.reason === "blocked-automation-browser", google.reason);
check("message mentions not bypass", /will not bypass/i.test(google.message));

console.log("MFA / CAPTCHA / security-check text:");
const mfa = detectFromSignals("https://login.example.com/mfa", "Two-step verification", "Enter a verification code from your authenticator app");
check("MFA detected on non-provider URL", mfa.detected && mfa.reason === "mfa", `${mfa.detected}/${mfa.reason}`);
const captcha = detectFromSignals("https://chatgpt.com/api/auth/error", "Just a moment...", "Verify you are human. Cloudflare.");
check("CAPTCHA / human-check detected", captcha.detected && captcha.reason === "captcha", `${captcha.detected}/${captcha.reason}`);
const security = detectFromSignals("https://accounts.google.com/signin/v2/challenge", "Verify it's you", "Security check");
check("security-check on provider", security.detected && security.provider === "google");

console.log("Non-protected pages do NOT trigger (no false positive):");
const mock = detectFromSignals("http://localhost:4321/form", "Mock Site — Form", "First name Last name Email Submit");
check("mock form not detected", mock.detected === false);
const success = detectFromSignals("http://localhost:4321/success?id=1", "Submission successful", "Submission successful");
check("mock success not detected", success.detected === false);

console.log("No secrets in detection output:");
check("detection has no cookie/token fields", !("cookies" in (google as object)) && !("token" in (google as object)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
