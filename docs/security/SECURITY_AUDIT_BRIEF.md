# Goal: Perform a Full Security Audit of AWKIT / WebFlow Studio

You are acting as a:

* Senior Application Security Engineer
* Electron Security Specialist
* Playwright Automation Security Engineer
* Browser Security Engineer
* Windows Desktop Security Engineer
* Secure Software Architect

Your goal is to perform a **complete, evidence-based security audit of the actual current AWKIT / WebFlow Studio codebase**.

AWKIT is a Windows-first Electron + React + TypeScript desktop application used to visually design and execute authorized Playwright web automation workflows.

This is **not Spotlight-Todo**.

Do not reference, reuse, or assume findings from Spotlight-Todo or any unrelated project.

Audit only the actual current AWKIT repository and its implementation.

---

# Primary Objective

Determine whether AWKIT safely converts:

```text
User-created workflows
Recorded browser actions
Dynamic data
Saved browser sessions
Concurrent execution configuration
```

into:

```text
Electron privileged operations
Playwright browser operations
Browser profile access
Filesystem access
Process execution
Network navigation
Downloads and uploads
```

The primary security question is:

> Can untrusted, malformed, manipulated, or unexpectedly structured AWKIT workflow/runtime input cross a trust boundary and perform operations beyond the intended automation model?

This is initially an **AUDIT AND REPORTING GOAL**.

Do not perform broad security refactoring before understanding the actual security architecture and documenting confirmed findings.

Small temporary test harnesses may be created when required to safely prove or disprove a finding.

---

# Known AWKIT Architecture and Security-Sensitive Features

The current project is known to contain or has previously contained features including:

* Electron desktop runtime.
* React renderer.
* TypeScript.
* electron-vite / Vite.
* Playwright.
* Bundled/offline Chromium.
* Workflow Builder.
* Flow Designer.
* Recorder.
* Execution engine.
* StepExecutor.
* PlaywrightRunner.
* BrowserContextFactory.
* Concurrent Instance Monitor.
* Live Reports.
* Saved flows.
* Workflow JSON persistence.
* Dynamic data sources.
* JSON Data Source Manager.
* Smart Locator Engine.
* Smart Wait Engine.
* Conditional connectors.
* Parallel connectors.
* Loop connectors.
* Isolated parallel pages.
* Auto Secure Login.
* Reuse Session.
* Session Capture.
* Manual Chrome Handoff.
* Protected Login Handoff.
* Browser restarting.
* Screenshots.
* Execution logs.
* Workflow history and statistics.
* Offline packaging.

Known security-sensitive code paths may include files or concepts such as:

```text
StepExecutor.ts
PlaywrightRunner.ts
BrowserContextFactory.ts
SessionCaptureService.ts
browserRestarter
manualChromeHandoff
Auto Secure Login
Reuse Session
```

These names are investigation leads.

Do not assume file locations, implementations, or vulnerabilities without verifying the current codebase.

---

# Critical Working Rule

Treat all previous assessments as hypotheses.

For every potential issue:

1. Locate the current implementation.
2. Trace the complete data flow.
3. Identify the trust boundary.
4. Verify existing protections.
5. Attempt a safe controlled reproduction when appropriate.
6. Confirm or disprove the issue.
7. Record exact evidence.

Do not convert assumptions into security findings.

Use:

```text
CONFIRMED
DISPROVED
NEEDS VERIFICATION
HARDENING RECOMMENDATION
```

---

# Phase 1 — Build the Actual AWKIT Security Architecture

Read the project memory and architecture documentation first.

Then verify the documentation against actual source code.

Map the complete architecture.

At minimum trace:

```text
React Renderer
      ↓
Preload / Context Bridge
      ↓
Electron IPC
      ↓
Main Process
      ↓
Execution Services
      ↓
Workflow Execution Engine
      ↓
StepExecutor
      ↓
PlaywrightRunner
      ↓
Browser / BrowserContext / Page
```

Also map:

```text
Recorder
   ↓
Recorded Action
   ↓
Locator Generation
   ↓
Flow Step
   ↓
Workflow Persistence
   ↓
Workflow Loading
   ↓
Execution
```

Map:

```text
Data Source JSON
        ↓
Data Source Manager
        ↓
Dynamic Mapping
        ↓
Step Value Resolution
        ↓
Playwright Action
```

Map:

```text
Auto Secure Login
        ↓
Session Lookup
        ↓
Session Capture or Existing Session
        ↓
Reuse Session
        ↓
Browser Restart
        ↓
Persistent Browser Context
```

Map:

```text
Manual Chrome Handoff
        ↓
Real Chrome / Edge Process
        ↓
User Authentication
        ↓
Profile Capture
        ↓
Session Storage
        ↓
Playwright Reuse
```

Map concurrency:

```text
Workflow
    ↓
Execution Instance
    ↓
Runner
    ↓
Browser / Context
    ↓
Page
```

And:

```text
Parallel Connector
        ↓
Parallel Branches
        ↓
Shared Page or Isolated Page
        ↓
Branch Join
```

