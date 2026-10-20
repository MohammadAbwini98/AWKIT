import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { checkProtectedSurface, watchProtectedWindow } from "@src/security/ProtectedSurfaceGuard";

export class ScreenshotService {
  constructor(private readonly screenshotsRoot: string) {}

  getScreenshotPath(executionId: string, instanceId: string, flowId: string, stepId: string): string {
    return join(this.screenshotsRoot, executionId, instanceId, flowId, `${stepId}.png`);
  }

  /**
   * awkit-3gtj: never photographs a protected-login surface. The image is taken into memory inside a watched window
   * and written only once the window and a re-check prove the page clean; a refusal throws and writes nothing.
   */
  async capture(page: Page, executionId: string, instanceId: string, flowId: string, stepId: string): Promise<string> {
    const path = this.getScreenshotPath(executionId, instanceId, flowId, stepId);
    const watch = await watchProtectedWindow(page, { strict: true });
    let image: Buffer;
    try {
      const before = await checkProtectedSurface(page);
      if (before.protected) throw refused(before.reason);
      image = await page.screenshot({ fullPage: true });
    } catch (error) {
      await watch.finish();
      throw error;
    }
    const window = await watch.finish();
    const after = window.protected ? window : await checkProtectedSurface(page);
    if (after.protected) throw refused(after.reason);
    await mkdir(join(this.screenshotsRoot, executionId, instanceId, flowId), { recursive: true });
    await writeFile(path, image);
    return path;
  }
}

function refused(reason: string | undefined): Error {
  return new Error(`Screenshot refused: the page is a protected-login surface (${reason ?? "frame-unscannable"}). Nothing was written.`);
}
