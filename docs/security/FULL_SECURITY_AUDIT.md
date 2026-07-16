# FULL SECURITY AUDIT — AWKIT / WebFlow Studio

> Evidence-based application-security audit of the **actual current** AWKIT / WebFlow Studio
> codebase (Electron + React + TypeScript + Playwright, Windows-first, offline-capable).
> Scope: the local repository only. No GitHub interaction, no remote state changed, no fixes applied
> (this is an audit-and-report deliverable per the brief in `SECURITY_AUDIT_BRIEF.md`).
>
> **Audit date:** 2026-07-14 · **Auditor role:** senior application / Electron / Playwright security engineer
> **Method:** every claim below is traced to current source (`file:line`). Assessments follow the brief's
> status model: **CONFIRMED / DISPROVED / NEEDS VERIFICATION / HARDENING RECOMMENDATION**.

---

## 1. Executive Summary

AWKIT is an Electron desktop app that lets an operator visually build and run authorized Playwright
automation. The **process-boundary hygiene is good**: `contextIsolation` is on, `nodeIntegration` is off,
there is **no `eval` / `new Function` / `vm` anywhere in the codebase**, the connector/condition
"expression" engines are hand-written comparison evaluators (not code execution), OS process launches use
**argument arrays** (no shell string concatenation → no command injection), SQLite uses **parameterized**
queries, and the Recorder already **redacts password fields** and **masks URL query secrets**.

The material weakness is the **workflow-execution trust boundary**. The brief's central question — *can
manipulated workflow/data-source JSON perform operations beyond the intended automation model?* — is
answered **partially yes**:

- There is **no runtime schema/type/bounds validation** of flow/workflow JSON before execution
  (TypeScript interfaces are compile-time only). The only runtime check is connector *structure*.
- A manipulated workflow can drive **`setInputFiles` with an arbitrary absolute local path** → exfiltrate
  sensitive local files (SSH keys, saved session profiles, cookie DBs) to a target website.
- Navigation sinks (`page.goto`) apply **no protocol allowlist**, so `file://` (and `data:`) targets are
  reachable from workflow data.
- An imported data-source profile can point `file` at an **arbitrary path** that the editor then
  **overwrites**.

None of these reach **CRITICAL** (no Node/OS RCE, no Electron privilege-boundary escape, no auto-execution
of downloaded content — downloads are saved, never launched). They are realistic for the documented threat
model where **workflow/data-source JSON is untrusted** (shared or imported automation files).

### Usage recommendation

| Usage | Recommendation |
| --- | --- |
| Local development | **YES** |
| Personal authorized automation | **YES WITH CONDITIONS** — only run workflows/data sources you authored yourself; do not import untrusted `.json` flows/data. |
| Internal company automation | **YES WITH CONDITIONS** — single trusted operator; workflows treated as trusted code and reviewed before running; upload/download folders on a non-sensitive volume. |
| Authorized banking / business-portal automation | **YES WITH CONDITIONS** — acceptable for a single vetted operator running self-authored workflows; **not** for running workflows received from others. Fix P0/P1 before wider use. |
| Broad enterprise deployment | **NO (not yet)** — needs the workflow trust model (schema validation + upload/navigation boundaries) and code signing first. |

**Final recommendation: YES WITH CONDITIONS** (see §29).

---

## 2. Overall Security Rating

**Rating: C — Material security weaknesses (trending to B once P0/P1 land).**

Rationale: excellent code-execution hygiene and Electron sandboxing basics pull the score up; the absence
of a runtime workflow-trust boundary (schema validation, upload/navigation/file-write bounds) and the lack
of code signing pull it down. There are **no confirmed CRITICAL** findings. The Highs are all conditioned
on a manipulated/untrusted workflow or data-source file, which the brief explicitly puts in scope.

---

## 3. Threat Model

**Protected assets**
- Saved browser **session profiles** (persistent Chrome/Edge `user-data-dir`s under the runtime root — cookies, `Login Data`, `Local State`, tokens).
- Playwright `storageState` session JSON (cookies + localStorage).
- Workflow / flow / data-source definitions and their history/reports/screenshots.
- Arbitrary local files reachable by the app's process token.
- Target web-application data the automation touches (internal / CRM / portal / banking when authorized).

**Attackers / failure sources considered**
- **Malicious or manipulated workflow file** (hand-edited or received/imported JSON). *In scope, primary.*
- **Manipulated data-source JSON** (arbitrary `file` path, huge/deep/`__proto__` keys). *In scope.*
- **Malicious target website** (hostile DOM, hostile `Content-Disposition` download filename, popups/redirects). *In scope.*
- **Unexpected renderer content** reaching the preload bridge. *In scope (defense-in-depth).*
- **Another local user/process** on the same Windows box (profile/lock races, artifact reads). *Partly in scope.*
- **Compromised build dependency.** *In scope (supply chain).*
- **Operator mistake / concurrency race / corrupted runtime state.** *In scope, mostly reliability.*

**Out of scope**
- Vulnerabilities in the *target* web applications themselves.
- Physical access / full OS compromise (an attacker already running as the user can do anything AWKIT can).
- CAPTCHA/MFA-bypass features — these are intentionally **absent** and must stay absent (§8).

---

## 4. Security Architecture

### Process & trust boundaries

```text
┌───────────────────────────── Electron main (Node, full privilege) ─────────────────────────────┐
│  main.ts ── windowManager (frameless BrowserWindow, contextIsolation:true, nodeIntegration:false)│
│  ipc/*  ── ipcMain.handle(...)  ← TRUST BOUNDARY (renderer → main)                                │
│  profileStores / uiSettings (atomic JSON)   SessionCaptureService (spawn real Chrome)            │
│  ExecutionEngine → InstanceManager → PlaywrightRunner → FlowExecutor → StepExecutor              │
│        │                                                    │                                     │
│        └── BrowserContextFactory → Playwright Chromium (bundled, sandboxed, offline-hardened)    │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ contextBridge (preload.ts: window.playwrightFlowStudio)  ← the ONLY renderer capability
┌───────────────────────────── Renderer (Chromium, no Node) ─────────────────────────────┐
│  React UI. Reaches main only through the typed preload API. Loads local bundle only.    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Workflow data → privileged sink (the boundary that matters most)

```text
Workflow / Flow JSON  (UNTRUSTED per threat model)
   ↓ JsonProfileStore.get()  → JSON.parse, no schema validation
   ↓ ExecutionEngine.startRun → PlaywrightRunner → FlowExecutor
   ↓ validateConnectorStructure()   ← ONLY runtime validation (graph structure, not fields)
   ↓ StepExecutor.executeStep(step)
        • step.url        → page.goto(url)            (no protocol allowlist)   [F-02]
        • step.value      → setInputFiles(filePath)   (arbitrary local path)    [F-01]
        • cfg.sessionFolder → storageState({path})     (arbitrary write path)    [F-04]
        • download.suggestedFilename → saveAs(join(...)) (site-controlled name)  [F-08]
