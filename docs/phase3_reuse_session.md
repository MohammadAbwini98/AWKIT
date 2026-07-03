# Phase 3 — Reuse Session Node

> **Target agent:** Claude Code
> **Project:** WebFlow Studio (`c:\Users\moham\OneDrive\Desktop\AWTKIT`)
> **Pre-requisite:** Read `AGENTS.md`, and complete Phase 1 and Phase 2. This phase relies on the `BrowserRestarter` callback introduced in Phase 2.
> **Phase:** 3 of 3 (Reuse Session)

---

## Goal

Implement the **"Reuse Session"** node. While the `autoSecureLogin` node handles the conditional capture, this node allows the user to explicitly load a specific, previously captured session mid-flow. 

It provides a dropdown in the Node Properties panel containing all available sessions (fetched dynamically). When executed, it safely restarts the Playwright browser using the chosen session's profile directory.

---

## Architecture & Wiring Changes

### 1. Node Registry & Types
Update `src/profiles/FlowProfile.ts` and `app/renderer/components/workflow/flowDesignerTypes.ts` to include the `reuseSession` step type.

Add a specific property for this node in `FlowDesignerNodeData`:
```typescript
reuseSessionId: string; // The ID of the selected session profile
```

Register it in `app/renderer/components/workflow/flowNodeCatalog.ts`:
```typescript
{
  type: "reuseSession",
  label: "Reuse Session",
  description: "Load a previously saved session profile",
  icon: History, // Import from lucide-react
  requiresLocator: false,
  requiresValue: false
}
```

### 2. Node Properties UI
Modify `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx` to render a searchable dropdown for selecting a session.

You will need to fetch the list of available sessions in the UI:
```tsx
const [availableSessions, setAvailableSessions] = useState<{ id: string, name: string, targetUrl?: string }[]>([]);

useEffect(() => {
  if (selectedNode?.data.stepType === "reuseSession") {
    window.playwrightFlowStudio.sessions.list()
      .then(sessions => setAvailableSessions(sessions.filter(s => s.status === "ready")))
      .catch(console.error);
  }
}, [selectedNode?.data.stepType]);
```

Render the field:
```tsx
{nodeData.stepType === "reuseSession" ? (
  <label>
    Saved Session
    <SearchableSelect
      value={nodeData.reuseSessionId}
      options={availableSessions.map(s => ({
        value: s.id,
        label: s.name,
        description: s.targetUrl
      }))}
      onChange={(val) => onUpdateNode(nodeId, { reuseSessionId: val })}
      placeholder="Select a saved session..."
    />
  </label>
) : null}
```

*Don't forget to map `reuseSessionId` back and forth in `toFlowStep` and `fromFlowStep` in `FlowChartDesigner.tsx` via `step.config?.reuseSessionId`.*

### 3. Step Execution Logic
Add the handler in `src/runner/StepExecutor.ts`. This requires the `BrowserRestarter` and `sessionService` implemented in Phase 2.

```typescript
private async executeReuseSession(step: FlowStep): Promise<StepExecutionResult> {
  const sessionId = step.config?.reuseSessionId;
  if (!sessionId) {
    throw new Error("Reuse Session node requires a valid Session ID to be selected.");
  }

  // 1. Validate session exists
  const profile = await this.sessionService.getById(sessionId);
  if (!profile || profile.status !== "ready") {
    throw new Error(`Saved session with ID ${sessionId} not found or not ready.`);
  }

  this.logger.info(`Loading saved session: ${profile.name}...`);

  // 2. Restart Playwright with the session's profile directory
  // (We don't need to close and wait like AutoSecureLogin, we just swap contexts)
  await this.browserRestarter({ newUserDataDir: profile.profileDir });

  // 3. Mark as used (updates lastUsed timestamp)
  await this.sessionService.markUsed(sessionId);

  return { status: "passed", outputs: { sessionLoaded: true, sessionId } };
}
```

---

## Implementation Steps Checklist

1. **Types & Registry**: Add `reuseSession` to `StepType` unions, update `flowDesignerTypes.ts` with `reuseSessionId`, update `toNodeConfig`/`fromFlowStep` in `FlowChartDesigner.tsx`.
2. **UI Properties**: Add the session fetching logic and the `SearchableSelect` dropdown to `FlowNodePropertiesPanel.tsx`.
3. **Execution Logic**: Add `executeReuseSession` in `StepExecutor.ts` using the `browserRestarter` to swap the profile directory.
4. **Testing**: Run `npm run build` and `npm run verify:runner`. Add a quick test to verify the logic executes cleanly.

## Non-Negotiable Rules
- **No global Playwright imports:** The runner must stay isolated.
- **Offline-first:** Keep it fully local. No CDN requests.
- **Minimal diffs:** Only touch what is needed for this node.
