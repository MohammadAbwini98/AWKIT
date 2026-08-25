/**
 * Real-Electron proof that the License Issuer page reports the signing key TRUTHFULLY (`awkit-uwfo`).
 *
 * The defect this exists to catch: the page said "Signing key: Unavailable — the external signing key
 * was not found on this issuer workstation" and gave the operator nowhere to look and no way to tell
 * "provision a key" from "fix this file" from "this build does not trust that key id". Source tests
 * can prove the service classifies correctly; only the running app can prove the page RENDERS it.
 *
 * Two launches, both on an ISOLATED, empty `%LOCALAPPDATA%` so the developer's real profile is never
 * touched and first-run always applies:
 *
 *   1. NO key anywhere        → MISSING, and the page must NAME the expected provisioning location.
 *   2. `SPECTER_ISSUER_KEY` → the authorized key on this workstation → READY.
 *
 * Launch 2 needs authorized signing material. Where none exists this verifier reports the case as
 * **BLOCKED** and says so in the summary — it is never silently skipped and never counted as a pass.
 * Nothing here signs a licence: it reads readiness only, so no production key is ever used to issue.
 *
 * Run after `npm run build`: `npm run verify:issuer-readiness-gui`
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import {
  isolatedLaunchEnv,
  resolveMainWindow,
  signInFirstRun
// @ts-expect-error Shared GUI helper is intentionally plain ESM JavaScript.
} from "./lib/gui-verify-harness.mjs";
import {
  createUser,
  genPassword,
  loginAs,
  navClick,
  signOut,
  submitForcedChange
// @ts-expect-error Shared E2E helper is intentionally plain ESM JavaScript.
} from "./lib/e2e-qa-lib.mjs";
import {
  DEFAULT_ISSUER_KEY_ID,
  ISSUER_KEY_PATH_ENV,
  nonElectronRuntimeRoot,
  resolveIssuerKeyLocation
} from "../src/licensing/issuer/IssuerLocations";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const results: { name: string; pass: boolean; detail?: string }[] = [];
const blocked: string[] = [];
function check(name: string, pass: unknown, detail?: string): void {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function block(name: string, why: string): void {
  blocked.push(`${name} — ${why}`);
  console.log(`  ⊘ BLOCKED ${name} — ${why}`);
}

const issuer = { username: "keyissuer", temporary: genPassword("IssuerTemp"), final: genPassword("IssuerFinal") };

/**
 * The base64 of the PKCS8-Ed25519 DER header that begins every one of these private keys.
 *
 * Split and rejoined for the same reason `verify:roadmap-license-issuer` does it: that verifier scans
 * the whole repository for this exact needle, and a file containing it literally would be reported as
 * committed key material. Writing the detector as one string made the scan fail on this file.
 */
const PKCS8_ED25519_B64_PREFIX = ["MC4CAQAw", "BQYDK2Vw"].join("");

/**
 * Does rendered page text carry PRIVATE key bytes?
 *
 * Deliberately not a search for "pkcs8": the page legitimately shows the key FILE NAME
 * (`key2.ed25519.pkcs8.b64`) so the operator knows what to provision, and a substring test would
 * confuse naming a file with disclosing its contents.
 */
function carriesKeyMaterial(text: string, exactMaterial?: string): boolean {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return true;
  if (text.includes(PKCS8_ED25519_B64_PREFIX)) return true;
  return exactMaterial !== undefined && exactMaterial.length > 0 && text.includes(exactMaterial);
}

/**
 * What the Signing readiness card and the summary metric actually say, read from the live DOM.
 *
 * Everything inside `evaluate` is written as inline expressions rather than named helper consts:
 * `tsx` compiles this file with esbuild's keep-names transform, which wraps a named function in a
 * `__name(...)` call that does not exist in the page and throws `__name is not defined`.
 */
