import { Workflow } from "lucide-react";
import { WindowControls } from "./WindowControls";

interface AppFrameProps {
  /** The current major area (active route label) shown as window-level context. */
  areaLabel: string;
}

/**
 * The AWKIT application frame: a thin, full-width title bar that replaces the removed native frame.
 * Its passive surface is an OS drag region (see `.app-frame` in global.css); the window controls opt
 * back out. Double-clicking the passive surface toggles maximize/restore, matching desktop expectation.
 */
export function AppFrame({ areaLabel }: AppFrameProps) {
  const toggleMaximize = () => void window.playwrightFlowStudio.appWindow.toggleMaximize().catch(() => undefined);

  return (
    <header className="app-frame" onDoubleClick={toggleMaximize}>
      <div className="app-frame-identity">
        <span className="app-frame-mark" aria-hidden="true">
          <Workflow size={14} strokeWidth={2.4} />
        </span>
        <span className="app-frame-wordmark">SpecterStudio</span>
      </div>
      <span className="app-frame-divider" aria-hidden="true" />
      <span className="app-frame-context" title={areaLabel}>
        {areaLabel}
      </span>
      <div className="app-frame-spacer" />
      <WindowControls />
    </header>
  );
}
