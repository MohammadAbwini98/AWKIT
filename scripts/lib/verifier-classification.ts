/**
 * Verifier classification registry (SRS-BAO-001 FR-I1, Tranche 0 — Reporting truthfulness).
 *
 * FR-I1 requires every `verify:*` / `validate:*` npm script to declare its class from a fixed
 * taxonomy, so a summary can report counts PER CLASS instead of one undifferentiated total, and so
 * a structural check is never quietly counted as runtime validation (I1.5). This registry is the
 * single source of truth for those classes; `scripts/verify-verifier-classification.mts` reconciles
 * it against `package.json` and fails if any script is unclassified or any entry is stale (I1.1).
 *
 * Class basis (what the script actually EXERCISES — the honest signal, taken from each verifier's
 * own header, not its name):
 *   - documentation-consistency : asserts docs/spec text agrees with code/config (e.g. the
 *                                 clean-machine validation policy docs vs the canonical policy source).
 *   - static-source-validation  : parses SOURCE / packaging inputs; the feature is never executed.
 *   - unit                      : runs a unit of production logic in-process with fakes; no
 *                                 persistence, no subprocess, no browser.
 *   - integration               : real subsystems together in-process — a real SQLite/sql.js file,
 *                                 a real Java bridge subprocess, real fs locks/atomic writes, or a
 *                                 live external DB — but no browser/Electron.
 *   - real-browser              : launches a real Chromium context or the built Electron app.
 *   - packaged-application      : drives the BUILT/packaged artifact or the offline dependency bundle.
 *   - clean-machine-acceptance  : the offline clean-machine runbook. (Manual; no npm script today.)
 *
 * This is a first-pass classification grounded in each verifier's header. The deeper FR-I1 audit —
 * proving each verifier can actually FAIL for the reason it claims (I1.4) and back-filling a
 * "what regression makes this fail?" line into every file header (I1.2) — is tracked separately and
 * is NOT asserted here. This module only fixes the count truthfulness (per-class totals).
 */

export const VERIFIER_CLASSES = [
  "documentation-consistency",
  "static-source-validation",
  "unit",
  "integration",
  "real-browser",
  "packaged-application",
  "clean-machine-acceptance"
] as const;

export type VerifierClass = (typeof VERIFIER_CLASSES)[number];

export interface VerifierClassification {
  class: VerifierClass;
  /** What the script actually exercises — the basis for its class. */
  why: string;
}

/**
 * Keyed by the exact npm script name (as it appears in `package.json`, colons and all).
 * Every `verify:*` / `validate:*` script MUST appear here; the reconciler enforces it.
 */
