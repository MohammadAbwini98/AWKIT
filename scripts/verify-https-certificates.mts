/**
 * Certificate-trust verifier — "Ignore invalid HTTPS certificates".
 *
 * Part 1 (unit, pure): defaults, persistence normalization, precedence, context-option construction,
 *   a regression guard that the forbidden `--ignore-certificate-errors` launch switch is never present,
 *   error classification, and log-payload safety.
 * Part 2 (integration, live Chromium): a real local HTTPS server with a generated self-signed
 *   certificate, driven through the SAME production code paths the app uses —
 *   `BrowserContextFactory` (persistent / dedicated / shared-pool contexts) and `RecorderService`.
 *   No external website is contacted.
 *
 * Run: npm run verify:https-certificates
 */
import { createHash, X509Certificate } from "node:crypto";
import { createServer, type Server } from "node:https";
import { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createSelfSignedCertificate } from "./lib/selfSignedCertificate.mjs";
import {
  buildBrowserContextOptions,
  certificateErrorCode,
  describeCertificateError,
  explainIgnoreHttpsErrors,
  isCertificateError,
  normalizeRecorderSecuritySettings,
  resolveIgnoreHttpsErrors,
  CERTIFICATE_ERROR_GUIDANCE,
  DEFAULT_IGNORE_HTTPS_ERRORS,
  DEFAULT_RECORDER_SECURITY_SETTINGS
} from "../src/security/browser/CertificateTrust";
import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserContextFactory } from "../src/runner/BrowserContextFactory";
import { SharedBrowserPool } from "../src/runner/browser/SharedBrowserPool";
import { sharedCompatibilityKey } from "../src/runner/browser/BrowserIsolationResolver";
import { RecorderService } from "../src/recorder/RecorderService";
import type { InstanceConfig } from "../src/instances/InstanceConfig";
import type { InstanceExecutionContext } from "../src/runner/InstanceExecutionContext";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

const AUTHORITY_INVALID = "page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://localhost:8443/";
const DATE_INVALID = "page.goto: net::ERR_CERT_DATE_INVALID at https://localhost:8443/";
const NAME_INVALID = "page.goto: net::ERR_CERT_COMMON_NAME_INVALID at https://localhost:8443/";

// ── Part 1: unit checks ──────────────────────────────────────────────────────