Identify every privilege boundary.

Create a Markdown security architecture diagram.

---

# Phase 2 — Identify All Privileged Operations

Search the entire codebase for operations capable of affecting:

* Browser processes.
* Browser profiles.
* Browser contexts.
* Pages.
* Cookies.
* Local storage.
* IndexedDB.
* Session storage.
* Files.
* Directories.
* Downloads.
* Uploads.
* Child processes.
* Windows shell.
* Environment variables.
* Network navigation.
* Electron windows.
* Persistent application state.

Search for all usage of:

```text
ipcMain
ipcRenderer
contextBridge
BrowserWindow
webContents
shell
child_process
spawn
exec
execFile
fork
process.kill
process.env
fs
fs/promises
readFile
writeFile
rm
unlink
rename
copyFile
mkdir
readdir
stat
realpath
path.resolve
path.join
launch
launchPersistentContext
newContext
newPage
browser.close
context.close
page.close
page.goto
page.evaluate
locator.evaluate
evaluateHandle
addInitScript
exposeFunction
route
request
setInputFiles
waitForEvent
download
saveAs
cookies
storageState
```

Create an inventory:

| Operation | File | Function | Input Source | Privilege | Validation | Security Boundary |
| --------- | ---- | -------- | ------------ | --------- | ---------- | ----------------- |

---

# Phase 3 — Electron and IPC Security Audit

Audit every `BrowserWindow`.

Verify:

```text
contextIsolation
nodeIntegration
sandbox
webSecurity
preload
webviewTag
allowRunningInsecureContent
experimentalFeatures
```

Review:

```text
setWindowOpenHandler
will-navigate
will-redirect
window.open
shell.openExternal
session permission handlers
download handlers
```

Determine whether an unexpected renderer navigation could expose AWKIT's preload bridge to untrusted content.

This is critical.

AWKIT's preload API can potentially reach browser automation, sessions, filesystem functions, and execution services.

Audit every:

```text
contextBridge.exposeInMainWorld
ipcRenderer.invoke
ipcRenderer.send
ipcMain.handle
ipcMain.on
```

Produce a complete IPC inventory:

| Channel | Renderer API | Main Handler | Privileged Effect | Runtime Validation | Sender Authorization | Risk |
| ------- | ------------ | ------------ | ----------------- | ------------------ | -------------------- | ---- |

For every privileged IPC handler verify:

### Runtime validation

Check:

* Object schema.
* Required properties.
* Optional properties.
* Unknown property rejection.
* String lengths.
* Array limits.
* Numeric limits.
* Enum validation.
* URL validation.
* Filesystem path validation.
* Nested object depth.
* Payload size.

TypeScript interfaces are not runtime security validation.

### Sender authorization

Inspect:

```text
event.sender
event.senderFrame
event.senderFrame.url
webContents.id
expected BrowserWindow
frame ownership
```

Determine whether an unexpected renderer or frame can invoke privileged automation functionality.

### API narrowness

Identify broad IPC contracts such as conceptual APIs like:

```text
executeStep(step)
executeWorkflow(workflow)
saveSettings(object)
openPath(path)
launchBrowser(options)
captureSession(config)
loadDataSource(path)
```

Determine whether manipulated objects can activate properties or execution branches not exposed by the UI.

---

# Phase 4 — Workflow Schema and Execution Trust Audit

This is a **CRITICAL AWKIT security area**.

The visual UI is not a security boundary.

Assume a user or local process could manually modify:

* Flow JSON.
* Workflow JSON.
* Connector configuration.
* Step properties.
* Data source mappings.
* Saved session metadata.

Trace:

```text
Workflow file
    ↓
JSON parsing
    ↓
Runtime validation
    ↓
Migration or normalization
    ↓
Execution Engine
    ↓
StepExecutor
```

Determine whether AWKIT performs complete runtime schema validation before execution.

Inventory every supported node/step type.

For each step type document:

| Step Type | Privileged Effect | Runtime Schema | Dangerous Fields | Bounds | Risk |
| --------- | ----------------- | -------------- | ---------------- | ------ | ---- |

Verify behavior for:

* Unknown node type.
* Removed node type.
* Invalid property types.
* Unknown properties.
* Extremely long values.
* Negative timeouts.
* Huge timeouts.
* Invalid locator structures.
* Thousands of locator alternatives.
* Deeply nested locator context.
* Invalid waits.
* Huge wait arrays.
* Unknown connector kind.
* Invalid branch targets.
* Missing target nodes.
* Self-referencing connections.
* Circular graphs.
* Nested loops.
* Infinite loops.
* Huge workflow graph.
* Duplicate node IDs.
* Duplicate connector IDs.

Determine whether manually manipulated workflow JSON can reach execution functionality the GUI would not normally create.

Do not assume saved local JSON is trusted.

---

# Phase 5 — Arbitrary Code and Script Execution Audit

Search aggressively for:

```text
eval
Function(
new Function
vm.
page.evaluate
locator.evaluate
evaluateHandle
addInitScript
executeJavaScript
script
customJavaScript
custom code
expression
template evaluation
interpolation
```

Pay special attention to:

* Smart Wait Engine custom conditions.
* Dynamic values.
* Conditional connector expressions.
* Recorder-generated scripts.
* Locator engines.
* Data transformation.
* User-defined JavaScript functionality.

For each code execution primitive determine:

```text
Who controls the code?
Where is it executed?
Electron renderer?
Electron main process?
Node.js?
Playwright browser page?
Target web application origin?
```

This distinction is critical.

For example:

```text
page.evaluate(userCode)
```

is materially different from:

```text
new Function(userCode)()
```

inside Electron main.

Determine whether user-controlled content can reach Node.js execution.

Search for command injection risks around:

```text
spawn
exec
execFile
PowerShell
cmd.exe
start
Chrome
Edge
```

Audit executable paths and command arguments separately.

Prefer argument arrays instead of concatenated shell commands.

Report every confirmed path from user-controlled input to executable code or operating-system command execution.

---

# Phase 6 — URL, Navigation, and Network Target Security

Inventory every source of navigation URLs:

* Navigate step.
* Recorder.
* Route Change.
* Popups.
* New tabs.
* Auto Secure Login.
* Protected Login Handoff.
* Session matching.
* Manual handoff.
* Workflow JSON.
* Dynamic data source values.

Determine accepted protocols.

Explicitly test or trace:

```text
http:
https:
file:
javascript:
data:
blob:
ftp:
ws:
wss:
chrome:
chrome-extension:
devtools:
```

Determine what happens for:

```text
localhost
127.0.0.1
::1
0.0.0.0
private IPv4 ranges
link-local addresses
internal hostnames
UNC-style targets
```

AWKIT is an authorized automation platform and may legitimately automate internal applications.

Do not blindly block internal networks.

Instead determine:

1. Whether the behavior is intentional.
2. Whether target scope is controlled.
3. Whether a malicious workflow can unexpectedly target local services.
4. Whether redirects can leave the intended target scope.
5. Whether target restrictions or user-visible execution policy are needed.

Review popup and new-window navigation.

Review cross-origin redirects.

Review downloads triggered by navigation.

---

# Phase 7 — Browser Session and Credential Security

This is a **CRITICAL audit area**.

Review the complete implementation of:

```text
Auto Secure Login
Reuse Session
Session Capture
manualChromeHandoff
Protected Login Handoff
browserRestarter
launchPersistentContext
storageState
```

Inventory all persisted authentication-related data.

Look for:

```text
cookies
refresh tokens
access tokens
session cookies
localStorage
IndexedDB
Chrome profile files
Login Data
Cookies database
Web Data
Local State
Network
Session Storage
IndexedDB
Service Worker
```

Determine exactly:

* What AWKIT stores.
* Where it stores it.
* How profiles are named.
* How workflow/session association works.
* Whether session paths appear in workflow JSON.
* Whether sensitive profiles can be copied.
* Whether logs expose paths or authentication metadata.
* Whether release packaging can accidentally include session data.

Review Windows ACL assumptions.

Review `%LOCALAPPDATA%/WebFlow Studio` or the actual current runtime data location.

Verify current behavior from source.

Do not assume the historical location remains correct.

Assess session isolation.

Test or trace whether:

```text
Workflow A session
```

can accidentally be reused by:

```text
Workflow B
```

Check:

* Origin matching.
* Domain matching.
* Port handling.
* HTTP versus HTTPS.
* Subdomains.
* Session ID collisions.
* Deleted sessions.
* Renamed workflows.
* Duplicated workflows.
* Concurrent workflow runs.

Review profile ownership.

Determine whether multiple Playwright runs or real Chrome/Edge can use the same profile concurrently.

Audit:

```text
SingletonLock
SingletonCookie
SingletonSocket
DevToolsActivePort
```

Do not delete locks blindly.

Determine process ownership and active profile usage before cleanup.

Review the previous Reuse Session browser-restart area, including the known runtime path:

```text
Reuse Session
    ↓
browserRestarter({ newUserDataDir: profile.profileDir })
    ↓
close current browser/context
    ↓
launchPersistentContext(profile directory)
```

The historical failure:

```text
page.goto: Target page, context or browser has been closed
```

is not automatically a security vulnerability.

However, audit the lifecycle for:

* Race conditions.
* Stale page references.
* Stale context references.
* Cross-instance references.
* Profile corruption.
* Concurrent profile ownership.
* Cleanup running against a replacement browser.
* Unexpected session crossover.

Classify lifecycle problems separately from security vulnerabilities unless an actual security boundary is affected.

---

# Phase 8 — Protected Login and Manual Handoff Safety

AWKIT must not bypass:

* CAPTCHA.
* MFA.
* Security challenges.
* Bot detection.
* Protected authentication mechanisms.

Audit the detection and handoff architecture.

Known protected login targets or detection patterns may include:

```text
Google
Microsoft
Okta
Auth0
Duo
CAPTCHA text
MFA text
security-check text
```