```

### Session / handoff

```text
Auto Secure Login / Reuse Session → BrowserRestarter → launchPersistentContext(profileDir)
Manual Chrome Handoff → SessionCaptureService.spawn(real Chrome, --user-data-dir=<app dir>) → capture
Protected Login Handoff → ProtectedLoginDetector (detect-only) → pause → manual auth → capture → resume
```

---

## 5. Privileged Operations Inventory

| Operation | File:line | Input source | Privilege | Validation | Boundary |
| --- | --- | --- | --- | --- | --- |
| `page.goto(url)` | `StepExecutor.ts:655,978` | workflow `step.url` | navigation | none (no protocol allowlist) | workflow→browser |
| `setInputFiles(path)` | `StepExecutor.ts:832` | workflow `step.value` | local file read→upload | none | workflow→FS/site |
| `download.saveAs(path)` | `StepExecutor.ts:843` | site filename + app dir | FS write | dir fixed; filename from site | site→FS |
| `storageState({path})` | `StepExecutor.ts:1053` | workflow `cfg.sessionFolder` | FS write (secrets) | name sanitized; folder not | workflow→FS |
| `spawn(browser, args)` | `SessionCaptureService.ts:236` | detected browser path + target URL | process launch | arg array; URL protocol unchecked | app→OS |
| `execFile(powershell/cim)` | `ProcessTreeSampler.ts:133` | internal (own PID subtree) | process query | internal only | app→OS |
| `shell.openPath(path)` | `system.ipc.ts:45` | renderer `path` | OS default-handler open | `existsSync` only | renderer→OS |
| `shell.openExternal(url)` | `windowManager.ts:41`, `auth.ipc.ts:16` | window.open / renderer | OS browser open | **http(s) only** ✅ | app→OS |
| `writeFile(profile.file)` | `dataSource.ipc.ts:106-135` | data-source `file` field | FS write | protected-dir check only | renderer→FS |
| `readFile(profile.file)` | `dataSource.ipc.ts:83,128,272` | data-source `file` field | FS read | none (abs path allowed) | renderer→FS |
| `launchPersistentContext(dir)` | `BrowserContextFactory.ts` | session profileDir | browser + profile lock | profile lock ✅ | app→browser |
| SQLite `db.exec(sql, ?params)` | `SqliteRuntimeStore.ts` | run telemetry | DB read/write | parameterized ✅; table names internal | app→FS |

---

## 6. Findings Summary

| ID | Finding | Severity | Confidence | Domain | Status |
| --- | --- | --- | --- | --- | --- |
| F-01 | Arbitrary local-file upload via `uploadFile` step (`setInputFiles` unbounded path) | **HIGH** | High | Upload / exfiltration | CONFIRMED |
| F-03 | No runtime schema/bounds validation of workflow/flow JSON before execution | **HIGH** | High | Workflow trust | CONFIRMED |
| F-02 | No navigation protocol allowlist (`file://`/`data:` reachable via `goto`) | **MEDIUM** | High | Navigation | CONFIRMED |
| F-04 | Arbitrary file write/overwrite via data-source `file` + `saveSession` folder | **MEDIUM** | High | Data source / FS | CONFIRMED |
| F-05 | `system:openPath` opens any renderer-supplied path with OS handler | **MEDIUM** | Medium | Electron / IPC | CONFIRMED |
| F-06 | No `will-navigate` guard + `sandbox:false` + broad preload API | **MEDIUM** | High | Electron | CONFIRMED |
| F-07 | Recorder stores all non-password input values literally (OTP/PII in text fields) | **MEDIUM** | High | Recorder / secrets | CONFIRMED |
| F-11 | Session-capture launches real browser with unvalidated URL protocol | **LOW** | Medium | OS integration | CONFIRMED |
| F-08 | Download filename path-traversal via `suggestedFilename` | **LOW** | Low | Download | NEEDS VERIFICATION |
| F-09 | No IPC sender/frame authorization on any handler | **LOW** | High | IPC | CONFIRMED (defense-in-depth) |
| F-10 | Dev-only dependency advisories (esbuild/vite/node-gyp/tar) | **INFO** | High | Supply chain | CONFIRMED (not shipped) |

No CRITICAL findings.

### Remediation status (2026-07-14, code changes applied — not committed)

All LOW, MEDIUM, and HIGH findings have been fixed in code (build clean; `verify:security` 29/29 plus
`verify:runner` 82/82, `verify:recorder` 72/72, `verify:ipc-contract` 4/4, `verify:data-editor` 27/27,
`verify:waits` 21/21, `verify:protected-login` 16/16 + 34/34 unregressed):

| ID | Status | Fix |
| --- | --- | --- |
| F-02 | **FIXED** | `assertNavigableUrl` allowlist at both `goto` sinks (`src/runner/urlPolicy.ts`); `file:`/`javascript:`/`chrome*`/`devtools:` blocked, http(s)/about/data allowed. |
| F-04 | **FIXED** | Data-source writes confined to the workspace (`dataSource.ipc.ts`); `saveSession` folder confined to the sessions root (`StepExecutor.ts`) via `src/utils/pathSafety.isPathInside`. |
| F-05 | **FIXED** | `system:openPath` confined to AWKIT data folders + executable-extension block (`system.ipc.ts`). |
| F-06 | **FIXED** | `will-navigate` / `will-redirect` lockdown to the app bundle (`windowManager.ts`). `sandbox:true` left as a tracked P3 option (needs its own regression pass). |
| F-07 | **FIXED** | Recorder redaction extended to OTP/one-time-code/card/CVV/PIN/SSN/token fields (`recorderInitScript.ts`). |
| F-08 | **FIXED** | `sanitizeDownloadFileName` strips path/traversal from site-suggested names (`StepExecutor.ts`). |
| F-09 | **FIXED (privileged channels)** | `assertTrustedSender` on `execution:runWorkflow`, `dataSources:writeJson/createFromScratch`, `session:startCapture`, `system:openPath` (`ipc/senderGuard.ts`). Remaining read-mostly channels are follow-up. |
| F-11 | **FIXED** | Session capture rejects non-http(s)/about target URLs (`SessionCaptureService.ts`). |
| F-01 | **FIXED** | Upload crown-jewels blocklist: `setInputFiles` refuses paths inside AWKIT sessions/logs/reports/screenshots/traces (+ traversal) via `StepExecutor.assertUploadAllowed` (owner-approved: block sensitive dirs, keep general user files uploadable). |
| F-03 | **FIXED** | Lenient runtime bounds normalization at the `executeFlow` seam (`src/profiles/FlowValidation.ts` `normalizeFlowBounds`): clamps timeouts/retries/loop iterations, caps locator-alternatives/waits arrays, warns on duplicate ids; keeps the existing unknown-step-type rejection; does not reject unknown properties (legacy flows still load). |
| F-10 | INFO | Dev-only advisories; no code change. |