function unitChecks(): void {
  console.log("\n[1] Settings model + defaults");
  check("default is false", DEFAULT_IGNORE_HTTPS_ERRORS === false && DEFAULT_RECORDER_SECURITY_SETTINGS.ignoreHttpsErrors === false);
  check("missing stored property resolves to false", normalizeRecorderSecuritySettings(undefined).ignoreHttpsErrors === false);
  check("empty stored group resolves to false", normalizeRecorderSecuritySettings({}).ignoreHttpsErrors === false);
  check("stored true is preserved", normalizeRecorderSecuritySettings({ ignoreHttpsErrors: true }).ignoreHttpsErrors === true);
  // Fail-SAFE: non-boolean junk must never be coerced into an enabled bypass.
  for (const bad of ["true", 1, null, {}, []] as unknown[]) {
    check(
      `non-boolean stored value (${JSON.stringify(bad)}) falls back to false`,
      normalizeRecorderSecuritySettings({ ignoreHttpsErrors: bad }).ignoreHttpsErrors === false
    );
  }

  console.log("\n[2] Precedence: run -> workflow -> app -> false");
  check("no sources at all -> false", resolveIgnoreHttpsErrors() === false && resolveIgnoreHttpsErrors({}) === false);
  check("app only (true)", resolveIgnoreHttpsErrors({ app: { ignoreHttpsErrors: true } }) === true);
  check("app only (false)", resolveIgnoreHttpsErrors({ app: { ignoreHttpsErrors: false } }) === false);
  check(
    "workflow overrides app",
    resolveIgnoreHttpsErrors({ workflow: { ignoreHttpsErrors: false }, app: { ignoreHttpsErrors: true } }) === false &&
      resolveIgnoreHttpsErrors({ workflow: { ignoreHttpsErrors: true }, app: { ignoreHttpsErrors: false } }) === true
  );
  check(
    "workflow undefined inherits app",
    resolveIgnoreHttpsErrors({ workflow: {}, app: { ignoreHttpsErrors: true } }) === true
  );
  check(
    "run overrides workflow and app",
    resolveIgnoreHttpsErrors({ run: false, workflow: { ignoreHttpsErrors: true }, app: { ignoreHttpsErrors: true } }) === false &&
      resolveIgnoreHttpsErrors({ run: true, workflow: { ignoreHttpsErrors: false }, app: { ignoreHttpsErrors: false } }) === true
  );
  check(
    "source attribution",
    explainIgnoreHttpsErrors({ run: true }) === "run" &&
      explainIgnoreHttpsErrors({ workflow: { ignoreHttpsErrors: true } }) === "workflow" &&
      explainIgnoreHttpsErrors({ app: { ignoreHttpsErrors: false } }) === "app" &&
      explainIgnoreHttpsErrors({}) === "default"
  );

  console.log("\n[3] Context-option construction");
  const existing = { acceptDownloads: true, viewport: { width: 1280, height: 720 }, serviceWorkers: "block" as const };
  const on = buildBrowserContextOptions(existing, { ignoreHttpsErrors: true });
  const off = buildBrowserContextOptions(existing, { ignoreHttpsErrors: false });
  check("true maps to ignoreHTTPSErrors: true", on.ignoreHTTPSErrors === true);
  check("false maps to ignoreHTTPSErrors: false", off.ignoreHTTPSErrors === false);
  check(
    "existing options are preserved",
    on.acceptDownloads === true && on.viewport.width === 1280 && on.serviceWorkers === "block"
  );
  check("input object is not mutated", !("ignoreHTTPSErrors" in existing));

  console.log("\n[4] Regression: the forbidden --ignore-certificate-errors launch switch is never present");
  // Certificate trust is CONTEXT-LEVEL ONLY (Playwright `ignoreHTTPSErrors`). The blanket Chromium
  // `--ignore-certificate-errors` switch is a browser-process-wide bypass and must never be added to
  // any AWKIT launch path. This scan FAILS if it is reintroduced anywhere under src/ or app/. The
  // pinned `--ignore-certificate-errors-spki-list=<fingerprint>` used by THIS verifier's own test
  // client (section [10]) is a different, scoped switch and is deliberately excluded by the lookahead
  // — and scripts/ is not scanned here in any case. The leading ["'] anchors the match to an actual
  // string-literal launch arg (how a reintroduction would appear) so it never trips on prose/comments
  // that name the switch in backticks to document that it is forbidden.
  const FORBIDDEN = /["']--ignore-certificate-errors(?!-spki-list)/;
  const here = dirname(fileURLToPath(import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|mjs|js)$/.test(entry.name)) continue;
      if (FORBIDDEN.test(readFileSync(full, "utf8"))) offenders.push(full);
    }
  };
  for (const root of ["src", "app"]) walk(join(here, "..", root));
  check(
    "no --ignore-certificate-errors switch anywhere under src/ or app/",
    offenders.length === 0,
    offenders.length ? `found in: ${offenders.join(", ")}` : "clean"
  );
  // The removed browser-level fallback surface must stay removed — the module exports none of it.
  const certSource = readFileSync(join(here, "..", "src", "security", "browser", "CertificateTrust.ts"), "utf8");
  check(
    "CertificateTrust exposes no launch-arg fallback helper",
    !/applyChromiumCertificateFallbackArgs|CHROMIUM_CERTIFICATE_FALLBACK_ARG|isChromiumCertificateFallbackEnabled/.test(
      certSource
    )
  );

  console.log("\n[5] Shared-pool compatibility key is independent of certificate trust");
  const cfg: InstanceConfig = {
    id: "i", name: "i", browser: "chromium", headless: true,
    isolationMode: "browserContext", timeoutMs: 30_000, viewport: { width: 1280, height: 720 }
  };
  // Certificate trust is a per-context option, so it must NOT appear in the browser-LEVEL pool key: a
  // bypassing and a validating instance with otherwise-identical launch config share one browser.
  check("key is deterministic for identical config", sharedCompatibilityKey(cfg) === sharedCompatibilityKey(cfg));
  check("key carries no certificate marker", !/cert/i.test(sharedCompatibilityKey(cfg)));

  console.log("\n[6] Certificate-error detection + messaging");
  for (const [label, message] of [
    ["ERR_CERT_AUTHORITY_INVALID", AUTHORITY_INVALID],
    ["ERR_CERT_DATE_INVALID", DATE_INVALID],
    ["ERR_CERT_COMMON_NAME_INVALID", NAME_INVALID]
  ] as const) {
    check(`detects ${label}`, isCertificateError(new Error(message)));
  }
  check("extracts the error code", certificateErrorCode(new Error(DATE_INVALID)) === "net::ERR_CERT_DATE_INVALID");
  for (const unrelated of [
    "page.goto: net::ERR_NAME_NOT_RESOLVED at https://nope.invalid/",
    "page.goto: net::ERR_CONNECTION_REFUSED at https://localhost:1/",
    "Timeout 30000ms exceeded."
  ]) {
    check(`does NOT match unrelated failure: ${unrelated.slice(0, 34)}…`, !isCertificateError(new Error(unrelated)));
  }
  const guided = describeCertificateError(new Error(AUTHORITY_INVALID), false);
  check(
    "guidance names the exact Settings path and keeps the original error",
    guided.includes("Settings → Recorder → Security → Ignore invalid HTTPS certificates") &&
      guided.includes("net::ERR_CERT_AUTHORITY_INVALID") &&
      guided.startsWith(CERTIFICATE_ERROR_GUIDANCE.split("\n")[0])
  );
  check(
    "no guidance when the bypass is already enabled",
    describeCertificateError(new Error(AUTHORITY_INVALID), true) === AUTHORITY_INVALID
  );
  check(
    "unrelated navigation errors are never rewritten",
    describeCertificateError(new Error("net::ERR_CONNECTION_REFUSED"), false) === "net::ERR_CONNECTION_REFUSED"
  );

  console.log("\n[7] Log-payload safety");
  // The guidance and the log message are static strings — they must not be able to carry a URL,
  // query string, cookie, or credential from the failing navigation.
  const sensitive = "https://user:pa55w0rd@internal.example/login?access_token=SECRET123&cookie=abc";
  const message = describeCertificateError(new Error(`page.goto: net::ERR_CERT_AUTHORITY_INVALID at ${sensitive}`), false);
  check(
    "guidance text itself contains no credentials/tokens",
    !CERTIFICATE_ERROR_GUIDANCE.includes("SECRET123") && !CERTIFICATE_ERROR_GUIDANCE.includes("pa55w0rd")
  );
  check(
    "the message adds no NEW sensitive data beyond Playwright's own error text",
    message.replace(`page.goto: net::ERR_CERT_AUTHORITY_INVALID at ${sensitive}`, "").indexOf("SECRET123") === -1
  );
}

