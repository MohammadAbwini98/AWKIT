import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { LoginOption, PrincipalSnapshot, ProviderId } from "@src/security/auth/AuthTypes";
import { App } from "../App";
import { resolveAppearance, type AppearanceMode } from "../state/theme";
import { SessionContext } from "./SessionContext";
import { LockedShell } from "./LockedShell";
import { LoginScreen, type LoginSubmitResult } from "./screens/LoginScreen";
import { FirstRunSetup } from "./screens/FirstRunSetup";
import { ForcedPasswordChange } from "./screens/ForcedPasswordChange";
import { SecurityUnavailable } from "./screens/SecurityUnavailable";

type GateState = "loading" | "unavailable" | "firstRun" | "login" | "forcedChange" | "authed";

/** Fallback idle window if the boot state doesn't report one (mirrors DEFAULT_SESSION_POLICY.idleMs). */
const DEFAULT_IDLE_MS = 30 * 60 * 1000;

function readAppearance(): AppearanceMode {
  const saved = window.localStorage.getItem("awkit-appearance");
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
}

/** Human-readable "signed out after N minutes of inactivity" note for the login screen. */
function inactivityNotice(idleMs: number): string {
  const mins = Math.round(idleMs / 60000);
  return mins >= 1
    ? `You were signed out after ${mins} minute${mins === 1 ? "" : "s"} of inactivity.`
    : "You were signed out after a period of inactivity.";
}

/**
 * Top-level authentication gate. It renders ONLY the pre-auth surfaces (loading / first-run / login /
 * forced-change / failure) until the trusted main process confirms a session — the real <App/> (and
 * therefore every protected route) is never mounted before that, so protected pages cannot flash.
 * Startup order: splash → this gate (boot state) → login → authenticated app.
 */
