import { useEffect, useState } from "react";

const appWindow = () => window.playwrightFlowStudio.appWindow;

/**
 * Track the *real* window maximized state. Seeded once on mount, then kept in sync via the
 * main-process event so external changes (OS snap, double-click, Win+Up, full-screen) are reflected
 * — never inferred from which button was last pressed. The subscription is torn down on unmount.
 */
function useWindowMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let active = true;
    appWindow()
      .isMaximized()
      .then((value) => {
        if (active) setMaximized(value);
      })
      .catch(() => undefined);
    const unsubscribe = appWindow().onMaximizedChange((value) => setMaximized(value));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return maximized;
}

// Crisp 10px caption glyphs drawn as strokes — no icon dependency, pixel-aligned for the thin frame.
const glyphProps = {
  width: 10,
  height: 10,
  viewBox: "0 0 10 10",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1,
  "aria-hidden": true
} as const;

function MinimizeGlyph() {
  return (
    <svg {...glyphProps}>
      <line x1="1" y1="5.5" x2="9" y2="5.5" />
    </svg>
  );
}

function MaximizeGlyph() {
  return (
    <svg {...glyphProps}>
      <rect x="1.5" y="1.5" width="7" height="7" rx="0.5" />
    </svg>
  );
}

function RestoreGlyph() {
  return (
    <svg {...glyphProps}>
      <rect x="1.25" y="2.75" width="6" height="6" rx="0.5" />
      <path d="M3.25 2.75 V1.25 H8.75 V6.75 H7.25" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg {...glyphProps} strokeLinecap="round">
      <line x1="1.6" y1="1.6" x2="8.4" y2="8.4" />
      <line x1="8.4" y1="1.6" x2="1.6" y2="8.4" />
    </svg>
  );
}

export function WindowControls() {
  const maximized = useWindowMaximized();

  const minimize = () => void appWindow().minimize().catch(() => undefined);
  const toggleMaximize = () => void appWindow().toggleMaximize().catch(() => undefined);
  const close = () => void appWindow().close().catch(() => undefined);

  return (
    // Isolate the controls from the frame's draggable surface and its double-click-to-maximize
    // handler, so a fast double-click on a button never also toggles the window.
    <div className="app-frame-controls" onDoubleClick={(event) => event.stopPropagation()}>
      <button type="button" className="win-control" aria-label="Minimize window" onClick={minimize}>
        <MinimizeGlyph />
      </button>
      <button
        type="button"
        className="win-control"
        aria-label={maximized ? "Restore window" : "Maximize window"}
        onClick={toggleMaximize}
      >
        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button type="button" className="win-control win-control-close" aria-label="Close window" onClick={close}>
        <CloseGlyph />
      </button>
    </div>
  );
}