// ── Part 2: live integration against a local self-signed HTTPS server ────────

function startHttpsServer(options: { expired?: boolean; wrongHost?: boolean }): Promise<{ server: Server; url: string }> {
  const { cert, key } = createSelfSignedCertificate(
    options.expired
      ? { validityDays: -30 }
      : options.wrongHost
        ? { commonName: "not-localhost.invalid", dnsNames: ["not-localhost.invalid"], ipAddresses: [] }
        : {}
  );
  const server = createServer({ cert, key }, (_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>cert-lab</title><h1 id=ok>secure ok</h1>");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `https://localhost:${port}/` });
    });
  });
}

const closeServer = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

function makeExecutionContext(root: string): InstanceExecutionContext {
  return {
    executionId: "cert-exec", instanceId: "cert-instance", scenarioId: "cert-workflow",
    instanceOrderNumber: 1, totalInstances: 1, runtimeInputs: {}, instanceInputs: {}, flowOutputs: {},
    paths: {
      downloads: join(root, "downloads"), screenshots: join(root, "screenshots"),
      logs: join(root, "logs"), reports: join(root, "reports")
    }
  };
}

function makeInstanceConfig(overrides: Partial<InstanceConfig> = {}): InstanceConfig {
  return {
    id: "cert-instance", name: "cert-instance", browser: "chromium", headless: true,
    isolationMode: "browserContext", timeoutMs: 30_000, viewport: { width: 1280, height: 720 },
    ...overrides
  };
}