### Hardening batch 2 (2026-07-14) — residuals closed + defense-in-depth

- **F-01 residual → DONE:** the global runtime data root (holds captured browser profiles cookies/`Login
  Data` + the durable store) is now threaded into the execution context (`protectedUploadRoots`) and added
  to the upload blocklist (`ExecutionEngine` + `InstanceExecutionContext` + `StepExecutor.assertUploadAllowed`).
- **F-09 residual → DONE:** a single global `ipcMain.handle` wrapper in `ipc/index.ts`
  (`installGlobalSenderGuard`) now applies `isTrustedSender` to **every** channel, not just the
  high-privilege ones.
- **Prototype pollution (§13) → DONE:** `setJsonAtPath` rejects `__proto__`/`constructor`/`prototype` path
  keys and `resolveJsonPath` refuses to traverse them (`TableEditing.ts`, `JsonPathResolver.ts`).
- **Smart Locator integrity (§16) → DONE:** `guardLocatorQuality` now fails a `dangerousMutation`/
  `externalCommit` step whose locator is a fragile positional/index fallback (the "wrong Submit/Delete"
  risk), even if the resolver could otherwise recover a match. Non-dangerous steps keep lenient fallback.
- **`sandbox: true` (P3) → NOT SHIPPED:** enabling it broke the app in a real-Electron GUI smoke test
  (`verify:flow-designer` — the ESM `preload.mjs` does not load under a sandboxed renderer in this
  electron-vite setup). Reverted to `sandbox: false`; enabling sandbox requires migrating the preload to
  CommonJS (or resolving ESM-preload-under-sandbox) and is tracked as a standalone task. The `will-navigate`
  lockdown (F-06) already removes the exploitable remote-content vector without the sandbox flag.

Remaining follow-ups: code signing (§20), offline hash validation (§19), artifact retention (§22).

### Hardening batch 3 (2026-07-14) — secret store (§15) + data-source read confinement (§14)

- **DPAPI secret store (§15) → DONE:** operator credentials are kept OUT of workflow/flow JSON and `.env`.
  Pure store `src/secrets/SecretStore.ts` (encrypt-at-rest, name/value validation, CRUD, atomic write)
  bound to Windows DPAPI via Electron `safeStorage` in `app/main/secretStore.ts`; `app/main/ipc/secrets.ipc.ts`
  exposes name-only management (`isAvailable`/`list`/`set`/`delete` — **no channel returns a decrypted
  value**, and every channel is under the global sender guard). Steps reference secrets by name
  (`valueSource.type = "secret"`, `secretName`); the runner resolves them per-run in the main process
  (`ExecutionEngine.setSecretResolver` → `collectSecretNames` → `InstanceExecutionContext.secrets`) and
  registers the literals with `SecretMasker` so they are scrubbed from logs/reports. Renderer management UI
  = **Settings → Secrets** card (add/update/delete by name; keystore-unavailable banner; token-only styling).
- **Data-source read confinement + preview cap (§14) → DONE:** all JSON data-source reads go through
  `readJsonFileGuarded` (`dataSource.ipc.ts`): a **25 MB** size cap (huge-file DoS guard) and a read
  confinement predicate `isReadableDataSourceFile` (`src/utils/pathSafety.ts`) that refuses any file inside
  the runtime data root that is not the data-sources workspace (saved sessions, captured browser profiles,
  the durable secret store, logs, reports), while allowing external user files and the workspace itself.
  Confinement/oversize surface as a `DataSourceReadError` to the user; ENOENT/parse errors keep their prior
  "new/empty file" behavior. (Write confinement + prototype-pollution on write were already closed under
  F-04/§13.)

`verify:security` **39/39** (+6 data-source read-confinement checks); `verify:secrets` **16/16**; GUI
`verify:flow-designer` **24/24** (Settings → Secrets card verified in a token-faithful harness, light + dark,
no horizontal overflow); regression `verify:runner` **82/82**, `verify:data-editor` **27/27**,
`verify:ipc-contract` **4/4** (129 handlers).

---

## 7. Detailed Findings

### F-01 — Arbitrary local-file upload via the `uploadFile` step  ·  HIGH · CONFIRMED

- **Affected:** `src/runner/StepExecutor.ts:829-834`
- **Input source:** `step.value` (or `valueSource` → data source) from workflow JSON — untrusted per threat model.
- **Sink:** `await (await this.locatorFactory.resolve(step)).setInputFiles(filePath)`.
- **Observed implementation:** `filePath = await this.resolveStepValue(step, step.value)`; the only check is truthiness (`if (!filePath) throw`). No allowlist, workspace boundary, path normalization, or user confirmation.
- **Data flow:**
  ```text
  workflow step.value = "C:\Users\<u>\.ssh\id_rsa"  (or %LOCALAPPDATA%\WebFlow Studio\sessions\*.json)
      ↓ resolveStepValue (static/dynamic/dataSource/env)
      ↓ NO validation
      ↓ setInputFiles(filePath)  → file attached to a form on the (attacker-influenced) target site
      ↓ site upload → exfiltration
  ```
- **Impact:** a manipulated/shared workflow can read and exfiltrate any file the app's user token can read — including AWKIT's own saved session profiles, browser cookie DBs, and SSH/API keys.
- **Preconditions:** operator runs a workflow authored/edited by an attacker (or a data source whose value the attacker controls) that targets an attacker-influenced page.
- **Existing protection:** none.
- **Exploitability:** high once a malicious workflow is loaded; the visual UI is not a barrier (workflow JSON is directly executed).
- **Remediation:** treat upload paths as a privileged capability — resolve against a configured **workspace/uploads allowlist**, reject paths inside the AWKIT runtime root / browser-profile dirs / user secret dirs, and optionally require a per-run "this workflow uploads local files" confirmation. Log the resolved path (masked).
- **Regression test:** workflow with `uploadFile` value = session-profile path and = `..\..`-traversal path → both rejected; an in-workspace path → allowed.