Verify:

```text
Protected login detected
        ↓
Automation pauses
        ↓
User receives clear safe handoff UI
        ↓
Playwright automation does not attempt bypass
        ↓
Approved real browser login flow
        ↓
User manually authenticates
        ↓
Session capture
        ↓
Automation safely resumes
```

Search for:

```text
stealth
webdriver masking
navigator.webdriver
fingerprint spoofing
CAPTCHA solving
challenge bypass
MFA automation
OTP interception
```

Determine whether any implementation accidentally creates prohibited bypass behavior.

Also verify that a malicious workflow cannot disable protected-login safety by manually modifying workflow JSON or step configuration.

Security control must exist in the runtime boundary where necessary, not only in the UI.

---

# Phase 9 — Browser and Workflow Isolation Audit

Audit isolation across:

* Workflows.
* Workflow instances.
* Sequential runs.
* Concurrent runs.
* Parallel branches.
* Shared-page branches.
* Isolated-page branches.
* Browser contexts.
* Persistent contexts.
* Saved sessions.

Create an isolation matrix:

| Scenario | Browser Shared? | Context Shared? | Page Shared? | Profile Shared? | Expected Isolation |
| -------- | --------------- | --------------- | ------------ | --------------- | ------------------ |

Review:

```text
ParallelConnectorConfig
joinMode
failMode
isolation
maxConcurrency
sharedPage
isolatedPage
```

Determine whether parallel branch execution can leak:

* Page state.
* Cookies.
* Local storage.
* Navigation.
* Variables.
* Locator state.
* Downloads.
* Runtime step results.

Review the current or planned shared-browser/context architecture.

Do not assume:

```text
BrowserContext = perfect isolation
```

Verify actual persistent-profile and session behavior.

Identify mutable global or singleton state.

Search for:

```text
currentBrowser
currentContext
currentPage
activeRunner
activeWorkflow
currentSession
global Map
module-level state
singleton
```

Determine whether concurrent instances can overwrite shared runtime references.

---

# Phase 10 — Recorder Security and Secret Leakage

Audit the Recorder as a sensitive input-capture system.

Trace:

```text
Browser event
    ↓
Recorder
    ↓
Action normalization
    ↓
Locator generation
    ↓
Value capture
    ↓
Draft flow
    ↓
Saved flow
```

Determine whether recorder output captures:

* Password values.
* OTP values.
* Credit card data.
* Authentication tokens.
* Hidden fields.
* Authorization headers.
* Cookies.
* Session IDs.
* Personal data.
* Banking data.
* Customer data.

Inspect:

```text
input
fill
type
press
select
request
response
headers
screenshots
page text
```

Determine whether password fields are:

```text
recorded literally
redacted
converted to secret references
ignored
```

Review recorder screenshots and logs.

Verify whether secrets can appear in:

* Workflow JSON.
* Draft JSON.
* Console logs.
* Structured logs.
* HTML reports.
* Live reports.
* Screenshots.
* Error diagnostics.
* Memory documentation.

Provide a concrete secret-handling recommendation designed for AWKIT.

Do not recommend committing credentials to `.env` as a universal solution.

Determine the correct secret model for a desktop automation product.

Assess whether Windows Credential Manager or DPAPI-backed local secret storage is appropriate.

---

# Phase 11 — Smart Locator Security

Review:

```text
StepLocator
alternatives[]
context
dialog
tableRow
card
listItem
iframe
```

Test malformed locator objects.

Determine whether locator configuration can cause:

* Arbitrary JavaScript execution.
* Unexpected frame access.
* Excessive locator searches.
* CPU exhaustion.
* Huge diagnostics.
* Sensitive page-content leakage.

Review fallback behavior:

```text
primary
    ↓
alternatives
    ↓
context scoping
    ↓
visibility fallback
```

Determine whether broad fallbacks could interact with the wrong security-sensitive element.

For example:

* Wrong Submit button.
* Wrong Delete button.
* Wrong Approve button.
* Wrong account row.
* Wrong transfer beneficiary.

This may be an **automation integrity risk**, even if it is not traditional code execution.

Assess the Smart Locator Engine from a "wrong privileged business action" threat model.

Report this separately.

---

# Phase 12 — Smart Wait Security and Abuse Resistance

Inventory all current wait condition types.

Historical implementation included approximately:

```text
time
selector visible
selector hidden
navigation
networkIdle
textVisible
request URL
response URL
method
status
idle milliseconds
custom
```

Verify the current actual types.

For every wait type review:

* Maximum timeout.
* URL pattern complexity.
* Regex usage.
* String size.
* Number of waits.
* Event listener cleanup.
* Promise cleanup.
* Cancellation.
* Workflow stop behavior.
* Browser restart behavior.

Check for catastrophic regular-expression behavior if regex is supported.

Check listener leaks for request/response waits.

Check waits armed before browser replacement.

Check stale waits after page/context/browser closure.

Determine whether malicious workflow data can create:

* Infinite waits.
* Thousands of listeners.
* Memory growth.
* Excessive logs.
* Runner starvation.

Audit any `custom` wait especially deeply.

Determine exactly what "custom" means in current implementation.

---

# Phase 13 — Conditional, Parallel, and Loop Execution Security

Review:

```text
ConditionalConnectorConfig
ParallelConnectorConfig
loop connector configuration
```

Audit conditional fields such as:

```text
sourceField
operator
expectedValue
priority
```

Determine whether property-path resolution is vulnerable to:

```text
__proto__
prototype
constructor
```

Check all object path helpers and merge utilities for prototype pollution.

Test malformed connector graphs.

Check:

* Branch cycles.
* Endless loops.
* Loop counter overflow.
* Missing termination condition.
* Huge maximum iteration value.
* Negative iteration value.
* Nested loop explosion.
* Parallel branch explosion.
* `waitAny` cleanup.
* `failFast` cancellation.
* `collectErrors` memory growth.

Verify that branches terminated by `waitAny` cannot continue executing privileged browser actions unexpectedly.

Verify failed or cancelled branches release:

* Pages.
* Listeners.
* Downloads.
* Timers.
* Waits.
* Runtime references.

---

# Phase 14 — Data Source Manager Security

Audit all JSON data-source functionality.

Trace:

```text
Browse file
    ↓
Path validation
    ↓
Read file
    ↓
JSON parse
    ↓
Preview
    ↓
Row/column mapping
    ↓
Dynamic step value
    ↓
Playwright action
```

Check:

* Arbitrary filesystem paths.
* UNC paths.
* Network files.
* Symbolic links.
* Huge JSON files.
* Deep JSON nesting.
* Huge arrays.
* Duplicate keys.
* Prototype-related keys.
* Invalid encodings.
* File changes after preview.
* Deleted files.
* Concurrent editing.
* Sensitive values.

Determine whether the renderer receives the entire file contents.

Determine whether huge data sources can freeze the renderer.

Determine whether secrets in a data source appear in logs or reports.

Review Data Source Editor write operations.

Check for:

* Arbitrary file overwrite.
* Path traversal.
* Symlink/reparse-point overwrite.
* Race between validation and write.
* Non-atomic writes.
* Corruption after application crash.

---

# Phase 15 — Upload and Download Security

Find every Playwright upload operation.

Audit:

```text
setInputFiles
file chooser
upload path
```

Determine whether workflow JSON can provide arbitrary local file paths.

This may be expected functionality in an automation platform.

However, explicitly document the trust model.

Determine whether a manipulated workflow can upload:

```text
AWKIT configuration
session profiles
cookie databases
browser Local State
logs
screenshots
SSH keys
other sensitive local files
```

Assess whether the product requires:

* Explicit allowed paths.
* User approval.
* Workspace boundaries.
* Execution-time warnings.
* Workflow trust levels.

Review downloads.

Trace:

```text
Target site
    ↓
Playwright download
    ↓
Suggested filename
    ↓
AWKIT path resolution
    ↓
saveAs
```

Test:

* `../`
* Absolute paths.
* Reserved Windows names.
* Extremely long names.
* Existing files.
* Symlink/reparse targets.
* Executable downloads.
* `.lnk`
* `.url`
* `.ps1`
* `.bat`
* `.cmd`
* `.exe`

Determine whether downloaded files are automatically opened or executed.

Automatic execution of downloaded content must be treated as high risk.

---

# Phase 16 — Browser Process Launch and OS Command Security

Audit browser launching for:

* Bundled Chromium.
* Real Chrome.
* Edge.
* Manual login handoff.

Trace executable resolution.

Verify executable paths cannot be manipulated by:

* Workflow values.
* Data source values.
* Session metadata.
* Renderer-controlled IPC parameters.

Inspect all command-line arguments.

Look for:

```text
--user-data-dir
--remote-debugging-port
--proxy-server
--load-extension
--disable-web-security
--no-sandbox
--disable-site-isolation-trials
--ignore-certificate-errors
```

Document every Chromium argument AWKIT supplies.

Explain the security effect of each non-default argument.

Search for shell concatenation.

Unsafe conceptual example:

```text
exec(`"${browserPath}" --user-data-dir="${profilePath}"`)
```

Prefer direct process APIs and argument arrays.

Review process termination.

Determine whether AWKIT can terminate unrelated Chrome or Edge processes.

A process name match alone is insufficient ownership validation.

Verify process ownership before terminating or cleaning profile locks.

---

# Phase 17 — Screenshots, Reports, Logs, and Diagnostics Privacy

AWKIT may automate:

* Internal business systems.
* CRM systems.
* ERP portals.
* Banking portals when authorized.
* Admin applications.

Therefore screenshots and reports must be considered potentially sensitive.

Inventory:

```text
screenshots/
logs/
reports/
Live Report
workflow history
error diagnostics
locator diagnostics
runtime statistics
```

Determine whether these artifacts contain:

