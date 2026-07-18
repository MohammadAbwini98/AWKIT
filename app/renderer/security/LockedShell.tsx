import type { ReactNode } from "react";
import { AppFrame } from "../layout/AppFrame";

interface LockedShellProps {
  /** Context label shown in the custom title bar (e.g., "Secure sign-in"). */
  areaLabel: string;
  children: ReactNode;
}

/**
 * Full-screen pre-authentication shell. Reuses the custom application frame (drag region + window
 * controls, so the frameless window stays movable/closable) and centers a single card in the remaining
 * space. It renders NONE of the protected app surfaces — SecurityGate mounts the real app only after
 * authentication, so protected pages can never flash before login.
 */
export function LockedShell({ areaLabel, children }: LockedShellProps) {
  return (
    <div className="app-window">
      <AppFrame areaLabel={areaLabel} />
      <div className="awkit-login-stage">
        <main className="awkit-login-card" role="main">
          {children}
        </main>
      </div>
    </div>
  );
}