export function SecurityGate() {
  const [state, setState] = useState<GateState>("loading");
  const [options, setOptions] = useState<LoginOption[]>([]);
  const [principal, setPrincipal] = useState<PrincipalSnapshot | null>(null);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  const sessionRef = useRef<string>("");
  const idleTimeoutRef = useRef<number>(DEFAULT_IDLE_MS);
  const lastActivityRef = useRef<number>(Date.now());
  const lastValidateRef = useRef<number>(Date.now());

  // Theme the pre-auth screens (matches App's logic). Once authenticated, App owns the theme.
  useLayoutEffect(() => {
    if (state === "authed") return;
    const apply = () => {
      document.documentElement.dataset.theme = resolveAppearance(readAppearance());
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [state]);

  const init = useCallback(async () => {
    setState("loading");
    try {
      const boot = await window.playwrightFlowStudio.security.getBootState();
      if (!boot.secureStorageAvailable) {
        setState("unavailable");
        return;
      }
      if (typeof boot.idleTimeoutMs === "number" && boot.idleTimeoutMs > 0) {
        idleTimeoutRef.current = boot.idleTimeoutMs;
      }
      setOptions(await window.playwrightFlowStudio.security.getLoginOptions());
      setState(boot.provisioned ? "login" : "firstRun");
    } catch {
      setState("unavailable");
    }
  }, []);

  useEffect(() => {
    void init();
  }, [init]);

  const applyPrincipal = useCallback((next: PrincipalSnapshot) => {
    sessionRef.current = next.sessionRef;
    setLockNotice(null);
    setPrincipal(next);
    setState(next.mustChangePassword ? "forcedChange" : "authed");
  }, []);

  // Drop the session and return to the login screen, revoking it server-side (fail-closed). `notice`
  // surfaces on the login screen (e.g. after an inactivity lock); pass null for a plain sign-out.
  const lock = useCallback((notice: string | null) => {
    const ref = sessionRef.current;
    sessionRef.current = "";
    setPrincipal(null);
    setLockNotice(notice);
    setState("login");
    if (ref) void window.playwrightFlowStudio.security.logout(ref).catch(() => undefined);
  }, []);

  const doLogin = useCallback(
    async (providerId: ProviderId, username: string, password: string): Promise<LoginSubmitResult> => {
      const result = await window.playwrightFlowStudio.security.login({ providerId, username, password });
      if (result.ok) {
        applyPrincipal(result.principal);
        return { ok: true };
      }
      return { ok: false, reason: result.reason };
    },
    [applyPrincipal]
  );

  const handleBootstrap = useCallback(
    async (input: { username: string; password: string; displayName?: string }) => {
      const result = await window.playwrightFlowStudio.security.bootstrapSuperUser(input);
      if (result.ok) {
        // Provisioned — sign the new Super User straight in for a smooth first run.
        const login = await doLogin("local", input.username, input.password);
        if (!login.ok) setState("login");
      }
      return result;
    },
    [doLogin]
  );

  const handleChangePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const result = await window.playwrightFlowStudio.security.changePassword({
      sessionRef: sessionRef.current,
      currentPassword,
      newPassword
    });
    if (result.ok) {
      const validation = await window.playwrightFlowStudio.security.validateSession(sessionRef.current);
      if (validation.valid) {
        setPrincipal(validation.principal);
        setState("authed");
      } else {
        sessionRef.current = "";
        setPrincipal(null);
        setState("login");
      }
    }
    return result;
  }, []);

  const logout = useCallback(() => lock(null), [lock]);

  // Re-validate when the user returns to the window; catches idle/absolute expiry and deactivation.
  useEffect(() => {
    if (state !== "authed") return;
    const revalidate = async () => {
      if (document.visibilityState !== "visible" || !sessionRef.current) return;
      const validation = await window.playwrightFlowStudio.security.validateSession(sessionRef.current).catch(() => null);
      lastValidateRef.current = Date.now();
      if (validation && !validation.valid) lock(null);
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [state, lock]);

  // Proactive idle lock: track renderer activity and lock after the idle window WITHOUT waiting for a
  // focus/visibility event. While the user IS active this also refreshes the server's sliding idle window
  // (validateSession) so a continuously-used, never-blurred window isn't logged out at the timeout, and it
  // catches server-side invalidation (absolute expiry, deactivation, revoke-on-password-change).
  useEffect(() => {
    if (state !== "authed") return;
    const now = Date.now();
    lastActivityRef.current = now;
    lastValidateRef.current = now;
    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const activityEvents = ["pointerdown", "keydown", "mousemove", "wheel", "touchstart", "scroll"];
    for (const ev of activityEvents) window.addEventListener(ev, markActivity, { passive: true });

    const idleMs = idleTimeoutRef.current;
    const tickMs = Math.min(15000, Math.max(1000, Math.floor(idleMs / 6)));
    const validateMinIntervalMs = Math.min(60000, Math.max(1000, Math.floor(idleMs / 3)));
    const interval = window.setInterval(async () => {
      if (!sessionRef.current) return;
      const tickNow = Date.now();
      if (tickNow - lastActivityRef.current >= idleMs) {
        lock(inactivityNotice(idleMs));
        return;
      }
      // Only refresh while genuinely active (activity since the last check), so an idle window still
      // ages out server-side rather than being kept alive by the heartbeat itself.
      if (lastActivityRef.current > lastValidateRef.current && tickNow - lastValidateRef.current >= validateMinIntervalMs) {
        lastValidateRef.current = tickNow;
        const validation = await window.playwrightFlowStudio.security.validateSession(sessionRef.current).catch(() => null);
        if (validation && !validation.valid) lock(null);
      }
    }, tickMs);

    return () => {
      for (const ev of activityEvents) window.removeEventListener(ev, markActivity);
      window.clearInterval(interval);
    };
  }, [state, lock]);

  if (state === "authed" && principal) {
    return (
      <SessionContext.Provider value={{ principal, logout }}>
        <App />
      </SessionContext.Provider>
    );
  }

  if (state === "loading") {
    return (
      <LockedShell areaLabel="Starting…">
        <div className="awkit-login-loading" role="status" aria-live="polite">
          <Loader2 size={22} className="awkit-login-spin" aria-hidden="true" />
          <span>Preparing secure sign-in…</span>
        </div>
      </LockedShell>
    );
  }

  if (state === "unavailable") {
    return (
      <LockedShell areaLabel="Unavailable">
        <SecurityUnavailable onRetry={() => void init()} />
      </LockedShell>
    );
  }

  if (state === "firstRun") {
    return (
      <LockedShell areaLabel="First-run setup">
        <FirstRunSetup onSubmit={handleBootstrap} />
      </LockedShell>
    );
  }

  if (state === "forcedChange" && principal) {
    return (
      <LockedShell areaLabel="Update password">
        <ForcedPasswordChange displayName={principal.displayName} onSubmit={handleChangePassword} onCancel={logout} />
      </LockedShell>
    );
  }

  return (
    <LockedShell areaLabel="Secure sign-in">
      <LoginScreen options={options} onSubmit={doLogin} notice={lockNotice} />
    </LockedShell>
  );
}