async function readIssuerPanel(win: Page) {
  const raw = await win.evaluate(() => {
    const readinessCard = [...document.querySelectorAll(".settings-card.awkit-admin-card")].find((node) =>
      (node.querySelector("h2")?.textContent ?? "").includes("Signing readiness")
    );
    const issueButton = [...document.querySelectorAll("button")].find((node) =>
      (node.textContent ?? "").includes("Issue and save license")
    ) as HTMLButtonElement | undefined;
    return {
      metric:
        ([...document.querySelectorAll(".awkit-admin-metric-card")].find((node) =>
          (node.textContent ?? "").trim().startsWith("Signing key")
        )?.textContent ?? "").trim(),
      badge: (readinessCard?.querySelector(".awkit-admin-badge")?.textContent ?? "").trim(),
      fields: [...document.querySelectorAll(".awkit-license-field")].map((node) => [
        (node.querySelector(".awkit-admin-muted")?.textContent ?? "").trim(),
        (node.querySelector("span:last-child")?.textContent ?? "").trim()
      ]),
      warnings: [...document.querySelectorAll(".form-message.warn")].map((node) => (node.textContent ?? "").trim()),
      issueDisabled: issueButton ? issueButton.disabled : null,
      issueTitle: issueButton?.getAttribute("title") ?? null,
      requestPickerPresent: [...document.querySelectorAll("button")].some((node) =>
        (node.textContent ?? "").includes("Select activation request")
      ),
      bodyText: (document.querySelector(".awkit-admin-page")?.textContent ?? "").trim()
    };
  });
  const fields = new Map(raw.fields as Array<[string, string]>);
  return {
    ...raw,
    keyId: fields.get("Signing key") ?? "",
    state: fields.get("Readiness") ?? "",
    expectedKeyLocation: fields.get("Expected key location") ?? "",
    outputFolder: fields.get("Output folder") ?? ""
  };
}

/** First-run → create the exclusive Issuer account → sign in as it → open the License Issuer page. */
async function openIssuerConsole(win: Page): Promise<void> {
  await signInFirstRun(win);
  await navClick(win, "Users");
  await win.getByRole("heading", { name: "Add a user" }).first().waitFor({ timeout: 15000 });
  await createUser(win, { username: issuer.username, password: issuer.temporary, roles: ["Issuer"] });
  await signOut(win);
  await loginAs(win, issuer.username, issuer.temporary);
  await win.getByRole("heading", { name: "Update your password" }).waitFor({ timeout: 20000 });
  await submitForcedChange(win, issuer.temporary, issuer.final);
  await win.waitForSelector(".app-shell", { timeout: 25000 });
  await navClick(win, "License Issuer");
  await win.getByRole("heading", { name: "Signing readiness" }).first().waitFor({ timeout: 15000 });
}

async function launch(label: string, extraEnv: Record<string, string> = {}) {
  const { env, cleanup } = isolatedLaunchEnv(label, extraEnv);
  const app: ElectronApplication = await electron.launch({ args: [path.join(root, "out", "main", "main.js")], env });
  return { app, cleanup };
}

// ── 1. No authorized key: the page must say MISSING and name where to put one ────────────────────
console.log("\nLicense Issuer with no signing key on the profile:");
{
  const { app, cleanup } = await launch("awkit-issuer-missing");
  try {
    const win = await resolveMainWindow(app);
    await win.waitForLoadState("domcontentloaded");
    await openIssuerConsole(win);
    const panel = await readIssuerPanel(win);

    check("the summary metric reports the key is not provisioned", panel.metric.includes("Not provisioned"), panel.metric);
    check("the readiness badge says the key is missing", panel.badge === "Key missing", panel.badge);
    check("the readiness state renders as MISSING", panel.state === "MISSING", panel.state);
    check("the active signing key id is shown", panel.keyId === DEFAULT_ISSUER_KEY_ID, panel.keyId);
    check(
      "the page NAMES the expected secure provisioning location",
      panel.expectedKeyLocation.includes("issuer-keys") && panel.expectedKeyLocation.includes(DEFAULT_ISSUER_KEY_ID),
      panel.expectedKeyLocation
    );
    check(
      "that location is redacted to a profile variable, not a raw account path",
      panel.expectedKeyLocation.startsWith("%LOCALAPPDATA%"),
      panel.expectedKeyLocation
    );
    check(
      "the operator is told the key was not found and must provision it",
      panel.warnings.some((warning) => warning.includes("was not found on this issuer workstation")),
      panel.warnings.join(" | ")
    );
    check("issuance is blocked", panel.issueDisabled === true);
    check(
      "the blocked reason names the signing key, not the activation request",
      (panel.issueTitle ?? "").includes("Signing key: Key missing"),
      String(panel.issueTitle)
    );
    check(
      "loading an activation request stays available while the key is missing",
      panel.requestPickerPresent,
      "reviewing which machine a request came from must not depend on the key"
    );
    check("no key material is rendered anywhere on the page", !carriesKeyMaterial(panel.bodyText));
  } finally {
    await app.close().catch(() => undefined);
    cleanup();
  }
}

