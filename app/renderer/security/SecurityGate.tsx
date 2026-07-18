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

function readAppearance(): AppearanceMode {
  const saved = window.localStorage.getItem("awkit-appearance");
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
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
  const sessionRef = useRef<string>("");

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
    setPrincipal(next);
    setState(next.mustChangePassword ? "forcedChange" : "authed");
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

  const logout = useCallback(() => {
    const ref = sessionRef.current;
    sessionRef.current = "";
    setPrincipal(null);
    setState("login");
    if (ref) void window.playwrightFlowStudio.security.logout(ref).catch(() => undefined);
  }, []);

  // Re-validate when the user returns to the window; catches idle/absolute expiry and deactivation.
  useEffect(() => {
    if (state !== "authed") return;
    const revalidate = async () => {
      if (document.visibilityState !== "visible" || !sessionRef.current) return;
      const validation = await window.playwrightFlowStudio.security.validateSession(sessionRef.current).catch(() => null);
      if (validation && !validation.valid) {
        sessionRef.current = "";
        setPrincipal(null);
        setState("login");
      }
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [state]);

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
      <LoginScreen options={options} onSubmit={doLogin} />
    </LockedShell>
  );
}
