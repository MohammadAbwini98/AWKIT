import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";

export class ScreenshotService {
  constructor(private readonly screenshotsRoot: string) {}

  getScreenshotPath(executionId: string, instanceId: string, flowId: string, stepId: string): string {
    return join(this.screenshotsRoot, executionId, instanceId, flowId, `${stepId}.png`);
  }

  async capture(page: Page, executionId: string, instanceId: string, flowId: string, stepId: string): Promise<string> {
    const path = this.getScreenshotPath(executionId, instanceId, flowId, stepId);
    await mkdir(join(this.screenshotsRoot, executionId, instanceId, flowId), { recursive: true });
    await page.screenshot({ path, fullPage: true });
    return path;
  }
}
