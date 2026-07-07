# Codex Goal Prompt — AWKIT Reuse Session Browser Close Root-Cause Fix

You are working locally only on the AWKIT Electron + Playwright project.

Do not use GitHub.
Do not stop after adding logs.
Do not stop after one failed attempt.
Do not stop after proving one theory wrong.
Keep iterating through all plausible causes until the real workflow works inside the full AWKIT app.

## Main Goal

Fix this workflow failure completely:

```text
Start
→ Auto Secure Login
→ Reuse Session
→ Navigate to https://chat.openai.com
```

Current failure:

```text
[swap] relaunching browser userDataDir=...
[swap] relaunched OK
[swap] active page closed 50ms after relaunch
[swap] context closed 75ms after relaunch
[swap] browser disconnected 76ms after relaunch
page.goto: Target page, context or browser has been closed
```

The task is complete only when:

```text
Reuse Session succeeds
Navigate succeeds
browser window stays visible
browser remains connected for at least 2 seconds after Reuse Session
no stale page/context/browser reference is used
no unhandled rejection appears in terminal
```

---

## Important Observations

Use these observations to avoid wasting time:

1. The same saved profile `session-8aa61a06` was tested outside the full app and it worked.
2. It worked with bundled Chromium.
3. It worked in standalone Node.
4. It worked inside Electron harness.
5. It worked with the same profile and same Chromium version.
6. Therefore, do not assume the saved profile is invalid unless new evidence proves it.
7. Do not block sessions created by `manualChromeHandoff`.
8. The protected login design intentionally uses real Chrome/Edge to capture the session.
9. Blocking external Chrome/Edge profiles would break the feature.
10. The browser only dies inside the full AWKIT runtime.
11. This strongly suggests an internal lifecycle, cleanup, stale handler, cancellation, or page-reference bug.

---

## My Strongest Suspicions

Prioritize these first.

### 1. Old browser disconnect handler kills the new browser

Possible pattern:

```ts
oldBrowser.on('disconnected', () => {
  this.cleanup();
});
```

After Reuse Session closes the old browser, its `disconnected` event fires and triggers cleanup that closes the new browser.

Fix with generation guards.

### 2. Stale `this.browser` reference is closed after replacement

Possible pattern:

```ts
this.browser = newBrowser;
await oldBrowser.close();

// some finally block:
await this.browser.close(); // now closes new browser by mistake
```

Fix by passing explicit runtime objects, not mutable global references.

### 3. Persistent context is being closed accidentally

Important Playwright behavior:

```text
launchPersistentContext(userDataDir) returns a BrowserContext.
Closing that context closes the browser.
```

So any accidental `context.close()` after Reuse Session will kill the browser.

Search for all:

```ts
context.close()
browser.close()
page.close()
cleanup()
dispose()
stopInstance()
cancelInstance()
```

### 4. Active page remains from the old context

Possible flow:

```text
Reuse Session launches new browser/context
but StepExecutor.activePage still points to old page
Navigate uses old closed page
```

Fix:

```ts
after swap:
  get page from newContext.pages()
  create new page if needed
  setActivePage(newPage)
  ensure all executors use newPage
```

### 5. Instance cleanup fires during browser swap

Possible pattern:

```text
old browser closes
ExecutionEngine thinks instance failed/stopped
InstanceManager cleanup runs
new browser gets closed
```

Fix with swap state:

```ts
isBrowserSwapInProgress = true
ignore old generation close/disconnect during swap
```

### 6. Duplicate Reuse Session / browserRestarter call

Possible pattern:

```text
Reuse Session called twice
first swap launches browser
second cleanup closes first browser
```

Add mutex around swap.

### 7. Profile lock is still possible, but not primary

Check if the profile is open in another Chrome/Edge/Chromium process.

If locked, fail clearly:

```text
Saved session profile is currently in use. Close the manual login browser and retry.
```

But do not claim the profile is incompatible.

---

## Files To Inspect

Inspect these first:

```text
src/runner/PlaywrightRunner.ts
src/runner/StepExecutor.ts
src/runner/FlowExecutor.ts
src/runner/ExecutionEngine.ts
src/runner/RunnerResult.ts
src/browser/BrowserContextFactory.ts
src/profiles/SessionCaptureService.ts
src/profiles/FlowProfile.ts
src/instances/*
src/runtime/*
app/main/ipc/*
app/main/preload.ts
```

Also search entire repo for:

```text
browser.close(
context.close(
page.close(
cleanup(
dispose(
stopInstance(
cancelInstance(
browserRestarter(
setActivePage(
activePage
disconnected
context.on('close'
page.on('close'
page.on('crash'
finally
setTimeout
forEach(async
```

---

## Required Debugging Strategy

Work like this:

```text
1. Reproduce the issue.
2. Add targeted diagnostics.
3. Run the real workflow.
4. Read the evidence.
5. Fix the highest-probability cause.
6. Run again.
7. If not fixed, keep going to the next cause.
8. Repeat until the real workflow succeeds.
```

Do not stop with “needs manual testing” unless the app physically cannot be launched from this environment.

---

## Required Implementation

### 1. Add browser generation IDs

Every browser/context/page runtime must have a generation number.

Example:

```ts
let browserGeneration = 0;

function nextBrowserGeneration() {
  browserGeneration += 1;
  return browserGeneration;
}
```

Every log should include it:

```text
[swap:g3] launch started
[swap:g3] persistent context created
[swap:g3] active page selected
[swap:g3] liveness passed
[swap:g2] old runtime closed intentionally
```

### 2. Add generation-guarded lifecycle handlers

Attach handlers like this:

```ts
browser.on('disconnected', () => {
  if (generation !== this.currentGeneration) {
    this.log(`[browser:g${generation}] stale disconnected ignored`);
    return;
  }

  this.log(`[browser:g${generation}] current browser disconnected`);
  this.handleCurrentBrowserDisconnected(generation);
});
```

Do this for:

```text
browser disconnected
context close
page close
page crash
instance stop
cleanup callbacks
cancel callbacks
```

Old generation events must never fail or close the new generation.

### 3. Add intentional close reasons

Use explicit reasons:

```ts
type BrowserCloseReason =
  | 'reuse-session-swap-old-runtime'
  | 'instance-stop'
  | 'execution-failed-cleanup'
  | 'user-request'
  | 'app-shutdown'
  | 'launch-failed-cleanup';
```

When closing the old browser during Reuse Session:

```ts
await closeRuntime(oldRuntime, 'reuse-session-swap-old-runtime');
```

Then ignore expected disconnects from that old generation.

### 4. Add temporary close stack traces

Behind an environment flag:

```text
AWKIT_BROWSER_LIFECYCLE_DEBUG=1
```

Patch close methods:

```ts
function patchCloseWithStack<T extends { close: Function }>(
  target: T,
  label: string
): T {
  const originalClose = target.close.bind(target);

  target.close = async (...args: any[]) => {
    console.warn(`[close-trace] ${label}.close() called`);
    console.warn(new Error(`[close-trace] ${label}`).stack);
    return originalClose(...args);
  };

  return target;
}
```

Apply to:

```text
old browser
old context
old active page
new browser
new context
new active page
```

Goal: identify exactly who closes the browser/context/page.

### 5. Refactor Reuse Session into safe two-phase swap

Implement the swap like this:

```ts
async function swapToPersistentSession(profileDir: string, profileId: string) {
  await swapMutex.runExclusive(async () => {
    const oldRuntime = currentRuntime;
    const newGeneration = nextBrowserGeneration();

    swapInProgress = true;

    try {
      markRuntimeAsBeingReplaced(oldRuntime);

      log(`[swap:g${newGeneration}] launchPersistentContext started`);

      const newContext = await launchPersistentContext(profileDir);
      const newBrowser = newContext.browser();

      if (!newBrowser) {
        throw new Error('Persistent context did not expose a browser instance');
      }

      const newPage = await resolveLivePage(newContext);

      const newRuntime = {
        generation: newGeneration,
        browser: newBrowser,
        context: newContext,
        activePage: newPage,
        userDataDir: profileDir,
        profileId,
        kind: 'persistent-session',
        state: 'launching',
      };

      attachLifecycleHandlers(newRuntime);

      await assertRuntimeAlive(newRuntime, 750);

      currentRuntime = newRuntime;
      currentGeneration = newGeneration;
      newRuntime.state = 'active';

      setActivePageEverywhere(newPage);

      if (oldRuntime) {
        await closeRuntime(oldRuntime, 'reuse-session-swap-old-runtime');
      }

      await assertRuntimeAlive(newRuntime, 1500);

      log(`[swap:g${newGeneration}] Reuse Session ready`);
    } catch (error) {
      log(`[swap:g${newGeneration}] Reuse Session failed: ${error}`);
      await cleanupFailedGeneration(newGeneration, 'launch-failed-cleanup');
      throw error;
    } finally {
      swapInProgress = false;
    }
  });
}
```

