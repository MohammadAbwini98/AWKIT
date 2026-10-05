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
  /**
   * Repo-relative paths this verifier makes **structural source claims** about: files it parses,
   * scans, or walks an import closure over, whose *contents* can fail it even when the edit looks
   * unrelated to the verifier's own subject.
   *
   * This is deliberately NOT "what it exercises" — that is `class`. It answers the opposite
   * question: *"I am editing this file; which structural gate has an opinion about it?"*
   *
   * Why it exists (2026-09-20): `verify:ai-fallback` and `verify:failure-capture-overhead` both
   * assert over `src/runner/**`, and both sat RED across several L3 commits because nothing
   * connected an edit in the runner to a verifier named after *fallback* or *overhead*. Nobody
   * looked, because nothing said to look. `verify:verifier-classification` prints these grouped by
   * path, and fails if a declared path no longer exists — so the map cannot rot into a typo.
   *
   * Only declare a path when the verifier reads that source **as data**. A verifier that merely
   * imports a module to run it is covered by `class`, not here.
   */
  guards?: string[];
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
  "verify:flow-library": { class: "real-browser", why: "awkit-k2s hardening: unit-tests the rescanTitle() reason priority, drives the real Electron Flow Library as Super User and a denied Viewer role to prove Re-scan Library is always rendered (never absent, only disabled with a truthful reason) and that main enforces WORKFLOW_EDIT independent of the renderer, plus static guards that no layer in FlowLibrary->pageChrome->App->AppShell->TopHeader filters the actions array; and L3 §9's model-free locator durability report on the page for both roles, its counts checked against an independent L2-classifier tally of the flows the app itself lists." },
  "verify:workflow-builder": { class: "real-browser", why: "Launches the built Electron app and drives the Workflow Builder canvas." },
  "verify:canvas-perf": { class: "real-browser", why: "Real-Electron render-count regression probe on a seeded canvas." },
  "verify:auth-gui": { class: "real-browser", why: "Real-Electron walkthrough of the SecurityGate sign-in UI." },
  "verify:issuer-readiness-gui": { class: "real-browser", why: "awkit-uwfo — launches the built Electron app twice on isolated profiles, provisions the exclusive Issuer account through the real Users UI, and reads the License Issuer page's own DOM: with no key it must render MISSING and NAME the redacted provisioning location; with the authorized key it must render READY. Reads readiness only — it never signs, and reports BLOCKED rather than passing when no authorized key exists." },
  "verify:settings-persistence": { class: "real-browser", why: "Integration checks in the REAL built Electron app (concurrent settings writes)." },
  "verify:single-instance": { class: "real-browser", why: "Two real Electron processes racing on the shared per-user store." },
  "verify:reports": { class: "real-browser", why: "Launches the built Electron app and smokes the Reports page." },
  "verify:reports-populated-gui": { class: "real-browser", why: "Seeds durable history, then drives the REAL Reports pages and asserts values against independently computed truth." },
  "verify:reports-settings-a11y": { class: "real-browser", why: "Real-Electron accessibility audit of Reports and Settings (keyboard, focus ring, names, live regions, zoom, reduced motion)." },
  "verify:reports-live-engine": { class: "real-browser", why: "SYS-REP-007 + SYS-REP-011 — launches the built Electron app on an isolated profile and starts REAL instances (`dryRun: false`) in real Chromium against the spawned mock site, saturating admission until the live ExecutionEngine refuses a dispatch, then reads queued/running distribution and backpressure from the running engine rather than the durable store." },
  "verify:settings-e2e": { class: "real-browser", why: "Real-Electron Settings journey on an isolated profile: authorization, validation, import/reset safety, accessibility, plus an exact-path Windows Explorer launch only under the explicit owner-approved AWKIT_ALLOW_OS_SHELL_LAUNCH=1 opt-in." },
  "verify:settings-runner-behaviour": { class: "real-browser", why: "SET-008 + SET-009 — launches the built Electron app and starts a REAL run from the rendered workflow run card's own Run button against the spawned mock site, asserting the runner honors the selected execution defaults and that screenshot-on-failure ON/OFF/ON changes the failure-evidence bundles actually written to disk." },
  "verify:recorder-gui": { class: "real-browser", why: "Recorder page GUI journeys in real Electron: idle enablement, start, invalid-target recovery, Stop vs Cancel, URL history table, protected-detection ignore scope, browser teardown and single-active-recorder concurrency." },
  "verify:recorder-redaction": { class: "real-browser", why: "REC-007 end-to-end secret redaction: a real Recorder session captures secret-shaped fields, then every file under the isolated app data root is scanned for the canaries, with a non-sensitive positive control proving the scan is not vacuous." },
  "verify:recorder-authz": { class: "real-browser", why: "Real-Electron Recorder authorization boundary: every recorder:* channel probed pre-auth, as a role without page.recorder, as one with it, and after sign-out — asserting the denial reason and the absence of side effects." },
  "verify:recorder-e2e": { class: "real-browser", why: "REC-018 + awkit-60w — drives the real Recorder UI, saves/restarts, then measures matched production-replay steps across baseline and two live DOM-drift profiles in bundled Chromium." },
  "verify:recorder": { class: "real-browser", why: "Records inside a real Chromium page and asserts unique semantic locators." },
  "verify:recorder-action-owner": { class: "real-browser", why: "Drives the injected Recorder capture in Chromium against /recorder-lab nested custom elements, round-trips the built flow, and replays the saved semantic locator through StepExecutor." },
  "verify:recorder-hotkeys": { class: "real-browser", why: "Captures trusted shortcuts and ordinary typing through the real injected Recorder in Chromium, JSON-round-trips the flow, then replays the Press Shortcut through production StepExecutor against the local fixture oracle." },
  "verify:recorder-actions": { class: "integration", why: "Exercises deterministic delete cascades and service-owned Clear All against a real temporary persisted Recorder draft, including URL-history and live-recording preservation." },
  "verify:recorder-navigation": { class: "real-browser", why: "Drives the real RecorderService.attachUrlCapture against real Chromium and the spawned mock site, measuring which navigation kinds (document, pushState, replaceState, hashchange, back/forward/reload, repeat visit) reach recordedUrls and whether query and hash survive." },
  "verify:recorder-hover": { class: "real-browser", why: "Live verification of Recorder's hover-dependency capture feature using real Chromium." },
  "verify:recorder-ambiguity": { class: "real-browser", why: "awkit-aui.8 nine-point acceptance gate — records ambiguous/duplicate/hover controls in real Chromium, then drives buildRecordedFlow, FlowValidator preflight, LocatorFactory and StepExecutor to prove capture, ancestor scoping, deterministic replay, review-required state, approved positional fallback, zero-launch preflight, round-trip integrity and hover replay, with negative controls." },
  "verify:locator-quality-class": { class: "real-browser", why: "Phase L L2 shared locator quality class — a rule table in which every reason code must be reachable, then real Recorder captures on /recorder-lab/locator-quality finalized by buildRecordedFlow and classified (strong/acceptable semantic, guarded positional stays resolved), with an unguarded negative control." },
  "verify:element-spy": { class: "real-browser", why: "Phase L L2 Element Spy + capture-time upgrade context — drives the real RecorderService browser on /recorder-lab/element-spy: bounded memory-only upgrade context with bound-value markers (absent from the draft and buildRecordedFlow), in-recording inspect, the independent inspect-only session (clicks/submits/links/popups intercepted, frame + open shadow, navigation and popup lifecycle), explicit Use in action with frame/interaction preservation and every rejection path, save/reload/StepExecutor replay, protected-login refusal in both modes, IPC permission wiring and the SSR-rendered result panel, with a paused-mode negative control." },
  "verify:locator-wrong-element": { class: "real-browser", why: "awkit-epbe wrong-element refusal gate — replays the 16 frozen L10.0 drift fixtures through the real Recorder capture and the production LocatorFactory in three configurations (recorded step, forced miss with local recovery, forced miss with local plus blueprint recovery) and proves the viewport-tiebreak, positional-alternative and same-label-recovery shapes refuse, no configuration resolves a wrong element outside one documented residual, and every outcome correct in the committed L10.0 results stays correct." },
  "verify:dom-intelligence-gui": { class: "real-browser", why: "L11 real-Electron walkthrough: Settings › DOM Intelligence status (parser-only, pinned version when the dev runtime is staged, browser and network access disabled), and the Designer's Find current element through the real preload, IPC authorization, flow store and the Element Spy's live Feature Test Lab page (found, missing, page/frame context, nothing offered without a proof), the saved flow byte-identical afterwards, and an explicit no-live-page refusal once the Spy is closed." },
  "verify:locator-diagnosis": { class: "real-browser", why: "L11.E Element Spy / Designer diagnosis gate — records real clicks on the frozen L10.0 fixtures, runs LocatorFactory.diagnose on the Recorder-scripted live page with a deterministic provider, and proves AWKIT's identity proof alone decides what is offered (proven drift offered and resolving to the true target, same-label decoy and protected-surface pages offer nothing), that the diagnosis leaves the page DOM, user events and the step unchanged, the renderer apply gate and request sanitizer contract, and that the Spy mount is read-only while the Designer's apply only edits the unsaved draft." },
  "verify:dom-intelligence-contexts": { class: "real-browser", why: "L11.F dynamic browser contexts — drives the production LocatorFactory in real Chromium on the Feature Test Lab's /dom-context-lab with a recording fake provider: a target removed from its iframe, from a parent page or a popup, or reached on another SPA route (also through a route-less legacy winner record) is never replaced by a look-alike that AWKIT's own gate would accept (each look-alike's score and ancestry are asserted first), while a same-context drift still recovers; every suggestion stage sees only the step's own frame and page document; virtualized rows (unmounted, recycled duplicates) refuse and come back only through the scroll step's own semantics; a disabled delayed-render skeleton is refused as not actionable and the action lands on the rendered target; the stale-snapshot proof refuses after a page change; and the report provenance of a route refusal." },
  "verify:dom-normalization": { class: "real-browser", why: "L11.G AI-context normalization through the required path on real Chromium and the REAL staged parser-only host (NOT RUN without the pinned runtime inputs): the pure normalizer (hostile shapes, closed roles, bounds, SemanticRedactor, the residual rescan behind a failing redactor); every fixture page in scripts/dom-intelligence/normalizationPages.mts (no hidden, script, value, attribute, URL or frame canary reaches the host, its answer, the context or a prompt; visible secrets inside every bound removed only by the redactor; hidden subtrees dropped in the page; labelled causal facts kept; password, OTP, CAPTCHA and passkey pages refused before any HTML leaves them; an SSO-text control not refused; a page past every bound truncated and bounded); every fault (no provider, disabled, hung, malformed) a refusal inside its budget and no context meaning the exact old request; the product path through the real ExecutionEngine (off by default, on puts the context into report.json, failureBatch and the request; refused on a protected page; suppressed with raw-UI-text suppression); and the committed labelled contexts equal to what the path produces today. benchmark:dom-normalization writes those contexts and the measured results." },
  "verify:dom-intelligence-acceptance": { class: "real-browser", why: "L11.I acceptance benchmark on real Chromium and the REAL staged parser-only host (NOT RUN, exit 2, without the pinned runtime inputs): every one of the 16 fixture classes (the L10.0 cases from real recorder recordings plus the /dom-context-lab frame, popup, SPA-route, virtualized, delayed and stale-reference classes) is run through legacy recovery, the snapshot engine, Scrapling candidates alone, Scrapling + AWKIT proof and the product failure path; asserts zero wrong-element results for the snapshot, product and proof engines, no engine error outside a refusal, no legacy recovery lost, every expected refusal refused or unresolved, warm snapshot p95 under 500 ms on at least 8 accepted representative fixtures (not a universal claim), and normal-step overhead under 5 ms median once a reference is bound. benchmark:dom-intelligence-acceptance also writes the matrix, latency breakdown, cold/warm host and DOM-scaling results." },
  "verify:recovery-provenance": { class: "real-browser", why: "L11.H locator repair/recovery provenance in execution reports — real runs through the production ExecutionEngine (Chromium, StepExecutor, LocatorFactory) on the Feature Test Lab's /dom-context-lab SPA routes, sharing one runtime root so winner memory and DOM references persist between runs, read back from the report.json ReportService wrote: a seed run (reference refresh reported on its own), a drift AWKIT's proof recovers (actedOn awkit-proof), a route mismatch, and provider timeout, unavailable, malformed and rejected-suggestion runs through a scripted provider. Each attempt leaves one bounded, versioned, code-only data.locatorRecovery record with stages, timings, counts, page alias, frame and route agreement; provider evidence is always effect none, actedOn appears only when AWKIT recovered, a hung provider is cut off by the suggestion budget, and no DOM, page text, selector, URL or masked field reaches the record." },
  "verify:dom-intelligence-host": { class: "integration", why: "L11 (awkit-djnl.19) parser-only DOM-intelligence host — stages the pinned runtime with scripts/prepare-dom-intelligence-host.mjs into a temp dir outside the repository and asserts the trimmed tree (no socket/TLS/FFI/async extension, no network/process stdlib, no Scrapling fetchers/spiders/engines/shell, no tld, unchecked-hash bytecode, pinned sys.path); runs a probe inside the staged interpreter proving 27 forbidden operations are refused by the host's audit hook against a no-host write control; drives the raw JSON-lines protocol (unknown op/property, wrong protocol, bounds, unparseable/oversized line, shutdown, EOF); and drives ScraplingDomIntelligenceProvider against the staged host and a misbehaving fake host (network/forbidden hello, malformed/wrong-id/bad-shape/oversized answers, timeout kill, crash circuit, absent runtime) plus an owner-death orphan check. Real subprocesses, no browser or Electron. Exits 2 (NOT RUN) without the pinned inputs." },
  "verify:dom-intelligence-coverage": { class: "real-browser", why: "L12.23 deterministic DOM-intelligence coverage (awkit-djnl.21.23) on real Chromium and the REAL staged parser-only host (NOT RUN, exit 2, without the pinned runtime inputs): 95 mutation cases on 24 DOM Coverage Lab fixtures, each recorded through the real Recorder, its locator forced to miss, then judged against a verifier-only oracle for the snapshot and product engines in 3 runs; the pure gate (0 wrong, removed targets empty, explicit expectations, identical runs, pinned counts) is mutation-tested in-process; plus Element Spy similar rows, protected-login detection and the read-time challenge check.", guards: ["src/runner/LocatorFactory.ts", "src/runner/recoverySnapshot.ts", "mock-site/dom-coverage-corpus.mjs"] },
  "verify:dom-intelligence-l12": { class: "real-browser", why: "L12 Scrapling expansion product wiring (awkit-djnl.21) — drives the production LocatorFactory in real Chromium with a recording fake provider: a pre-blueprint step gains a flow-scoped DOM reference on its first passing run and a later failed lookup consults the provider with it (L12.5), diagnosis asks with the 5 s diagnosis budget and finds the flow-scoped reference only when told the flow while a run stays inside 800 ms (L12.4), and the run, recorder and Element Spy IPC handlers prewarm the host after their permission checks (L12.1, source assertions).", guards: ["app/main/ipc/execution.ipc.ts", "app/main/ipc/recorder.ipc.ts", "app/main/domIntelligence/domIntelligenceRuntime.ts"] },
  "verify:protected-diagnosis": { class: "real-browser", why: "L12.17 Super-User-only protected diagnosis (awkit-djnl.21.17) — the permission in every built-in role both directions and its re-authentication, the surface allow-list (sign-in, MFA, passkey, SSO, known provider) and its refusals (CAPTCHA, security check, blocked automation, signature, approval, unknown), then the production LocatorFactory.diagnose in real Chromium: a sign-in page skipped without the opt-in and read with it with no password field and no typed value in the HTML, a CAPTCHA widget or detector-named challenge refused even with the opt-in, and a plain page unchanged. Source assertions pin the IPC gate (role, permission, re-auth, denial audit before any read, use audit after) and that getLivePage never relaxes in a handoff.", guards: ["app/main/ipc/domIntelligence.ipc.ts", "src/recorder/RecorderService.ts", "src/runner/domIntelligence/repairSuggestion.ts"] },
  "verify:provider-agreement": { class: "unit", why: "L12 agreement rule (awkit-djnl.21.6) — replays the AWKIT rankings and Scrapling top picks measured on the L11 acceptance set through decideProviderAgreement (3 accepted, 9 refused), checks each guard (provider score and lead floors, identity floor, ancestry veto, AWKIT's own margin, refusal kinds) on its own, and checks toRecoveryProvenance attributes an agreed recovery to awkit-provider-agreement and a rejected one with its reason. No browser or host." },
  "verify:locator-guard": { class: "real-browser", why: "Guarded-positional identity gate — records positional clicks in real Chromium, proves normal and sensitive steps persist hashed guards, then drives buildRecordedFlow, FlowValidator, LocatorFactory.resolveGuardedPositional, and StepExecutor to verify identity before action and abort on candidate-set or identity change (never a sibling fallback); unchanged replay also proves capture/runtime fingerprint parity." },
  "verify:frame-chain": { class: "real-browser", why: "awkit-65g Phase C1 cross-origin frame-chain gate — records a click inside single/nested/duplicate/navigating iframes across two mutually cross-origin 127.0.0.1 origins, then drives buildFrameChain (Playwright Frame graph), buildRecordedFlow, FlowValidator, and LocatorFactory.resolveFrameChain/StepExecutor to prove each frame boundary is resolved in order with identity verification, and that a dropped/reordered chain or a missing/changed frame fails with FRAME_IDENTITY_CHANGED (never entering a sibling frame)." },
  "verify:closed-shadow": { class: "real-browser", why: "awkit-65g Phase C2 instrumented closed-shadow gate — records a click inside single/nested/mixed closed shadow roots (real Chromium), then drives buildRecordedFlow and LocatorFactory.resolveClosedShadow via the closedShadowBridge init script + custom selector engine to prove replay clicks the closed-root target; asserts fail-closed without the bridge or on a changed host/target (no false-valid, no side effect), that mode is not forced open and no internal name is persisted, and that the retained roots are unreachable without the per-process secret token. Includes the mock-site /closed-shadow-lab fixture." },
  "verify:blueprint-recovery": { class: "integration", why: "Locator Blueprint recovery — Node-side assembly + durable store. Drives buildRecordedFlow to assemble PageBlueprint/ElementBlueprint from captured actions (page-key dedupe, 2000-element cap, additive blueprintId), asserts fingerprint hashing parity (hashFingerprint/hashToken — no second model) and that no raw label/attribute/URL text is persisted, normalizes computePageKey (query/fragment stripped, 3-word title category, frame flag) and computeDocumentFingerprint (order-independent histogram), and round-trips FileLocatorBlueprintStore with a real temp dir (atomic put/get/list, no .tmp leak, schema-version rejection, 512KB size guard). Browser-only capture/runtime coverage belongs to verify:blueprint-recovery-browser." },
  "verify:blueprint-recovery-browser": { class: "real-browser", why: "Locator Blueprint browser acceptance gate — records a click through the real injected Recorder capture, assembles its captured blueprint, mutates the local Feature Test Lab DOM so every saved locator misses beyond the broad scan cap, and proves LocatorFactory's second-layer blueprint neighborhood recovers the intended target at the 0.86 threshold while refusing a below-threshold control." },
  "verify:recorder-competitive": { class: "real-browser", why: "Competitive/adversarial Recorder locator-quality gate — drives the real installRecorderCapture in Chromium and proves generated/framework identifiers (React useId, Ember, GUID, CSS-module id hashes) and CSS-in-JS/hashed classes (emotion css-, styled sc-, FB atomic x1…, CSS-module Foo__hash) are never emitted as the locator while uniqueness is preserved, meaningful classes still disambiguate, and native <select>/contenteditable/keyboard interactions capture safely (unique, non-utility locator or nothing). Regression trip: a brittle generated token appears in a recorded locator or a disambiguation is non-unique." },
  "verify:recorder-third-pass": { class: "real-browser", why: "Third-pass recorder fixes (AWKIT-REC-039/041/042): real-Chromium tab-switch targeting, download-to-step capture, and wheel-scroll capture/replay." },
  "verify:wdu-live": { class: "real-browser", why: "External-site acceptance: real runner against webdriveruniversity.com. NOT part of deterministic verification — needs the public internet." },
  "verify:wdu-recorder-live": { class: "real-browser", why: "External-site Recorder acceptance: drives RecorderService.wireContext against webdriveruniversity.com and inspects the stored action semantics, then replays them through the real runner. NOT part of deterministic verification — needs the public internet." },
  "verify:wdu-data-live": { class: "real-browser", why: "External-site data/persistence/report acceptance: drives a real DataSource-bound workflow through ExecutionEngine against webdriveruniversity.com and inspects the run report the engine writes. NOT part of deterministic verification — needs the public internet." },
  "verify:assertions": { class: "real-browser", why: "Assertion comparison types (incl. element attribute) through StepExecutor against real Chromium." },
  "verify:storage-assertions": { class: "real-browser", why: "Browser-storage assertions (localStorage/sessionStorage, absent-vs-empty, area selection, secret masking) through StepExecutor and the real PlaywrightRunner against the mock site storage lab." },
  "verify:click-and-hold": { class: "real-browser", why: "Drives the real Recorder init script against the mock site press-and-hold lab and replays the built clickAndHold step through the production StepExecutor in real Chromium." },
  "verify:recorder-upload": { class: "real-browser", why: "Drives the real Recorder init script against the mock site upload input in real Chromium and asserts the stored action, the built flow, and that preflight validation refuses the missing path." },
  "verify:recorder-dialogs": { class: "real-browser", why: "Drives RecorderService.wireContext against the mock site dialog lab in real Chromium, asserts the captured dialogExpectation and its attribution, and replays the reloaded recording through the real PlaywrightRunner." },
  "verify:recorder-capture-gaps": { class: "real-browser", why: "Reproduces the five Recorder capture defects WebDriverUniversity exposed — drag ghost occlusion, radio value locators, own-text locators, readonly-field clicks and document.write popups — against the mock site in real Chromium." },
  "verify:dialogs": { class: "real-browser", why: "Real Chromium native alert/confirm/prompt handling through the real runner against the mock site." },
  "verify:waits": { class: "real-browser", why: "Live Smart Wait checks against real Chromium." },
  "verify:smart-wait-causality": { class: "real-browser", why: "Drives the injected Recorder observer in real Chromium through causal and background completion signals, flow assembly/round-trip, StepExecutor replay, identity drift diagnostics, and non-fatal optional/advisory semantics." },
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
  "verify:system-pages-gui": { class: "real-browser", why: "Real-Electron walkthrough of the ten SpecterStudio-design system pages: design surface + signature blocks mounted, containment at 1024/1440/1920, token fills painting, a seeded Run Artifacts report rendering as a real table row with every action reachable, no console errors, light/dark screenshots." },
  "verify:e2e-auth": { class: "real-browser", why: "Authentication lifecycle against the REAL Electron app." },
  "verify:e2e-rbac": { class: "real-browser", why: "Per-role authorization in the REAL Electron app." },
  "verify:e2e-licensing": { class: "real-browser", why: "Licensing page + run-enforcement gate in the REAL Electron app." },
  "verify:e2e-sweep": { class: "real-browser", why: "Full route sweep of the REAL Electron app." },
  "verify:e2e-reauth": { class: "real-browser", why: "Live ReauthDialog re-auth flow in the REAL Electron app." },
  "verify:oracle-drivers-gui": { class: "real-browser", why: "Real-Electron walkthrough of Settings › Database Drivers." },
  "verify:durable-accuracy": { class: "real-browser", why: "Launches the real ExecutionEngine benchmarks (real Chromium) for durable-store accuracy." },
  "verify:accent-gui": { class: "real-browser", why: "Real-Electron walkthrough of Appearance › Accent Color (solid/gradient/preset/reset + login pre-mount bootstrap)." },
  "verify:design-tokens": { class: "real-browser", why: "Static global.css token contract (undefined-var + rule-body literal + chart-palette parity) plus a real-Electron light/dark proof that the token spine and the Sessions status pill paint in both themes." },
  "verify:app-background": { class: "real-browser", why: "Real-Electron proof that the full-viewport dot-field canvas sits behind the layout, paints its grid, lights the dot under the pointer, parks its rAF loop at rest, and repaints on a light→dark switch." },
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
  "verify:flow-fragments-gui": {
    class: "real-browser",
    why: "L6 fragment surfaces in the real Electron app: capture over permission-gated IPC landing a file on disk, the dirty-editor refusal, the library's audit preview, insertion as an editor transaction with undo/redo, two insertions not colliding, and locator/data-binding survival through insert → save → disk."
  },
  "verify:flow-fragments-e2e": {
    class: "real-browser",
    why: "L6 fragment lifecycle end to end: capture in the real Flow Designer, insert into another flow, wire it in with the canvas's own drag-to-connect, save, reopen, edit, re-save, then run it for real through execution:runWorkflow with the bundled Chromium against the Feature Test Lab — asserting the flow JSON on disk, the engine's run report, and the mock site's own submitted state, plus the refusal when a declared required runtime input is unsupplied."
  },
  "verify:flow-fragments": {
    class: "integration",
    why: "L6 reusable fragments: the blocking audit matrix asserted by cardinality over every declared code with a negative control per rule, capture and apply over real FlowProfile fixtures, the create/reload/edit/re-save/tamper round trip against a real JsonProfileStore in a temp dir, and (§12) a construct-independent drift guard that neither AI-policy nor failure-evidence consumer restates the canonical PROTECTED_LOGIN_STEP_TYPES.",
    guards: ["src/security/authz/AiAutonomyPolicy.ts", "src/runner/evidence/FailureEvidenceCollector.ts", "src/profiles/FlowProfile.ts"]
  },
  "verify:r0-characterization": { class: "integration", why: "R0 refactoring baseline: AST-resolved production dependency/license-checkpoint guards plus real same-folder JsonProfileStore atomic-write overlap/failure behavior and the real ExecutionEngine lifecycle, coordinator, browser-pool, backpressure and capacity planner without launching a browser." },
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
  "verify:glm-delegate": { class: "integration", why: "Spawns the real glm_delegate_server.py as a stdio subprocess and drives the real MCP initialize/tools-list/tools-call handshake against it, byte-compiles the server, and exercises budget resolution, scope expansion, truncation and omission notices, and secret-bearing and out-of-root path refusal over throwaway temp-directory fixtures it really writes. The HTTP boundary is stubbed, so it needs no GLM_API_KEY and opens no network connection. Developer-agent tooling — nothing under app/, src/ or the packaged runtime references it." },
  "verify:glm-delegate-live": { class: "integration", why: "Credential-gated acceptance over the same MCP stdio subprocess against the REAL Z.AI provider, recording provider-reported token counts and stop reasons verbatim. NOT part of deterministic verification — it needs the public internet and GLM_API_KEY, and reports BLOCKED rather than passing when the credential is absent (the verify:wdu-live precedent for an external-dependency verifier; integration rather than real-browser because it launches no browser, matching verify:oracle-live). Developer-agent tooling, outside the packaged runtime." },
  "verify:random-lifecycle": { class: "unit", why: "Runs a seeded exhaustive auth × authz × license × enforcement matrix through the production AuthorizationService and pure production license run-gate policy using in-memory fakes only." },

  // ── Unit (pure in-process logic with fakes; no persistence/subprocess/browser) ───────────────
  "verify:canvas-layout": { class: "unit", why: "Pure graph-layout geometry over the real layout functions." },
  "verify:branch-pairs": { class: "unit", why: "Pure branch-pair reconciliation over the real shared module." },
  "verify:accent-theme": { class: "unit", why: "Pure accent-color model: hex normalize/migrate, light/dark token derivation, WCAG foreground pick, gradient stops. No fs/browser." },
  "verify:failure-screenshot-precedence": { class: "unit", why: "Pure precedence check over the real FlowExecutor gate (stub StepExecutor)." },
  "verify:failure-evidence": { class: "unit", why: "Per-attempt failure-evidence ordering/accumulation (FR-B2) over the real FlowExecutor.executeWithRetry with a stub StepExecutor; no browser." },
  "verify:avatar": { class: "unit", why: "Pure initials/palette derivation." },
  "verify:licensing": { class: "unit", why: "Pure licensing domain + RBAC (no packaged app)." },
  "verify:license-dispatch-gate": { class: "unit", why: "Real ExecutionEngine queue loop with maxConcurrentInstances=0 plus static production-wiring assertions; no browser or Electron process." },
  "verify:write-queue": { class: "unit", why: "Deterministic serial write-queue logic." },
  "verify:security": { class: "unit", why: "Pure security logic; no Electron/Chromium." },
  "verify:auth": { class: "unit", why: "Trusted-core auth logic, headless." },
  "verify:portable-fresh-state": { class: "integration", why: "Audits packaged input trees for mutable databases and exercises first-run Super User bootstrap against a real temporary SQLite store." },
  "verify:secrets": { class: "unit", why: "Secret-store hardening with a fake crypto backend." },
  "verify:workflow-sentinels": { class: "unit", why: "Pure Start/End sentinel + workflow→scenario conversion logic." },
  "verify:async-review": { class: "unit", why: "Pure async completion review/classification." },
  "verify:flow-step-mapping": { class: "unit", why: "Pure model↔node-data round-trip converters." },
  "verify:validation": {
    class: "unit",
    why: "Rule-by-rule Flow Validation Engine checks over pure validator logic; no persistence or browser."
  },
  "verify:condition-semantics": {
    class: "unit",
    why: "awkit-9qcz Option A literal-only condition semantics: the FlowValidator ignoredConditionValueSource warning (names only the source kind, never a resolved/secret value) and source-only rejection, the FlowExecutor.resolveNext synchronous literal-only routing, createValueSource never fabricating a condition source while round-tripping a legacy binding verbatim, and RandomConfigurationGenerator omitting the valueSource for conditions. Pure validator/runtime/mapping logic; no persistence or browser."
  },
  "verify:wait-validation": {
    class: "unit",
    why: "Both wait contracts. (1) The subtype-aware wait STEP node: engine rules, the designer panel's own validate(), the profile round-trip and a source-level parity check against StepExecutor.executeWait. (2) The Smart Wait CONDITION union in beforeWaits/afterWaits: per-type required fields, the vacuous-match cases, OR-group nesting, and a severity split asserted against runRequiredOrOptional. Pure; no browser or Electron."
  },
  "verify:assertion-validation": {
    class: "unit",
    why: "The assertText step contract refined by assertion kind: the expectedValue channel the designer writes, the url/storage kinds that resolve no locator, the attributeName/storageKey fields the runtime only enforced by throwing, config literals, the designer panel's own validate(), the profile round-trip, a source-level parity check against StepExecutor.executeAssertion, and a guard over the shipped mock-site fixtures. Pure; no browser or Electron."
  },
  "verify:loop-scroll-validation": {
    class: "unit",
    why: "The loop and scroll step contracts refined by config: the iteration source and scroll distance the designer writes into config rather than value, the SILENT no-op cases (a loop whose action needs a target it does not have still reports passed; a scroll-to-element with no element quietly wheels the page), loop child-flow references, the designer panel's own validate(), the round-trip, a generated-corpus guard, and a source-level parity check against executeLoop/performLoopAction. Pure; no browser or Electron."
  },
  "verify:legacy-compat": {
    class: "integration",
    why: "Drives FlowValidationService against a real JSON profile store on a temp dir (atomic writes, grant persistence); no browser."
  },
  "verify:packaged-validation": {
    class: "packaged-application",
    why: "Launches the built Electron app (Playwright _electron) to walk the validation subsystem; requires package:portable first."
  },
  "verify:run-report-compatibility": {
    class: "unit",
    why: "Builds reports through the real ReportService with fixtures; source guards cover the wiring."
  },
  "verify:ipc-error-message": {
    class: "unit",
    why: "Pure string reasoning over the real preload unwrapper, plus a source guard on the boundary."
  },
  "verify:release-key-custody": {
    class: "unit",
    why: "Pure path/env reasoning over both custody modules and the issuer service; reads no key."
  },
  "verify:flow-node-catalog-parity": {
    class: "unit",
    why: "Reconciles the real node catalog/registry modules in-process; parses the StepType union from source."
  },
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
  "verify:recorder-draft": { class: "unit", why: "Recorder action-draft + saved-URL logic, REC-022 handoff-cancel draft preservation, and the SessionCaptureService metadata store (real-file round trip, corrupt/missing recovery, atomic EPERM/EBUSY retry via injected seams); no browser." },
  "verify:recorder-flow": { class: "unit", why: "Pure buildRecordedFlow logic; no browser, no I/O." },
  "verify:protected-login": { class: "unit", why: "Pure protected-login detector core." },
  "verify:data-editor": { class: "unit", why: "Data-source editor logic (small file round-trip is incidental)." },
  "verify:instance-monitor": { class: "unit", why: "Pure non-DOM Instance-Monitor card logic." },
  "verify:oracle-profiles": { class: "unit", why: "In-memory Oracle profile store + credentials." },
  "verify:oracle-data-source": { class: "unit", why: "Oracle data-source model/resolution; no Java, no DB." },
  "verify:oracle-driver-bundle": { class: "unit", why: "Driver-bundle store logic with a STUB bridge probe." },
  "verify:authz": { class: "unit", why: "RBAC + Super-User admin logic, headless." },
  "verify:super-user-controls": { class: "integration", why: "Exercises the Super-User permission registry, session-policy validation, real bounded/redacted JSONL files in a temp directory, generated roadmap parity, and IPC/UI source boundaries without Electron." },
  "verify:session-context": { class: "unit", why: "Browser-free sender-bound session-registry checks." },
  "verify:stress:concurrency": { class: "unit", why: "Concurrency stress over pure logic with fake runtimes." },
  "verify:stress:cancellation": { class: "unit", why: "Cancellation stress over pure logic with fake runtimes." },

  // ── Documentation consistency (asserts docs/spec text agrees with code/config) ────────────────
  "verify:clean-machine-policy": { class: "documentation-consistency", why: "Asserts the clean-machine validation policy docs agree with the canonical policy source (blocking matrix + wording), protected gates stay mandatory, and historical NOT EXECUTED evidence is unchanged." },
  "verify:nsis-per-user-install": { class: "unit", why: "Exercises the canonical PowerShell argument/outcome helper with the exact 0xC0000005 NSIS System.dll negative control, then guards both installed-layout drivers against returning to bare /S." },

  // ── Static source validation (parses source / packaging inputs; feature not executed) ────────
  "verify:verifier-classification": { class: "static-source-validation", why: "Reconciles this registry against package.json and reports per-class verifier counts (FR-I1)." },
  "verify:editor-history": { class: "unit", why: "Exercises the shared bounded editor-history contract in process: undo/redo, mutation classes, redo invalidation, unknown fields, saved checkpoints, load reset, and the 50-entry cap." },
  "verify:packaged-licensing": { class: "packaged-application", why: "Drives the PACKAGED build to prove every blocking license state (NOT_ACTIVATED/INVALID_SIGNATURE/CORRUPTED/EXPIRED/MACHINE_MISMATCH) refuses a real run where no bypass exists, plus the one-time migration-grace scenario on its own upgraded profile (awkit-1cc)." },
  "verify:test-lab-cli-only": { class: "static-source-validation", why: "Proves the Randomized Test Lab harness is absent from app/** imports, the production bundles, and the route registration files (owner decision 2026-07-29, awkit-wza.8)." },
  "verify:test-lab-cli-only-exit": { class: "static-source-validation", why: "Runs the unmodified verify:test-lab-cli-only against fixture bundles (missing, empty, stale, non-JavaScript, contaminated, current) and asserts its exit code and PASS/FAIL/BLOCKED counts: BLOCKED exits 2, FAIL exits 1, only a fully inspected clean bundle exits 0." },
  "verify:secret-storage-seam": { class: "real-browser", why: "Launches the real Electron app from the production entry point AND the test composition root to prove SET-013's unavailable-keystore behaviour, plus the source/packaging hygiene that keeps the substitution out of shipped builds (awkit-8ri)." },
  "verify:ipc-contract": {
    class: "static-source-validation",
    why: "Statically parses app/main/ipc + preload for channel-contract drift.",
    guards: ["app/main/ipc", "app/main/preload.ts"]
  },
  "verify:oracle-offline-bundle": { class: "static-source-validation", why: "Audits Oracle offline-bundle integrity over fixtures (no packaged app run)." },
  "verify:oracle-packaging": { class: "static-source-validation", why: "Checks Oracle packaging + path-resolution config." },
  "verify:roadmap-license-issuer": { class: "integration", why: "Starts the real dashboard server on an ephemeral port and drives the License Issuer routes over HTTP, spawning the real tsx issuer bridge process; then issues real Ed25519-signed licenses through LicenseIssuerService and imports them through LicenseStore/LicenseService. No browser or Electron." },
  "verify:issuer-key-resolution": { class: "integration", why: "awkit-uwfo — drives the canonical external signing-key resolver and all five readiness states against REAL key files on disk (valid, absent, unopenable, malformed, untrusted id), signs through LicenseIssuerService into folders whose names carry spaces and shell metacharacters, spawns the real issuer CLI with fixed argv and no shell, and imports the signed .dat through the production LicenseValidator/LicenseStore/LicenseService — all on an EPHEMERAL Ed25519 pair, so no production private key is read." },
  "verify:roadmap-dashboard": { class: "static-source-validation", why: "Parses the repo's roadmap/issue/ledger/traceability sources plus the tools/roadmap model and server; never launches a browser or the app." },
  "verify:dom-intelligence-gate": { class: "static-source-validation", why: "L10.0 (awkit-djnl.18) evidence consistency, offline with no Python or browser: re-renders the frozen fixtures against their recorded hashes, re-derives the tally and both GO/NO-GO decisions from the committed per-case data through the pre-registered rule in scripts/dom-intelligence/gate.mts, proves the measured venv was exactly Scrapling's parser-only closure with no forbidden module loaded, and checks the evidence report and DECISIONS.md state the same decisions. The measurements themselves come from npm run benchmark:dom-intelligence." },
  "verify:graphify-shrink-guard": { class: "integration", why: "awkit-wy82 — drives the REAL locally installed Graphify package (uv tool graphifyy) through a Python subprocess: _check_shrink negative/positive controls, provenance-aware _stale_graph_sources selection with the fail-closed liveness guard, the atomic _prune_graph_json_sources on a synthetic 104-node fixture mirroring the real 5/23/65=93 event, and an end-to-end CLI replica (build → exclude → refusal without --force → prune → accepted update). Reports BLOCKED (exit 2) rather than a vacuous PASS when the runtime is absent. No browser or Electron." },
  "verify:agent-routing": { class: "static-source-validation", why: "Exercises the tools/agents routing registry, classifier, contract validator and write lease in-process against fixtures — every rejection rule is driven by a contract that violates it, and the write lease runs against a temp file rather than the repository's own. Never launches a browser or the app." },
  "verify:app-icon": { class: "static-source-validation", why: "awkit-icon2 — renders app/renderer/assets/brand/awkit-app-icon.svg in memory through the same sharp pipeline as scripts/generate-app-icon.mjs and pixel-compares resources/icon-source.png, resources/icon.png and all seven resources/icon.ico frames against it (plus the #1d4ed8 accent brick), with a generator-equivalent positive control and superseded-accent/wrong-size negative controls. Writes nothing; no browser or Electron." },

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
  "verify:async-wait-hygiene": {
    class: "static-source-validation",
    why: "Scans source text for Playwright waits handed an async predicate, which waitForFunction never awaits; parses source only, launches nothing."
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
  },

  // ── Phase L (local AI) — L3 deterministic core ───────────────────────────────────────────────
  "verify:locator-plan": {
    class: "unit",
    why: "Locator plan DSL, trusted compiler and intent guard: invented frames, scripts, positional and unstable selectors, XPath policy and bound-value scopes are refused and position-to-text changes flagged; pure in-process, no model or browser."
  },
  "verify:locator-upgrade-proof": {
    class: "real-browser",
    why: "L3 proof gates and pending-upgrade replay in real Chromium on the mock-site Locator Upgrade Lab: Recorder-captured guarded baselines, same-element identity, wrong/ambiguous/frame/shadow/bound-data/T3 refusals, observational proof, StepExecutor replays counted only on a passing step, persistence and staleness through JsonProfileStore and the Flow Designer save mapping."
  },
  "verify:ai-locator-upgrade": {
    class: "real-browser",
    why: "L3 §6 controlled promotion, audit and revert in real Chromium on the mock-site Locator Upgrade Lab: evidence earned by StepExecutor replays, refusals for unverified, replay-rejected, superseded, stale, T3, non-promotable, dirty-editor and provisional-threshold cases, the promoted locator executing and surviving save/reload through JsonProfileStore and the Flow Designer mapping, concurrent promotions collapsing to one write, and revert restoring the exact previous locator without overwriting a newer edit."
  },
  "verify:ai-locator-upgrade-gui": {
    class: "real-browser",
    why: "Drives the real Electron Flow Designer: the locator-upgrade panel renders the lifecycle state, the Apply control is offered only when the main process says the promotion is permitted, an unsaved editor defers it, and the applied upgrade's one-click revert restores the saved locator on disk."
  },
  "verify:ai-assist-gui": {
    class: "real-browser",
    why: "L3 §1 first: in the real Recorder, Open Element Spy launches the Recorder's own Chromium on the Feature Test Lab and a trusted click inspects an element through that browser's own Playwright connection (captured in main, never a second browser); Find stronger locator with AI crosses the real preload and IPC, and main's §7 loop compiles, guards and proves the scripted plan on that live page before the panel shows it labelled and applied nowhere; a wrong-element plan is refused in the browser, a T3 element before any model call, Cancel and a new inspection release the job in main with no late answer painted, a reloaded document withholds the old inspection's answer, AI off leaves the Spy working, a protected page is never inspected, and Close Spy or closing the page ends a pending job; no flow, fragment, report or draft changes. Then drives the real Electron Flow Designer through the L4b authoring assist with the deterministic test provider (AWKIT_TEST_AI_PROVIDER, non-packaged builds only): the open flow crosses real IPC, main re-validates it and answers through the production AiService, each labelled explanation renders under the validator finding it names, the fix order marks only validator-fixable findings and applying still opens the deterministic preview, an edit withholds the stale answer, cancel releases the job in main, a refused answer renders none of its text, AI switched off disables the control while every finding still lists and navigates, and the saved flow stays byte-identical throughout; plus L6 in the same app: the insert dialog describes the STORED fragment on demand (labelled, cancellable, an empty answer refused, a malformed request refused in main, Describe disabled with AI off), and the save dialog's no-model similarity hint follows the checked steps with AI off (one shared step of two gives none, the full shape does) while no fragment on disk changes; plus L5b: a failed run seeded through the real SqliteRuntimeStore with diagnostics from L5a's real EvidenceBuffer and deriveFailureCause opens from Failure Analytics into the run-detail drawer showing its deterministic cause and every captured event with no stripped query secret or row id, the on-demand analysis is labelled in its own section, reports how many instances share the signature and marks the evidence it cites, an answer citing uncaptured evidence is refused with none of its text rendered, and with AI off the evidence and cause still show while the control is disabled. Says nothing about live-model quality or latency."
  },
  "verify:ai-locator-status": {
    class: "unit",
    why: "L3 §10 Intelligent Locator status vocabulary: every badge and lifecycle state derived from real FlowProfile fixtures through the same describeFlowLocatorUpgrades the IPC channel calls, asserting that a proposal is never reported as applied, capture proof is not replay eligibility and replay eligibility is not authorization, one refused replay is terminal, a stale or T3 or policy refusal keeps its own sentence rather than a shared fallback, absent proof evidence renders as unavailable rather than as a passed gate, an applied upgrade names its tier, proof, model and retained revert target, and no typed value, named secret, prompt text or data-row key reaches a view or an evidence row."
  },
  "verify:ai-locator-attempts": {
    class: "real-browser",
    why: "L3 §7 bounded synthesis attempts in real Chromium on the mock-site Locator Upgrade Lab: the real AiService over the deterministic fake transport, a budget of two attempts consumed only by real rejections, a repeated candidate neither refreshing the budget nor being re-proven, malformed/compiler/intent refusals kept off the page, wrong-element and ambiguous candidates rejected by the browser gates, protected-login and expired-context refusals terminating the job, cancellation cancelling on the host without storing a late answer, superseded and concurrent proposals resolved by the flow store's compare-and-swap, and runs that pass unchanged while the provider times out, crashes or is absent."
  },
  "verify:ai-fragment-assist": {
    class: "integration",
    why: "L6 Intelligence over the real auditFragment and the real AiService: deterministic discovery that needs no model or index and compares step SHAPE so a reordered fill pair still matches and renaming every step changes nothing, capped and stably ordered; the T0 summary carrying step types and input keys but never a step name, locator or typed value; and the T1 parameter mapping, where a password workflow input is excluded from the request, the prompt and the grammar's key enum AND still refused as CREDENTIAL_TARGET if it reaches the parse, two fragment inputs cannot be aliased onto one workflow input, a type mismatch is refused by the declarations rather than the model's confidence (both duplicate cases use type-compatible pairs so the type rule cannot shadow them), an unmapped input is a correct answer, and neither feature has any schema field through which it could bind or apply."
  },
  "verify:ai-error-analysis": {
    class: "integration",
    why: "L5b coalescing and the post-run analysis contract over L5a's REAL EvidenceBuffer and REAL deriveFailureCause, so every event is redacted and id-stripped and every baseline is the product's own conclusion: 500 identical data-row failures collapse to one group and exactly one planned model call because the signature excludes instance, row, timing and repeat count, while a different status on the same route and the same status on a different route stay distinct; the per-batch analysis budget and the distinct-signature cap both bind, and a declined group keeps its deterministic baseline and names BATCH_BUDGET rather than vanishing; the request's evidence-id space is a closed enum re-checked after decoding, the schema has no field for a status, retry, policy or workflow edit, and an answer attempting one is refused by the real AiOutputContract; a conclusion with no cited evidence is refused as a guess, insufficient is a first-class answer, and claiming both is refused as contradictory; and the prompt carries the path template (through the rescanned ids channel, because the prompt builder redacts whole URLs in text) but no row identifier, query token or instance id."
  },
  "verify:ai-authoring": {
    class: "integration",
    why: "L4b authoring explanations (T0) and safe-fix ranking (T1) over the REAL FlowValidator on a real broken profile, so the emitted safeFix set is the product's own: the answer schema carries no field through which a fix kind could be returned, issue ids are a closed enum built from that report AND re-checked after decoding, ranking is narrowed further to only the ids the validator emitted a fix for so FIX_NOT_EMITTED refuses a model proposing a repair of its own, duplicates and unknown ids and empty or control-character prose are refused with a field path and never an echoed value, an invented fix field is refused by the real AiOutputContract inside the real AiService before this module sees it, explanations are T0 and ranking is T1 with configuration unable to raise either, the prompt carries codes and severities and generated anchors and product-authored rule summaries but never a validator message (which embeds the step name) nor a locator, typed value or fix literal, and re-validating the same profile afterwards yields identical codes, severities and emitted fixes."
  },
  "verify:ai-deadlines": {
    class: "unit",
    why: "Each product AI feature's own deadline on a virtual clock, with the production AiService and its production limits over the fake transport: failure analysis through analyzeFailure over a report built by L5a's real evidence buffer and cause baseline, and the L3 §7 locator job through runLocatorUpgradeAttempts. An answer past the old shared 30 s and one at the feature's L1.8 ceiling plus the measured overhead are delivered; a hang ends TIMEOUT at exactly the feature's deadline and is cancelled on the host; a locator job's second attempt gets a deadline of its own; a user cancel ends cancelled; a late answer is neither stored nor seen by the next request; a host killed at the deadline is reloaded; and every feature's deadline equals its L1.8 ceiling plus 5 s, sits inside the service's limit, which is the longest of them, while the fragment summary keeps 30 s."
  },
  "verify:ai-job-status": {
    class: "unit",
    why: "Phase L L9 (awkit-djnl.13), deterministic. A: the budget table's defaults are the closed evidence values inside committed bounds, apart from the L1.8 ceilings and the cancel grace; out-of-range, fractional, unknown and non-object budgets are refused (never clamped) with main's own bounds; a pre-L9 settings file loads unchanged and a stored out-of-range value reads as the default; the service's limit is recomputed from the table; a changed budget un-qualifies exactly the features under it (TIME_BUDGET_CHANGED). B: the AiJobTracker under an injected clock: every state and stage transition, determinate progress only in copy-hash and model-load and never past its denominator, a stage change clearing progress, an ETA only from measured history counted down and saying overrun, cold/warm, requeue, a stale estimate ignored after a requeue or the job's end, cancel not undone, terminal immutability, per-owner listing and publishing, bounded retention, only completed jobs of known warmth recorded. C: the production AiService over the fake transport on a virtual clock: exact cold and warm stage sequences, the runtime's load fraction as the only determinate progress, generation only at the first token, queue positions and hold reasons, cancel queued and running, timeout at exactly the feature's budget and recovery, configured, model-load and probe budgets, yielding, GPU-Offload fallback and GPU-Only refusal profiles with no placement assumed for an ETA, owner validation, disable and shutdown reasons. D: the ETA history on a real filesystem: ranges and confidence, cold and warm apart, per-list caps in the file itself, key caps and LRU, refused keys and durations, restart persistence, newer versions never overwritten, corrupt files preserved, serialized writes, no prompt text. E: model copy byte progress and cancel keeping nothing."
  },
  "verify:ai-job-status-mutations": {
    class: "integration",
    why: "The mutation run of verify:ai-job-status (L9), with verify:ai-display-gate-mutations' in-memory hook (scripts/helpers/source-mutant-hooks.mjs), so no product file is written: 53 mutants break one rule each across AiJobStatus, AiEtaHistory, AiTimeBudgets, AiSettings, AiQualification, AiService and AiModelPack (progress outside a measurable stage or past its denominator, progress kept across stages, overrun and countdown, what is recorded, no-history and pending, stale estimates, requeue, cancel, terminal immutability, owner scoping, retention, confidence, history keys, durations, cold/warm mixing, per-list and key caps, LRU order, newer-version and corrupt-file handling, trimming, serialized writes, budget bounds, clamping, unknown and stored values, changed-budget qualification, feature, load and probe budgets, stage reporting, warmth, timeout state, cancelling, queue positions and hold reasons, owner ids, assumed GPU placement, fallback reasons, copy progress and aborted copies). A survivor or crash fails; each file loaded unchanged through the hook must pass in full; the source is byte-identical afterwards."
  },
  "verify:ai-locator-sweep": {
    class: "unit",
    why: "L3 §9 idle flow health sweep, pure: the sweep held by an active OR queued run, host pressure, a dispatch refusal, low memory and no weighted headroom through the same decideAiAdmission one inference obeys; the durability report complete for every scanned step with its class histogram summing to the step count and every step either queued or carrying a skip reason; T3 steps never queued and counted as BOTH forbidden and weak so neither total understates the flow; a step with a proposal in flight or an applied upgrade left alone, while a pending candidate whose binding no longer matches does NOT shield it; and the per-sweep job cap bounding the queue and the deferred count without ever truncating the audit, clamped so a caller can lower it but never raise it above the documented maximum; and the standalone buildLocatorDurabilityReport (the Flow Library's) equal to the sweep's own report, present while a run holds the sweep and unbounded by the cap."
  },
  "verify:ai-locator-repair": {
    class: "real-browser",
    why: "L3 §8 runtime locator repair in real Chromium on the mock-site Locator Upgrade Lab: gate E refusing BASELINE_HEALTHY while the saved locator still resolves, gate C proving a candidate against the step's SAVED identity (a real fingerprint written by a real run, never seeded) at LocatorFactory's own 0.9 threshold so a unique buildable look-alike is still refused WRONG_ELEMENT, a missing identity anchor refused rather than guessed, the compiler and intent guard still running before the page, protected-login terminating the job, only a proven repair stored (never unprovable-now, which replay could never settle for a baseline that does not resolve), promotion refused for mode auto because locatorRepair's ceiling is T1 and accepted for a user with an EMPTY replay tally, the audit record attributed to locatorRepair with proof repair-proven and no replay counts, the promoted locator actually passing a run on the page that broke it, one-click revert restoring the exact previous locator, and the §10 badge reading repair-proven with the replay threshold reported as not applicable."
  },

  // ── Phase L (local AI) — L1 foundation ───────────────────────────────────────────────────────
  "verify:ai-autonomy-policy": {
    class: "unit",
    why: "Exhaustive tier matrix, T3 unreachability under every configuration, ceilings and the T2 cap, and self-demotion thresholds, against an independently restated decision table; pure policy in-process."
  },
  "verify:ai-permissions": {
    class: "unit",
    why: "Every built-in role asserted in both directions for ai.use, ai.manage, ai.audit.view and recorder.elementSpy, pinned permission values, re-auth for AI management only, and deny/grant overrides; then parses the ai.ipc handler source so every ai:* channel is gated, authorizes BEFORE acting, and the preload exposes exactly the gated set; and parses aiRuntime so the test AI provider and the L8a.4 test GPU fixture (AWKIT_TEST_AI_GPU) each return on app.isPackaged before reading either variable, and neither variable is read anywhere else.",
    guards: ["src/security/authz/Permissions.ts", "app/main/ipc/ai.ipc.ts", "app/main/preload.ts"]
  },
  "verify:ai-adapter": {
    class: "unit",
    why: "AiService over the deterministic FakeAiHostTransport: handshake/load, one inference at a time, priority/FIFO, queue bound, cancel, timeout, crash/restart and circuit, malformed and schema-rejected output, yield to runs and its bound, idle unload, shutdown and states. In-process; no model or Electron."
  },
  "verify:ai-redaction": {
    class: "unit",
    why: "buildAiPrompt redaction, delimiter-nonce injection containment, caps, id validation and residual-secret refusal, then end to end through AiService asserting what the fake host received and that logs carry codes only."
  },
  "verify:ai-fallback": {
    class: "static-source-validation",
    why: "Degraded modes (switch off, no runtime, no/invalid model, open circuit, throwing providers) return codes with zero host calls, plus a resolved-import TRANSITIVE CLOSURE walk proving nothing the execution tree reaches — at any depth — reaches the model (service, prompt builder, fake transport, host protocol, host), that the renderer cannot import the inference machinery, and that the preload's ai:* roster is exactly the seven admitted channels.",
    guards: [
      "src/runner",
      "src/recorder",
      "src/orchestrator",
      "src/instances",
      "src/session",
      "app/renderer",
      "app/main/preload.ts",
      "src/ai"
    ]
  },
  "verify:ai-settings-gui": {
    class: "real-browser",
    why: "Real-Electron walkthrough of Settings › Local AI on an isolated profile: AI off with no pack/runtime/audit by default, tier selectors bounded by each feature's ceiling, and the master switch and a lowered tier persisting to ai-settings.json on disk across navigation. L8a.4: Automatic (the default since 2026-10-03) and the three E4 modes as a keyboard-driven radio group, Automatic's GPU check informational and GPU-Offload's a warning, the VRAM reserve refused (never clamped) out of range with an accessible error, both themes on Hologram tokens; after a restart with the non-packaged test provider and GPU fixture, GPU-Only refusal told apart from GPU-Offload fallback for a missing pack, no NVIDIA adapter, mixed or unreadable adapters and low VRAM, fixture placements labelled unqualified, Automatic on every layer with one NVIDIA adapter (Runs on, GPU use and diagnostics' Running as name the mode the load ran as, GPU-Offload, chosen by Automatic, never Automatic as the runtime mode) and on CPU & RAM only (no fallback) with a mixed set, a mode change and a reserve-only change each unloading the idle model, a slow load showing its real stage, and a pre-L8a settings file reading as Automatic."
  },
  "verify:ai-settings-gpu-gui": {
    class: "real-browser",
    why: "L8a Automatic on REAL hardware: the real Electron app on an isolated profile with neither the test AI provider nor the GPU fixture (both refused), the pinned Vulkan pack installed and the pinned Qwen3.5-0.8B imported through Settings' own dialogs, trust chain and stores, every AI request answered by the real runtime. The stored mode stays auto on disk; before a load the GPU check and diagnostics show the production readiness (NVIDIA adapters by PCI vendor ID, the pack installed) as information and claim nothing; a real request's pushed job profile (ai:jobStatus) is GPU-Offload on Vulkan, never auto, and Runs on, GPU use and diagnostics' Running as name GPU-Offload as chosen by Automatic, with Vulkan and the layer count; a process maps ggml-vulkan.dll from the app-managed pack and nvidia-smi shows the model's VRAM; the label is the qualified list's (Compatible but unqualified on the GPU, Qualified on CPU & RAM for exactly the listed features); CPU & RAM only unloads the GPU load (VRAM given back) and answers on the CPU, and Automatic again resolves afresh onto the GPU; the pack removed through Settings is a real not-ready condition, under which Automatic answers on CPU & RAM only with no fallback reason and no refusal, and re-installing it puts the next load back on the GPU; no renderer error. Exit 2 NOT RUN without an NVIDIA adapter, the Vulkan prebuilt or the model, and INCONCLUSIVE while a Remote Desktop session is active."
  },
  "verify:ai-gpu-automatic-lifecycle": {
    class: "real-browser",
    why: "L8a Automatic's lifecycle on the real hosts: verify:ai-gpu-host's pack import (production store, real trust chain) and staged 0.8B, then scripts/ai-harness/gpuLifecycle.ts mode gpuAutoLifecycle drives the production AiService with the stored mode auto and the product's own readiness over a pack-guarded Vulkan host and the CPU host. The first load resolves Automatic and answers (one readiness check, one guarded fork, nvidia-smi VRAM up); a request cancelled during prompt evaluation and one cancelled during generation (each waited for by its own reported stage, never a fixed sleep) end cancelled within the L1.8 3 s ceiling and leave the service available, and the next request is answered; the GPU host killed mid-inference fails that job (HOST_ERROR, one unexpected exit, circuit closed) and the next load resolves afresh on a new guarded host on the GPU; a release stops the GPU host and nvidia-smi shows its VRAM given back; a reload answers; readiness SUBSTITUTED as VENDOR_UNPROVEN after a release (labelled) runs as CPU & RAM only with no GPU host, no fallback reason and no refusal, while GPU-Only under the same answer refuses with GPU_UNAVAILABLE (labelled control); readiness restored is back on the GPU at the next fresh resolution. Without proven NVIDIA only the CPU & RAM resolution is checked and the GPU lifecycle is NOT RUN (exit 2). Never NVIDIA qualification without a 0x10DE adapter (E11)."
  },
  "verify:ai-gpu-automatic-lifecycle-packaged": {
    class: "packaged-application",
    why: "verify:ai-gpu-automatic-lifecycle against dist/win-unpacked's AI tree: the packaged ai-host.cjs (byte-identical to the source host, or the package is stale and FAILS), the packaged pinned runtime and CPU prebuilt, and the Vulkan pack imported with trust from the packaged signed manifest and runtime DLLs, driven by the source service and managers. The same Automatic lifecycle: resolve and answer, cancels, a killed host and a fresh resolution, release with VRAM given back, reload, the labelled not-ready leg beside GPU-Only's refusal, and restore. Exit 2 without the package, runtime, Vulkan prebuilt or model, or without proven NVIDIA."
  },
  "verify:ai-gpu-quality": {
    class: "real-browser",
    why: "L8a, the curated 0.8B's GPU quality against its qualified CPU & RAM configuration: every live acceptance gate of the three qualified features (failure analysis and locator upgrade accepted, L3's locator-quality set judged by the page in real Chromium, L4b's authoring and L5's error labelled sets in --cases groups of at most three model calls that cover every case once) through the existing launcher with --execution auto, each with its own set, judge, deadlines and thresholds and nothing re-judged. Prints each gate's checks and exit, its recorded quality (L5 accuracy, attribution, declines and evidence links; L4b delivery and proxies; L3 evidence totals) and every model call's resolved mode, backend, offload, cold load, first token, generation and tokens, summed. Records Windows' display adapters and this process's session at the start and end, and keeps topology and compute apart (scripts/ai-harness/gpuQualityEvidence.ts): a run at the physical console with no Remote Desktop adapter is a physical-console topology qualification, any other never is; the GPU is proven independently of topology from NVIDIA-only PCI compute adapters unchanged across the run (the Remote Display Adapter is display topology, never a compute device), every call's GPU-Offload on Vulkan with all layers and a vulkan/full answer, the pack-guarded host, off the console the runtime's own GPU-plan Vulkan device count within Windows' NVIDIA PCI adapters (readiness counts the GPU twice under Remote Desktop), and nvidia-smi read with no gate running before each gate and after the last showing at least the model file's size held over idle. A call off the GPU after Automatic resolved to it FAILS (exit 1); a device that cannot be proven, or an Automatic run that did not resolve to the GPU, is INCONCLUSIVE (exit 2). Authoring captures go to this qualification's own review store, never the one verify:ai-authoring-review judges. Exit 2 without the runtime, the Vulkan prebuilt or the model."
  },
  "verify:ai-gpu-quality-part1": {
    class: "real-browser",
    why: "verify:ai-gpu-quality's first part under --execution auto, so it fits the 600 s tool ceiling: the failure-analysis and locator-upgrade feature gates, L4b's whole authoring set in its three groups and L3's locator-quality set, with the same judges, execution checks, console/topology record and summary. Part 2 runs the whole L5 error set; together they are exactly verify:ai-gpu-quality's thirteen gates."
  },
  "verify:ai-gpu-quality-part2": {
    class: "real-browser",
    why: "verify:ai-gpu-quality's second part under --execution auto: L5's whole error set in its seven --cases groups (every labelled case once), with the same judges, execution checks, console/topology record and summary, so the L5 metrics (baseline and AI accuracy, false attribution, declines, evidence links) are summed over the whole set in one run."
  },
  "verify:ai-gpu-quality-cpu-baseline": {
    class: "real-browser",
    why: "verify:ai-gpu-quality's same gates, groups, judges and summary under --execution cpu: the qualified CPU & RAM configuration (no execution mode stored, as the qualified evidence ran) on this machine, every call recorded as on the CPU, so the GPU arm is compared on one machine and one commit. Runs anywhere; on a CPU slower than the qualifying host its latency is this machine's, never the qualified latency class. Exit 2 without the runtime or the model."
  },
  "verify:ai-progress-gui": {
    class: "real-browser",
    why: "Phase L L9 (awkit-djnl.13) in the real Electron app on an isolated profile, with the non-packaged deterministic provider (production queue, prompt, output contract, tracker and ETA history; only the transport scripted): a cold explanation's one named progress bar, determinate only while the runtime reports its load fraction and with no aria-valuenow in prompt evaluation and generation, stage names and elapsed time in its value text, no estimate with no history, polite announcements throttled below the number of stage changes; a warm run with no warm history then a measured range from one earlier warm run; Enter starts and cancels on the same control with focus never dropped; reduced motion stills the indeterminate sweep and without it the sweep runs; the fragment dialog's focus trap holding while its job runs; Settings › Time limits loading a pre-L9 file at defaults, refusing an out-of-range value with main's bounds as an alert tied to the field and nothing written, saving a valid one, a hung job then timing out at that limit, Use default restoring it, the measured-speed row; after a restart a cold run's ETA from the cold run measured before it; the history file versioned with latency-class keys and integer durations only."
  },
  "verify:ai-host": {
    class: "unit",
    why: "Evaluates the real native-hosts/ai/ai-host.cjs source under a fake parentPort with an injected fake node-llama-cpp: envelope and prototype-safe dispatch, runtime identity, model-path confinement including a junction escape, CPU-only never-build load options, schema-to-grammar translation, the thinking-disabled template with page text kept out of special-token parsing, prompt bounds, running and queued cancellation, arrival order, one inference at a time, shutdown and no runtime-text leaks, plus source constants against the TypeScript contract. L8b.2's inspect: the confined real path, a filesystem-only no-split reader with a live abort signal, nothing native loaded, every header fact, unreadable as an answer with no error text, vetted architecture names with no prototype or inherited keys read, unknown tensor types counted, template shapes, unsafe counts as null, and an endless header read ended by the host's deadline (below the manager's) with the serial queue freed. Then requires thirty in-memory source mutations to fail the suite.",
    guards: ["native-hosts/ai/ai-host.cjs", "src/ai/contracts/AiHostProtocol.ts", "src/ai/AiOutputContract.ts"]
  },
  "verify:ai-host-electron": {
    class: "real-browser",
    why: "Launches a real Electron app directory that drives the production AiUtilityHostManager against the real ai-host.cjs in a utility process: handshake reporting whether the runtime is installed, out-of-root and damaged-GGUF refusals the host survives, the runtime kept out of the main process, a killed host detected and restarted in a new process, the circuit opening on the third crash, and disposal leaving no process. No model."
  },
  "verify:ai-packaged-runtime": {
    class: "packaged-application",
    why: "Phase L L7 packaging: stages the pinned node-llama-cpp runtime with scripts/prepare-ai-native-host.mjs into a temp directory OUTSIDE the repository (so module lookup cannot climb into the repository's node_modules), checks every file against the staged manifest in both directions, the host and addon byte-identical to their sources, CPU prebuilt only, and every declared runtime dependency resolving inside the tree; loads the runtime from that isolated copy in Electron's Node with two negative controls (no CPU prebuilt, one JS dependency removed) that must fail; handshakes the production AiUtilityHostManager with the staged host in a real utility process; runs the live harness on it with the pinned 0.8B pack (NOT RUN without it); and repeats integrity, identity with the current staging and the isolated load on dist/win-unpacked's tree. Also: black-box refusals of a byte-identical copy of the staging script in scratch repositories (an ambiguous, unpinned, malformed or conflicting AI_RUNTIME_PIN, package.json declaring node-llama-cpp twice, node_modules, a runtime package or --out reached through a junction); the strict validator's pin and path-by-path inventory rules through -RootPath on scratch roots; a PE-import check that every DLL the staged binaries import is staged or ships with Windows; the staged packages' licenses against the inventory and reproduced notices in resources/THIRD_PARTY_NOTICES.md; a model-file scan of the whole packaged artifact including app.asar members (by .gguf/.ggml name, GGUF magic or a pinned pack's size) behind three controls; and any dotfile in a staged or packaged manifest refused, because the installer may drop one. Exit follows gateExitCode: 1 on any failure (a package without the AI tree, or with one that is not the current staging, is stale and FAILS), 2 when a required section is NOT RUN (no dist/win-unpacked, no pack), 0 only when every section ran and passed; section F proves both packaged AI gates exit 2 for a gate that did not run."
  },
  "verify:ai-packaged-app": {
    class: "packaged-application",
    why: "Phase L L7: the first packaged AI gate. Launches dist/win-unpacked/SpecterStudio.exe on a fresh isolated LOCALAPPDATA, creates its first account through the real setup screen, then through the app's own IPC only: the packaged main process finds its runtime in resources/native-hosts/ai with the pinned build and no bundled model pack, AI enabled with no pack is MODEL_MISSING and never RUNTIME_MISSING, the pinned 0.8B imports through ai:importModelPack (only the file dialog is answered in main) into the writable profile and nowhere in resources, and a validation explanation runs a real inference in the packaged utility host under its own deadline, naming the pinned model although AWKIT_TEST_AI_PROVIDER points at a scripted answer. Before launch it reads every file of dist/win-unpacked and every app.asar member for a model file, and after the import it re-reads the packaged resources. L8b.2 and L8b.3: importing a model the manifest does not list runs its header check and probe in the packaged host, so a Llama-3-template header reads registered/CHAT_TEMPLATE and a compatible header with no weights registered/PROBE_LOAD_FAILED, each with AI MODEL_INCOMPATIBLE. L8b.5: every import is the preflight (file, size, free space, need, nothing copied) then the copy named by a one-time token, refused on reuse; L8b.4: the curated 0.8B reads Qualified on CPU & RAM for its three limited-GO features with speed unclaimed. NOT RUN exits 2 (never 0) without the packaged AI tree or the pack, a stale package FAILS (exit 1), a TIMEOUT is INCONCLUSIVE (exit 2)."
  },
  "verify:dom-intelligence-packaged": {
    class: "packaged-application",
    why: "L11 (awkit-djnl.19) packaged gate. Before launch: dist/win-unpacked/resources/native-hosts/dom-intelligence is exactly the signed manifest's domIntelligenceRuntime tree (the package's manifest byte-identical to the committed one; every asset present with its size and SHA-256; nothing unlisted; the runtime's descriptor, the one unlisted file as in validate-offline-bundle.ps1, naming the schema and entries main launches and exactly the signed assets; the pinned corresponding sources, an LGPL one among them, under sources/ with their pinned SHA-256 for LGPL-2.1 section 6). Then dist/win-unpacked/SpecterStudio.exe on a fresh isolated LOCALAPPDATA creates its first account through the real setup screen; no host runs after launch and sign-in; its own IPC and the Settings card report the runtime shipped and Available with the pinned Scrapling version, parser-only, browser and network access disabled, and the snapshot recovery engine; exactly one python.exe from the packaged tree runs, a child of the packaged main process; and a graceful quit leaves no python.exe from that tree, checked before the forced teardown. NOT RUN exits 2 (never 0) without the packaged runtime tree, a stale package FAILS (exit 1)."
  },
  "verify:ai-model-registration": {
    class: "packaged-application",
    why: "Phase L L8b acceptance (awkit-djnl.12, E11: the development machine, the packaged build). Launches dist/win-unpacked/SpecterStudio.exe on a fresh isolated LOCALAPPDATA with its first account created through the real setup screen. A: Qwen3.5-2B, which the manifest does not list, registers through the app's own IPC: the preflight names the file, size, free space and need before any copy (none on disk yet), the copy lands under its checksum with a registry holding both verdicts and no path, the packaged host's header check and probe pass, it reads COMPATIBLE, Compatible but unqualified (no quality evidence, speed unclaimed) and MODEL_UNACKNOWLEDGED, and the acknowledgement is given in Settings itself (button, dialog naming the model and its missing quality evidence, confirmation) after which AI is available. B: a malformed GGUF reads GGUF_UNREADABLE and an unknown architecture ARCHITECTURE_UNSUPPORTED, each Incompatible with AI MODEL_INCOMPATIBLE, and a replacement drops the acknowledgement. C: an unlisted copy of the 0.8B that differs by one byte of name metadata registers compatible yet unqualified (qualification keyed on the checksum), is acknowledged over IPC and answers a real validation explanation named external-<sha12>. D: one byte flipped in the stored copy after hashing, same size, is refused before the next load (HASH_MISMATCH, MODEL_INVALID) with the host's circuit closed. Exit follows gateExitCode: 1 on any failure or a stale package, 2 without the packaged AI tree or the models in ~/Downloads, or on a TIMEOUT under the feature's deadline, 0 only when every step ran and passed."
  },
  "verify:ai-progress-packaged": {
    class: "packaged-application",
    why: "Phase L L9 PACKAGED_LIVE (awkit-djnl.13, E11: the development machine, the packaged build). Launches dist/win-unpacked/SpecterStudio.exe on a fresh isolated LOCALAPPDATA (its AI host byte-identical to the source host, the payload not older than the source), creates its first account through the real setup screen and watches every ai:jobStatus pushed to its window: the pinned 0.8B's copy is a model-import job determinate by bytes to exactly the file's size; CPU & RAM only, a real explanation in the packaged host is cold with the runtime's own load fraction as the only determinate progress, no history and no ETA, under the explanation budget; warm without then with warm history (a measured range from exactly one run); Settings' measured speed for this configuration with qualification claiming no latency; GPU-Offload's and GPU-Only's real product answers on this machine (a cold CPU reload with the fallback reason in the job's profile; a refusal as the job's terminal reason with no load and no progress), or real placement where the adapter is eligible; the ETA history on disk versioned under the profile, keyed by the pack's checksum and configuration, durations only; after a restart a cold run's ETA from exactly the cold samples on disk. The test provider is set and ignored. GPU placement mechanics are verify:ai-progress-gpu-packaged; NVIDIA stays BLOCKED without a 0x10DE adapter (E11). Exit follows gateExitCode: 1 on any failure or a stale package, 2 without the package or pack or on a TIMEOUT, 0 only when every step ran and passed."
  },
  "verify:native-dependencies": {
    class: "packaged-application",
    why: "Phase L L7 packaging (awkit-i6ot): every native binary in dist/win-unpacked (Electron, the bundled Chromium, the Zvec binding, the local-AI runtime) must find its DLLs on a Windows machine with nothing else installed. Static: every PE image's import and delay-load directories are read, and an import resolves only as an API set, beside its importer, node.exe for a Node addon, or a System32 file validly signed \"Microsoft Windows\" — so a Visual C++ runtime a developer machine installed globally (signed by another Microsoft publisher) does not count, which controls prove on kernel32.dll and on the host's own runtime DLLs. Loader-level: for the AI runtime (getLlama), its reflink addon and the Zvec binding, a scratch copy of each tree has every imported name this host could satisfy from outside the tree rewritten, same length, to a decoy no directory holds (files inside renamed to match), and the module must still load; the unpatched copy must load first. Exit follows gateExitCode: 1 on any failure, 2 without dist/win-unpacked, 0 only when all ran and passed."
  },
  "verify:ai-gpu-backend-gate": {
    class: "packaged-application",
    why: "Phase L L8a.0 (awkit-djnl.11): the Vulkan backend gate on the packaged build. Inventories the pinned @node-llama-cpp/win-x64-vulkan pack (every file's size and SHA-256, x64 images, imports from outside the pack limited to the Vulkan loader and the Visual C++ runtime, Authenticode status); proves dist/win-unpacked carries no llama.cpp/ggml GPU backend (a control proves the scan flags one) and reports the separate pack's size; reads every display adapter by PCI vendor ID, the driver versions and the Vulkan loaders. Then, in a real Electron utility process, loads the packaged AI tree with the pack staged in a separate app-managed folder through an ESM resolve hook, with every import this host could supply from outside the layout rewritten to a same-length decoy (the L7 native-dependencies method; the driver's Vulkan loader exempt), and audits the process's own module list: the addon and ggml-vulkan.dll come from the app-managed folder and nothing the runtime resolved comes from the repository, PATH or a CUDA Toolkit. Controls: the unpatched copy loads; the pack without its app-local Visual C++ runtime must not load; CPU mode loads nothing from the pack. Records adapter pinning by per-spawn GGML_VK_VISIBLE_DEVICES and the 3.21.1 sizing APIs (GGUF insights, estimates, layer resolution) with CPU, partial and full offload measured on the pinned Qwen3.5-0.8B pack. Exit follows gateExitCode: 1 on any failure, 2 without dist/win-unpacked, an NVIDIA adapter with a Vulkan driver, or the pack, 0 only when every section ran and passed."
  },
  "verify:ai-backend-manifest": {
    class: "integration",
    why: "Phase L L8a.1 (awkit-djnl.11): the release-owned GPU backend manifest. A: src/offline/ai-backend-manifest.json resolves to exactly the frozen Vulkan entry for AI_RUNTIME_PIN.build, AI_RUNTIME_PIN.backends is cpu plus every manifest backend, and the structural check and fail-closed resolver refuse 15 + 5 negative controls (traversal, backslash, absolute and drive paths, a model file, bad hashes and sizes, a case-variant duplicate, no addon, another package, version or backend; another build or schema, a duplicate or unpinned backend). B: the manifest equals the installed @node-llama-cpp/win-x64-vulkan prebuilt as a set (with the staging script's exclusions) and file by file (size, SHA-256). C: the real strict validator through -RootPath on scratch roots: a consistent root draws no backend problem, and a signed copy absent, different or bundled, a source for another build, with a traversal path, a case-variant duplicate or no addon, a pin whose backend set omits vulkan, and a pinned binary shipped under another name each draw their own message. D: the committed resources/dependency-manifest.json verifies against its Ed25519 signature and its aiGpuBackends equals the source. Exit follows gateExitCode: 1 on any failure, 2 without the installed Vulkan prebuilt, 0 only when every section ran and passed."
  },
  "verify:ai-backend-pack": {
    class: "integration",
    why: "Phase L L8a.2 (awkit-djnl.11): AiBackendPackStore on real temp folders. A: synthetic packs refused with the exact code, by checklist and import alike, leaving nothing behind — missing, same-size-modified, resized, renamed, other-build and other-backend packs, an extra DLL, a native image named .txt, a runtime DLL supplied by the pack, an extra script, plain file or empty folder, a junction inside or as the selected root, a file symlink (NOT RUN without the privilege), too many entries, and manifest entries with traversal or absolute paths. B: an unverified signed manifest or app runtime, runtime bytes that differ from their trusted hash while copying, and free space one byte short of pack + runtime + headroom or unmeasurable. C: a valid import into a versioned directory with the app's own runtime DLLs, a registry holding only the directory name, every write inside the backends root, an idempotent re-import that copies nothing, and a runtime name escaping the staging refused. D: cancellation mid-copy and of a replacement, crash leftovers (staging, orphans, temp files, a junction never followed) recovered. E: source changed while copying, staged file altered or DLL planted before promotion, failed promotion — each keeps the previous pack; a cross-build replacement lands in a new directory. F: the load guard refuses altered, deleted, planted, runtime-replaced, truncated and junction-swapped packs and outside-pointing or deleted registries, with a CPU fallback, sticky until re-import and never repairing. G: removal, CPU independence and packaged/dev trust paths. H/I: the committed signed manifest, the dev staged runtime and the real pinned 24-file pack end to end, and the shipped runtime in dist/win-unpacked."
  },
  "verify:ai-backend-pack-gui": {
    class: "real-browser",
    why: "Phase L L8a.2 (awkit-djnl.11): real-Electron walkthrough of Settings › Local AI › GPU backend pack on an isolated profile with the real pinned pack and only the folder dialog answered in main: not installed and GPU use not active on a fresh profile; a closed dialog shows nothing; an extra-DLL folder refused by name with focus on the checklist and no import offered; a valid folder's full preflight (backend, build, source, destination, size, free space, headroom, 24 of 24 validated, identical-pack state, warning) with nothing copied before confirmation; accessible progress and cancel while copying; on-disk registry and 24 + 3 files with this build's own runtime DLLs; a flipped byte refused by Verify and persisted invalid without repair; replacement into a new directory; confirmed removal; no GPU-in-use claim and no renderer errors."
  },
  "verify:ai-backend-pack-packaged": {
    class: "packaged-application",
    why: "Phase L L8a.2 (awkit-djnl.11): verify:ai-backend-pack-gui's whole walkthrough against dist/win-unpacked/SpecterStudio.exe (app.isPackaged asserted), with the licence bypass stripped and a dist/ older than the sources refused. Proves the packaged path handling end to end: trust from the packaged resources/resources signed manifest, the app's runtime DLLs byte-identical to the copies shipped in resources/native-hosts/ai, and the backends folder under the isolated LOCALAPPDATA. Exit 2 without a packaged app, never 0."
  },
  "verify:ai-gpu-modes": {
    class: "integration",
    why: "Phase L L8a.3 (awkit-djnl.11): the production AiService, settings sanitizer and execution policy against a CPU and a Vulkan FakeAiHostTransport that keep the real host's backend rules. Settings: CPU default, pre-L8a files load unchanged, unknown modes and out-of-range reserves fail closed or are refused, never clamped. E2: NVIDIA only by PCI vendor 0x10DE (12 adapter sets incl. AMD-only, hybrid, unknown and software adapters) and every Vulkan device explained by NVIDIA adapters. E4 over 14 unavailable scenarios per mode (missing/tampered pack, no/unsupported GPU, hybrid, no readiness or GPU host, throwing readiness, non-Vulkan or incompatible GPU host, no usable device, extra devices, nothing fitting): GPU-Offload runs on CPU keeping the reason and stops the GPU host, GPU-Only refuses and never touches the CPU host. Sizing: full and partial offload, the exact GPU-Only shortfall, a bounded halving retry then CPU, no smaller retry for GPU-Only, the reserve in bytes. Lifecycle: a mode or reserve change reloads at the next job and never mid-inference, crash re-plans, cancel reaches the active host, idle unload, releaseModel and shutdown stop the GPU host. L8a.4 (section G): the service's own load stage recorded at each readiness check, model verification and host request (offload with retry, fallback, CPU, mode switch, GPU-Only refusal, failure and missing pack) and cleared after the load; a fallback or refusal is current only for the mode AND reserve that produced it (each alone withdraws it, GPU-Only unavailability included), the next load's profile belongs to the new settings; the plan's VRAM figures reported where a plan ran and never where none did. L8a.5 (section H): a GPU lost after a successful load (host exit or failed inference) fails that job, frees the GPU and re-plans against the VRAM free by then (fewer layers, or GPU-Only's new shortfall); at GPU_LOSS_LIMIT the setting stays off the GPU for the session (GPU-Offload on CPU, GPU-Only refusing, both LOST_AFTER_LOAD) until the mode or reserve changes, with the CPU host's circuit untouched; cancels, kills that honour them and CPU host crashes are never losses. Section I (E2 pending, 2026-10-02): nine hybrid adapter orders and mixes read VENDOR_UNPROVEN with no name, index or order read; under GPU-Offload a hybrid set answers on CPU & RAM, starts no GPU host and keeps VENDOR_UNPROVEN in status, view, log and a completed job's progress; GPU-Only refuses it; proven NVIDIA stays on the GPU in both modes. Section J (2026-10-03): a GPU host that exits while starting or a plan that times out falls back under GPU-Offload with its reason and a completed job, and GPU-Only refuses; a model that fails verification or a CPU load that fails after a fallback stays a failed LOAD_FAILED job, never an answer or a GPU reason. Section K (Automatic, the default since 2026-10-03): settings default to auto, a file with no mode reads as auto, a stored cpu is kept and an unknown value fails closed to cpu; proven NVIDIA runs as GPU-Offload on every layer with one readiness check and its job profile and label say so; a CPU-only or hybrid set runs as CPU & RAM only with no GPU host, no fallback reason, its readiness reason in the view, a CPU cold ETA and a CPU label before any load; proven NVIDIA that cannot take the model falls back with its reason and never refuses; a pack install or removal is followed at the next load without reusing the other mode's ETA; an explicit CPU & RAM only never touches the GPU; the execution view keeps the stored auto apart from the mode the load ran as (ranAs: GPU-Offload or CPU & RAM only, never auto)."
  },
  "verify:ai-gpu-harness": {
    class: "integration",
    why: "Phase L L8a (awkit-djnl.15): the GPU harness's own lifecycle rules, regression for the 2026-10-02 GTX 980M run where the product behaved and three instruments failed. A: MECHANICS observes a guarded fork: a host left running by the PRODUCT steps is released (the manager's own release) before exactly one guard run is required; a fresh host is observed normally; an unguarded launch, a double guard run, a call that starts nothing and a host surviving release all fail, nothing skipped. B: harness teardown records every host pid and, after dispose() returns while Windows still has the process, waits by pid until each is gone: normal completion, a kill to honour a cancel, an exhaustion run that throws and an early return; a host that never exits is a failed step naming its pid. C: the launcher removes its scratch folders only once Windows' module list shows nothing mapped from them, names owners, reports an unremovable folder with its code and never throws; real controls: the scan finds this process's own node.exe and real temp folders are removed. D: verify:ai-gpu-backend-gate section C sets aside Microsoft's remote and software adapters only by software enumerator AND name, a hardware adapter without its PCI vendor ID and an unknown adapter still fail, and runtime E2 is unchanged. E: the three GPU modes and the launcher are wired to these helpers, the MECHANICS precondition is found by its own label, and gpuLive's PRODUCT Automatic runs on the product readiness before MECHANICS with only its labelled not-ready leg substituted; gpuLifecycle's PRODUCT Automatic lifecycle (its own mode, gpuAutoLifecycle, apart from MECHANICS) runs on the stored mode auto and the product readiness, waits on observable state (the job's reported stage, a host exit, nvidia-smi) with no fixed sleep, and checks a fresh resolution after the restart, the release, the not-ready leg and the restore; the live quality modes' Automatic arm (liveExecution.ts) stores auto over the product readiness and a pack-guarded Vulkan host while the unset arm keeps the qualified CPU path. No GPU, model or Electron."
  },
  "verify:ai-gpu-host": {
    class: "real-browser",
    why: "Phase L L8a.3 (awkit-djnl.11): imports the pinned Vulkan pack through the production AiBackendPackStore and real trust chain, stages the pinned 0.8B, then drives the production AiUtilityHostManager and AiService against the real ai-host.cjs on the CPU and Vulkan backends in a real Electron app (scripts/ai-harness/gpuLive.ts). CPU host unchanged and refusing GPU requests; PRODUCT: this machine's adapters by PCI vendor ID and what GPU-Offload (CPU with the reason, no GPU host started) and GPU-Only (refused) do with them; PRODUCT Automatic (owner decision 2026-10-03) on the same readiness: the stored mode stays auto while the load and the job profile report the resolved mode, on proven NVIDIA exactly one guarded GPU host fork with every runtime binary from the pack, nvidia-smi VRAM up while loaded and back after the release, and the 0.8B labelled compatible-unqualified on Vulkan against its qualified CPU control; then a labelled leg with readiness substituted as VENDOR_UNPROVEN after a release (CPU & RAM only, no GPU host, no fallback reason, no refusal, the reason in the view) and re-resolution on the product readiness at the next load; MECHANICS with eligibility substituted and labelled: the pack guard before each GPU fork, the runtime's plan and a no-fit reserve, an offloaded load and inference, every llama.cpp binary in the GPU host loaded from the pack (Windows' own module list), the service's GPU-Offload, GPU-Only's real shortfall, the CPU fallback, CPU mode after, and a pack altered after import refused before any GPU host starts. Never NVIDIA qualification without a 0x10DE adapter (E11). Exit 2 without the runtime, the Vulkan prebuilt or the model."
  },
  "verify:ai-model-inspect": {
    class: "real-browser",
    why: "Phase L L8b.2 (awkit-djnl.12): stages the manifest's curated Qwen3.5 packs and Qwen3.5-2B, which the manifest does not list, from ~/Downloads by hard link (each proven on its side of the manifest by SHA-256), then scripts/ai-harness/modelInspect.ts drives the production AiUtilityHostManager against the real ai-host.cjs and the pinned runtime's own GGUF reader: every real model passes the static header check; thirteen hand-built header-only GGUF files each fail exactly their own check (chat template, architecture, tensor type, context, layers, version, unreadable) or pass (a ChatML qwen2), including a header claiming 2^62 entries that the host's deadline ends as unreadable; the host never restarts; an out-of-root path is refused. L8b.3: every real model then passes the probe (load, no think block in its first unconstrained tokens, the probe schema answered and validated), the weightless ChatML header fails the probe's load without restarting the host, and a copy of the host with the thinking-off pre-fill removed (written into node_modules for the run so it resolves the same pinned runtime, then deleted) reads THINKING_NOT_DISABLED on a real Qwen3.5 model. AiModelPackStore, runCompatibilityStages and AiService.inspectModel/probeModel with AI switched off record a header failure that is never probed and a replacement's header pass and probe failure; the main process never loads the runtime. Exit 2 without the runtime or a model (NOT RUN for that model), never 0."
  },
  "verify:ai-gpu-lifecycle": {
    class: "real-browser",
    why: "Phase L L8a.5 (awkit-djnl.11): verify:ai-gpu-host's pack import and staged 0.8B, then scripts/ai-harness/gpuLifecycle.ts drives the production AiUtilityHostManager (pack guard before every fork) against the real Vulkan host. For every layer and for a partial load: the cold fork, handshake and load; cancel latency during prompt processing and during generation against the L1.8 3 s ceiling (a cancel that lands after the inference finished is INCONCLUSIVE, exit 2); a host killed from outside and brought back with the model, one strike, circuit closed. Records how a loaded host behaves while other GPU hosts take the adapter's VRAM, what a fresh plan and load see under that pressure, and recovery once the VRAM is back. MECHANICS on this machine's adapter, never NVIDIA qualification (E11). Exit 2 without the runtime, the Vulkan prebuilt or the model."
  },
  "verify:ai-gpu-packaged": {
    class: "packaged-application",
    why: "Phase L L8a.5 (awkit-djnl.11): verify:ai-gpu-host's L8a.3 modes against dist/win-unpacked's AI tree: the packaged ai-host.cjs (byte-identical to the source host or the package is stale and FAILS), the packaged pinned runtime and CPU prebuilt, and the Vulkan pack imported with trust from the packaged signed manifest and runtime DLLs, driven by the source managers and service in a real Electron utility process (the L8a.0 method). PRODUCT: this machine's E2 answer and Automatic's resolution through the packaged host; MECHANICS: the pack guard, plan, offloaded load and inference, and the service's GPU-Offload, GPU-Only and CPU paths. Never NVIDIA qualification without a 0x10DE adapter (E11). Exit 2 without dist/win-unpacked, the runtime, the Vulkan prebuilt or the model."
  },
  "verify:ai-gpu-lifecycle-packaged": {
    class: "packaged-application",
    why: "Phase L L8a.5 (awkit-djnl.11): verify:ai-gpu-lifecycle against dist/win-unpacked's AI tree, with its own freshly imported pack and the same stale-package guard and packaged trust as verify:ai-gpu-packaged: cancel latency against the L1.8 3 s ceiling in both phases and the kill-restart-reload cost for every layer and a partial load, and VRAM taken after load observed. MECHANICS on this machine's adapter, never NVIDIA qualification (E11). Exit 2 without the package, runtime, Vulkan prebuilt or model, or when a cancel lands after its inference finished."
  },
  "verify:ai-progress-gpu-packaged": {
    class: "packaged-application",
    why: "Phase L L9 (awkit-djnl.13): verify:ai-gpu-packaged's pack import, packaged trust and stale-host guard, then scripts/ai-harness/gpuProgress.ts drives the production AiService with the production AiJobTracker and AiEtaHistoryStore against dist/win-unpacked's AI host on the Vulkan and CPU backends, eligibility substituted and labelled MECHANICS: GPU-Offload cold with the runtime's own load fraction as the job's determinate progress on the GPU, rising, in model-load only, no history and no ETA; warm with no warm history, then a measured warm range from exactly one run on that placement; GPU-Only placing every layer with its load progress or refusing with its reason and no progress; CPU & RAM only after, cold with its own fraction and no borrowed GPU estimate; the history holding each placement's cold and warm durations apart. Never NVIDIA qualification without a 0x10DE adapter (E11). Exit 2 without dist/win-unpacked, the runtime, the Vulkan prebuilt or the model."
  },
  "verify:ai-model-live": {
    class: "real-browser",
    why: "Credential-style gate on the owner-installed node-llama-cpp and downloaded Qwen3.5-4B pack (NOT RUN without them): measures the pack, requires the runtime pin and manifest entry, imports through AiModelPackStore with the real manifest, then drives the production AiService and AiUtilityHostManager against the real host in a real Electron utility process for constrained decoding, determinism, injection text, thinking off, special-token literalness, truncation, cancel, deadline, yield, crash recovery and shutdown."
  },
  "verify:ai-model-live-0-8b": {
    class: "real-browser",
    why: "verify:ai-model-live on the re-scoped Qwen3.5-0.8B pack from ~/Downloads (NOT RUN without the runtime or the pack; a pack that is not the published object fails): the same pins, the pack's own GGUF header against its manifest entry (architecture, context length, quantization), import through AiModelPackStore with the real manifest, and the live harness against the real host in a real utility process."
  },
  "verify:ai-explanation-live": {
    class: "real-browser",
    why: "Gate on the owner-installed runtime and the downloaded Qwen3.5-0.8B pack (NOT RUN without them; a pack that is not the published object is refused): launches a real Electron app directory that sends the product's validation explanation through explainFlowValidation, the production AiService with AUTHORING_LIMITS.timeoutMs, AiUtilityHostManager and the real ai-host.cjs over the L1.8 benchmark's flow — a real explanation delivered under its own deadline, a user cancel after 30 s settling within 3 s, and a deadline in prompt evaluation killing the host before a reloaded explanation is delivered."
  },
  "verify:ai-failure-analysis-live": {
    class: "real-browser",
    why: "Gate on the owner-installed runtime and the downloaded Qwen3.5-0.8B pack (NOT RUN without them; a pack that is not the published object is refused): launches a real Electron app directory that sends L5b's own request through analyzeFailure, the production AiService with FAILURE_ANALYSIS_LIMITS.timeoutMs, AiUtilityHostManager and the real ai-host.cjs, over a typical failure and the largest one the product sends, both built by L5a's real evidence buffer and cause baseline; every answer must arrive before the feature's own deadline, recorded with its tokens, timings and worst case at the output cap. With `-- --execution cpu|auto` (L8a, the 0.8B's GPU quality against its qualified CPU configuration) every model call's resolved mode, backend, offload, stages, timings and tokens are recorded; auto stores Automatic over the pinned Vulkan pack imported through the real trust chain and is GPU evidence only when every load resolved to GPU-Offload on Vulkan and every answer came from the GPU (INCONCLUSIVE where readiness does not prove NVIDIA)."
  },
  "verify:ai-failure-analysis-budget": {
    class: "real-browser",
    why: "Gate on the owner-installed runtime and the downloaded Qwen3.5-0.8B pack (NOT RUN without them; a pack that is not the published object is refused): launches a real Electron app directory that loads only the pack's vocabulary through node-llama-cpp, builds L5b's own requests through buildFailureAnalysisRequest over L5a's real evidence buffer and cause baseline, and counts on the model's own tokenizer: each prompt with the host's template, every offered evidence line shown whole, and the longest answer the grammar admits and the parser accepts, in both indentation layouts and with the longest ids L5a mints, within FAILURE_ANALYSIS_LIMITS.maxOutputTokens. No inference.",
    guards: ["native-hosts/ai/ai-host.cjs"]
  },
  "verify:ai-locator-upgrade-live": {
    class: "real-browser",
    why: "Gate on the owner-installed runtime and the downloaded Qwen3.5-0.8B pack (NOT RUN without them; a pack that is not the published object is refused): launches a real Electron app directory that runs L3 §7's own job, runLocatorUpgradeAttempts, through the production AiService with LOCATOR_ATTEMPT_LIMITS.timeoutMs, AiUtilityHostManager and the real ai-host.cjs, over a typical and the largest L2 capture context (the browser proof stubbed as page-unavailable); every attempt must be answered before the feature's own deadline, be the request locatorAttemptJob builds with every line shown whole, and the job must end accepted (decoded, compiled, past the intent guard, stored), recorded with tokens, timings, plan shape and worst case at the output cap. With `-- --execution cpu|auto` (L8a, the 0.8B's GPU quality against its qualified CPU configuration) every model call's resolved mode, backend, offload, stages, timings and tokens are recorded; auto stores Automatic over the pinned Vulkan pack imported through the real trust chain and is GPU evidence only when every load resolved to GPU-Offload on Vulkan and every answer came from the GPU (INCONCLUSIVE where readiness does not prove NVIDIA)."
  },
  "verify:ai-spy-live": {
    class: "real-browser",
    why: "Gate on the owner-installed runtime and the downloaded Qwen3.5-0.8B pack (NOT RUN without them; a pack that is not the pinned object is refused): seeds the pinned pack into an isolated profile as an import leaves it, launches the real Electron app from out/, and drives Element Spy's Find stronger locator with AI through the button on the Recorder's own browser (a trusted click through its own Playwright connection) on the Feature Test Lab, so the real preload and IPC, main's loop, compiler, intent guard and proof, and the production AiService with the real ai-host.cjs answer it. A T3 element is refused before the model is asked; a duplicated row control and a uniquely named one are asked for real, each settling inside its own deadline and releasing the host; a real inference is cancelled within the 3 s ceiling. Any proposal the panel shows (read from its rendered props) must come from the pinned model and is judged by the page on a fresh page of the verifier's own browser (exactly one match, the inspected element's data-spy, a click the page attributes to it), after controls show the judge is not vacuous; nothing on disk changes. Refusals are recorded as outcomes, not failures, each attempt paired with its own infer request by host id and re-classified (contract, compiler branch by value shape, intent, duplicate, page) without printing model or page text; a run in which nothing is shown is INCONCLUSIVE for correctness (exit 2). Each run that reaches the pinned pack keeps an allowlisted session record at docs/plans/ai-upgrade-v5/evidence/L3-spy-live-<runId>.json (spyLiveEvidence.mts: each scenario's status, check counts and facts, each attempt's codes), written as an INCOMPLETE checkpoint at every scenario boundary and recorded fact and as the final record before the profile is removed; it never replaces another run's file, and a failed write fails the run."
  },
  "verify:ai-locator-quality-live": {
    class: "real-browser",
    why: "Gate on the owner-installed runtime and the downloaded Qwen3.5-0.8B pack (NOT RUN without them; a pack that is not the published object is refused): serves the Feature Test Lab and launches a real Electron app directory that runs L3 §7/§8's own job, runLocatorUpgradeAttempts, through the production AiService and the real ai-host.cjs over real Recorder captures on /recorder-lab/locator-upgrade (a unique element, a guarded baseline whose CSS matched twice, a region-scoped duplicate, a broken saved locator through repair, a list re-rendered while the job runs, and identical twins), with every compiled plan proven by the product's own proveLocatorPlan / proveRepairPlan in real Chromium. Each accepted candidate is judged by the page on a fresh page (exactly one match, the recorded element's data-lu, the product's replay or repair proof again, a click the page attributes to that element); false-target must be 0, the twins must be refused after a second attempt that carries the first attempt's real refusal, and at least one real plan must be browser-proven. Scripted controls first show a correct plan passes the judge and that a bypassed gate C or B, a stubbed proof and a second attempt without the real refusal are each caught. With `-- --execution cpu|auto` (L8a, the 0.8B's GPU quality against its qualified CPU configuration) every model call's resolved mode, backend, offload, stages, timings and tokens are recorded; auto stores Automatic over the pinned Vulkan pack imported through the real trust chain and is GPU evidence only when every load resolved to GPU-Offload on Vulkan and every answer came from the GPU (INCONCLUSIVE where readiness does not prove NVIDIA)."
  },
  "verify:ai-locator-quality-live-d1": {
    class: "real-browser",
    why: "Gate on the owner-installed runtime and the downloaded Qwen3.5-0.8B pack (NOT RUN without them; a pack that is not the published object is refused): verify:ai-locator-quality-live's harness, judge and product path over D1's own labelled set on /recorder-lab/element-spy, run and reported apart from the original set: a duplicate Call told apart only by its list item's stable test id (D1 A) or authored name (D1 B), both asked for as Element Spy asks (userRequested, with the real Recorder capture), and two cases with no approved identity (a record-keyed test id with an email name, and the INV-2002 row named only by its cells), which must end refused. Each case's fixture is checked on the page and in the request before the model is asked; every request must carry the offered scope and never a withheld identity; each call is recorded as codes and a bounded scope category (offered, structural, row-content, or not-offered placed by the product's own proof as sibling, absent, ambiguous or withheld-own) with requests, replies, attempts spent and accepted candidates counted apart; false-target must be 0. No D1 acceptance rate is approved, so none is applied: a run that browser-proves no D1 candidate is INCONCLUSIVE (exit 2). Five D1 controls run first and end the run if one fails."
  },
  "verify:ai-locator-quality-controls": {
    class: "real-browser",
    why: "Every scripted control of verify:ai-locator-quality-live and -d1 in plain Node over the served Feature Test Lab, with no runtime, pack, Electron or model call (real Recorder captures, the real §7 loop, compiler, intent guard and proveLocatorPlan in real Chromium, the page as judge). The five original controls, then D1's: each D1 fixture is what its label says, and removing the twin controls, renaming the inspected one, dropping the offered scope, offering a record-keyed test id or marking a computed row name authored is each caught by exactly its own check; an offered scope from a scripted provider is proven and judged the inspected element; a sibling's, an absent, a withheld own and a row-content scope are each refused SCOPE_NOT_OFFERED before the browser (no proof runs) while the product's proof, asked directly, tells them apart, and the attempt check catches a refused plan that reached the browser or a misrecorded refusal; a misattributed sibling or invented container let through a bypassed gate C or B is caught by the judge; an unproven, unanswered, false-target, leaked or accepted no-identity case is never classed a success. Shows the judge and fixtures are sound, never model quality. First, with no browser, the saved evidence of both live verifiers: synthetic runs of the locator-quality sets (locatorQualityEvidence.mts) and synthetic verify:ai-spy-live sessions (spyLiveEvidence.mts) through the real recorder, builder, writer and settle step, covering a proven proposal, a refusal, a SCOPE_NOT_OFFERED attempt, INCONCLUSIVE, a failed check, a cancel, profile cleanup, a silenced console, seeded sensitive strings, a run-id clash, failed writes, a killed run's INCOMPLETE checkpoint, and the live verifier's scenario wiring."
  },
  "verify:ai-authoring-quality-live": {
    class: "real-browser",
    why: "Gate on the owner-installed runtime and the downloaded Qwen3.5-0.8B pack (NOT RUN without them; a pack that is not the published object is refused): launches a real Electron app directory that sends L4b's labelled set (nine broken flows, seventeen issues, fourteen L4a codes, both fix kinds, a truncated report whose two fixes differ in urgency, a warnings-only report and a lone issue) through explainFlowValidation, the production AiService with AUTHORING_LIMITS, AiUtilityHostManager and the real ai-host.cjs. Each case must be the request the product builds with the labelled codes, fixes and blocking order, get the feature's own deadline, be delivered with every sent issue explained, and leak no canary planted in the flow's names and values and no residual secret. Recorded, not judged, since one part is not a run: on subject, misattributed, actionable (a corrective verb with its issue's remedy), five unsupported-claim screens (an invented automatic fix, an off-domain remedy, a fabricated literal, a warning said to block the run, a blocking error called harmless), each explanation's category, the ranking order and whether the product withheld it; every case, delivered or not, goes into a redacted local review capture, and verify:ai-authoring-review judges the adopted target over captured runs and a person's verdicts; an explanation clearing every screen is for a person to review, never counted as correct. Scripted controls of the judge run first and end the run if one fails. Nine answers pass the 600 s tool ceiling, so -part1 and -part2 run it in two. With `-- --execution cpu|auto` (L8a, the 0.8B's GPU quality against its qualified CPU configuration) every model call's resolved mode, backend, offload, stages, timings and tokens are recorded; auto stores Automatic over the pinned Vulkan pack imported through the real trust chain and is GPU evidence only when every load resolved to GPU-Offload on Vulkan and every answer came from the GPU (INCONCLUSIVE where readiness does not prove NVIDIA)."
  },
  "verify:ai-authoring-quality-live-part1": {
    class: "real-browser",
    why: "verify:ai-authoring-quality-live over five of the nine labelled cases (casing, locator-orphan, branch, cycle, values; five model calls). Same hard checks, controls and recorded metrics as the whole gate; -part2 runs the others."
  },
  "verify:ai-authoring-quality-live-part2": {
    class: "real-browser",
    why: "verify:ai-authoring-quality-live over the other four labelled cases (duplicate-timeout, priority, warnings, single; four model calls): the fix-order case, the warnings-only case and the lone issue. Same hard checks, controls and recorded metrics as the whole gate; -part1 runs the others."
  },
  "verify:ai-authoring-review": {
    class: "integration",
    why: "Reads the local L4b review store (redacted review captures written by verify:ai-authoring-quality-live and a person's verdicts; %LOCALAPPDATA%/SpecterStudio/ai-quality-review/authoring, outside the repository) and judges the explanation quality target the owner adopted provisionally on 2026-09-22 over every complete run of the CURRENT request (captures of other instructions are ignored): no confirmed unsupported claim and no misattribution, at least 90 % on subject and 80 % actionable by proxy in every run, a person's verdict on every screen-clear explanation with at least 80 % correct and actionable, no fix-order violation when the model ranks (an empty order is acceptable), and at least two runs. Exit 0 only when MET; PENDING review and NOT MET exit 1; NOT RUN with nothing captured. `-- --pending` lists what awaits a person and `-- --record` stores one verdict, redacted. Its evaluator, capture redaction and verdict validation are proven without a model by verify:ai-authoring §12."
  },
  "verify:ai-authoring-dx": {
    class: "integration",
    why: "L4b's delivered-experience acceptance (owner decision 2026-09-25, option B; scripts/ai-harness/authoringDx.ts) over the local review store, beside the unchanged adopted target: DX-0 (every fresh capture carries the model, runtime, frozen source blobs and held-out corpus it was taken on, all equal to DX-0, and the working tree still matches via git hash-object; the model manifest may match by its model entries and app/main/ai/aiAssist.ts by its authoring path instead of its blob), DX-2 (two complete labelled runs and one complete held-out run, none left incomplete), DX-3 (a person's reading of every fresh text, 0 displayed escapes, at least 80 % of displayed correct and actionable), DX-4 (at most 1 issue in 4 without a displayed text in every complete run) and DX-5 (the model's own rates reported). DX-1 is left to verify:ai-authoring §14 and verify:ai-assist-gui. Exit 0 MET, 1 NOT MET or an unreadable store, 2 PENDING. Its evaluator is proven without a model by verify:ai-authoring §15."
  },
  "verify:ai-dx-mutations": {
    class: "integration",
    why: "The mutation run of L4b's DX evaluator and held-out check (scripts/ai-harness/authoringDx.ts), the same way as verify:ai-display-gate-mutations and with its hook: each mutant breaks one rule in memory (the 25 % cap per run and what it counts, withheld texts never credited, escapes and misattribution, a person's label, every text read, DX-3 only after DX-2, incomplete runs, each DX-0 input and the tree, the reading packet, the held-out hash, canary, labelled id, secret, minimum and commit checks) and verify:ai-authoring must fail at least one check. A survivor or crash fails; a control loads the file unchanged and must pass in full; the source is byte-identical afterwards. No model."
  },
  "verify:ai-authoring-dx-pending": {
    class: "integration",
    why: "The DX-3 reading packet: every fresh text in the local review store still awaiting a person's DX verdict, displayed and withheld alike, in item-id order with no display-gate or judge reading beside it, each with its evidence line and the product's step. Read-only; records nothing (a person records with verify:ai-authoring-review -- --record)."
  },
  "verify:ai-authoring-held-out": {
    class: "static-source-validation",
    why: "Structural check of L4b's held-out flows under docs/plans/ai-upgrade-v5/evidence/L4b-held-out/flows (the product's own intake, outside the labelled set, no canary, nothing the redaction treats as sensitive, at least one issue each, no duplicate, at least 17 issues sent) and their inventory from the real FlowValidator and request builder. No model and no display gate run. The first valid run writes inventory.json (write-once); later runs compare with it and report whether both are committed. Exit 0 valid, 1 invalid, 2 no flows yet."
  },
  "verify:ai-authoring-held-out-eligibility": {
    class: "static-source-validation",
    why: "L4b held-out selection, step 1 (owner directive 2026-09-26, latest): enumerates every candidate of the committed rule's two sources (the resource flow fixtures and the Randomized Test Lab's awkit-oracle-baseline-001 mutated flows, rebuilt with that verifier's own seeds), applies E1 (the held-out structural rules), E2 (not a request L4b's development sent a model) and E3 (one candidate per distinct request) and writes eligibility.json once; later runs compare with it and never rewrite it. No model and no display gate. Exit 0 written or matching, 1 differing."
  },
  "verify:ai-authoring-held-out-select": {
    class: "static-source-validation",
    why: "L4b held-out selection, step 2: only once eligibility.json is committed and matches a fresh enumeration, derives the seed from its content and writes the shortest seeded prefix sending at least 17 issues to flows/ once, refusing any other content there. No model and no display gate. Exit 0 written or already the selection, 1 refused."
  },
  "verify:ai-authoring-held-out-live-part1": {
    class: "real-browser",
    why: "verify:ai-authoring-quality-live over the committed held-out set's first five flows in case-id order (--held-out --part 1): same hard checks and redacted review capture as the labelled parts, each flow checked against its inventory, each capture carrying the inputs measured for DX-0. REFUSED until the held-out set is committed."
  },
  "verify:ai-authoring-held-out-live-part2": {
    class: "real-browser",
    why: "verify:ai-authoring-quality-live over the committed held-out set's flows 6-10 in case-id order (--held-out --part 2); as part1. REFUSED when the set has no such flows."
  },
  "verify:ai-authoring-held-out-live-part3": {
    class: "real-browser",
    why: "verify:ai-authoring-quality-live over the committed held-out set's flows 11-15 in case-id order (--held-out --part 3); as part1. REFUSED when the set has no such flows."
  },
  "verify:ai-authoring-held-out-live-part4": {
    class: "real-browser",
    why: "verify:ai-authoring-quality-live over the committed held-out set's flows 16-20 in case-id order (--held-out --part 4); as part1. REFUSED when the set has no such flows."
  },
  "verify:ai-display-gate-mutations": {
    class: "integration",
    why: "The mutation run of the L4b R4 display gate: runs verify:ai-authoring once per mutant in a child process whose Node load hook (scripts/helpers/source-mutant-hooks.mjs) replaces one source file's text in memory, so no product file is ever written. Mutants cover the gate's decisions (screens, causes, consequences), its evidence anchoring, its vocabulary, the parser and the adapter. A mutant counts as killed only when the run completes with a failed check; a survivor or a crash fails the gate. Controls: each file loaded unchanged through the hook passes in full, each mutant's text occurs exactly once and proves it loaded, and the source files are byte-identical afterwards. No model, no network."
  },
  "verify:ai-error-quality-live": {
    class: "real-browser",
    why: "Gate on the owner-installed runtime and the downloaded Qwen3.5-0.8B pack (NOT RUN without them; a pack that is not the published object is refused): launches a real Electron app directory that sends L5's labelled set plus three baseline-anchoring cases (a second baseline resting on an unrelated earlier event, an unrelated error after the real cause, a timeout beside only an unrelated console error) and two step-provenance cases, built through L5a's real EvidenceBuffer and deriveFailureCause with every event labelled cause or unrelated, through analyzeFailure, the production AiService with FAILURE_ANALYSIS_LIMITS and the real ai-host.cjs. Hard: each batch coalesces as labelled (500 rows cost one call, a 409 and a 422 two), a pass and an insufficient baseline cost none, every other row is the product's request with its own deadline, delivered and saved, no canary or residual secret, every citation shown whole. Recorded: L5's metrics (baseline and AI accuracy, improvement over the baseline, false attribution, how often the AI rests on a wrong baseline's own lead event, evidence-link accuracy, coalescing, calls per batch, latency), for the rows run, the eleven-row labelled set, the eight rows 4f81424a measured and the provenance cases apart, and whether the AI beats the baseline, ROADMAP rule 7's condition for automatic analysis. Scripted controls of the judge run first and end the run if one fails. Thirteen model calls pass a 600 s tool ceiling: -part1/-part2 run the labelled set and -provenance the two provenance cases. With `-- --execution cpu|auto` (L8a, the 0.8B's GPU quality against its qualified CPU configuration) every model call's resolved mode, backend, offload, stages, timings and tokens are recorded; auto stores Automatic over the pinned Vulkan pack imported through the real trust chain and is GPU evidence only when every load resolved to GPU-Offload on Vulkan and every answer came from the GPU (INCONCLUSIVE where readiness does not prove NVIDIA)."
  },
  "verify:ai-error-quality-live-part1": {
    class: "real-browser",
    why: "verify:ai-error-quality-live over the first part of its labelled set (toast before timeout, native validation, the 409/422 batch, 500 identical rows, an unrelated console error after the real cause, and the two zero-call rows: six model calls), so it fits a 600 s tool ceiling. Same hard checks, controls and recorded metrics as the whole gate, over those cases; part2 runs the rest, and the parts' counts sum to the whole set."
  },
  "verify:ai-error-quality-live-part2": {
    class: "real-browser",
    why: "verify:ai-error-quality-live over the rest of its labelled set (the two baselines that take an unrelated earlier event, a page error before a timeout, the duplicate burst, and a timeout beside only an unrelated console error: five model calls), so it fits a 600 s tool ceiling. Same hard checks, controls and recorded metrics as the whole gate, over those cases; part1 runs the others."
  },
  "verify:ai-error-quality-live-provenance": {
    class: "real-browser",
    why: "verify:ai-error-quality-live over its two step-provenance cases only (two model calls): an unrelated 503 captured one step before a failed step whose page error is the cause (unrelated-server-error-first event for event, the A/B), and the reverse, a save's 500 one step before an assertion whose step holds only an unrelated console error. Both baselines are right by construction; the gate records whether the model follows the step each event was captured in, which buildFailureAnalysisRequest states on each line only when the offered events span more than one step. Same hard checks and controls as the whole gate; part1 and part2 are the eleven-row labelled set."
  },
  "verify:ai-error-quality-live-page-context-part1": {
    class: "real-browser",
    why: "L11.G comparison arm of verify:ai-error-quality-live-part1: the same cases, judge, hard checks and recorded metrics, with each labelled row also carrying the bounded, redacted context of the page it failed on (scripts/ai-harness/pageContextCases.json, produced through the real normalization path by benchmark:dom-normalization), so the product's request shows a PageAtFailure field. Paired with the unchanged part1 run in the same session to decide whether the page context may become the default (evidence: docs/plans/ai-upgrade-v5/evidence/L11-acceptance-2026-10-01.md)."
  },
  "verify:ai-error-quality-live-page-context-part1b": {
    class: "real-browser",
    why: "The last case of the page-context part1 arm (cause-then-unrelated-console) alone: the longer page-context prompts pushed part1 past the launcher's time budget, so this case runs on its own. Same hard checks, controls and recorded metrics."
  },
  "verify:ai-error-quality-live-page-context-part2": {
    class: "real-browser",
    why: "L11.G comparison arm over transport-noise, pageerror-timeout and burst with each row's page context attached (three model calls, so the longer prompts fit the 600 s tool ceiling); part2b runs the rest of verify:ai-error-quality-live-part2's cases. Same hard checks, controls and recorded metrics."
  },
  "verify:ai-error-quality-live-page-context-part2b": {
    class: "real-browser",
    why: "L11.G comparison arm over unrelated-server-error-first and timeout-unrelated-console with each row's page context attached (two model calls). Same hard checks, controls and recorded metrics."
  },
  "verify:ai-error-quality-live-page-context-provenance": {
    class: "real-browser",
    why: "L11.G comparison arm of verify:ai-error-quality-live-provenance: the two step-provenance cases with each row's page context attached (two model calls). Same hard checks, controls and recorded metrics."
  },
  "verify:ai-error-quality-live-requests1": {
    class: "real-browser",
    why: "verify:ai-error-quality-live over three of its six real-runner request-provenance cases (three model calls), captured by verify:request-provenance into scripts/ai-harness/requestProvenanceCases.json and labelled by request name before any inference: the failed step's own awaited save beside an unrelated same-page heartbeat (the baseline takes the heartbeat), the same failure with its provenance stripped as a legacy control, and an inventory request the step before issued that is answered during the failed step. buildFailureAnalysisRequest states each request's runtime relation on its line; the gate records whether the model's primary evidence is the step's own request. Same hard checks and controls as the whole gate; requests2 runs the other three."
  },
  "verify:ai-error-quality-live-requests2": {
    class: "real-browser",
    why: "verify:ai-error-quality-live over the other three real-runner request-provenance cases (three model calls): requests from a popup and a child frame beside the awaited save (the baseline takes the popup), an earlier step's own awaited request beside the failed step's, and an uncertain save (no response wait links it; the step waits for its success text) beside an earlier step's own request. Same hard checks, controls and recorded metrics as the whole gate; requests1 runs the others."
  },
  "verify:ai-locator-upgrade-budget": {
    class: "real-browser",
    why: "Gate on the owner-installed runtime and the downloaded Qwen3.5-0.8B pack (NOT RUN without them; a pack that is not the published object is refused): launches a real Electron app directory that loads only the pack's vocabulary through node-llama-cpp, builds L3 §7's own requests through locatorAttemptJob over L2-sanitized capture contexts, and counts on the model's own tokenizer: each prompt with the host's template and every line shown whole, the longest prompt a capture at every L2 bound can send, the longest plan LOCATOR_ATTEMPT_SCHEMA admits (English names and test ids) and the longest plan using only the texts its strategies read (names with numbers included), in both indentation layouts, within LOCATOR_ATTEMPT_LIMITS.maxOutputTokens. No inference.",
    guards: ["native-hosts/ai/ai-host.cjs"]
  },
  "verify:ai-inference-profile": {
    class: "real-browser",
    why: "Diagnostic gate on the owner-installed runtime and pack (NOT RUN without them): runs the harness in profile mode under the same constrained CPU mask as benchmark:ai-model and drives node-llama-cpp directly, so the cost of one inference splits into prompt evaluation, decode, JSON-grammar overhead and thread scaling — the split the host cannot report, because it returns timings only on completion and refuses unconstrained generation. It asserts measurements exist, never ceilings; benchmark:ai-model judges the numbers.",
    guards: ["native-hosts/ai/ai-host.cjs"]
  },
  "verify:authoring-diagnostics": {
    class: "unit",
    why: "Phase L L4a family matrix against the real owners: FlowValidator codes with severity, anchor and active-path class for every family (unreachable and past-End steps, connector rules, Start/End, bindings, value sources, branch pairs, unguarded cycles, malformed loops, dead ends, priority ties, stale references, retired ports) with negative controls, the PreRunValidator gate, FlowDependencyResolver workflow parity, a legacy-shaped profile, FlowExecutor source premises the rules mirror, and no second implementation left in the designer. In-process."
  },
  "verify:failure-cause-baseline": {
    class: "unit",
    why: "Phase L L5a: the real EvidenceBuffer on an injected clock (schema, ids, step context, SemanticRedactor masking incl. registered run secrets, URL path templates, field/payload/event/source/instance/run-byte caps with drop counts, de-duplication with repeat counts, protected-login retraction returning bytes to both budgets) and the real deriveFailureCause over the labelled cases (toast before timeout, native validation, 409/422/500, transport failure, page error, unrelated console error in and before the step, neutral UI, insufficient, cancelled) plus windows, grace, ordering, bounded support and determinism. In-process."
  },
  "verify:ui-error-evidence": {
    class: "real-browser",
    why: "Phase L L5a end to end: 14 concurrent executions through the real ExecutionEngine and real Chromium against the real mock site (/runner-lab failure-evidence section), read back from the report.json the real ReportService wrote. Transient toast captured after its node is gone (the failure DOM snapshot proves it), native + inline validation without the typed value, HTTP 409/422/500/503 metadata, transport failure, page error, console error outranked by the runner, error page, repeat folding, pass-with-warning (no cause), 409 then a consequential timeout, protected-login exclusion (canaries absent, exclusions counted), manual handoff resumed, user cancellation (its report reaches report.json), clean pass (no diagnostics), the off switch, cross-instance attribution and listener teardown. Seven mutations caught."
  },
  "verify:request-provenance": {
    class: "real-browser",
    why: "L5a runtime request-to-step provenance: three concurrent failing executions through the real ExecutionEngine, StepExecutor and production FailureEvidenceCollector in real Chromium against the mock site (/runner-lab Request provenance), read back from report.json. The failed step's awaited request and its own navigation are linkedToFailedStep; a same-page background request and an un-awaited request from the same action both stay uncertain (duringFailedStep); child-frame and popup requests are off target; a request issued one step earlier and answered during the failed step is issuedBeforeFailedStep although its step stamp says failed step; one id across a redirect and across a response then its transfer failure; a page-cancelled request leaves no event; a request that began before the collector attached stays unknown; an older report gets no relation, and the cause baseline, step relations, coalescing signature and failure-analysis request are identical with and without provenance. Three mutations caught (identity, target page, issue step)."
  },
  "verify:failure-capture-overhead": {
    class: "real-browser",
    why: "Phase L L5a overhead gate, owner-approved B+D+E (2026-09-21): 7 alternating capture ON/OFF rounds (fast and evidence-heavy passing workloads, 1 instance each; --saturated is the informational 3-instance run) through the real ExecutionEngine and real Chromium against the real mock site; paired-round median duration and Node CPU per instance judged three-way over a distribution-free 95% median interval (INCONCLUSIVE exits 2), p95 informational below 21 samples per mode, evidence bytes as a hard cap, all against the unchanged committed ceilings, plus event-loop delay, Node and automation-Chromium RSS, listener and Chromium-process teardown, and a static import-closure proof that ExecutionEngine reaches no module able to CALL the model (pure src/ai data/schema/policy is allowed). The pre-fix awaited exposeBinding failed it (+568 to +1077 ms).",
    guards: ["src/runner", "src/ai", "app/main/ai", "native-hosts/ai"]
  },
  "verify:failure-capture-gate-stats": {
    class: "unit",
    why: "Phase L L5a gate rules in scripts/lib/failure-capture-gate.mts, in-process: the owner-approved median interval against an independent exact BigInt binomial for n 0-80, every PASS/FAIL/INCONCLUSIVE boundary with negative controls (a low median with a wide spread is not PASS, a high one is not FAIL, a lower bound equal to the ceiling is not FAIL, missing or non-finite rounds are INCOMPLETE), p95 eligibility grounded in stats() returning the maximum at 20 samples, approved 21x1 versus unsupported rounds/instances (gate NOT RUN, exit 2) and the exit code, evidence appends that preserve earlier runs and refuse an unreadable file untouched, and the committed raw evidence re-deriving every recorded binding verdict."
  },
  "verify:ai-model-pack": {
    class: "integration",
    why: "Real temp-folder AiModelPackStore with synthetic GGUF files and an injected manifest: format refusals and the free-space gate (file plus 256 MB, fail closed when unmeasurable) leave nothing behind, single-pass hashed import, cheap status plus once-per-session load verification catching tamper/truncate/delete, retirement, replacement sweep and removal. L8b.1 (E7): the preflight measures and copies nothing; a GGUF the manifest does not list is registered (stored under its SHA-256, the source's name kept for display only, never curated, never loaded) with tamper, swap, deletion and symlinked-source checks; forged registries read unreadable and pre-L8b registries load unchanged. Then checks the production AiModelManifest entries."
  },
  "verify:ai-model-compatibility": {
    class: "integration",
    why: "Phase L L8b.2 (awkit-djnl.12), outside the host: staticVerdict fails each of the seven checks on its own and at its boundary, first failure wins, every code is reachable and a malformed host reply is never a pass; staticStanding counts a verdict only for the runtime build that produced it; a real temp-folder AiModelPackStore records a verdict only on the active registered model (never another model, a curated pack or a malformed verdict), L8b.1 registries load unchecked, forged verdicts read unreadable and a re-import starts unchecked; runStaticStage records nothing when the host cannot answer or the model was replaced while the host read; AiService.inspectModel handshakes the CPU host first, runs with AI switched off, and answers null for an incompatible or skewed host, no host, a host exit (then re-handshakes), an open circuit, an out-of-root path or after shutdown."
  },
  "verify:ai-audit-revert": {
    class: "integration",
    why: "Real temp-folder AiActionStore and JsonProfileStore: record sanitization and retention, concurrent atomic appends, persisted self-demotion, and compare-and-swap revert through the flow folder lane (stale refusal, exact restore, lost-audit revert)."
  }
};
