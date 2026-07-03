# Phase 2 — Auto Secure Login Node

> **Target agent:** Claude Code
> **Project:** WebFlow Studio (`c:\Users\moham\OneDrive\Desktop\AWTKIT`)
> **Pre-requisite:** Read `AGENTS.md` and Phase 1 implementation details. Phase 1 (Enhanced Connectors) MUST be completed before starting this phase.
> **Phase:** 2 of 3 (Auto Secure Login)

---

## Goal

Implement the **"Auto Secure Login"** node. This node solves the bot-detection problem by allowing the user to log in manually using a real, un-instrumented Chrome browser, capturing that session, and then automatically resuming the automated flow.

### Required Logic Flow
When the `autoSecureLogin` node executes:
1. **Check for existing session:** Look up saved sessions by the target URL. If a valid session exists, return `passed` immediately with output `{ sessionSkipped: true }`. (The flow will proceed to the next node).
2. **If no session exists, suspend automation:**
   - Close the current Playwright browser context to free up resources.
   - Call `SessionCaptureService.startCapture()` to launch a real, headed Chrome browser pointed at the target URL.
3. **Wait for manual login:**
   - Poll `SessionCaptureService.getStatus()` until the status is `closed` (meaning the user finished logging in and closed the browser).
   - *Race condition mitigation:* Wait ~200ms after it closes, then verify the profile status is `ready` via `SessionCaptureService.getById()`.
4. **Resume automation:**
   - Relaunch the Playwright browser using the newly populated user-data-dir.
   - Return `passed` with output `{ sessionCaptured: true }`.

Using the Phase 1 Enhanced Connectors, the user will draw an `outcome` edge from this node back to `Start` with condition `${stepResult.sessionCaptured} === true`. This safely re-runs the flow with the new authenticated browser state.

---

## Architecture & Wiring Changes

### 1. The `BrowserRestarter` Callback
`StepExecutor` currently doesn't own the browser lifecycle; `PlaywrightRunner` does. You must inject a callback into `StepExecutor` to allow mid-run browser restarts.

Modify `src/runner/PlaywrightRunner.ts`:
```typescript
// Define the callback type
export type BrowserRestarter = (options?: { closeOnly?: boolean; newUserDataDir?: string }) => Promise<void>;

// Inside executeScenario:
let browserRuntime = await this.browserContextFactory.create(instanceConfig, context);
let page = await browserRuntime.context.newPage();

const restartBrowser: BrowserRestarter = async (opts) => {
  await browserRuntime.close();
  if (opts?.closeOnly) return;
  
  // Create a customized config if a specific session dir is requested
  const customConfig = opts?.newUserDataDir ? { ...instanceConfig, userDataDir: opts.newUserDataDir } : instanceConfig;
  
  browserRuntime = await this.browserContextFactory.create(customConfig, context);
  page = await browserRuntime.context.newPage();
};

// Update StepExecutor instantiation to pass restartBrowser
const executor = new StepExecutor({ page, logger, context, browserRestarter: restartBrowser, sessionService: this.sessionService });
```

*(Note: `PlaywrightRunner` also needs `sessionService` injected from `ExecutionEngine.ts` down through its constructor).*

### 2. Node Registry & Types
Update `src/profiles/FlowProfile.ts` and `app/renderer/components/workflow/flowDesignerTypes.ts` to include the `autoSecureLogin` step type and its properties:
- `targetUrl`: The URL to check against and open in real Chrome.

Register it in `app/renderer/components/workflow/flowNodeCatalog.ts`:
```typescript
{
  type: "autoSecureLogin",
  label: "Auto Secure Login",
  description: "Capture manual login in real Chrome",
  icon: ShieldCheck, // Import from lucide-react
  requiresLocator: false,
  requiresValue: true // We use the `value` field for targetUrl
}
```

### 3. Step Execution Logic
Add the handler in `src/runner/StepExecutor.ts`.

```typescript
private async executeAutoSecureLogin(step: FlowStep): Promise<StepExecutionResult> {
  const targetUrl = this.resolveValue(step);
  if (!targetUrl) throw new Error("Auto Secure Login requires a target URL.");

  // 1. Check existing sessions
  const profiles = await this.sessionService.list();
  const existing = profiles.find(p => p.status === "ready" && p.targetUrl === targetUrl);
  if (existing) {
    this.logger.info(`Valid session found for ${targetUrl}. Skipping capture.`);
    return { status: "passed", outputs: { sessionSkipped: true } };
  }

  // 2. Suspend Playwright
  this.logger.info(`No session found. Closing automation browser and launching real Chrome for ${targetUrl}...`);
  await this.browserRestarter({ closeOnly: true });

  // 3. Start Capture
  const captureName = `AutoLogin-${new Date().toISOString().slice(0,10)}`;
  const capture = await this.sessionService.startCapture(captureName, targetUrl);
  const sessionId = capture.sessionId!;

  // 4. Poll until closed
  while (true) {
    await new Promise(r => setTimeout(r, 1000));
    const status = this.sessionService.getStatus();
    if (!status.active || status.status === "closed" || status.status === "error") {
      if (status.status === "error") throw new Error(`Capture failed: ${status.error}`);
      break;
    }
  }

  // 5. Race condition mitigation: wait for async file write
  await new Promise(r => setTimeout(r, 500));
  const finalProfile = await this.sessionService.getById(sessionId);
  if (!finalProfile || finalProfile.status !== "ready") {
    throw new Error("Captured session did not reach 'ready' state.");
  }

  // 6. Resume Playwright with new session
  this.logger.info(`Session captured successfully. Resuming automation with new profile...`);
  await this.browserRestarter({ newUserDataDir: finalProfile.profileDir });

  return { status: "passed", outputs: { sessionCaptured: true, sessionId } };
}
```

---

## Implementation Steps Checklist

1. **`ExecutionEngine.ts`**: Import `getSessionService` from `session.ipc` and pass it to `PlaywrightRunner`.
2. **`PlaywrightRunner.ts`**: Implement the `BrowserRestarter` callback and pass it to `StepExecutor` along with `sessionService`. Remember to update the active `page` reference that gets passed to subsequent steps!
3. **`StepExecutor.ts`**: Add `executeAutoSecureLogin` with the exact logic outlined above.
4. **Types & Registry**: Add `autoSecureLogin` to `StepType` unions, `flowDesignerTypes.ts` defaults, and `flowNodeCatalog.ts`.
5. **UI Properties Panel**: Ensure the standard Value input in `FlowNodePropertiesPanel.tsx` is shown for this node (representing the Target URL).
6. **Testing**: Run `npm run build` and `npm run verify:runner`. Add a mock test case in `verify-runner.mts` that simulates the session service.

## Non-Negotiable Rules
- **No global Playwright imports:** The runner must stay isolated.
- **IPC Boundaries:** `sessionService` only exists in the Main process / Node context. Do not import it into Renderer files.
- **Offline-first:** Keep it fully local.
- **Minimal diffs:** Only touch what is needed for this node.