Important:

```text
Do not close old runtime before the new runtime passes liveness check.
Do not let old runtime handlers close the new runtime.
Do not set active page until the new page is verified live.
Do not allow Navigate to run after failed Reuse Session.
```

### 6. Resolve active page from the new context only

Use:

```ts
async function resolveLivePage(context: BrowserContext): Promise<Page> {
  const pages = context.pages().filter(page => !page.isClosed());

  if (pages.length > 0) {
    return pages[0];
  }

  return await context.newPage();
}
```

Then update all relevant holders:

```ts
stepExecutor.setActivePage(newPage);
playwrightRunner.setActivePage(newPage);
flowExecutor.setActivePage?.(newPage);
```

Search for any class that caches `page`.

### 7. Add liveness checks before each step

Before every step execution:

```ts
await browserRuntimeController.assertCurrentRuntimeAlive(`before step ${step.name}`);
```

Check:

```ts
browser.isConnected()
context is not closed
activePage exists
!activePage.isClosed()
await activePage.evaluate(() => 1)
```

If liveness fails, stop workflow with clear error.

Do not let Navigate run on a dead page.

### 8. Add profile lock check

Before launching persistent context, check if profile is already open.

On Windows, look for files like:

```text
SingletonLock
SingletonCookie
SingletonSocket
```

Also check running browser command lines if practical.

If profile is locked:

```text
The saved session profile is currently in use by another browser process.
Close the manual login browser window, then run the workflow again.
```

Stop Reuse Session cleanly.

### 9. Fix unsafe async cleanup

Search and fix:

```ts
forEach(async () => ...)
setTimeout(() => close...)
finally { await this.browser.close() }
cleanup using this.browser after swap
fire-and-forget cleanup
unawaited promises
```

Use explicit runtime references.

Bad:

```ts
finally {
  await this.browser.close();
}
```

Better:

```ts
finally {
  await browserRuntimeController.closeRuntime(runtime, 'execution-failed-cleanup');
}
```

### 10. Add swap mutex

Only one browser swap per instance may run at a time.

If another swap starts while one is active:

```text
Browser session swap is already in progress for this instance.
```

---

## Tests To Add

Add or update tests for:

```text
valid persistent profile reuse
empty persistent profile reuse
profile locked by another process
old browser disconnected after swap does not kill new browser
old context close after swap does not fail workflow
active page after Reuse Session belongs to new context
Navigate after failed Reuse Session does not execute
duplicate Reuse Session calls are blocked
persistent context close closes browser, so it must be guarded
```

Add a regression simulation:

```text
oldRuntime emits disconnected 50ms after newRuntime launch
expected: stale disconnect ignored
expected: newRuntime remains alive
expected: workflow continues
```

---

## Verification

Run:

```bash
npm run build
npm run verify:runner
npm run verify:recorder
npm run check-memory
```

If these scripts do not exist, inspect `package.json` and run equivalent local checks.

Also run the actual Electron workflow:

```text
Smart-Rec-Chatgpt
Start
→ Auto Secure Login
→ Reuse Session
→ Navigate to https://chat.openai.com
```

---

## Completion Criteria

Do not finish until one of these is true.

### Success

```text
Real workflow works inside full AWKIT app.
Browser appears.
Reuse Session succeeds.
Navigate succeeds.
Browser stays connected.
All verification commands pass.
```

### Or hard blocker

Only stop if there is a real hard blocker, and report:

```text
exact blocker
what was tested
what was ruled out
what remains
next exact command/user action needed
```

Do not stop with vague statements like:

```text
needs more investigation
probably profile issue
could not reproduce
```

---

## Forbidden Fixes

Do not do these:

```text
Do not block manualChromeHandoff profiles.
Do not require sessions to be created by Playwright only.
Do not remove Reuse Session.
Do not hide failure with blind Navigate retries.
Do not use sleep as the only fix.
Do not allow Navigate after failed Reuse Session.
Do not keep old page references.
Do not directly close browser/context/page from random executor code.
Do not mark workflow successful if browser died.
```

---

## Final Report Format

Return exactly:

```text
Root cause:
...

Evidence:
...

Files changed:
...

Fix implemented:
...

Tests added:
...

Verification:
- npm run build: pass/fail
- npm run verify:runner: pass/fail
- npm run verify:recorder: pass/fail
- npm run check-memory: pass/fail
- real Electron workflow: pass/fail

Final status:
Reuse Session → Navigate works: yes/no
Browser remains connected: yes/no
```