// ── 2. The authorized key present: the page must detect it and say READY ────────────────────────
console.log("\nLicense Issuer with the authorized signing key present:");
const workstationKey = resolveIssuerKeyLocation({
  runtimeRoot: nonElectronRuntimeRoot(),
  keyId: DEFAULT_ISSUER_KEY_ID
});
const keyAvailable = workstationKey.keyPath.length > 0 && existsSync(workstationKey.keyPath);

if (!keyAvailable) {
  block(
    "the UI reports READY against the authorized key",
    `no authorized signing key at ${workstationKey.displayPath || "the resolved location"} and ` +
      `${ISSUER_KEY_PATH_ENV} is unset on this workstation. Provision the key there and re-run; ` +
      `nothing here may generate a substitute.`
  );
} else {
  const { app, cleanup } = await launch("awkit-issuer-ready", { [ISSUER_KEY_PATH_ENV]: workstationKey.keyPath });
  try {
    const win = await resolveMainWindow(app);
    await win.waitForLoadState("domcontentloaded");
    await openIssuerConsole(win);
    const panel = await readIssuerPanel(win);

    check("the summary metric reports the key is Ready", panel.metric.includes("Ready"), panel.metric);
    check("the readiness badge says Ready", panel.badge === "Ready", panel.badge);
    check("the readiness state renders as READY", panel.state === "READY", panel.state);
    check("the active signing key id is shown", panel.keyId === DEFAULT_ISSUER_KEY_ID, panel.keyId);
    check("no refusal message is shown for the key", !panel.warnings.some((w) => w.includes("signing key")), panel.warnings.join(" | "));
    check(
      "the confined output folder is named",
      panel.outputFolder.includes("issuer-output"),
      panel.outputFolder
    );
    check(
      "issuance is still blocked until an activation request is loaded",
      panel.issueDisabled === true && (panel.issueTitle ?? "").includes("Load an activation request"),
      String(panel.issueTitle)
    );
    // The strongest form available: the REAL key bytes, compared against what the page rendered.
    // Read here and never printed — no assertion, log line or detail string carries the value.
    check(
      "the page never renders the real key material it just validated",
      !carriesKeyMaterial(panel.bodyText, readFileSync(workstationKey.keyPath, "utf8").trim())
    );

    // The page action must re-ask the main process, not repaint a cached verdict.
    const refresh = win.getByRole("button", { name: "Check signing key" });
    check("the page exposes a live re-check of the signing key", (await refresh.count()) === 1);
    if ((await refresh.count()) === 1) {
      await refresh.click();
      await win.waitForTimeout(600);
      const rechecked = await readIssuerPanel(win);
      check("re-checking keeps the state at READY", rechecked.state === "READY", rechecked.state);
    }
  } finally {
    await app.close().catch(() => undefined);
    cleanup();
  }
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nLicense Issuer readiness GUI: ${passed}/${results.length} checks passed, ${blocked.length} BLOCKED`);
for (const entry of blocked) console.log(`  BLOCKED: ${entry}`);
process.exit(passed === results.length ? 0 : 1);
