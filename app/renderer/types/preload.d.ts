import type { PlaywrightFlowStudioApi } from "../../main/preload";

declare global {
  interface Window {
    playwrightFlowStudio: PlaywrightFlowStudioApi;
  }
}

export {};