* Page screenshots.
* URLs.
* Query parameters.
* Usernames.
* Customer information.
* Account information.
* Transaction information.
* Input values.
* Locator text.
* DOM snippets.
* Cookies.
* Headers.
* Filesystem paths.
* Session profile paths.

Check retention.

Check cleanup.

Check file permissions.

Check whether paths can be configured to insecure network or synchronized locations.

Check whether report generation embeds sensitive screenshots or values.

Review exception handling.

Determine whether raw Playwright errors expose sensitive page or input context.

---

# Phase 18 — Concurrency and Local Denial-of-Service Security

AWKIT supports repeated and concurrent workflow execution.

Audit the actual execution dispatcher and concurrency controls.

Do not assume machine specifications such as:

```text
8 CPU cores
48 GB RAM
```

The system must adapt to the current machine.

Review limits for:

* Concurrent workflow instances.
* Browser processes.
* Browser contexts.
* Pages.
* Parallel branches.
* Downloads.
* Screenshots.
* Step logs.
* History records.
* Timers.
* Event listeners.
* Worker queues.

Test or reason from concrete code about:

* Infinite workflow loops.
* Workflow spawning excessive pages.
* Parallel branch explosion.
* Repeated browser restart.
* Failed page cleanup.
* Failed context cleanup.
* Browser crash restart loops.
* Massive screenshot creation.
* Log disk exhaustion.
* Huge Live Report timelines.
* Large workflow history.
* Large workflow JSON.
* Run button spam.
* Multiple concurrent execution requests for the same workflow.

Classify findings as:

```text
Security-relevant DoS
Reliability defect
Performance issue
```

Do not artificially label all resource issues as security vulnerabilities.

---

# Phase 19 — Offline Runtime and Supply-Chain Security

Review:

```text
package.json
package-lock.json
Electron
Playwright
bundled Chromium
electron-vite
Vite
React
native modules
electron-builder
packaging scripts
```

Known offline-related architecture may contain components or scripts conceptually related to:

```text
BundledBrowserResolver
OfflineRuntimeValidator
ProductionStartupCheck
NoInternetGuard
prepare-offline-deps.ps1
generate-dependency-manifest.ps1
validate-offline-bundle.ps1
package-portable.ps1
```

Verify actual current names and implementations.

Review dependency vulnerabilities.

Do not rely only on:

```text
npm audit --omit=dev
```

Electron and Playwright may appear as development dependencies while their runtime or browser binaries are distributed with the product.

For every Critical or High dependency issue document:

| Dependency | Version | Severity | Shipped | Reachable | AWKIT Risk | Action |
| ---------- | ------- | -------- | ------- | --------- | ---------- | ------ |

Review:

* Lockfile integrity.
* Install scripts.
* Native binaries.
* Browser downloads.
* Dependency manifests.
* Browser executable hashes.
* Offline bundle validation.
* Stale bundled Chromium.
* Stale Playwright/browser revision mismatch.

Determine whether the offline dependency validation verifies integrity or only existence.

---

# Phase 20 — Packaging and Release Security

Review all Electron packaging configuration.

Inventory final packaged contents.

Search release artifacts for:

```text
.env
session profiles
cookies
Local State
Login Data
workflow files
data source files
screenshots
logs
reports
test credentials
development certificates
source maps
debug artifacts
```

Verify browser binaries.

Verify native modules.

Check ASAR usage and unpack rules.

Check Windows Authenticode status.

Determine whether the application and distributed executable are signed.

Explain what signing protects and what it does not protect.

Review portable packaging behavior.

Determine where AWKIT stores:

* Workflows.
* Sessions.
* Profiles.
* Screenshots.
* Logs.
* Reports.
* Settings.

Test the conceptual environments:

```text
Development
Packaged installation
Portable package
Offline clean Windows machine
```

Produce a storage matrix:

| Artifact | Dev Location | Packaged Location | Portable Location | Sensitive? | Protection |
| -------- | ------------ | ----------------- | ----------------- | ---------- | ---------- |

---

# Phase 21 — Secrets and Repository Leakage

Search the repository and release contents for:

```text
password
passwd
secret
token
apiKey
api_key
authorization
bearer
cookie
session
storageState
refresh_token
access_token
client_secret
private key
BEGIN RSA
BEGIN OPENSSH
.env
credential
```

Inspect:

* Source.
* Tests.
* Fixtures.
* Mock site.
* Logs.
* Screenshots.
* Reports.
* Documentation.
* Project memory.
* Handoff files.
* Packaged application.

GitHub review is not required for this task.

Work from the **local project only**.

Do not modify or push anything to GitHub.

If local Git history is available, it may be inspected for accidental secret leakage, but do not contact GitHub or change remote state.

Never print an actual discovered secret in the report.

Redact values.

---

# Phase 22 — Security Regression Test Gap Analysis

Review all current verification suites.

Historical suites may include or may previously have included:

```text
verify:runner
verify:recorder
verify:recorder-draft
verify:flow-designer
verify:waits
```

Verify current scripts and actual test counts.

Do not rely on historical counts.

Create a security test matrix covering at minimum:

