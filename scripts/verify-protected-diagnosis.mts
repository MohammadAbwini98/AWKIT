/**
 * verify:protected-diagnosis — L12.17 (awkit-djnl.21.17): Super-User-only DOM-intelligence diagnosis of a
 * sign-in or MFA page, with CAPTCHA and the other challenge surfaces refused for every role.
 *
 *   A. Roles, both directions: only Super User holds the permission, it re-authenticates, and Administrator
 *      does not receive it through its denylist.
 *   B. The surface policy: which detector reasons may be read, and which never.
 *   C. Real Chromium, the production LocatorFactory.diagnose with a recording fake provider:
 *      a sign-in page is skipped without the opt-in and read with it, the HTML carries no password field and no
 *      typed value, the result names the surface; a CAPTCHA page (a widget marker, or the detector's own
 *      challenge) stays refused with the opt-in; a page with nothing protected is read as before.
 *   D. The main-process gate (source): the role, the permission, re-authentication and denial audit before the
 *      page is fetched, a use audited after, and getLivePage relaxing only for that actor, never in a handoff.
 *
 * Run: npm run verify:protected-diagnosis
 */
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";

import { chromium, type Browser } from "playwright";

import type { FlowStep } from "@src/profiles/FlowProfile";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { stepCandidatesDigest } from "@src/runner/LocatorRecoveryStore";
import { NoopDomIntelligenceProvider, type DomIntelligenceProvider, type DomRecoveryRequest, type DomRecoveryResult } from "@src/runner/domIntelligence/DomIntelligenceProvider";
import { MemoryDomReferenceStore, domReferenceId } from "@src/runner/domIntelligence/domReference";
import { sanitizeDiagnosisRequest } from "@src/runner/domIntelligence/DomIntelligenceApi";
import { PROTECTED_DIAGNOSIS_REASONS, protectedDiagnosisAllowed } from "@src/runner/domIntelligence/protectedDiagnosis";
import { BUILTIN_ROLES, Permission, SENSITIVE_PERMISSIONS } from "@src/security/authz/Permissions";
import { detectRecorderProtectedLogin } from "@src/security/ProtectedLoginDetector";

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

class RecordingProvider implements DomIntelligenceProvider {
  readonly requests: DomRecoveryRequest[] = [];
  private readonly off = new NoopDomIntelligenceProvider("DISABLED", "recording fake");
  async getStatus() {
    return { available: true, provider: "scrapling" as const, mode: "parser-only" as const, browserAccess: false as const, networkAccess: false as const };
  }
  async findRecoveryCandidates(request: DomRecoveryRequest): Promise<DomRecoveryResult> {
    this.requests.push(request);
    return { ok: true, candidates: [], elements: 0, parseMs: 0, matchMs: 0 };
  }
  saveReference = () => this.off.saveReference();
  normalizeForAi = () => this.off.normalizeForAi();
  shutdown = () => this.off.shutdown();
}

const SIGN_IN = (extra = "") =>
  '<!doctype html><html><head><title>Sign in</title></head><body><main><section class="auth"><form class="login">' +
  '<label for="user">Email</label><input id="user" name="email" type="email" value="person@example.com">' +
  '<label for="pw">Password</label><input type="password" id="pw" name="password" autocomplete="current-password" value="hunter2-secret">' +
  `<div class="actions"><button type="submit" id="sign-in">Sign in</button></div>${extra}</form></section></main></body></html>`;
const PLAIN = '<!doctype html><html><head><title>Orders</title></head><body><main><section class="auth"><form class="login"><div class="actions"><button type="submit" id="sign-in">Save</button></div></form></section></main></body></html>';

