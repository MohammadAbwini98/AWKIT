# Phase 7 — Playwright Runner Engine

## Objective

Build a generic Playwright execution engine that reads flow/scenario profiles and executes them without generating duplicated Playwright code per scenario.

## Runner Principle

The runner should not contain business-specific flows.

Bad approach:

```text
loginCustomer()
createCustomer()
approveCapex()
downloadSpecificReport()
```

Good approach:

```text
executeScenario(profile)
executeFlow(flow)
executeStep(step)
```

## Runner Architecture

```text
PlaywrightRunner
   ↓
ScenarioOrchestrator
   ↓
FlowExecutor
   ↓
StepExecutor
   ↓
LocatorFactory
   ↓
ValueResolver
```

## Step Executor Supported Actions

```text
goto
click
fill
select
check
uncheck
radio
scroll
wait
uploadFile
downloadFile
readText
assertText
assertVisible
screenshot
manualHandoff
condition
loop
runFlow
```

## TypeScript Step Model

```ts
export type StepType =
  | "start"
  | "goto"
  | "click"
  | "fill"
  | "select"
  | "check"
  | "uncheck"
  | "radio"
  | "scroll"
  | "wait"
  | "uploadFile"
  | "downloadFile"
  | "readText"
  | "assertText"
  | "assertVisible"
  | "screenshot"
  | "manualHandoff"
  | "condition"
  | "loop"
  | "runFlow"
  | "end";

export interface FlowStep {
  id: string;
  type: StepType;
  name: string;

  locator?: {
    strategy:
      | "role"
      | "label"
      | "placeholder"
      | "text"
      | "testId"
      | "id"
      | "css"
      | "xpath"
      | "tagName";
    value: string;
    name?: string;
  };

  value?: string;
  valueSource?: ValueSource;

  selectionMode?: "value" | "label" | "index";

  url?: string;
  timeoutMs?: number;

  retry?: {
    count: number;
    delayMs: number;
  };

  onFailure?: {
    action: "stop" | "continue" | "goToFailureEdge" | "manualHandoff";
    screenshot: boolean;
  };

  outputs?: Record<string, unknown>;

  next?: string;
}
```

## Locator Factory

```ts
import { Page } from "@playwright/test";

export class LocatorFactory {
  constructor(private readonly page: Page) {}

  create(locator: FlowStep["locator"]) {
    if (!locator) {
      throw new Error("Locator is required for this step.");
    }

    switch (locator.strategy) {
      case "id":
        return this.page.locator(`#${locator.value}`);

      case "css":
        return this.page.locator(locator.value);

      case "xpath":
        return this.page.locator(`xpath=${locator.value}`);

      case "text":
        return this.page.getByText(locator.value);

      case "label":
        return this.page.getByLabel(locator.value);

      case "placeholder":
        return this.page.getByPlaceholder(locator.value);

      case "testId":
        return this.page.getByTestId(locator.value);

      case "role":
        return this.page.getByRole(locator.value as any, locator.name ? { name: locator.name } : undefined);

      case "tagName":
        return this.page.locator(locator.value);

      default:
        throw new Error(`Unsupported locator strategy: ${(locator as any).strategy}`);
    }
  }
}
```

## Step Executor Example

```ts
export class StepExecutor {
  constructor(
    private readonly page: Page,
    private readonly locatorFactory: LocatorFactory,
    private readonly valueResolver: ValueResolver
  ) {}

  async execute(step: FlowStep): Promise<void> {
    switch (step.type) {
      case "goto":
        if (!step.url) throw new Error(`Step ${step.id} missing URL`);
        await this.page.goto(step.url);
        break;

      case "click":
        await this.locatorFactory.create(step.locator).click({
          timeout: step.timeoutMs ?? 10000
        });
        break;

      case "fill": {
        const value = await this.valueResolver.resolve(step.valueSource);
        await this.locatorFactory.create(step.locator).fill(value);
        break;
      }

      case "select": {
        const value = await this.valueResolver.resolve(step.valueSource);
        const locator = this.locatorFactory.create(step.locator);

        if (step.selectionMode === "label") {
          await locator.selectOption({ label: value });
        } else if (step.selectionMode === "index") {
          await locator.selectOption({ index: Number(value) });
        } else {
          await locator.selectOption(value);
        }

        break;
      }

      case "check":
        await this.locatorFactory.create(step.locator).check();
        break;

      case "uncheck":
        await this.locatorFactory.create(step.locator).uncheck();
        break;

      case "radio": {
        const value = await this.valueResolver.resolve(step.valueSource);
        await this.page.locator(`input[type="radio"][value="${value}"]`).check();
        break;
      }

      case "scroll":
        await this.page.mouse.wheel(0, Number(step.value ?? 500));
        break;

      case "wait":
        await this.page.waitForTimeout(Number(step.value ?? 1000));
        break;

      case "screenshot":
        await this.page.screenshot({
          path: `screenshots/${step.id}.png`,
          fullPage: true
        });
        break;

      default:
        throw new Error(`Unsupported step type: ${step.type}`);
    }
  }
}
```

## Manual Handoff

For CAPTCHA, MFA, security confirmation, or human approval:

```text
Pause automation
Show message in Windows app
Allow user to complete action manually
User clicks Resume
Continue flow
```

Manual handoff step example:

```json
{
  "id": "mfa-handoff",
  "type": "manualHandoff",
  "name": "Complete MFA",
  "message": "Please complete MFA manually, then click Resume."
}
```

## Downloads

Download step should support:

```text
Wait for download
Save to instance downloads path
Capture file path
Output downloaded file path
```

## Uploads

Upload step should support:

```text
Static file path
Runtime UI selected file
JSON file path
Previous flow output file path
```

## Deliverables

- Generic Playwright runner.
- Locator factory.
- Value resolver integration.
- Step executor.
- Flow executor.
- Manual handoff controller.
- Download/upload handling.
- Screenshot on failure.
- Retry support.


## Update: Runner Requirements for Concurrent and Offline Execution

Every runner operation must receive an `InstanceExecutionContext`. The browser must be launched using `BundledBrowserResolver` in production mode. In production, the runner must never attempt browser downloads or depend on global Node, global Playwright, or a system-installed browser.
