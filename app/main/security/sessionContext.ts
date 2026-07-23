/**
 * Main-owned, sender-bound session context — the trusted binding between a renderer window (its
 * `webContents.id`) and the session that authenticated from it. The authorization boundary for the
 * non-admin IPC surface (flows / workflows / data sources / settings / execution) derives the acting
 * session from `event.sender`, NEVER from renderer-supplied identity, so a crafted preload/DevTools
 * call cannot claim another user's permissions. The session + user status + permission are re-validated
 * against the store on every call, and the gate fails closed when no valid binding exists.
 *
 * Scope: this gates the CRUD/action channels that do NOT already carry a sessionRef. The Super-User
 * admin surface (`security:admin:*`) keeps its explicit-sessionRef `adminCall` path — those channels
 * already pass a ref and validate it, so they need no window binding.
 */
import type { IpcMainInvokeEvent } from "electron";
import { assertTrustedSender } from "../ipc/senderGuard";
import { AuthReason, SecurityError } from "@src/security/errors/ReasonCodes";
import type { Permission } from "@src/security/authz/Permissions";
import type { AuthorizedActor } from "@src/security/authz/AuthorizationService";

/** `webContents.id` → the sessionRef that authenticated from that window. */
const boundSessions = new Map<number, string>();

/**
 * Associate the authenticated session with the window it logged in from. Re-binding overwrites the
 * previous ref for that window. Auto-unbinds when the window is destroyed (close / navigation teardown)
 * so a recycled webContents id can never inherit a stale session.
 */
export function bindSession(event: IpcMainInvokeEvent, sessionRef: string): void {
  const id = event.sender.id;
  boundSessions.set(id, sessionRef);
  event.sender.once("destroyed", () => unbindByWebContentsId(id));
}

/**
 * Clear the window's binding. When `sessionRef` is supplied the binding is cleared only if it matches
 * the currently-bound ref, so logging out session B never unbinds a window still bound to session A.
 * In normal use (one session per window) this is equivalent to an unconditional clear.
 */
export function unbindSession(event: IpcMainInvokeEvent, sessionRef?: string): void {
  const id = event.sender.id;
  if (sessionRef !== undefined && boundSessions.get(id) !== sessionRef) return;
  boundSessions.delete(id);
}

/** Clear a binding by raw `webContents.id` (used by the window-destroyed hook). */
export function unbindByWebContentsId(id: number): void {
  boundSessions.delete(id);
}

/** The sessionRef bound to a window, or `undefined` when none. */
export function boundSessionRef(event: IpcMainInvokeEvent): string | undefined {
  return boundSessions.get(event.sender.id);
}

/**
 * The real authorization gate for a sender-bound (non-admin) IPC handler: assert the trusted renderer,
 * resolve the window's bound session (fail closed when none → NOT_AUTHORIZED), then `requirePermission`
 * — which re-validates the session + user status against the store on every call — and, for a sensitive
 * action, `requireFreshReauth`. Throws `SecurityError` on any failure so the caller lets the renderer
 * `invoke` reject. A dead (expired/revoked) session also clears its stale binding. Returns the resolved
 * {@link AuthorizedActor} (already computed by `requirePermission`) so callers that need the acting
 * user — e.g. to attach an actor to an audit-log entry — get it without a second session lookup.
 */
export async function assertSenderPermission(
  event: IpcMainInvokeEvent,
  permission: Permission,
  options: { sensitive?: boolean } = {}
): Promise<AuthorizedActor> {
  assertTrustedSender(event);
  const sessionRef = boundSessions.get(event.sender.id);
  if (!sessionRef) throw new SecurityError(AuthReason.NOT_AUTHORIZED);
  // Loaded lazily so the pure sender-binding registry (and its fail-closed path) stays free of the
  // Electron-backed kernel import — the module can be unit-tested off-Electron, and this line only runs
  // once a window is actually bound (the real enforcement path).
  const { getSecurityKernel } = await import("./securityKernel");
  const kernel = await getSecurityKernel();
  try {
    const actor = await kernel.authz.requirePermission(sessionRef, permission);
    if (options.sensitive) kernel.authz.requireFreshReauth(sessionRef);
    return actor;
  } catch (error) {
    if (error instanceof SecurityError && error.reason === AuthReason.SESSION_EXPIRED) {
      unbindByWebContentsId(event.sender.id);
    }
    throw error;
  }
}