async function main(): Promise<void> {
  console.log("A. Roles, both directions");
  const perm = Permission.DOM_INTELLIGENCE_PROTECTED_DIAGNOSIS;
  check("Super User holds the permission", BUILTIN_ROLES.SuperUser.permissions.includes(perm));
  for (const role of ["Administrator", "Operator", "Viewer", "Issuer"] as const) {
    check(`${role} does NOT hold it`, !BUILTIN_ROLES[role].permissions.includes(perm));
  }
  check("it requires a fresh re-authentication", SENSITIVE_PERMISSIONS.has(perm));
  check("(non-vacuity) Administrator does hold an ordinary permission it should", BUILTIN_ROLES.Administrator.permissions.includes(Permission.RECORDER_ELEMENT_SPY));

  console.log("B. Which surfaces may be read");
  for (const reason of ["login-form", "mfa", "passkey", "sso", "known-provider"] as const) check(`${reason}: allowed`, protectedDiagnosisAllowed(reason));
  for (const reason of ["captcha", "security-check", "blocked-automation-browser", "digital-signature", "external-approval", "unknown"] as const) {
    check(`${reason}: refused for every role`, !protectedDiagnosisAllowed(reason));
  }
  check("no reason, no override", !protectedDiagnosisAllowed(undefined));
  check("the allow-list is exactly five reasons", PROTECTED_DIAGNOSIS_REASONS.size === 5);
  check("the request opt-in takes only the literal true", sanitizeDiagnosisRequest({ source: "draft", actionId: "a1", includeProtected: "true" })?.includeProtected === undefined && sanitizeDiagnosisRequest({ source: "draft", actionId: "a1", includeProtected: true })?.includeProtected === true);

  console.log("C. The diagnosis on real pages");
  let html = SIGN_IN();
  const server: Server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html" }).end(html));
  const base = await new Promise<string>((done) => server.listen(0, "127.0.0.1", () => done(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const step: FlowStep = { id: "sign-in-step", name: "Sign in", type: "click", locator: { strategy: "css", value: "#sign-in-old" } } as FlowStep;
    const references = new MemoryDomReferenceStore();
    await references.put({
      schemaVersion: 1,
      referenceId: domReferenceId(step, "flow-p")!,
      bindingDigest: stepCandidatesDigest(step.locator!),
      source: "recorder",
      capturedAt: new Date().toISOString(),
      element: { tag: "button", attributes: { id: "sign-in", type: "submit" }, text: "Sign in", path: ["html", "body", "main", "section", "form", "div", "button"], siblings: [], children: [] }
    });
    const diagnose = async (allowProtected: boolean) => {
      const provider = new RecordingProvider();
      const diagnosis = await new LocatorFactory(page).diagnose(step, { provider, references, flowId: "flow-p", allowProtected });
      return { diagnosis, provider };
    };

    await page.goto(`${base}/login`);
    check("precondition: the sign-in page has a password field with a typed value", (await page.locator('input[type="password"]').inputValue()) === "hunter2-secret");
    const without = await diagnose(false);
    check("without the opt-in the sign-in page is skipped as protected, no HTML sent", without.diagnosis.provider.reason === "protected-surface" && without.provider.requests.length === 0, without.diagnosis.provider);
    const withIt = await diagnose(true);
    const sent = withIt.provider.requests[0]?.html ?? "";
    check("with the opt-in the sign-in page is read", withIt.provider.requests.length === 1 && withIt.diagnosis.provider.outcome === "ok", withIt.diagnosis.provider);
    check("...and the result names the surface it read", typeof withIt.diagnosis.protectedOverride === "string" && protectedDiagnosisAllowed(withIt.diagnosis.protectedOverride as never), withIt.diagnosis.protectedOverride);
    check("...the HTML carries the button it is about", sent.includes('id="sign-in"'));
    check("...but no password field at all", !/type="password"|autocomplete="current-password"|name="password"/.test(sent), sent.slice(0, 400));
    check("...and no typed value, from any field", !sent.includes("hunter2-secret") && !sent.includes("person@example.com") && !/\svalue="/.test(sent));

    // A Turnstile widget: the protected-login detector does not name it, so only the second, independent marker
    // check can refuse it. The precondition makes that explicit (otherwise this check could pass on the detector).
    html = SIGN_IN('<div class="cf-turnstile" data-sitekey="test-key"></div>');
    await page.goto(`${base}/login`);
    const detectorView = await detectRecorderProtectedLogin(page);
    check("precondition: the detector alone does not call the Turnstile page a CAPTCHA", detectorView.reason !== "captcha", detectorView.reason);
    const captcha = await diagnose(true);
    check("a sign-in page carrying a CAPTCHA widget the detector misses stays refused with the opt-in", captcha.diagnosis.provider.reason === "protected-surface" && captcha.provider.requests.length === 0 && !captcha.diagnosis.protectedOverride, captcha.diagnosis.provider);

    html = SIGN_IN('<div role="img" aria-label="captcha challenge">Verify the image</div>');
    await page.goto(`${base}/login`);
    const detected = await diagnose(true);
    check("a page the detector names a CAPTCHA stays refused with the opt-in", detected.provider.requests.length === 0 && !detected.diagnosis.protectedOverride, { provider: detected.diagnosis.provider, override: detected.diagnosis.protectedOverride });

    html = PLAIN;
    await page.goto(`${base}/login`);
    const plain = await diagnose(true);
    check("control: a page with nothing protected is read and names no override", plain.provider.requests.length === 1 && plain.diagnosis.protectedOverride === undefined, plain.diagnosis);
  } finally {
    await browser?.close().catch(() => undefined);
    server.close();
  }

  console.log("D. The main-process gate");
  const ipc = readFileSync("app/main/ipc/domIntelligence.ipc.ts", "utf8");
  const handler = ipc.slice(ipc.indexOf('ipcMain.handle("domIntelligence:diagnoseStep"'), ipc.indexOf('ipcMain.handle("domIntelligence:checkDrift"'));
  check(
    "an opt-in needs the Super User role, the permission, re-authentication and a denial audit",
    /request\.includeProtected\s*\?\s*await assertSenderSuperUser\(event, Permission\.DOM_INTELLIGENCE_PROTECTED_DIAGNOSIS, \{\s*sensitive: true,\s*audit: \{ eventType: "PROTECTED_DIAGNOSIS_DENIED"/.test(handler)
  );
  check("...decided before the step or the page is read", handler.indexOf("assertSenderSuperUser") < handler.indexOf("getLivePage") && handler.indexOf("assertSenderSuperUser") < handler.indexOf("createFlowProfileStore"));
  check("the live page relaxes only for that authorized actor", /getLivePage\(alias, \{ allowProtected: actor !== undefined \}\)/.test(handler));
  check("the diagnosis is told to read protected pages only for that actor", /allowProtected: actor !== undefined/.test(handler.slice(handler.indexOf(".diagnose("))));
  check("a use that read a protected page is audited", /if \(actor && diagnosis\.protectedOverride\) await auditProtectedDiagnosis\(actor, diagnosis\.protectedOverride\)/.test(handler));
  check("the use audit records the actor and the surface code, never the page", /eventType: "PROTECTED_DIAGNOSIS_USED"[\s\S]{0,400}detail: \{ surface: reason \}/.test(ipc) && !/detail: \{[^}]*(url|html|selector)/i.test(ipc));
  check("the drift check never opts in (protected pages stay not-here there)", !ipc.slice(ipc.indexOf('ipcMain.handle("domIntelligence:checkDrift"')).includes("allowProtected"));
  const recorder = readFileSync("src/recorder/RecorderService.ts", "utf8");
  check(
    "getLivePage never relaxes during a protected-login handoff",
    /if \(!this\.inspectionAllowed\(\) \|\| \(this\.inspectionRefused && options\.allowProtected !== true\)\) return null;/.test(recorder) && /inspectionAllowed\(\): boolean \{\s*return [^;]*!this\.handoff\?\.active/.test(recorder)
  );
  const runner = readFileSync("src/runner/domIntelligence/repairSuggestion.ts", "utf8");
  check("a run's suggestion stage never reads a protected page (no override there)", !runner.includes("allowProtected") && runner.includes('reason: "protected-surface"'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
