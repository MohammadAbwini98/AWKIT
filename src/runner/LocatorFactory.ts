import type { Page } from "playwright";
import type { FlowStep } from "@src/profiles/FlowProfile";

export class LocatorFactory {
  constructor(private page: Page) {}

  /** Redirect locator creation to a different page (used by Route Change). */
  setPage(page: Page): void {
    this.page = page;
  }

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
        return this.page.getByText(locator.value, locator.exact ? { exact: true } : undefined);
      case "label":
        return this.page.getByLabel(locator.value, locator.exact ? { exact: true } : undefined);
      case "placeholder":
        return this.page.getByPlaceholder(locator.value, locator.exact ? { exact: true } : undefined);
      case "testId":
        return this.page.getByTestId(locator.value);
      case "role":
        return this.page.getByRole(
          locator.value as never,
          locator.name ? { name: locator.name, exact: locator.exact ?? false } : undefined
        );
      case "tagName":
        return this.page.locator(locator.value);
      default:
        throw new Error(`Unsupported locator strategy: ${(locator as FlowStep["locator"])?.strategy}`);
    }
  }
}