### F-03 — No runtime schema validation of workflow/flow JSON  ·  HIGH · CONFIRMED

- **Affected:** `src/profiles/FlowProfile.ts` (only `validateConnectorStructure`, lines 472-506); `JsonProfileStore` load path; `src/runner/FlowExecutor.ts` / `StepExecutor.ts`.
- **Observed implementation:** flows/workflows are `JSON.parse`d and returned by the profile store with **no schema, type, bounds, or unknown-property validation**. The only runtime gate before execution is `validateConnectorStructure` (loop-returns-to-self, single standard outgoing edge, self-loop siblings must be conditional) — graph structure only. TypeScript `FlowStep`/`FlowProfile` interfaces are compile-time and provide **no runtime guarantee**.
- **Partial mitigations that already exist (good):** `StepExecutor.executeStep` **throws on unknown step type** (`default: throw new Error("Unsupported step type…")`, line 932); operation limiters cap concurrent navigation/download/screenshot; `page.goto` carries a 30 s default timeout.
- **Gaps:** negative/huge `timeoutMs`, huge `retry.count`, thousands of locator `alternatives`, deeply nested `context`, huge `afterWaits[]`, duplicate node/connector IDs, and unknown extra properties are all accepted and passed to the runner. This is the **enabler** for F-01/F-02/F-04.
- **Impact:** manipulated workflow JSON reaches execution paths the GUI would never construct; resource-exhaustion vectors (§18) and the file/nav findings all trace back here.
- **Remediation:** add a single runtime validator (hand-rolled or a schema lib) at the load/execute seam that enforces: known step/connector types, field types, numeric bounds (timeouts, retry counts, iteration caps), array-length caps (alternatives, waits, nodes/edges), unique IDs, and **rejects unknown top-level properties**. Fail closed before `startRun`.
- **Regression test:** a suite of malformed workflows (unknown type, negative timeout, 10k alternatives, duplicate IDs, circular graph) all rejected with a clear error and **no** browser action taken.

### F-02 — No navigation protocol allowlist  ·  MEDIUM · CONFIRMED

- **Affected:** `src/runner/StepExecutor.ts:655` (`goto` step) and `:978` (`routeChange` navigateCurrentPage).
- **Observed implementation:** `this.activePage.goto(url, …)` where `url` comes straight from `resolveStepValue(step, step.url)`; no scheme check.
- **Behavior by scheme (traced/reasoned):** `http(s)` intended; `file://` **allowed** → the automation browser loads a local file, which a subsequent `readText`/`screenshot` step can read and a later step can exfiltrate; `data:` allowed; `javascript:` is rejected by Playwright `goto` itself (not a reliable app-level control). AWKIT legitimately automates arbitrary/internal http(s) targets, so the concern is specifically the **non-web schemes**, not internal-network blocking.
- **Impact:** combined with F-01-style exfiltration, `file://` navigation broadens local-file reach; on its own it is a workflow-integrity concern.
- **Remediation:** enforce an allowlist (`http`, `https`, and explicitly-opted-in `file:` only if a feature needs it) at both `goto` sinks; reject others with a clear error. Keep internal http(s) targets allowed (do not block private ranges) but consider a user-visible "this run navigates to `file://`/internal" note.
- **Regression test:** `goto` with `file:///C:/…` and `data:text/html,…` rejected; `http(s)` and internal `http://localhost` allowed.

### F-04 — Arbitrary file write/overwrite via data source `file` and Save Session folder  ·  MEDIUM · CONFIRMED

- **Affected:** `app/main/ipc/dataSource.ipc.ts` `writeDataSourceRows` (106-147) / `resolveDataFile` (69-73) / `resolveProjectPath` (275-281); `src/runner/StepExecutor.ts:1016-1058` (`saveSession`).
- **Observed implementation:** `dataSources:import(profile)` accepts a full profile whose `file` may be **any absolute path** (`isAbsolute(file) → return file`). `writeJson` then writes `JSON.stringify(rows)` to that path (only *sample/resources* and `app.asar` are protected via `isProtectedFile`). `saveSession` writes `storageState` (cookies/tokens) to `cfg.sessionFolder` — an arbitrary workflow-controlled folder (only the *file name* is sanitized, not the folder).
- **Impact:** a crafted imported data-source profile can overwrite an arbitrary user-writable file with JSON (integrity/DoS, not RCE — content is JSON, and downloads are not executed); a workflow can drop session secrets into a synced/network folder.
- **Remediation:** confine data-source writes to the configured data-sources workspace (resolve + verify the target is inside it, reject symlink/reparse escapes); confine `saveSession` to the runtime sessions root (or an explicit allowlisted folder); reject UNC/network targets unless opted in.
- **Regression test:** import a data source with `file` = `C:\Windows\Temp\evil.json` → write rejected; `saveSession` folder outside the sessions root → rejected.

### F-05 — `system:openPath` opens any renderer-supplied path with the OS handler  ·  MEDIUM · CONFIRMED

- **Affected:** `app/main/ipc/system.ipc.ts:32-49`.
- **Observed implementation:** `shell.openPath(path)` on a renderer-supplied string after only an `existsSync` check; for a directory it auto-opens the first image. No restriction to app artifact folders.
- **Impact:** the renderer can ask the OS to open **any** existing local file with its default handler. Not auto-executed by AWKIT, but `shell.openPath` on, e.g., a `.exe`/`.lnk`/`.ps1` would launch it. Reachable today only from trusted renderer code, but there is no barrier if the renderer is subverted (see F-06), and it pairs badly with any attacker-controlled download path.
- **Remediation:** restrict `openPath` to the app's runtime data root (reports/screenshots/downloads/sessions) — resolve + verify containment before calling `shell.openPath`; reject executable extensions.
- **Regression test:** `system:openPath("C:\\Windows\\System32\\cmd.exe")` rejected; a path under the reports root allowed.

### F-06 — No navigation lockdown; broad preload bridge with `sandbox:false`  ·  MEDIUM · CONFIRMED