## Workflow Validation

* Unknown step type.
* Unknown step properties.
* Huge workflow.
* Duplicate node IDs.
* Duplicate connector IDs.
* Circular graph.
* Infinite loop.
* Excessive iteration count.
* Parallel branch explosion.

## IPC

* Invalid types.
* Unknown properties.
* Oversized payload.
* Deep object.
* Unauthorized renderer.
* Unauthorized frame.
* Destroyed sender.

## Navigation

* `file://`
* `javascript:`
* `data:`
* localhost.
* Private network.
* Cross-origin redirect.
* Unexpected popup.

## Sessions

* Workflow A session reused by Workflow B.
* Concurrent same-profile run.
* Real Chrome owns profile.
* Playwright owns profile.
* Stale lock.
* Deleted profile.
* Corrupted profile.
* Browser replacement during active waits.

## Protected Login

* CAPTCHA detected.
* MFA detected.
* Security challenge detected.
* Manually modified workflow attempts to disable handoff.
* Resume after manual authentication.

## Recorder

* Password input.
* OTP input.
* Hidden input.
* Token-like value.
* Screenshot containing sensitive content.
* Error containing input value.

## Data Sources

* Huge JSON.
* Deep JSON.
* `__proto__`.
* `constructor`.
* Network path.
* Symlink/reparse file.
* File changed after preview.
* Arbitrary overwrite.

## Uploads

* Session database upload.
* Profile file upload.
* Arbitrary absolute path.
* Nonexistent path.
* Network path.

## Downloads

* Path traversal filename.
* Executable download.
* Existing file.
* Huge download.
* Interrupted download.

## Concurrency

* Concurrent workflows.
* Concurrent same session.
* Parallel isolated pages.
* Parallel shared page.
* `waitAny` cancellation.
* `failFast` cancellation.
* Browser crash.
* Page crash.
* Repeated restart.

## Electron

* Unexpected renderer navigation.
* New window.
* Permission request.
* Preload access from unexpected page.
* Unauthorized IPC sender.

---

# Severity Model

Use:

## CRITICAL

Realistic path to:

* Node.js or OS command execution outside intended product behavior.
* Electron privilege-boundary compromise.
* Cross-workflow credential/session compromise with major impact.
* Automatic execution of untrusted downloaded content.
* Major unauthorized browser action outside the workflow trust model.

## HIGH

Realistic path to:

* Authentication/session data exposure.
* Sensitive local file upload without an appropriate trust control.
* Unauthorized privileged IPC operation.
* Major cross-workflow isolation failure.
* Protected-login safety bypass.
* Dangerous persistent data exposure.
* Severe workflow integrity failure causing unintended privileged web actions.

## MEDIUM

Requires specific local access, unusual configuration, or produces limited impact.

## LOW

Defense-in-depth weakness or low-impact hardening issue.

## INFORMATIONAL

Architecture observation or security recommendation without a confirmed vulnerability.

Do not inflate severity.

---

# Mandatory Finding Evidence

Every confirmed finding must include:

```text
Finding ID
Title
Severity
Confidence
Status
Security domain
Affected component
Affected files
Exact function/class/code location
Input source
Trust boundary
Privileged sink
Observed implementation
Existing protection
Attack or failure path
Required preconditions
Impact
Exploitability
Safe reproduction performed
Reproduction result
Recommended remediation
Recommended regression test
```

For security data flows, explicitly document:

```text
SOURCE
   ↓
TRANSFORMATION
   ↓
VALIDATION
   ↓
TRUST BOUNDARY
   ↓
PRIVILEGED SINK
```

Example format:

```text
Workflow JSON step.value
    ↓
Workflow loader
    ↓
No runtime URL protocol validation found
    ↓
Execution Engine
    ↓
StepExecutor
    ↓
page.goto(step.value)
```

This is only a formatting example.

Do not claim this vulnerability exists unless current code proves it.

---

# Required Report

Create:

```text
docs/security/FULL_SECURITY_AUDIT.md
```

The report must contain:

# 1. Executive Summary

Explain AWKIT's actual current security posture.

Explicitly answer:

| Usage                                         | Recommendation                 |
| --------------------------------------------- | ------------------------------ |
| Local development                             | YES / NO / YES WITH CONDITIONS |
| Personal authorized automation                | YES / NO / YES WITH CONDITIONS |
| Internal company automation                   | YES / NO / YES WITH CONDITIONS |
| Authorized banking/business portal automation | YES / NO / YES WITH CONDITIONS |
| Broad enterprise deployment                   | YES / NO / YES WITH CONDITIONS |

Explain every answer.

---

# 2. Overall Security Rating

Use:

```text
A — Strong
B — Good with hardening required
C — Material security weaknesses
D — Serious security risk
F — Critical/unacceptable
```

Explain the rating.

---

# 3. Threat Model

Document:

* Protected assets.
* Authentication sessions.
* Browser profiles.
* Workflow definitions.
* Data sources.
* Local files.
* Reports.
* Screenshots.
* Credentials.
* Target web application data.