export const VERIFIER_CLASSIFICATION: Record<string, VerifierClassification> = {
  // ── Real browser (real Chromium or the built Electron app) ─────────────────────────────────
  "verify:runner": { class: "real-browser", why: "Drives the real PlaywrightRunner + Chromium against the spawned mock site." },
  "verify:mock-site": { class: "real-browser", why: "Starts the mock site and checks pages/selectors via a real browser context." },
  "verify:flow-designer": { class: "real-browser", why: "Launches the built Electron app and drives the Flow Designer canvas." },
  "verify:workflow-builder": { class: "real-browser", why: "Launches the built Electron app and drives the Workflow Builder canvas." },
  "verify:canvas-perf": { class: "real-browser", why: "Real-Electron render-count regression probe on a seeded canvas." },
  "verify:auth-gui": { class: "real-browser", why: "Real-Electron walkthrough of the SecurityGate sign-in UI." },
  "verify:settings-persistence": { class: "real-browser", why: "Integration checks in the REAL built Electron app (concurrent settings writes)." },
  "verify:single-instance": { class: "real-browser", why: "Two real Electron processes racing on the shared per-user store." },
  "verify:reports": { class: "real-browser", why: "Launches the built Electron app and smokes the Reports page." },
  "verify:recorder": { class: "real-browser", why: "Records inside a real Chromium page and asserts unique semantic locators." },
  "verify:waits": { class: "real-browser", why: "Live Smart Wait checks against real Chromium." },
  "verify:concurrency": { class: "real-browser", why: "BrowserContextFactory profile-lock + cleanup with real Chromium." },
  "verify:capacity-settings-gui": { class: "real-browser", why: "Real-Electron check of the Runtime Concurrency settings UI." },
  "verify:shared-browser-live": { class: "real-browser", why: "Counts real Chromium OS processes for the shared pool." },
  "verify:lean-mode": { class: "real-browser", why: "Live A9 resource-routing against real Chromium." },
  "verify:artifacts": { class: "real-browser", why: "Live Chromium: JSONL logs, failure trace zips, failure screenshots." },
  "verify:runtime-analytics-gui": { class: "real-browser", why: "Real-Electron walkthrough of the Runtime Analytics page across seeded DBs." },
  "verify:cancellation": { class: "real-browser", why: "Hard-cancellation against live Chromium (local only)." },
  "verify:dynamic-origin-claims": { class: "real-browser", why: "Pure tracker checks PLUS a live StepExecutor/Chromium part." },
  "verify:protected-login-recorder": { class: "real-browser", why: "Pure detection PLUS a live recorder/Chromium + mock-site part." },
  "verify:instance-monitor-gui": { class: "real-browser", why: "Real-Electron walkthrough of Instance Monitor summaries + bulk stop." },
  "verify:popup": { class: "real-browser", why: "Headless real Playwright/Chromium context (no Electron)." },
  "verify:popup-mock-site": { class: "real-browser", why: "Popup handling against real Chromium + the mock site." },
  "verify:chromium-hardening": { class: "real-browser", why: "Arg-contract unit part PLUS a live Chromium no-egress check." },
  "verify:admin-gui": { class: "real-browser", why: "Real-Electron walkthrough of the Super User Administration area." },
  "verify:e2e-auth": { class: "real-browser", why: "Authentication lifecycle against the REAL Electron app." },
  "verify:e2e-rbac": { class: "real-browser", why: "Per-role authorization in the REAL Electron app." },
  "verify:e2e-licensing": { class: "real-browser", why: "Licensing page + run-enforcement gate in the REAL Electron app." },
  "verify:e2e-sweep": { class: "real-browser", why: "Full route sweep of the REAL Electron app." },
  "verify:e2e-reauth": { class: "real-browser", why: "Live ReauthDialog re-auth flow in the REAL Electron app." },
  "verify:oracle-drivers-gui": { class: "real-browser", why: "Real-Electron walkthrough of Settings › Database Drivers." },
  "verify:durable-accuracy": { class: "real-browser", why: "Launches the real ExecutionEngine benchmarks (real Chromium) for durable-store accuracy." },
  "verify:accent-gui": { class: "real-browser", why: "Real-Electron walkthrough of Appearance › Accent Color (solid/gradient/preset/reset + login pre-mount bootstrap)." },
  "verify:https-certificates": { class: "real-browser", why: "Cert-policy precedence unit part PLUS live Chromium navigation against real self-signed / expired / wrong-host HTTPS servers." },
  "verify:https-certificates-gui": { class: "real-browser", why: "Real-Electron walkthrough of Settings › Recorder Security (Ignore invalid HTTPS certificates)." },
  "verify:branding-gui": { class: "real-browser", why: "Real-Electron walkthrough of the Workspace Logo card + sidebar/login custom-logo rendering." },
  "verify:failure-evidence-live": { class: "real-browser", why: "Real Chromium + local HTTP server: FR-B2 evidence files are written, safely named, path-confined, and secret-masked; page-identity + dead-page paths." },

  // ── Integration (real SQLite/sql.js, real Java bridge, real fs locks/atomic writes, live DB) ──
  "verify:durable-store": { class: "integration", why: "Real SQLite file on disk; migrations + persistence across store restart." },
  "verify:durable-locks": { class: "integration", why: "Durable SQLite-backed lock lifecycle." },
  "verify:startup-recovery": { class: "integration", why: "Temp SQLite files; exercises the real runStartupRecovery." },
  "verify:telemetry": { class: "integration", why: "Reporting read-model v1→v4 in-place store migration + samples." },
  "verify:soak:runtime": { class: "integration", why: "Durable runtime store soak at volume (real store, no browser)." },
  "verify:stress:locks": { class: "integration", why: "Lock stress over the real lock/fs machinery." },
  "verify:stress:artifacts": { class: "integration", why: "Artifact stress writing real artifact files." },
  "verify:locks": { class: "integration", why: "Real lock manager + real BrowserContextFactory lock path + fs (no browser launched)." },
  "verify:profile-store": { class: "integration", why: "Real atomic fs writes / corrupt-quarantine / id-rename in a temp dir." },
  "verify:machine-profile": { class: "integration", why: "Machine-profile atomic fs round-trip + recalibration on hardware change." },
  "verify:oracle-bridge": { class: "integration", why: "Builds the real Java bridge core and checks its contract." },
  "verify:oracle-bridge-real-build": { class: "integration", why: "Real direct-JDBC executor build + class load." },
  "verify:oracle-sql-policy": { class: "integration", why: "TS mirror vs the AUTHORITATIVE Java policy via a real bridge process." },
  "verify:oracle-lazy-resolution": { class: "integration", why: "Lazy data-source semantics driven by the REAL Java bridge." },
  "verify:oracle-runtime-prep": { class: "integration", why: "Bridge-bundle preparation against real bridge artifacts." },
  "verify:oracle-runtime": { class: "integration", why: "Drives the real Java mock bridge through OracleQueryService (no DB)." },
  "verify:oracle-java-runtime": { class: "integration", why: "Real bridge launch using the user-selected Java (no DB)." },
  "verify:oracle-direct-jdbc": { class: "integration", why: "Drives the real Java mock bridge, one connection per query." },
  "verify:oracle-live": { class: "integration", why: "Credential-gated validation against a REAL Oracle database." },
  "verify:branding": { class: "integration", why: "Real BrandingLogoStore atomic publish/rollback + sha256 re-verify + corrupt/missing fallback on a temp dir; no browser." },
  "verify:custom-brand-logo": { class: "integration", why: "Real BrandingLogoStore + BrandingValidation on a temp dir (signature/dimension/atomic/rollback/hash) mapped to the acceptance cases, plus structural source assertions; no browser." },

  // ── Unit (pure in-process logic with fakes; no persistence/subprocess/browser) ───────────────
  "verify:canvas-layout": { class: "unit", why: "Pure graph-layout geometry over the real layout functions." },
  "verify:branch-pairs": { class: "unit", why: "Pure branch-pair reconciliation over the real shared module." },
  "verify:accent-theme": { class: "unit", why: "Pure accent-color model: hex normalize/migrate, light/dark token derivation, WCAG foreground pick, gradient stops. No fs/browser." },
  "verify:failure-screenshot-precedence": { class: "unit", why: "Pure precedence check over the real FlowExecutor gate (stub StepExecutor)." },
  "verify:failure-evidence": { class: "unit", why: "Per-attempt failure-evidence ordering/accumulation (FR-B2) over the real FlowExecutor.executeWithRetry with a stub StepExecutor; no browser." },
  "verify:avatar": { class: "unit", why: "Pure initials/palette derivation." },
  "verify:licensing": { class: "unit", why: "Pure licensing domain + RBAC (no packaged app)." },
  "verify:write-queue": { class: "unit", why: "Deterministic serial write-queue logic." },
  "verify:security": { class: "unit", why: "Pure security logic; no Electron/Chromium." },
  "verify:auth": { class: "unit", why: "Trusted-core auth logic, headless." },
  "verify:secrets": { class: "unit", why: "Secret-store hardening with a fake crypto backend." },
  "verify:workflow-sentinels": { class: "unit", why: "Pure Start/End sentinel + workflow→scenario conversion logic." },
  "verify:async-review": { class: "unit", why: "Pure async completion review/classification." },
  "verify:flow-step-mapping": { class: "unit", why: "Pure model↔node-data round-trip converters." },
  "verify:machine-capabilities": { class: "unit", why: "Pure capability detection; no real host assumptions." },
  "verify:capacity-planner": { class: "unit", why: "Pure capacity planning." },
  "verify:capacity-modes": { class: "unit", why: "Pure mode→limits resolver." },
  "verify:concurrency-defaults": { class: "unit", why: "Pure concurrency default resolution." },
  "verify:browser-pool": { class: "unit", why: "Deterministic pool logic with fake runtimes." },
  "verify:shared-browser-pool": { class: "unit", why: "Shared-pool grouping logic with fake runtimes." },
  "verify:browser-isolation": { class: "unit", why: "Pure isolation resolver + compatibility-key logic." },
  "verify:operation-limiters": { class: "unit", why: "Pure operation-limiter logic." },
  "verify:adaptive-concurrency": { class: "unit", why: "Adaptive ceiling logic with an injected clock." },
  "verify:workload-weights": { class: "unit", why: "Pure weighted-admission / confidence logic." },
  "verify:resource-routing": { class: "unit", why: "Pure artifact-profile → trace/screenshot/video mapping." },
  "verify:browser-resource-profile": { class: "unit", why: "Pure resource-profile resolution." },
  "verify:benchmark-planner": { class: "unit", why: "Pure machine-relative benchmark planner." },
  "verify:watchdog": { class: "unit", why: "Deterministic watchdog logic with fake instance views." },
  "verify:runtime-status": { class: "unit", why: "Pure runtime-status aggregation." },
  "verify:observability": { class: "unit", why: "Pure observability aggregation/anomaly logic." },
  "verify:safety-policy": { class: "unit", why: "Pure step-safety metadata classification." },
  "verify:resource-sampling": { class: "unit", why: "Pure resource-sampling logic." },
  "verify:recorder-draft": { class: "unit", why: "Recorder action-draft + saved-URL logic; no browser." },
  "verify:recorder-flow": { class: "unit", why: "Pure buildRecordedFlow logic; no browser, no I/O." },
  "verify:protected-login": { class: "unit", why: "Pure protected-login detector core." },
  "verify:data-editor": { class: "unit", why: "Data-source editor logic (small file round-trip is incidental)." },
  "verify:instance-monitor": { class: "unit", why: "Pure non-DOM Instance-Monitor card logic." },
  "verify:oracle-profiles": { class: "unit", why: "In-memory Oracle profile store + credentials." },
  "verify:oracle-data-source": { class: "unit", why: "Oracle data-source model/resolution; no Java, no DB." },
  "verify:oracle-driver-bundle": { class: "unit", why: "Driver-bundle store logic with a STUB bridge probe." },
  "verify:authz": { class: "unit", why: "RBAC + Super-User admin logic, headless." },
  "verify:session-context": { class: "unit", why: "Browser-free sender-bound session-registry checks." },
  "verify:stress:concurrency": { class: "unit", why: "Concurrency stress over pure logic with fake runtimes." },
  "verify:stress:cancellation": { class: "unit", why: "Cancellation stress over pure logic with fake runtimes." },

  // ── Documentation consistency (asserts docs/spec text agrees with code/config) ────────────────
  "verify:clean-machine-policy": { class: "documentation-consistency", why: "Asserts the clean-machine validation policy docs agree with the canonical policy source (blocking matrix + wording), protected gates stay mandatory, and historical NOT EXECUTED evidence is unchanged." },

  // ── Static source validation (parses source / packaging inputs; feature not executed) ────────
  "verify:verifier-classification": { class: "static-source-validation", why: "Reconciles this registry against package.json and reports per-class verifier counts (FR-I1)." },
  "verify:ipc-contract": { class: "static-source-validation", why: "Statically parses app/main/ipc + preload for channel-contract drift." },
  "verify:oracle-offline-bundle": { class: "static-source-validation", why: "Audits Oracle offline-bundle integrity over fixtures (no packaged app run)." },
  "verify:oracle-packaging": { class: "static-source-validation", why: "Checks Oracle packaging + path-resolution config." },

  // ── Packaged application (drives the built artifact or the offline dependency bundle) ─────────
  "verify:packaged-runtime": { class: "packaged-application", why: "Smoke of the packaged app runtime." },
  "verify:packaged-walkthrough": { class: "packaged-application", why: "Packaged clean-profile release-candidate walkthrough." },
  "validate:offline": { class: "packaged-application", why: "Validates the offline dependency bundle (sql-wasm, resources, manifest)." }
};