- **Affected:** `app/main/windowManager.ts:5-52`; `app/main/preload.ts` (full API surface).
- **Observed implementation:** `webPreferences` sets `contextIsolation:true`, `nodeIntegration:false` (good) but `sandbox:false`, and there is **no `will-navigate` / `will-redirect` handler**. `setWindowOpenHandler` correctly denies + http(s)-only external open, but nothing prevents the *main* frame itself from navigating. The exposed `window.playwrightFlowStudio` API is powerful (run workflows, read/write files via data sources, launch browsers, capture sessions).
- **Impact:** contextIsolation blocks direct Node access from a hostile page, but if the renderer is ever navigated to untrusted content (bug, injected iframe reaching top-level nav, future feature), that content inherits the full IPC capability surface. Defense-in-depth gap, not a live exploit.
- **Remediation:** add `webContents.on("will-navigate")` / `will-redirect` to hard-block any navigation away from the app origin/bundle; consider enabling `sandbox:true` (preload uses only `ipcRenderer` + `contextBridge`, which are sandbox-compatible); keep the API as narrow as the UI needs.
- **Regression test:** a Playwright/Electron check that attempting `location = "https://evil"` in the renderer is blocked and the API is unreachable from any non-bundle origin.

### F-07 — Recorder captures all non-password input values literally  ·  MEDIUM · CONFIRMED

- **Affected:** `src/recorder/recorderInitScript.ts:1109-1110, 1139-1140`.
- **Observed implementation:** `const value = type === "password" ? "" : input.value;` — **only** `type="password"` is redacted. Values typed into `text`/`email`/`tel`/`search`/`number` inputs (OTP codes, card numbers, SSNs, bearer tokens pasted into a text box) are stored verbatim in the recorded flow JSON.
- **Existing protection (good):** password fields redacted; recorded URLs mask sensitive query keys (`RecorderService.maskUrl`, keys incl. `token`/`secret`/`password`); network capture stores method + URL **path** only (no headers/bodies/cookies); protected-login surfaces are detected and handed off without capture.
- **Impact:** sensitive non-password data can persist in workflow JSON, logs, and (via `sampleRow`) previews.
- **Remediation:** extend redaction to `autocomplete="one-time-code"`, `inputmode="numeric"` OTP fields, `type` in {`tel`}, fields whose name/id matches a card/SSN/OTP pattern, and offer a "store as secret reference" option (see §15 secret model) rather than literal capture.
- **Regression test:** record into an OTP/`one-time-code` and a card-number field → recorded value is empty/redacted.

### F-11 — Session capture launches the real browser with an unvalidated URL protocol  ·  LOW · CONFIRMED

- **Affected:** `src/session/SessionCaptureService.ts:215-231`.
- **Observed implementation:** the target URL is normalized (bare host → `https://`), but a URL that already carries a scheme (`file:`, `data:`) passes through and is appended as a positional arg to the real Chrome/Edge. Command-injection is **not** possible (argument array; a leading `--` value is neutralized because non-URL strings get `https://` prepended), but `file://` would open a local file in the user's real browser.
- **Impact:** low — it is the user's own browser, launched by the user's own capture action; worst case is opening a local file locally.
- **Remediation:** validate the capture target is `http(s)` before launch.

### F-08 — Download filename path traversal  ·  LOW · NEEDS VERIFICATION

- **Affected:** `src/runner/StepExecutor.ts:841-843` — `join(this.context.paths.downloads, download.suggestedFilename())`.
- **Concern:** `suggestedFilename()` is derived from the site's `Content-Disposition`. If Playwright does not strip path separators, a name like `..\..\evil.exe` would escape the downloads folder. Playwright generally sanitizes this to a basename, so the risk is likely already mitigated by the library — hence **NEEDS VERIFICATION**.
- **Positive:** downloaded files are **saved only, never opened or executed** (no `shell.openPath` on the download path), so even a malicious download is inert until the user acts.
- **Remediation:** defensively `basename()` + sanitize the suggested filename and confirm the resolved path stays inside the downloads root before `saveAs`.

### F-09 — No IPC sender/frame authorization  ·  LOW · CONFIRMED (defense-in-depth)

