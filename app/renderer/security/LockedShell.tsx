import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { AppFrame } from "../layout/AppFrame";
import { resolveAppearance, type AppearanceMode } from "../state/theme";

interface LockedShellProps {
  /** Context label shown in the custom title bar (e.g., "Secure sign-in"). */
  areaLabel: string;
  /** Trusted idle-lock window from SecurityGate; null until reported, which renders generic copy. */
  idleTimeoutMs: number | null;
  children: ReactNode;
}

type DemoStepState = "complete" | "active" | "pending";

interface DemoStep {
  label: string;
  elapsed: string;
  durationMs: number;
}

/**
 * Decorative labels mirror the bundled Customer Onboarding sample and its Login Flow. The elapsed
 * values are a fixed design demo, never runtime state or measured telemetry.
 */
const DEMO_STEPS: DemoStep[] = [
  { label: "Login", elapsed: "1.2s", durationMs: 1200 },
  { label: "Open Login Page", elapsed: "0.9s", durationMs: 900 },
  { label: "Create customer", elapsed: "2.4s", durationMs: 2400 },
  { label: "Validate result", elapsed: "1.6s", durationMs: 1600 },
  { label: "Logout", elapsed: "0.8s", durationMs: 800 }
];

const DEMO_TICK_MS = 80;
const PREVIEW_MOTION_PREFERENCE_KEY = "awkit-login-preview-motion-enabled";

function readAppearance(): AppearanceMode {
  const saved = window.localStorage.getItem("awkit-appearance");
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
}

function readPreviewMotionEnabled(): boolean {
  return window.localStorage.getItem(PREVIEW_MOTION_PREFERENCE_KEY) !== "false";
}

function idleDuration(idleTimeoutMs: number | null): string | null {
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
  const [demo, setDemo] = useState({ step: 0, progress: 0 });
  // The owner explicitly asked for this decorative workflow demo to autoplay. The persistent
  // control remains available for anyone who wants to pause it, without affecting authentication.
  const [previewMotionEnabled, setPreviewMotionEnabled] = useState(readPreviewMotionEnabled);

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

  useEffect(() => {
    if (!previewMotionEnabled) {
      setDemo({ step: 0, progress: 0 });
      return;
    }
    const timer = window.setInterval(() => {
      setDemo((current) => {
        const step = DEMO_STEPS[current.step];
        const progress = current.progress + DEMO_TICK_MS / step.durationMs;
        if (progress < 1) return { ...current, progress };
        return { step: (current.step + 1) % DEMO_STEPS.length, progress: 0 };
      });
    }, DEMO_TICK_MS);
    return () => window.clearInterval(timer);
  }, [previewMotionEnabled]);

  const toggleDarkAppearance = useCallback(() => {
    const nextAppearance: AppearanceMode = resolvedTheme === "dark" ? "light" : "dark";
    setAppearance(nextAppearance);
    window.localStorage.setItem("awkit-appearance", nextAppearance);
    window.playwrightFlowStudio.settings.update({ appearance: nextAppearance }).catch(() => undefined);
  }, [resolvedTheme]);

  const togglePreviewMotion = useCallback(() => {
    setPreviewMotionEnabled((current) => {
      const next = !current;
      window.localStorage.setItem(PREVIEW_MOTION_PREFERENCE_KEY, String(next));
      return next;
    });
  }, []);

  const configuredIdleDuration = idleDuration(idleTimeoutMs);

  return (
    <div className="app-window awkit-login-shell">
      <AppFrame areaLabel={areaLabel} />
      <div className="awkit-login-stage">
        <section className="awkit-login-form-pane" aria-label={areaLabel}>
          <div className="awkit-login-brand-row">
            <span className="awkit-login-brand-row-spacer" />
            <span className="awkit-login-appearance-label">Preview motion</span>
            <button
              type="button"
              className="awkit-login-appearance-switch"
              role="switch"
              aria-checked={previewMotionEnabled}
              aria-label="Animate workflow preview"
              onClick={togglePreviewMotion}
            >
              <span className="awkit-login-appearance-thumb" />
            </button>
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

            </div>
          </div>
        </section>

        <aside className="awkit-login-run-panel" aria-hidden="true" data-motion={previewMotionEnabled ? "running" : "paused"}>
          <span className="awkit-login-run-grid" />
          <span className="awkit-login-run-spot" />
          <span className="awkit-login-run-scanline" />

          <div className="awkit-login-run-content">
            <div className="awkit-login-run-kicker">
              <span className="awkit-login-run-live-dot" />
              <span>Sample workflow preview</span>
              <span className="awkit-login-run-demo-label">Demo</span>
            </div>

            <div className="awkit-login-run-lead">
              <h2>Authorized UI automation, designed visually.</h2>
              <p>Customer Onboarding Workflow — a scripted preview of the bundled sample flow.</p>
            </div>

            <ol className="awkit-login-run-timeline">
              {DEMO_STEPS.map((step, index) => {
                const state: DemoStepState = index < demo.step ? "complete" : index === demo.step ? "active" : "pending";
                const elapsed = state === "complete"
                  ? step.elapsed
                  : state === "active"
                    ? `${((step.durationMs / 1000) * demo.progress).toFixed(1)}s`
                    : "";
                return (
                  <li className={`awkit-login-run-step is-${state}`} key={step.label}>
                    <span className="awkit-login-run-step-rail">
                      <span className="awkit-login-run-step-dot">
                        {state === "complete" ? <Check size={12} strokeWidth={2.8} /> : null}
                      </span>
                      {index < DEMO_STEPS.length - 1 ? <span className="awkit-login-run-step-line" /> : null}
                    </span>
                    <span className="awkit-login-run-step-card">
                      <span className="awkit-login-run-step-row">
                        <span className="awkit-login-run-step-title">{step.label}</span>
                        <span className="awkit-login-run-step-time">{elapsed}</span>
                      </span>
                      {state === "active" ? (
                        <span className="awkit-login-run-progress">
                          <span style={{ width: `${demo.progress * 100}%` }} />
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div className="awkit-login-run-stats">
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
