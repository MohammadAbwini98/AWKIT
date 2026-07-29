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
  "verify:comprehensive-e2e": { class: "real-browser", why: "Loads persisted comprehensive fixtures and drives their safe browser, workflow, popup, I/O, manual-handoff, retry, and recovery paths against the local mock site." },
  "verify:oracle-mock-ui-workflow": { class: "real-browser", why: "Runs a persisted Oracle Data Source and row-driven workflow through the real Java mock bridge, OracleQueryService, PlaywrightRunner, and real Chromium against the local form." },
  "verify:mock-site": { class: "real-browser", why: "Starts the mock site and checks pages/selectors via a real browser context." },
  "verify:flow-designer": { class: "real-browser", why: "Launches the built Electron app and drives the Flow Designer canvas." },
  "verify:workflow-builder": { class: "real-browser", why: "Launches the built Electron app and drives the Workflow Builder canvas." },
  "verify:canvas-perf": { class: "real-browser", why: "Real-Electron render-count regression probe on a seeded canvas." },
  "verify:auth-gui": { class: "real-browser", why: "Real-Electron walkthrough of the SecurityGate sign-in UI." },
  "verify:settings-persistence": { class: "real-browser", why: "Integration checks in the REAL built Electron app (concurrent settings writes)." },
  "verify:single-instance": { class: "real-browser", why: "Two real Electron processes racing on the shared per-user store." },
  "verify:reports": { class: "real-browser", why: "Launches the built Electron app and smokes the Reports page." },
  "verify:reports-populated-gui": { class: "real-browser", why: "Seeds durable history, then drives the REAL Reports pages and asserts values against independently computed truth." },
  "verify:reports-settings-a11y": { class: "real-browser", why: "Real-Electron accessibility audit of Reports and Settings (keyboard, focus ring, names, live regions, zoom, reduced motion)." },
  "verify:reports-live-engine": { class: "real-browser", why: "SYS-REP-007 + SYS-REP-011 — launches the built Electron app on an isolated profile and starts REAL instances (`dryRun: false`) in real Chromium against the spawned mock site, saturating admission until the live ExecutionEngine refuses a dispatch, then reads queued/running distribution and backpressure from the running engine rather than the durable store." },
  "verify:settings-e2e": { class: "real-browser", why: "Real-Electron Settings journey on an isolated profile: authorization, validation, import/reset safety, accessibility." },
  "verify:settings-runner-behaviour": { class: "real-browser", why: "SET-008 + SET-009 — launches the built Electron app and starts a REAL run from the rendered workflow run card's own Run button against the spawned mock site, asserting the runner honors the selected execution defaults and that screenshot-on-failure ON/OFF/ON changes the failure-evidence bundles actually written to disk." },
  "verify:recorder-gui": { class: "real-browser", why: "Recorder page GUI journeys in real Electron: idle enablement, start, invalid-target recovery, Stop vs Cancel, URL history table, protected-detection ignore scope, browser teardown and single-active-recorder concurrency." },
  "verify:recorder-redaction": { class: "real-browser", why: "REC-007 end-to-end secret redaction: a real Recorder session captures secret-shaped fields, then every file under the isolated app data root is scanned for the canaries, with a non-sensitive positive control proving the scan is not vacuous." },
  "verify:recorder-authz": { class: "real-browser", why: "Real-Electron Recorder authorization boundary: every recorder:* channel probed pre-auth, as a role without page.recorder, as one with it, and after sign-out — asserting the denial reason and the absence of side effects." },
  "verify:recorder-e2e": { class: "real-browser", why: "REC-018 + awkit-60w — drives the real Recorder UI, saves/restarts, then measures matched production-replay steps across baseline and two live DOM-drift profiles in bundled Chromium." },
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
  "verify:popup-identity": { class: "real-browser", why: "Drives real popups (reversed order, script/timer, ambiguous) to assert the FR-C1 identity invariants." },
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
  "verify:semantic-ui-gui": { class: "real-browser", why: "Real-Electron walkthrough of the Semantic Search page + Settings › Semantic Index, including that a Viewer never sees the nav entry." },
  "verify:failure-evidence-live": { class: "real-browser", why: "Real Chromium + local HTTP server: FR-B2 evidence files are written, safely named, path-confined, and secret-masked; page-identity + dead-page paths." },
  "verify:random-live": { class: "real-browser", why: "Runs deterministic generated linear and isolated-page waitAll topologies through the real ExecutionEngine and bundled Chromium against the local Mock Site, then checks persisted reports, resource release, and secret-safe artifacts." },

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
  "verify:oracle-mock-ui": { class: "integration", why: "Builds the real Java mock bridge and proves SQL-fixture parity, UI compatibility, limits, and read-only policy without a database." },
  "verify:branding": { class: "integration", why: "Real BrandingLogoStore atomic publish/rollback + sha256 re-verify + corrupt/missing fallback on a temp dir; no browser." },
  "verify:custom-brand-logo": { class: "integration", why: "Real BrandingLogoStore + BrandingValidation on a temp dir (signature/dimension/atomic/rollback/hash) mapped to the acceptance cases, plus structural source assertions; no browser." },
  "verify:random-failures": { class: "integration", why: "Writes immutable failure bundles to a real temporary filesystem, reloads them through the production reproducer, and verifies category-preserving shrink behavior plus Windows-safe CLI parsing." },
  "verify:random-reporting": { class: "integration", why: "Writes versioned campaign JSON and Markdown to a real temporary filesystem and verifies raw-sample percentiles, resource peaks, coverage/block reasons, failure categories, reproduction commands, non-overwrite behavior, and secret-canary refusal." },
  "verify:random-lifecycle": { class: "unit", why: "Runs a seeded exhaustive auth × authz × license × enforcement matrix through the production AuthorizationService and pure production license run-gate policy using in-memory fakes only." },

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
  "verify:roadmap-dashboard": { class: "static-source-validation", why: "Parses the repo's roadmap/issue/ledger/traceability sources plus the tools/roadmap model and server; never launches a browser or the app." },

  // ── Packaged application (drives the built artifact or the offline dependency bundle) ─────────
  "verify:packaged-runtime": { class: "packaged-application", why: "Smoke of the packaged app runtime." },
  "verify:packaged-walkthrough": { class: "packaged-application", why: "Packaged clean-profile release-candidate walkthrough." },
  "validate:offline": { class: "packaged-application", why: "Validates the offline dependency bundle (sql-wasm, resources, manifest)." },
  "verify:offline-supply-chain": { class: "packaged-application", why: "Verifies the pinned browser archive/payload policy, Ed25519-signed dependency manifest, runtime tamper detection, and real staged resources/vendor trees." },

  // ── Semantic subsystem (Zvec) ────────────────────────────────────────────────────────────────
  // Added 2026-07-25. Phase 1A introduced these twelve scripts without registering them, so this
  // reconciler had been FAILING on `main` — the taxonomy total was stale at 111 and excluded the
  // entire semantic subsystem. Classified from each verifier's own header, not its name.
  "verify:semantic-policy": {
    class: "unit",
    why: "Projection allowlist, redactor and policy validator in-process; no fs, subprocess, or browser."
  },
  "verify:semantic-store": {
    class: "unit",
    why: "Shared SemanticStore contract suite run against BOTH implementations (in-memory, and the Zvec adapter over a transport fake), plus injected-failure and ranking checks. No native host — that is verify:zvec-packaged-live."
  },
  "verify:semantic-zvec-native-contract": {
    class: "packaged-application",
    why: "Runs the shared SemanticStore contract through the REAL production path — ZvecSemanticStore over ZvecUtilityHostManager, a live Electron utilityProcess, the raw staged/packaged host and the real Zvec binding. Classified packaged-application because it launches Electron against a staged host tree; it is the only semantic verifier that exercises the host's own filter builder, exact-total pass and post-delete re-scan rather than scanning their source text."
  },
  "verify:semantic-zvec-filter": {
    class: "unit",
    why: "Typed filter builder plus its host-side duplicate, then the SAME expressions executed against the real @zvec/zvec binding on a throwaway on-disk collection. Classified unit because it spawns nothing and drives no browser or Electron process — the native library is loaded in-process, and the verifier fails rather than skipping when the binding is absent."
  },
  "verify:semantic-rebuild-live": {
    class: "packaged-application",
    why: "The rebuild lifecycle through the REAL generation runtime — SemanticIndexRuntime, the generation filesystem, ZvecSemanticStore, a live Electron utilityProcess, the raw staged/packaged host and real Zvec. Classified packaged-application because it launches Electron against a staged host tree. This is where post-activation behaviour becomes observable: the pointer swap committing while the new generation refuses to open, a host killed mid-write and mid-populate, real rollback, and restart opening the pointer-selected generation — none of which a lifecycle stub can express."
  },
  "verify:semantic-rebuild": {
    class: "unit",
    why: "Rebuild watermark and delta-journal orchestration against in-memory stores and a generation-lifecycle stub: a mutation accepted mid-rebuild survives activation, every pre-activation failure leaves the active pointer and the pending queue untouched, and the queue is never cleared on activation. In-process; no filesystem, subprocess or browser."
  },
  "verify:semantic-queue": {
    class: "unit",
    why: "Mutation-queue coalescing, ordering, delete-supersedes-upsert, bounded overflow and no-blind-replay, in-process against the in-memory store."
  },
  "verify:source-hygiene": {
    class: "static-source-validation",
    why: "Scans every TypeScript source for literal control characters (invisible delimiters); parses source only, executes nothing."
  },
  "verify:zvec-host-lifecycle": {
    class: "unit",
    why: "Restart/circuit-breaker policy and path confinement with an injected clock — plain Node, no native binding or process."
  },
  "verify:zvec-generation-recovery": {
    class: "integration",
    why: "Real temp directory trees: atomic pointer/metadata writes, real discard/quarantine on disk."
  },
  "verify:zvec-generation-lifecycle": {
    class: "integration",
    why: "Real fs generation lifecycle incl. the atomic pointer swap and rebuild rollback."
  },
  "verify:zvec-generation-concurrency": {
    class: "integration",
    why: "Genuinely simultaneous allocators (real processes) proving check-then-create cannot double-allocate."
  },
  "verify:zvec-native": {
    class: "integration",
    why: "Drives the real @zvec/zvec native module in-process (spike coverage)."
  },
  "verify:zvec-negative-cases": {
    class: "integration",
    why: "Real native-module failure modes (spike coverage)."
  },
  "verify:zvec-host-source-boundary": {
    class: "static-source-validation",
    why: "Parses the host source + packaging config to prove it stays raw CJS, utilityProcess-only, and carries no crash-injection path."
  },
  "verify:all-typecheck": {
    class: "static-source-validation",
    why: "Combined type gate (build + typecheck:scripts); parses source, never executes the feature."
  },
  "verify:zvec-packaged-assets": {
    class: "packaged-application",
    why: "Verifies the packaged tree's Zvec assets against the shipped per-asset manifest."
  },
  "verify:zvec-packaged-negative-cases": {
    class: "packaged-application",
    why: "Packaged-tree negative cases (tampered/missing assets)."
  },
  "verify:zvec-packaged-live": {
    class: "packaged-application",
    why: "Launches a real Electron app directory against the packaged AND NSIS-installed host via the production manager."
  },
  "verify:zvec-coexistence": {
    class: "real-browser",
    why: "Runs a real Playwright workflow alongside a large Zvec indexing batch to quantify coexistence impact."
  }
};
