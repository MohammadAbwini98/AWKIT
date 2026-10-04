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
import { CAPTCHA_MARKER_SELECTOR, PROTECTED_DIAGNOSIS_REASONS, REFUSED_TEXT_PATTERNS, protectedDiagnosisAllowed } from "@src/runner/domIntelligence/protectedDiagnosis";
import { captureDomSnapshot } from "@src/runner/domIntelligence/domSnapshot";
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
  const server: Server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html));
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

    // A Turnstile widget on a sign-in page. Since L12.20 the detector names it a CAPTCHA, so the reason allow-list
    // refuses it; the independent CAPTCHA_MARKER_SELECTOR check also matches it (asserted below and in D). The two
    // checks now cover the same markers, so the second can no longer be isolated end to end on a real page.
    html = SIGN_IN('<div class="cf-turnstile" data-sitekey="test-key"></div>');
    await page.goto(`${base}/login`);
    const detectorView = await detectRecorderProtectedLogin(page);
    check("the detector names the Turnstile sign-in page a CAPTCHA (L12.20)", detectorView.reason === "captcha" && detectorView.recommendedAction === "pause", detectorView.reason);
    const captcha = await diagnose(true);
    check("a sign-in page carrying a Turnstile widget stays refused with the opt-in", captcha.diagnosis.provider.reason === "protected-surface" && captcha.provider.requests.length === 0 && !captcha.diagnosis.protectedOverride, captcha.diagnosis.provider);
    for (const [label, widget] of [
      ["Turnstile", '<div class="cf-turnstile" data-sitekey="test-key"></div>'],
      ["Arkose", '<iframe src="about:blank#client-api.arkoselabs.com"></iframe>'],
      ["bare data-sitekey", '<div data-sitekey="k"></div>']
    ] as const) {
      html = SIGN_IN(widget);
      await page.goto(`${base}/login`);
      check(`the independent marker check matches a ${label} widget`, (await page.locator(CAPTCHA_MARKER_SELECTOR).count()) > 0);
    }

    html = SIGN_IN('<div role="img" aria-label="captcha challenge">Verify the image</div>');
    await page.goto(`${base}/login`);
    const detected = await diagnose(true);
    check("a page the detector names a CAPTCHA stays refused with the opt-in", detected.provider.requests.length === 0 && !detected.diagnosis.protectedOverride, { provider: detected.diagnosis.provider, override: detected.diagnosis.protectedOverride });

    html = PLAIN;
    await page.goto(`${base}/login`);
    const plain = await diagnose(true);
    check("control: a page with nothing protected is read and names no override", plain.provider.requests.length === 1 && plain.diagnosis.protectedOverride === undefined, plain.diagnosis);

    console.log("E. L12.21 review findings: wording, child frames, and the read itself");
    // Finding 1: a password field outranks the page's own wording in the detector, so these pages are reported as
    // login-form. The serializer must still refuse them for the refused reason they state.
    for (const [label, heading] of [
      ["security check", "<h1>Verify it’s you</h1>"],
      ["blocked automation", "<h1>This browser or app may not be secure</h1>"],
      ["digital signature", "<h1>Digital signature required</h1>"]
    ] as const) {
      html = SIGN_IN(heading);
      await page.goto(`${base}/login`);
      const view = await detectRecorderProtectedLogin(page);
      check(`precondition: the detector reports a ${label} sign-in page as login-form`, view.reason === "login-form", view.reason);
      const worded = await diagnose(true);
      check(
        `a sign-in page stating a ${label} stays refused with the opt-in`,
        worded.diagnosis.provider.reason === "protected-surface" && worded.provider.requests.length === 0 && !worded.diagnosis.protectedOverride,
        worded.diagnosis.provider
      );
    }

    // Finding 2: the detector and the marker check read the top document, so a step in a child frame never gets
    // the override. The control (the same frame without a password field) proves the path reaches the read.
    const frameStep: FlowStep = { ...step, id: "frame-step", locator: { strategy: "css", value: "#sign-in-old", context: { frame: { selector: "#auth" } } } } as FlowStep;
    await references.put({
      schemaVersion: 1,
      referenceId: domReferenceId(frameStep, "flow-p")!,
      bindingDigest: stepCandidatesDigest(frameStep.locator!),
      source: "recorder",
      capturedAt: new Date().toISOString(),
      element: { tag: "button", attributes: { id: "sign-in", type: "submit" }, text: "Sign in", path: ["html", "body", "main", "section", "form", "div", "button"], siblings: [], children: [] }
    });
    const inFrame = async (child: string) => {
      html = `<!doctype html><html><head><title>Portal</title></head><body><iframe id="auth" srcdoc="${child.replace(/"/g, "&quot;")}"></iframe></body></html>`;
      await page.goto(`${base}/portal`);
      await page.frameLocator("#auth").locator("#sign-in").waitFor();
      const provider = new RecordingProvider();
      return { diagnosis: await new LocatorFactory(page).diagnose(frameStep, { provider, references, flowId: "flow-p", allowProtected: true }), provider };
    };
    const childPlain = await inFrame(PLAIN);
    check("control: a step in a child frame with nothing protected is read", childPlain.provider.requests.length === 1 && childPlain.diagnosis.frame === "child", childPlain.diagnosis.provider);
    const childLogin = await inFrame(SIGN_IN());
    check("a sign-in form in a child frame is not read with the opt-in", childLogin.diagnosis.provider.reason === "protected-surface" && childLogin.provider.requests.length === 0 && !childLogin.diagnosis.protectedOverride, childLogin.diagnosis.provider);
    const childCaptcha = await inFrame(SIGN_IN('<div class="g-recaptcha" data-sitekey="k"></div>'));
    check("...nor one carrying a CAPTCHA under a clean top page", childCaptcha.provider.requests.length === 0 && !childCaptcha.diagnosis.protectedOverride, childCaptcha.diagnosis.provider);

    // Finding 3: the challenge check runs inside the same evaluate that serializes the document, so a widget that
    // renders after the pre-check is still refused. Exercised directly on the serializer.
    const read = async (extra: string) => {
      html = SIGN_IN(extra);
      await page.goto(`${base}/login`);
      return captureDomSnapshot(page.mainFrame(), { mode: "recover", allowProtectedDocument: true });
    };
    check("control: the serializer reads an allowed sign-in page under the override", !(await read("")).refused);
    check("the serializer refuses a widget present at read time", (await read('<div class="cf-turnstile"></div>')).refused === "protected-login");
    check("the serializer refuses a refused reason's wording present at read time", (await read("<p>Security check</p>")).refused === "protected-login");
    check("...including curly-apostrophe wording", (await read("<p>Couldn’t sign you in</p>")).refused === "protected-login");
    check("...and wording split by a non-breaking space or a line break", (await read("<p>Security&nbsp;check</p>")).refused === "protected-login" && (await read("<p>Digital<br>signature</p>")).refused === "protected-login");
    check("the refused wording covers every refused reason the detector knows", REFUSED_TEXT_PATTERNS.includes("verify it's you") && REFUSED_TEXT_PATTERNS.includes("captcha") && REFUSED_TEXT_PATTERNS.includes("digital signature") && !REFUSED_TEXT_PATTERNS.includes("verification code"));
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
  const factory = readFileSync("src/runner/LocatorFactory.ts", "utf8");
  check(
    "the diagnosis override needs the independent widget-marker check to find nothing",
    /const challenge = deps\.allowProtected === true && \(await this\.page\.locator\(CAPTCHA_MARKER_SELECTOR\)\.count\(\)\.catch\(\(\) => 1\)\) > 0;/.test(factory) &&
      /const override =\s*\(protectedPage \|\| protectedDocument\) &&\s*deps\.allowProtected === true &&\s*frame === this\.page\.mainFrame\(\) &&\s*!challenge &&/.test(factory)
  );
  check("the override is reported only after the serializer read the page", /else \{\s*if \(overrideReason\) diagnosis\.protectedOverride = overrideReason;\s*const result = await deps\.provider\.findRecoveryCandidates/.test(factory));
  const session = readFileSync("app/main/security/sessionContext.ts", "utf8");
  const superUser = session.slice(session.indexOf("export async function assertSenderSuperUser"), session.indexOf("export interface DenialAudit"));
  check(
    "L12.21 the Super User role is checked before re-authentication",
    /assertSenderPermission\(event, permission, \{ audit: options\.audit \}\)/.test(superUser) && superUser.indexOf("isSuperUser(actor.user)") < superUser.indexOf("requireFreshReauth")
  );
  check("L12.21 a stale re-authentication is audited as a denial", /REAUTH_REQUIRED\) \{\s*await recordDenial\(options\.audit, permission, AuthReason\.REAUTH_REQUIRED, actor, actor\.sessionRef\)/.test(superUser));
  check("L12.21 ...on every audited sensitive channel too", /AuthReason\.REAUTH_REQUIRED\) \{\s*await recordDenial\(options\.audit, permission, AuthReason\.REAUTH_REQUIRED, actor, sessionRef\)/.test(session));
  const runner = readFileSync("src/runner/domIntelligence/repairSuggestion.ts", "utf8");
  check("a run's suggestion stage never reads a protected page (no override there)", !runner.includes("allowProtected") && runner.includes('reason: "protected-surface"'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
