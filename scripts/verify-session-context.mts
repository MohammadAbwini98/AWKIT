/**
 * verify:session-context — browser-free unit checks for the main-owned, sender-bound session registry
 * (app/main/security/sessionContext.ts, bd awkit-b92). Covers: bind + resolve, unbind, the match-guarded
 * unbind (logging out a different ref leaves the binding), the window-destroyed auto-unbind hook,
 * re-bind overwrite, per-window isolation, and the FAIL-CLOSED deny when no session is bound.
 *
 * The full permission re-validation (requirePermission / requireFreshReauth against the store, incl.
 * deny-after-expiry) runs through the SAME AuthorizationService that verify:authz exercises at domain
 * level; this suite proves the sender→session binding layer that sits in front of it. Only the unbound
 * path is exercised here, so the Electron-backed security kernel is never opened.
 *
 * Run: npm run verify:session-context   (npx tsx scripts/verify-session-context.mts)
 */
import type { IpcMainInvokeEvent } from "electron";
import {
  bindSession,
  unbindSession,
  unbindByWebContentsId,
  boundSessionRef,
  assertSenderPermission
} from "../app/main/security/sessionContext";
import { Permission } from "../src/security/authz/Permissions";
import { AuthReason, SecurityError } from "../src/security/errors/ReasonCodes";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

/**
 * Minimal IpcMainInvokeEvent stand-in: the registry only reads `sender.id` and registers a one-shot
 * `sender.once("destroyed")` hook, and an empty `senderFrame.url` satisfies the trusted-sender check
 * (the packaged/dev shell reports an empty early-load frame URL).
 */
function mockEvent(id: number): { event: IpcMainInvokeEvent; destroy: () => void } {
  let destroyed: (() => void) | undefined;
  const event = {
    senderFrame: { url: "" },
    sender: {
      id,
      once: (name: string, cb: () => void) => {
        if (name === "destroyed") destroyed = cb;
      }
    }
  } as unknown as IpcMainInvokeEvent;
  return { event, destroy: () => destroyed?.() };
}

async function assertDenied(name: string, fn: () => Promise<void>, reason: string): Promise<void> {
  try {
    await fn();
    check(`${name} (should have thrown)`, false);
  } catch (error) {
    check(name, error instanceof SecurityError && error.reason === reason);
  }
}

async function main(): Promise<void> {
  console.log("session-context registry:");

  // 1 — bind + resolve
  const a = mockEvent(101);
  bindSession(a.event, "sess-A");
  check("bind then boundSessionRef returns the bound ref", boundSessionRef(a.event) === "sess-A");

  // 2 — unbind (unconditional)
  unbindSession(a.event);
  check("unbindSession clears the binding", boundSessionRef(a.event) === undefined);

  // 3 — match-guarded unbind
  bindSession(a.event, "sess-A");
  unbindSession(a.event, "sess-OTHER");
  check("unbind with a non-matching ref leaves the binding intact", boundSessionRef(a.event) === "sess-A");
  unbindSession(a.event, "sess-A");
  check("unbind with the matching ref clears the binding", boundSessionRef(a.event) === undefined);

  // 4 — unbind by raw webContents id
  bindSession(a.event, "sess-A");
  unbindByWebContentsId(101);
  check("unbindByWebContentsId clears the binding", boundSessionRef(a.event) === undefined);

  // 5 — window-destroyed auto-unbind
  bindSession(a.event, "sess-A");
  a.destroy();
  check("the window-destroyed hook auto-unbinds", boundSessionRef(a.event) === undefined);

  // 6 — re-bind overwrites
  bindSession(a.event, "sess-A");
  bindSession(a.event, "sess-A2");
  check("re-binding a window overwrites its session ref", boundSessionRef(a.event) === "sess-A2");
  unbindSession(a.event);

  // 7 — fail closed when unbound (never reaches the security kernel)
  const unbound = mockEvent(202);
  await assertDenied(
    "assertSenderPermission fails closed (NOT_AUTHORIZED) when the window has no bound session",
    () => assertSenderPermission(unbound.event, Permission.WORKFLOW_EXECUTE),
    AuthReason.NOT_AUTHORIZED
  );

  // 8 — per-window isolation
  const w1 = mockEvent(303);
  const w2 = mockEvent(404);
  bindSession(w1.event, "sess-1");
  check("binding one window does not bind another", boundSessionRef(w2.event) === undefined);
  await assertDenied(
    "an unbound window is denied even while a different window is bound",
    () => assertSenderPermission(w2.event, Permission.WORKFLOW_EXECUTE),
    AuthReason.NOT_AUTHORIZED
  );
  check("the bound window keeps its ref", boundSessionRef(w1.event) === "sess-1");
  unbindSession(w1.event);

  console.log(`\nsession-context: ${passed}/${passed + failed} checks passed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