Document attackers and failure sources:

* Malicious workflow file.
* Manipulated data source.
* Unexpected renderer content.
* Another local process/user.
* Malicious target website.
* Compromised dependency.
* Operator mistake.
* Concurrency race.
* Corrupted runtime state.

Clearly define what is out of scope.

---

# 4. Security Architecture

Include all process, browser, profile, and trust-boundary diagrams.

---

# 5. Privileged Operations Inventory

Include the complete privileged-operation table.

---

# 6. Findings Summary

| ID | Finding | Severity | Confidence | Domain | Status |
| -- | ------- | -------- | ---------- | ------ | ------ |

Sort:

```text
Critical
High
Medium
Low
Informational
```

---

# 7. Detailed Findings

Provide complete evidence for every finding.

---

# 8. Electron Security Review

Include BrowserWindow and navigation security.

---

# 9. IPC Security Review

Include the full IPC inventory.

---

# 10. Workflow Execution Trust Review

Include every current step/node type.

---

# 11. Arbitrary Code and Command Execution Review

Clearly distinguish:

```text
Browser-page JavaScript
Renderer JavaScript
Electron main Node.js
OS process execution
```

---

# 12. Navigation and Network Target Review

---

# 13. Session and Browser Profile Security

Include:

```text
Auto Secure Login
Reuse Session
manualChromeHandoff
Protected Login Handoff
browserRestarter
```

---

# 14. Browser Lifecycle and Isolation

Include the isolation matrix.

---

# 15. Recorder and Secret Leakage Review

---

# 16. Smart Locator Integrity Review

Explicitly discuss unintended business-action risk.

---

# 17. Smart Wait Security Review

---

# 18. Conditional / Parallel / Loop Security Review

---

# 19. Data Source Security Review

---

# 20. Upload and Download Security Review

---

# 21. Browser Process and OS Integration Security

---

# 22. Logs, Screenshots, Reports, and Privacy

---

# 23. Concurrency and Resource Abuse

---

# 24. Dependency and Offline Supply Chain

---

# 25. Packaging and Release Security

Include the storage matrix.

---

# 26. Existing Security Controls

Document what AWKIT already does correctly.

Examples must be proven from current code.

Do not write a purely negative security report.

---

# 27. Security Test Gap Analysis

Include the complete proposed test matrix.

---

# 28. Prioritized Security Roadmap

Use:

## P0 — Release Blocking

Security issues that must be fixed before enterprise or sensitive-portal distribution.

## P1 — High Priority

Required before broader authorized production use.

## P2 — Security Hardening

Defense-in-depth.

## P3 — Long-Term Architecture Improvements

For every remediation include:

```text
Finding IDs
Affected components
Recommended design
Implementation complexity: Small / Medium / Large
Regression risk: Low / Medium / High
Tests required
```

Do not write generic tasks such as:

```text
Improve validation.
```

State exactly which boundary requires which validation.

---

# 29. Final Security Recommendation

Explicitly answer:

> Is the current AWKIT / WebFlow Studio build ready to automate authorized sensitive business and banking web applications?

Answer only one:

```text
YES
NO
YES WITH CONDITIONS
```

Then explain the evidence.

List exact release blockers.

---

# Final Execution Rules

* This audit is for AWKIT / WebFlow Studio only.
* Never reference Spotlight-Todo.
* Review the current local codebase.
* Do not use GitHub.
* Do not push.
* Do not create pull requests.
* Do not modify remote repositories.
* Read current project memory files first.
* Verify memory against source.
* Trace real code paths.
* Do not trust the GUI as a security boundary.
* Treat workflow JSON as potentially manipulated input.
* Treat data source JSON as potentially manipulated input.
* Treat target websites as potentially hostile web content.
* Treat browser sessions and profiles as sensitive credential containers.
* Never attempt to bypass CAPTCHA.
* Never attempt to bypass MFA.
* Never add stealth or bot-detection bypass behavior.
* Never expose real credentials in the audit report.
* Use isolated temporary profiles for security tests.
* Use safe local/mock targets for destructive or malformed workflow tests.
* Do not run dangerous tests against real banking, corporate, CRM, ERP, or production applications.
* Do not delete real saved sessions.
* Do not corrupt real user profiles.
* Do not weaken tests to make the project appear secure.
* Separate security vulnerabilities from reliability and performance defects.
* Separate browser-page JavaScript execution from Node.js execution.
* Separate intended automation power from unintended privilege escalation.
* Record failed commands and incomplete checks honestly.
* Do not stop after reviewing Electron.
* Do not stop after reviewing IPC.
* Do not stop after `npm audit`.
* Trace every privileged workflow field to its final browser, filesystem, process, or session effect.
* Produce `docs/security/FULL_SECURITY_AUDIT.md`.

The goal is complete only when the actual AWKIT security architecture is mapped, all privileged boundaries are reviewed, workflow execution trust is assessed, browser-session isolation is assessed, protected-login safety is verified, and every confirmed finding is backed by exact current-code evidence.
