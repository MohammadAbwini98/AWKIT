import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, ShieldCheck } from "lucide-react";
import packageMetadata from "../../../package.json";
import { AppFrame } from "../layout/AppFrame";
import { resolveAppearance, type AppearanceMode } from "../state/theme";

interface LockedShellProps {
  /** Context label shown in the custom title bar (e.g., "Secure sign-in"). */
  areaLabel: string;
  /** Live session policy supplied by SecurityGate when that screen is wired. */
  idleTimeoutMs: number;
  children: ReactNode;
}

type DemoStepState = "complete" | "active" | "pending";

interface DemoStep {
  label: string;
  elapsed: string;
  state: DemoStepState;
}

/**
 * Decorative labels mirror the bundled Customer Onboarding sample and its Login Flow. The elapsed
 * values are a fixed design demo, never runtime state or measured telemetry.
 */
const DEMO_STEPS: DemoStep[] = [
  { label: "Login", elapsed: "1.2s", state: "complete" },
  { label: "Open Login Page", elapsed: "0.9s", state: "complete" },
  { label: "Create customer", elapsed: "2.4s", state: "active" },
  { label: "Validate result", elapsed: "1.6s", state: "pending" },
  { label: "Logout", elapsed: "0.8s", state: "pending" }
];

const APPLICATION_VERSION = packageMetadata.version;

function readAppearance(): AppearanceMode {
  const saved = window.localStorage.getItem("awkit-appearance");
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
}

function idleDuration(idleTimeoutMs: number | undefined): string | null {
  if (typeof idleTimeoutMs !== "number" || !Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) return null;
  const minutes = Math.max(1, Math.round(idleTimeoutMs / 60_000));
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Full-screen pre-authentication shell. It renders NONE of the protected app surfaces — SecurityGate
 * mounts the real app only after authentication, so protected pages can never flash before login.
 */
export function LockedShell({ areaLabel, children, idleTimeoutMs }: LockedShellProps) {
  const [appearance, setAppearance] = useState<AppearanceMode>(readAppearance);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => resolveAppearance(readAppearance()));
  const [customLogo, setCustomLogo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.playwrightFlowStudio.branding
      .getState()
      .then((state) => {
        if (!cancelled) setCustomLogo(state.active && state.dataUrl ? state.dataUrl : null);
      })
      .catch(() => {
        if (!cancelled) setCustomLogo(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const apply = () => {
      const nextTheme = resolveAppearance(appearance);
      document.documentElement.dataset.theme = nextTheme;
      setResolvedTheme(nextTheme);
    };
    apply();
    if (appearance !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);

  const toggleDarkAppearance = useCallback(() => {
    const nextAppearance: AppearanceMode = resolvedTheme === "dark" ? "light" : "dark";
    setAppearance(nextAppearance);
    window.localStorage.setItem("awkit-appearance", nextAppearance);
    window.playwrightFlowStudio.settings.update({ appearance: nextAppearance }).catch(() => undefined);
  }, [resolvedTheme]);

  const configuredIdleDuration = idleDuration(idleTimeoutMs);

  return (
    <div className="app-window awkit-login-shell">
      <AppFrame areaLabel={areaLabel} />
      <div className="awkit-login-stage">
        <section className="awkit-login-form-pane" aria-label={areaLabel}>
          <div className="awkit-login-brand-row">
            {customLogo ? (
              <img
                className="awkit-login-logo-custom awkit-login-shell-logo"
                src={customLogo}
                alt=""
                aria-hidden="true"
                draggable={false}
              />
            ) : null}
            <span className="awkit-login-brand-row-spacer" />
            <span className="awkit-login-appearance-label">Dark</span>
            <button
              type="button"
              className="awkit-login-appearance-switch"
              role="switch"
              aria-checked={resolvedTheme === "dark"}
              aria-label="Dark appearance"
              onClick={toggleDarkAppearance}
            >
              <span className="awkit-login-appearance-thumb" />
            </button>
          </div>

          <div className="awkit-login-scroll-body">
            <div className="awkit-login-content">
              <main className="awkit-login-card awkit-login-screen" role="main">
                {children}
              </main>

              <div className="awkit-login-footnote">
                <ShieldCheck size={15} strokeWidth={1.8} aria-hidden="true" />
                <span>
                  Credentials stay on this machine. Sessions lock after {configuredIdleDuration ?? "the configured period"} of inactivity.
                </span>
              </div>

              <footer className="awkit-login-footer">
                <span>SpecterStudio {APPLICATION_VERSION}</span>
                <span>Offline · bundled Chromium</span>
              </footer>
            </div>
          </div>
        </section>

        <aside className="awkit-login-run-panel" aria-hidden="true">
          <span className="awkit-login-run-grid" />
          <span className="awkit-login-run-spot" />
          <span className="awkit-login-run-scanline" />

          <div className="awkit-login-run-content">
            <div className="awkit-login-run-kicker">
              <span className="awkit-login-run-live-dot" />
              <span>Local run in progress</span>
              <span className="awkit-login-run-demo-label">Demo</span>
            </div>

            <div className="awkit-login-run-lead">
              <h2>Authorized UI automation, designed visually.</h2>
              <p>Customer Onboarding Workflow — every step timed, traced and replayable offline.</p>
            </div>

            <ol className="awkit-login-run-timeline">
              {DEMO_STEPS.map((step, index) => (
                <li className={`awkit-login-run-step is-${step.state}`} key={step.label}>
                  <span className="awkit-login-run-step-rail">
                    <span className="awkit-login-run-step-dot">
                      {step.state === "complete" ? <Check size={12} strokeWidth={2.8} /> : null}
                    </span>
                    {index < DEMO_STEPS.length - 1 ? <span className="awkit-login-run-step-line" /> : null}
                  </span>
                  <span className="awkit-login-run-step-card">
                    <span className="awkit-login-run-step-row">
                      <span className="awkit-login-run-step-title">{step.label}</span>
                      <span className="awkit-login-run-step-time">{step.elapsed}</span>
                    </span>
                    {step.state === "active" ? (
                      <span className="awkit-login-run-progress">
                        <span />
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>

            <div className="awkit-login-run-stats">
              <span className="awkit-login-run-stat">
                <strong>{APPLICATION_VERSION}</strong>
                <small>Studio build</small>
              </span>
              <span className="awkit-login-run-stat">
                <strong>Local</strong>
                <small>Workspace data</small>
              </span>
              <span className="awkit-login-run-stat">
                <strong>Offline</strong>
                <small>Bundled Chromium</small>
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