- **Affected:** all `ipcMain.handle` handlers in `app/main/ipc/*`.
- **Observed implementation:** handlers do not inspect `event.senderFrame`/`webContents` identity (except `system:browseFolder`, which only uses `event.sender` to pick the dialog's parent window). Acceptable for the single-trusted-window model, but there is no barrier if a second/unexpected frame ever reaches the bridge (compounds F-06).
- **Remediation:** if F-06 hardening lands (single-origin lockdown), add a lightweight sender-origin assertion in a shared IPC wrapper for the privileged channels (execution, dataSources write, session, settings).

### F-10 — Dev-only dependency advisories  ·  INFO · CONFIRMED

- `npm audit` reports esbuild/vite (moderate/high, dev server), and node-gyp/tar/cacache (transitive dev). These are **build-time only** — not present in the packaged offline runtime (`electron-builder.json` ships `out/**` + `sql-wasm` + resources/vendor; not `node_modules` dev tooling). Runtime dependencies shipped: Playwright (unpacked from asar), `sql.js`, React/framer-motion/lucide (bundled). Keep them patched but they are not a runtime exposure.

---

## 8. Electron Security Review

- **BrowserWindow** (`windowManager.ts`): `contextIsolation:true` ✅, `nodeIntegration:false` ✅, `sandbox:false` ⚠️ (F-06), `webviewTag` unset (default false) ✅, `webSecurity` unset (default true) ✅, `allowRunningInsecureContent`/`experimentalFeatures` unset ✅. Preload path is bundled.
- **Navigation:** `setWindowOpenHandler` denies all and opens **http(s) only** externally ✅ (`windowManager.ts:36-43`). **No `will-navigate`/`will-redirect`** ⚠️ (F-06). No `session.setPermissionRequestHandler` / download handler on the app session (the app renderer does not request geolocation/camera; the automation Chromium is a separate Playwright browser).
- **External open:** `auth.ipc.ts:14-18` and `windowManager.ts:39` both gate on `^https?://` ✅.

## 9. IPC Security Review

Full inventory from `preload.ts` + `app/main/ipc/*`. All are `ipcRenderer.invoke` → `ipcMain.handle` (request/response); the one push channel is `window:maximizedChanged` (main→renderer, boolean). A static guard (`verify:ipc-contract`, 4/4) already enforces every invoked channel has exactly one handler and unexposed handlers are allowlisted.

| Group | Channels | Privileged effect | Runtime validation | Sender auth | Risk |
| --- | --- | --- | --- | --- | --- |
| appWindow | minimize/toggleMaximize/close/isMaximized | window control | n/a | scoped to sender window | Low |
| system | openPath / browseFolder / capacityPreview | **OS open** / dialog | existsSync only | none | **Med (F-05)** |
| dataSources | list/get/CRUD/import/browseJson/readJson/**writeJson**/createFromScratch | **FS read/write** | shape-light; `file` unbounded | none | **Med (F-04)** |
| execution | runWorkflow / pause/resume/stop/repeat/recovery… | **runs automation** | no schema (F-03) | none | **High (F-01/03)** |
| session | startCapture/stop/delete/rename/getById | launch real browser, delete profile | name sanitized | none | Med |
| recorder | start/stop/saveFlow/handoff… | launch browser, write flow | URL normalized | none | Med (F-07) |
| settings | get/update/import/reset/paths… | persisted config incl. storage paths | validated + atomic write | none | Low |
| flows/workflows | CRUD/import/export/clone | FS JSON store | none (F-03 applies) | none | Med |
| telemetry/reports/instances/offlineRuntime/auth | read models + http(s) open | read-mostly | typed | none | Low |

TypeScript interfaces on the preload are **not** runtime validation (brief §3). Recommend a shared `validate()` wrapper for the write/execute channels (F-03/F-04) and optional sender assertion (F-09).

## 10. Workflow Execution Trust Review

Every current step type (`FlowProfile.ts:1-34`) and its sink:

| Step type | Privileged effect | Runtime schema | Dangerous fields | Bounds | Risk |
| --- | --- | --- | --- | --- | --- |
| goto / routeChange | navigation | none | `url` (any scheme) | timeout only | **Med (F-02)** |
| uploadFile | local file → site | none | `value` = path | none | **High (F-01)** |
| downloadFile | FS write | none | site filename | dir fixed | Low (F-08) |
| saveSession | write cookies/tokens | none | `sessionFolder` | name sanitized | Med (F-04) |
| autoSecureLogin / reuseSession / protectedLoginHandoff | browser swap / session | none | `reuseSessionId` | restart cap | Med |
| fill/click/select/check/scroll/readText/assert* | DOM action / read | none | locator, value | timeout | Low |
| loop | repeat | none | `maxIterations` | **caller-capped** | Low–Med (§13) |
| runFlow | sub-flow | none | `targetFlowId` | recursion? verify | Med |
| condition | routing | safe evaluator ✅ | expression | n/a | Low |
| unknown | — | **throws** ✅ | — | — | — |

Central gap: **no field/bounds validation before dispatch** (F-03). Unknown *type* is safely rejected; unknown *properties* and out-of-range values are not.

## 11. Arbitrary Code & Command Execution Review

- **Node / renderer JS execution:** **none.** No `eval`, `new Function`, `vm`, `require(userInput)`, or `executeJavaScript` anywhere (verified by repository-wide grep). Connector/condition "expressions" are evaluated by hand-written comparison engines (`ExpressionEvaluator.ts`, `ConnectorConditionEvaluator.ts`) — fixed operator sets, string/number coercion, no dynamic code. **Strong control.**
- **Browser-page JS:** `page.evaluate` / `addInitScript` appear only in the Recorder init script, `ProtectedLoginDetector`, and `PlaywrightRunner` — the injected code is **AWKIT-authored, static**; it does not evaluate user-supplied strings. Runs in the *target page* origin (not Node), which is the correct boundary.
- **OS command execution:** two sites, both safe: `SessionCaptureService.spawn(browserPath, argsArray)` (browser path from OS detection, **argument array**, no shell) and `ProcessTreeSampler.execFile` (queries the app's own PID subtree). **No shell string concatenation → no command injection.**

## 12. Navigation & Network Target Review

- URL sources: `goto`/`routeChange` steps, Recorder navigation, session-capture target, `shell.openExternal`.
- Protocols: external-open is **http(s)-only** ✅; automation `goto` has **no allowlist** (F-02). Internal/localhost/private ranges are **intentionally allowed** (authorized internal automation) — this is correct for the product; the residual risk is a malicious workflow silently targeting a local service, mitigated by treating workflows as trusted (conditions in §1) and by the F-02 fix restricting non-web schemes.
- Popups/new tabs: handled via `waitForEvent("page")` and validated against `urlContains`/`titleContains` hints (non-blocking). Redirects are not policy-checked (acceptable for automation).

## 13. Conditional / Parallel / Loop Security Review

- **Prototype pollution:** condition routing uses `variableName`→scope resolver and the safe evaluators; there is no user-path deep-merge into live objects on the execution path. `setJsonAtPath` (`TableEditing.ts:26-38`) copies via spread and does not mutate global `Object.prototype`, but assigning through a `__proto__` key is fragile — **HARDENING:** explicitly skip `__proto__`/`constructor`/`prototype` keys in `setJsonAtPath` and any future object-path setter. `resolveJsonPath` only reads. **Status: no confirmed pollution; harden defensively.**
- **Loops:** `LoopConnectorConfig.maxIterations` bounds iteration; self-loop-only structural rule + `validateConnectorStructure` prevent cross-node loop abuse; `maxActiveNodesPerFlow` clamps isolated parallel branches. **Gap:** `maxIterations` is not range-validated at load (F-03) — a huge value is a local-DoS lever (§18), classified reliability/DoS not RCE.
- **Parallel:** `waitAny`/`failFast` cancellation and branch page cleanup are implemented at the engine level (CURRENT_STATE hard-cancel path). Verify cancelled branches release pages/listeners under load (existing `verify:cancellation`, `verify:concurrency`).

## 14. Data Source Security Review

- `browseJsonDataSource` uses an OS file dialog (user-chosen) ✅. But `dataSources:import`/`create` accept an arbitrary `file` (abs path) that `readJson`/`writeJson` later read/overwrite (F-04). The full parsed file is returned to the renderer (`browseJson` returns `data`) — a huge JSON could pressure the renderer (reliability). `__proto__`/`constructor` keys in a data file are read as plain values (no pollution on the read path). **Remediation:** confine to the data-sources workspace; cap file size for preview; strip dangerous keys on write. **FIXED (batch 3):** `readJsonFileGuarded` applies a 25 MB cap + `isReadableDataSourceFile` confinement at every read sink; write confinement (F-04) + prototype-pollution rejection (§13) already shipped.

## 15. Recorder & Secret Leakage Review

Covered in F-07. **Recommended secret model for a desktop automation product:** do **not** recommend committing credentials to `.env`. Store operator secrets in **Windows Credential Manager / DPAPI-backed** local storage, reference them from steps by name (`{{secret:portal_password}}`), resolve at run time in the main process, and keep them out of workflow JSON, logs, previews, screenshots, and reports. Session profiles already live under the runtime root and are gitignored (`session-profiles.json`, `profiles/`, `sessions/`). **FIXED (batch 3):** DPAPI-backed secret store shipped (`src/secrets/SecretStore.ts` + `app/main/secretStore.ts` + `secrets.ipc.ts`), referenced from steps by name (`valueSource.type = "secret"`), resolved per-run in the main process and masked in logs; managed from **Settings → Secrets**.

## 16. Smart Locator Integrity Review

The "wrong privileged business action" threat is real for automation: the resolver (`LocatorFactory.resolve`) tries primary → `alternatives` → visibility disambiguation. A broad fallback could, in principle, match the wrong Submit/Delete/Approve control. Mitigations present: container/frame scoping, `guardLocatorQuality` fails ambiguous recorded steps lacking context/alternatives, and `friendlyLocatorError` surfaces strict-mode violations. **HARDENING:** for steps classified `dangerousMutation`/`externalCommit` (safety metadata), require a *unique* match and **disable silent positional fallback** — fail closed rather than click a guessed element. This is an automation-integrity control, tracked separately from code-execution risk.

## 17. Smart Wait Security Review

Wait types are a fixed enum (`FlowProfile.ts:167-186`): loaderHidden/elementVisible/… /response/urlChanged/domStable/fixedDelay. **No regex** in wait matching (`urlContains` is substring `includes`), so no ReDoS. "Custom" is **not** a code-execution wait — there is no user-JS wait type. Listener cleanup and stale-wait-after-browser-swap are handled by the generation-guarded runner + operation limiters. **Gap (F-03):** `timeoutMs`/`delayMs`/array length unbounded at load → local-DoS lever only.

## 18. Concurrency & Resource Abuse Review

Strong machine-adaptive controls exist: `BackpressureController`, `OperationLimiters` (browserLaunch/context/navigation/download/screenshot caps), `AdaptiveController` (CPU/mem/event-loop pressure), `maxActiveFlows`, `maxBrowsersPerHost`, report retention sweep. **Security-relevant DoS is low.** Residual **reliability/DoS** (not vulnerabilities): unbounded `maxIterations`/`timeoutMs` and huge workflow graphs from unvalidated JSON (F-03); log/screenshot disk growth over long runs (retention sweep mitigates). Classify: local-DoS = reliability, gated by F-03.

## 19. Dependency & Offline Supply Chain

Runtime-shipped: Playwright 1.49 (asar-unpacked), `sql.js` 1.13 + `sql-wasm`, React 18, framer-motion, lucide. Electron 33.2. Dev-only advisories (F-10) are not shipped. Offline validators exist (`OfflineRuntimeValidator`, `validate:offline`, dependency manifest). **HARDENING:** confirm the offline bundle validator checks **integrity (hashes)**, not just existence, of the bundled Chromium and `sql-wasm` (brief §19) — verify `dependency-manifest.json` carries hashes and `validate-offline-bundle.ps1` compares them.

| Dependency | Ver | Sev | Shipped | Reachable | Risk | Action |
| --- | --- | --- | --- | --- | --- | --- |
| esbuild/vite | dev | Mod/High | No | No (dev server) | Low | patch when convenient |
| node-gyp/tar/cacache | dev | High | No | No | Low | patch when convenient |
| electron | 33.2 | — | Yes | Yes | keep current | track Electron security releases |
| playwright | 1.49 | — | Yes | Yes | keep current | track releases |

## 20. Packaging & Release Security

`electron-builder.json`: ships `out/**` + `sql-wasm` + filtered `resources`/`vendor`; **excludes `test-fixtures/**` and icon sources**; asar on (Playwright unpacked). No `.env`/session/profile/report artifacts are included (runtime data lives in `%LOCALAPPDATA%`). NSIS is per-user, no elevation. **Gap:** **no code signing** configured (no `certificateFile`/`sign`) → the portable EXE and installer are **unsigned**. Signing does not protect the app's runtime behavior but does protect against post-build tampering and SmartScreen warnings; document this for enterprise distribution.

### Storage matrix

| Artifact | Dev | Packaged | Portable | Sensitive? | Protection |
| --- | --- | --- | --- | --- | --- |
| Workflows/flows/data sources | repo/workspace | `%LOCALAPPDATA%\WebFlow Studio` | portable data dir | med | file ACL (user) |
| Session profiles / storageState | gitignored `profiles/`,`sessions/` | `%LOCALAPPDATA%\…\sessions`,`profiles` | portable dir | **high** | user ACL only; not encrypted |
| Screenshots/reports/logs | workspace | runtime root | portable dir | **high** (may show portal data) | user ACL only |
| Settings | workspace | runtime root | portable dir | low | atomic write |
| Bundled Chromium / vendor | resources/vendor | extraResources | alongside EXE | low | read-only install |

Session profiles, screenshots, and reports are stored **unencrypted** under the user profile — acceptable for single-user desktop, but a candidate for DPAPI-at-rest (§28 P2) given banking/portal use.

## 21. Secrets & Repository Leakage

Repository grep for high-entropy `key/secret/password/token = "…"` assignments and private-key headers: **no hardcoded secrets found**. Only `.env.example` is present; `.env`/`.env.*` are gitignored, as are `session-profiles.json`, `profiles/`, `sessions/`, `browser-profiles/`. Recorder masks URL query secrets and redacts password fields. **Residual:** F-07 (non-password field values can enter workflow JSON). No secret values are reproduced in this report.

## 22. Logs, Screenshots, Reports & Privacy

`RunLogger` writes **masked** JSONL; `saveSession` logs only the artifact **path** (never contents), and only when masking is off. Diagnostics sanitize URLs to origin+path. Screenshots and full reports can, by their nature, contain portal page content (customer/account data) and are stored unencrypted (§20). **HARDENING:** document artifact sensitivity, offer a retention/auto-purge policy for screenshots/reports, and warn if the configured artifact path is a synced/network location.

## 23. Concurrency & Resource Abuse

See §18 — controls are strong; residual items are reliability/DoS gated by F-03, not security vulnerabilities.

## 24. Dependency & Offline Supply Chain

See §19.

## 25. Packaging & Release Security

See §20 (storage matrix included).

## 26. Existing Security Controls (proven from current code)

1. **No dynamic code execution** — zero `eval`/`Function`/`vm`; safe hand-written condition evaluators (`ExpressionEvaluator.ts`, `ConnectorConditionEvaluator.ts`).
2. **No command injection** — `spawn`/`execFile` use argument arrays, no shell (`SessionCaptureService.ts:236`, `ProcessTreeSampler.ts:133`).
3. **Electron hardening basics** — contextIsolation on, nodeIntegration off, http(s)-only window-open + openExternal (`windowManager.ts`, `auth.ipc.ts`).
4. **Recorder secret hygiene** — password redaction, URL query masking, network capture = method+path only, protected-login detect-and-handoff (`recorderInitScript.ts`, `RecorderService.ts`).
5. **No CAPTCHA/MFA bypass, no stealth** — no `navigator.webdriver` masking / fingerprint spoofing / challenge-solving code anywhere (verified); protected surfaces pause and hand off to the user's real browser.
6. **Chromium offline hardening** — egress-blocking launch args with **no** `--no-sandbox` / `--disable-web-security` / `--ignore-certificate-errors` (`ChromiumHardening.ts`; verified none present in `src/`).
7. **Data-integrity hardening** — atomic temp-file+rename writes, corrupt-file quarantine (not silent drop), serialized mutations, crash-safe id rename (`ProfileStore`, `uiSettings`, prior audit remediation A1-A3).
8. **Profile ownership** — in-process + durable `profile:<dir>` locks prevent two runtimes sharing a `user-data-dir`; `Singleton*` checks cover external Chrome/Edge.
9. **Parameterized SQL** — values bound via `?`; table names are internal constants (`SqliteRuntimeStore.ts`).
10. **Runtime connector-structure enforcement** — `validateConnectorStructure` runs at execute time, blocking UI-bypassed invalid graphs.
11. **Downloads are inert** — saved via `saveAs`, never opened/executed.
12. **IPC contract guard** — `verify:ipc-contract` prevents stray/duplicate/unexposed channels.

## 27. Security Test Gap Analysis (proposed matrix)

Current verifiers are functional (60+ `verify:*` scripts) but there is **no dedicated security-regression suite**. Add `verify:security` covering:

- **Workflow validation:** unknown step type (already throws — assert it), unknown properties rejected, huge graph, duplicate node/connector IDs, circular graph, negative/huge `timeoutMs`, huge `maxIterations`, 10k locator alternatives.
- **Upload/FS:** `uploadFile` with session-profile path / traversal / absolute path → rejected; data-source `file` outside workspace → rejected; `saveSession` folder outside sessions root → rejected.
- **Navigation:** `goto` with `file://` / `data:` rejected; `http(s)` + internal localhost allowed.
- **IPC:** `system:openPath` outside runtime root rejected; oversized payloads bounded.
- **Recorder:** OTP / `one-time-code` / card-number field → redacted.
- **Electron:** renderer `will-navigate` to external origin blocked.
- **Downloads:** traversal `suggestedFilename` confined to downloads root.
- **Sessions:** Workflow A session not silently reused by Workflow B; concurrent same-profile run blocked (lock).

## 28. Prioritized Security Roadmap

### P0 — Release-blocking (before running untrusted/shared workflows or wider distribution)
- **F-01 / F-03:** Add a runtime workflow validator + **upload path allowlist** (workspace-confined, reject runtime-root/profile/secret paths, reject traversal). *Components:* `StepExecutor` upload sink, new validator at the load/execute seam. *Complexity: Medium · Regression risk: Low · Tests:* workflow-validation + upload matrix (§27).

### P1 — High priority (before broader authorized production use)
- **F-02:** Navigation protocol allowlist at both `goto` sinks. *Small · Low · nav tests.*
- **F-04:** Confine data-source writes and `saveSession` to their workspaces; reject UNC/symlink escape. *Medium · Low.*
- **F-06:** `will-navigate`/`will-redirect` lockdown to the app bundle; evaluate `sandbox:true`. *Small · Medium.*
- **F-07:** Extend Recorder redaction (OTP/one-time-code/card/tel/name-pattern) + secret-reference option. *Medium · Low.*

### P2 — Security hardening (defense-in-depth)
- **F-05:** Confine `system:openPath` to the runtime root; reject executables. *Small · Low.*
- **F-09:** Sender-origin assertion wrapper on privileged IPC channels. *Small · Low.*
- **F-08 / §13 / §16:** Sanitize download filenames; skip `__proto__`/`constructor` in object-path setters; require unique match (no positional fallback) for `dangerousMutation` steps. *Small–Medium · Low.*
- **§20/§22:** DPAPI-at-rest for session profiles; artifact retention/auto-purge; warn on synced/network artifact paths.

### P3 — Long-term architecture
- Windows Credential Manager / DPAPI secret store with `{{secret:…}}` references (§15).
- Workflow **trust levels** (self-authored vs imported) with a capability gate (upload/file-nav/openPath) per trust level.
- **Code signing** (Authenticode) for portable EXE + installer.
- Offline-bundle **integrity (hash) validation**, not just existence (§19).

Each item states the exact boundary and validation required — no generic "improve validation" tasks.

## 29. Final Security Recommendation

> **Is the current AWKIT / WebFlow Studio build ready to automate authorized sensitive business and banking web applications?**

**YES WITH CONDITIONS.**

**Evidence:** the app has no confirmed code-execution or Electron privilege-boundary vulnerability, no
command injection, no CAPTCHA/MFA-bypass or stealth behavior, good session-handoff design, and strong data-
integrity and concurrency controls. It is safe for a **single, trusted operator running workflows and data
sources that operator authored**, on an artifact volume that isn't sensitive/synced.

**Conditions (must hold until P0/P1 land):**
1. Do **not** run or import workflows / data-source files from an untrusted source (F-01/F-03/F-04 make a
   manipulated workflow a real local-exfiltration/overwrite vector).
2. Treat workflow JSON as trusted code and review before running.
3. Keep session profiles / screenshots / reports on a local, access-controlled volume.

**Exact release blockers for wider (multi-user / imported-workflow / enterprise) use:**
- **P0:** runtime workflow schema validation + upload-path allowlist (F-01/F-03).
- **P1:** navigation protocol allowlist (F-02), data-source/save-session write confinement (F-04),
  renderer navigation lockdown (F-06), Recorder redaction extension (F-07).
- **P3 (distribution):** Authenticode signing.

---

### Appendix — Method & honesty notes

- Every finding cites current source (`file:line`) read during this audit; no findings were carried over
  from any other project.
- **Not executed** (require a clean-machine / packaged run outside this static+targeted review): live
  malformed-workflow reproduction against the mock site, a packaged-EXE storage/signing check, and a live
  concurrent-session isolation stress. These are called out as NEEDS VERIFICATION where relevant (F-08) or
  proposed as regression tests (§27).
- No secrets were discovered or reproduced. No remote/GitHub interaction occurred. No fixes were applied
  (audit-only, per the brief and the user's instruction not to commit).
