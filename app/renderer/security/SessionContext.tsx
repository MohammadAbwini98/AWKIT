import { createContext, useContext } from "react";
import type { PrincipalSnapshot } from "@src/security/auth/AuthTypes";

/**
 * The authenticated principal + logout, provided by SecurityGate to the authenticated app. The
 * snapshot is a UI hint only (display name, super-user flag); it never carries credentials, and the
 * trusted layer re-checks authorization per request. Consumed by AppFrame (user chip + logout) and,
 * in a later phase, by permission-aware UI.
 */
export interface SessionContextValue {
  principal: PrincipalSnapshot;
  logout: () => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

/** Non-throwing accessor: returns null when rendered outside an authenticated session (e.g., login). */
export function useSession(): SessionContextValue | null {
  return useContext(SessionContext);
}