/** Navigate and report the outcome without letting a failure escape. */
async function tryGoto(page: { goto: (url: string) => Promise<unknown> }, url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await page.goto(url);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function integrationChecks(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "awkit-cert-"));
  const resourcesRoot = join(process.cwd(), "resources");
  const context = makeExecutionContext(root);
  const invalid = await startHttpsServer({});

  try {
    console.log("\n[8] Runtime contexts — dedicated browser (BrowserContextFactory)");
    for (const ignoreHttpsErrors of [false, true]) {
      const factory = new BrowserContextFactory({ productionOffline: false, resourcesRoot, ignoreHttpsErrors });
      const runtime = await factory.create(makeInstanceConfig(), context);
      const page = await runtime.context.newPage();
      const outcome = await tryGoto(page, invalid.url);
      await runtime.close();
      if (ignoreHttpsErrors) {
        check("bypass ENABLED -> navigation succeeds on an invalid certificate", outcome.ok, outcome.error);
      } else {
        check(
          "bypass DISABLED -> navigation fails with a certificate error",
          !outcome.ok && isCertificateError(new Error(outcome.error ?? "")),
          outcome.error?.split("\n")[0]
        );
      }
    }

    console.log("\n[9] Runtime contexts — persistent context (captured session / Reuse Session path)");
    for (const ignoreHttpsErrors of [false, true]) {
      const userDataDir = join(root, `persistent-${ignoreHttpsErrors}`);
      const factory = new BrowserContextFactory({ productionOffline: false, resourcesRoot, ignoreHttpsErrors });
      const runtime = await factory.create(
        makeInstanceConfig({ isolationMode: "persistentContext", userDataDir, headless: true }),
        context
      );
      const page = runtime.context.pages()[0] ?? (await runtime.context.newPage());
      const outcome = await tryGoto(page, invalid.url);
      await runtime.close();
      check(
        `launchPersistentContext honours the option (ignoreHttpsErrors=${ignoreHttpsErrors})`,
        outcome.ok === ignoreHttpsErrors,
        outcome.error?.split("\n")[0]
      );
    }

    console.log("\n[10] Parallel isolated contexts on a SHARED browser");
    {
      const pool = new SharedBrowserPool({
        maxBrowsers: 2,
        maxContextsPerBrowser: 4,
        maxContextsPerBrowserHardLimit: 8,
        recycleAfterContexts: 100
      });
      const factory = new BrowserContextFactory({
        productionOffline: false, resourcesRoot, ignoreHttpsErrors: true, sharedBrowserPool: pool
      });
      const runtimes = await Promise.all([
        factory.create(makeInstanceConfig({ id: "a" }), context),
        factory.create(makeInstanceConfig({ id: "b" }), context),
        factory.create(makeInstanceConfig({ id: "c" }), context)
      ]);
      const outcomes = await Promise.all(
        runtimes.map(async (runtime) => tryGoto(await runtime.context.newPage(), invalid.url))
      );
      const browsers = pool.snapshot().totalBrowsers;
      await Promise.all(runtimes.map((runtime) => runtime.close()));
      await pool.closeAll();
      check(
        "every parallel isolated context receives the same effective setting",
        outcomes.every((outcome) => outcome.ok),
        `succeeded=${outcomes.filter((o) => o.ok).length}/3 sharedBrowsers=${browsers}`
      );
    }

    console.log("\n[11] Recorder — initial launch (RecorderService)");
    for (const ignoreHttpsErrors of [false, true]) {
      const recorder = new RecorderService();
      recorder.configureDraftStorage(join(root, `recorder-draft-${ignoreHttpsErrors}.json`));
      recorder.configureUrlStorage(join(root, `recorder-urls-${ignoreHttpsErrors}.json`));
      let error: string | undefined;
      try {
        await recorder.startRecording(invalid.url, { ignoreHttpsErrors, captureSmartWaits: false });
      } catch (thrown) {
        error = thrown instanceof Error ? thrown.message : String(thrown);
      }
      const status = recorder.getStatus();
      if (ignoreHttpsErrors) {
        check("Recorder starts on an invalid certificate when enabled", error === undefined && status.isRecording, error?.split("\n")[0]);
        check("Recorder status exposes the live bypass state", status.ignoreHttpsErrors === true);
        await recorder.cancelRecording();
      } else {
        check(
          "Recorder fails with the actionable certificate message when disabled",
          error !== undefined && error.includes("Settings → Recorder → Security → Ignore invalid HTTPS certificates"),
          error?.split("\n")[0]
        );
        check("Recorder is not left 'in progress' after the failure", status.isRecording === false);
      }
    }

    console.log("\n[12] Expired + wrong-host certificates");
    for (const [label, opts] of [["expired", { expired: true }], ["wrong host", { wrongHost: true }]] as const) {
      const server = await startHttpsServer(opts);
      try {
        const strict = new BrowserContextFactory({ productionOffline: false, resourcesRoot, ignoreHttpsErrors: false });
        const strictRuntime = await strict.create(makeInstanceConfig(), context);
        const strictOutcome = await tryGoto(await strictRuntime.context.newPage(), server.url);
        await strictRuntime.close();

        const lax = new BrowserContextFactory({ productionOffline: false, resourcesRoot, ignoreHttpsErrors: true });
        const laxRuntime = await lax.create(makeInstanceConfig(), context);
        const laxOutcome = await tryGoto(await laxRuntime.context.newPage(), server.url);
        await laxRuntime.close();

        check(
          `${label} certificate: rejected when disabled, accepted when enabled`,
          !strictOutcome.ok && isCertificateError(new Error(strictOutcome.error ?? "")) && laxOutcome.ok,
          `strict=${strictOutcome.error?.split("\n")[0]} lax=${laxOutcome.ok}`
        );
      } finally {
        await closeServer(server.server);
      }
    }

    console.log("\n[13] VALID certificate is unaffected by the setting");
    {
      // Trust the generated CA for this browser only (the cert is its own issuer), so the server is a
      // genuinely TRUSTED origin — proving the setting changes nothing when validation already passes.
      const trusted = createSelfSignedCertificate({});
      const server = createServer({ cert: trusted.cert, key: trusted.key }, (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><title>trusted</title><h1 id=ok>trusted ok</h1>");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const { port } = server.address() as AddressInfo;
      const url = `https://localhost:${port}/`;
      try {
        for (const ignoreHttpsErrors of [false, true]) {
          const browser = await chromium.launch({
            headless: true,
            // Trust anchor injected at the BROWSER level for this check only; the production factory
            // never does this. It makes the origin genuinely valid rather than merely tolerated.
            args: [`--ignore-certificate-errors-spki-list=${spkiFingerprint(trusted.cert)}`]
          });
          const ctx = await browser.newContext(buildBrowserContextOptions({}, { ignoreHttpsErrors }));
          const outcome = await tryGoto(await ctx.newPage(), url);
          await ctx.close();
          await browser.close();
          check(`valid certificate navigates successfully (ignoreHttpsErrors=${ignoreHttpsErrors})`, outcome.ok, outcome.error?.split("\n")[0]);
        }
      } finally {
        await closeServer(server);
      }
    }
  } finally {
    await closeServer(invalid.server);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Base64 SHA-256 of the certificate's SubjectPublicKeyInfo (Chromium's SPKI allow-list format). */
function spkiFingerprint(certPem: string): string {
  const spki = new X509Certificate(certPem).publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return createHash("sha256").update(spki).digest("base64");
}

async function main(): Promise<void> {
  console.log("HTTPS certificate trust verifier");
  unitChecks();
  await integrationChecks();

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nHTTPS certificate trust: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
