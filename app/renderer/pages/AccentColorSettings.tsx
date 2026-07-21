import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AlertTriangle, ArrowLeftRight, Check, Palette, RotateCcw } from "lucide-react";
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_ACCENT_SETTINGS,
  SPECTER_BLUE,
  SPECTER_BLUE_SETTINGS,
  deriveAccentTokensFor,
  gradientReadability,
  lighten,
  normalizeAccentColor,
  normalizeAccentSettings,
  type AccentMode,
  type AccentPreset,
  type AccentSettings
} from "@src/theme/accentColor";
import { useTheme } from "../state/theme";

/**
 * Appearance → Accent Color setting. Lets the user pick a solid accent or a two-color gradient accent
 * (with a built-in Specter Blue preset), preview it locally, and commit it app-wide. Editing only recolors
 * the scoped preview panel (accent tokens + `data-accent-mode` set inline on that container); the rest of
 * the app stays on the saved accent until Apply. Persistence, global application and the bootstrap cache
 * are owned by App.tsx via `setAccent`.
 */
export function AccentColorSettings() {
  const { accent, setAccent, resolvedTheme } = useTheme();

  const [mode, setMode] = useState<AccentMode>(accent.mode);
  const [primaryHex, setPrimaryHex] = useState<string>(accent.primaryColor ?? DEFAULT_ACCENT_COLOR);
  const [secondaryHex, setSecondaryHex] = useState<string>(accent.secondaryColor ?? lighten(accent.primaryColor ?? DEFAULT_ACCENT_COLOR, 0.35));
  const [primaryTouched, setPrimaryTouched] = useState(false);
  const [secondaryTouched, setSecondaryTouched] = useState(false);

  // Re-seed the editor when the saved accent changes elsewhere (Reset to Defaults, Import).
  useEffect(() => {
    setMode(accent.mode);
    setPrimaryHex(accent.primaryColor ?? DEFAULT_ACCENT_COLOR);
    setSecondaryHex(accent.secondaryColor ?? lighten(accent.primaryColor ?? DEFAULT_ACCENT_COLOR, 0.35));
    setPrimaryTouched(false);
    setSecondaryTouched(false);
  }, [accent]);

  const primaryNorm = normalizeAccentColor(primaryHex);
  const secondaryNorm = normalizeAccentColor(secondaryHex);
  const primaryValid = primaryNorm !== null;
  const secondaryValid = secondaryNorm !== null;
  const valid = mode === "solid" ? primaryValid : primaryValid && secondaryValid;

  // The accent this draft represents. Solid + default purple collapses to the default (drops the override).
  const candidate: AccentSettings = useMemo(() => {
    if (mode === "solid" && primaryNorm === DEFAULT_ACCENT_COLOR) return DEFAULT_ACCENT_SETTINGS;
    return normalizeAccentSettings({
      mode,
      primaryColor: primaryNorm ?? accent.primaryColor,
      secondaryColor: secondaryNorm ?? accent.secondaryColor,
      gradientAngle: DEFAULT_ACCENT_SETTINGS.gradientAngle
    });
  }, [mode, primaryNorm, secondaryNorm, accent.primaryColor, accent.secondaryColor]);

  const dirty = !accentsEqual(candidate, accent);
  const activePreset: AccentPreset = candidate.preset;

  // Scope the preview: derive tokens for the current theme and set them (plus data-accent-mode) inline.
  const previewStyle = useMemo(
    () => deriveAccentTokensFor(candidate, resolvedTheme) as unknown as CSSProperties,
    [candidate, resolvedTheme]
  );

  const readability = useMemo(
    () => (candidate.mode === "gradient" && primaryNorm && secondaryNorm ? gradientReadability(primaryNorm, secondaryNorm, resolvedTheme) : { ok: true, foreground: "#FFFFFF" }),
    [candidate.mode, primaryNorm, secondaryNorm, resolvedTheme]
  );

  const editPrimary = (v: string) => {
    setPrimaryHex(v);
    setPrimaryTouched(true);
  };
  const editSecondary = (v: string) => {
    setSecondaryHex(v);
    setSecondaryTouched(true);
  };
  const swapColors = () => {
    setPrimaryHex(secondaryHex);
    setSecondaryHex(primaryHex);
    setPrimaryTouched(true);
    setSecondaryTouched(true);
  };

  const applyPreset = (preset: AccentPreset) => {
    if (preset === "default-purple") {
      setMode("solid");
      setPrimaryHex(DEFAULT_ACCENT_COLOR);
      setSecondaryHex(lighten(DEFAULT_ACCENT_COLOR, 0.35));
    } else if (preset === "specter-blue") {
      setMode("gradient");
      setPrimaryHex(SPECTER_BLUE.primary);
      setSecondaryHex(SPECTER_BLUE.secondary);
    }
    setPrimaryTouched(true);
    setSecondaryTouched(true);
  };

  const apply = () => {
    if (!valid || !dirty) return;
    setAccent(candidate);
  };
  const resetToDefault = () => applyPreset("default-purple");
  const resetDisabled = candidate.mode === "solid" && candidate.primaryColor === null && !dirty;

  return (
    <section className="work-panel settings-card">
      <div className="settings-card-head">
        <Palette size={16} />
        <h2>Appearance — Accent Color</h2>
      </div>
      <p className="settings-card-hint">
        Sets the application's primary accent — buttons, navigation, tabs, focus rings, selected workflow
        nodes and badges. Choose a solid color or a two-color gradient. Status colors (success, warning,
        error) are never changed. The accent applies across the whole app, is remembered on this machine,
        and is restored on restart. Fine controls (ports, focus rings, checkboxes) always use a solid derived
        color for clarity.
      </p>

      <div className="accent-setting-grid">
        <div className="accent-picker-col">
          {/* Style */}
          <div className="accent-field">
            <span>Accent style</span>
            <div className="accent-seg" role="group" aria-label="Accent style">
              {(["solid", "gradient"] as AccentMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`toolbar-button ${mode === m ? "primary" : ""}`}
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    setPrimaryTouched(true);
                  }}
                >
                  {m === "solid" ? "Solid" : "Gradient"}
                </button>
              ))}
            </div>
          </div>

          {/* Presets */}
          <div className="accent-field">
            <span>Preset</span>
            <div className="accent-preset-row" role="group" aria-label="Accent preset">
              <button type="button" className={`accent-preset ${activePreset === "default-purple" ? "is-active" : ""}`} aria-pressed={activePreset === "default-purple"} onClick={() => applyPreset("default-purple")}>
                <span className="accent-preset-swatch" style={{ background: DEFAULT_ACCENT_COLOR }} aria-hidden="true" />
                Default Purple
              </button>
              <button type="button" className={`accent-preset ${activePreset === "specter-blue" ? "is-active" : ""}`} aria-pressed={activePreset === "specter-blue"} onClick={() => applyPreset("specter-blue")}>
                <span className="accent-preset-swatch" style={{ background: `linear-gradient(135deg, ${SPECTER_BLUE.primary}, ${SPECTER_BLUE.secondary})` }} aria-hidden="true" />
                Specter Blue
              </button>
              <button type="button" className={`accent-preset ${activePreset === "custom" ? "is-active" : ""}`} aria-pressed={activePreset === "custom"} disabled={activePreset !== "custom"} title="Active when you pick your own colors">
                <span className="accent-preset-swatch" style={{ background: "var(--awkit-surface-inset)" }} aria-hidden="true" />
                Custom
              </button>
            </div>
          </div>

          {/* Primary color */}
          <label className="accent-field">
            <span>{mode === "gradient" ? "Primary color" : "Accent color"}</span>
            <div className="accent-input-row">
              <input type="color" className="accent-color-input" aria-label="Primary color picker" value={(primaryNorm ?? DEFAULT_ACCENT_COLOR).toLowerCase()} onChange={(ev) => editPrimary(ev.target.value.toUpperCase())} />
              <input type="text" className="accent-hex-input" aria-label="Primary color hex value" aria-invalid={primaryTouched && !primaryValid} spellCheck={false} autoComplete="off" placeholder="#7C3AED" maxLength={7} value={primaryHex} onChange={(ev) => editPrimary(ev.target.value)} />
              <span className="accent-swatch" aria-hidden="true" style={{ background: primaryValid ? primaryNorm : "transparent" }} />
            </div>
          </label>
          {primaryTouched && !primaryValid ? <p className="form-message error-text" role="alert">Enter a valid hex color, e.g. #7C3AED.</p> : null}

          {/* Secondary color (gradient only) */}
          {mode === "gradient" ? (
            <>
              <label className="accent-field">
                <span>Secondary gradient color</span>
                <div className="accent-input-row">
                  <input type="color" className="accent-color-input" aria-label="Secondary color picker" value={(secondaryNorm ?? "#38BDF8").toLowerCase()} onChange={(ev) => editSecondary(ev.target.value.toUpperCase())} />
                  <input type="text" className="accent-hex-input" aria-label="Secondary color hex value" aria-invalid={secondaryTouched && !secondaryValid} spellCheck={false} autoComplete="off" placeholder="#38BDF8" maxLength={7} value={secondaryHex} onChange={(ev) => editSecondary(ev.target.value)} />
                  <span className="accent-swatch" aria-hidden="true" style={{ background: secondaryValid ? secondaryNorm : "transparent" }} />
                  <button type="button" className="toolbar-button" onClick={swapColors} title="Swap primary and secondary">
                    <ArrowLeftRight size={15} />
                    Swap
                  </button>
                </div>
              </label>
              <p className="form-message">The gradient flows deep → primary → bright highlight → secondary → deep.</p>
              {secondaryTouched && !secondaryValid ? <p className="form-message error-text" role="alert">Enter a valid hex color, e.g. #38BDF8.</p> : null}
              {valid && !readability.ok ? (
                <p className="form-message warn" role="alert">
                  <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> This pair is low-contrast; text on the accent is auto-adjusted for readability.
                </p>
              ) : null}
            </>
          ) : null}

          <div className="accent-saved-row">
            <span className="awkit-muted">Saved</span>
            <span className="accent-swatch small" aria-hidden="true" style={savedSwatch(accent)} />
            <strong>{savedLabel(accent)}</strong>
            {dirty ? <span className="accent-dirty-chip">Unsaved</span> : null}
          </div>

          <div className="accent-actions">
            <button type="button" className="toolbar-button primary" onClick={apply} disabled={!valid || !dirty} title="Apply this accent to the whole application and save it">
              <Check size={15} />
              Apply
            </button>
            <button type="button" className="toolbar-button" onClick={resetToDefault} disabled={resetDisabled} title="Restore the original default purple">
              <RotateCcw size={15} />
              Reset to Default Purple
            </button>
          </div>
        </div>

        {/* Scoped live preview — reflects the draft (mode + colors) without touching the rest of the app. */}
        <div className="accent-preview" data-accent-mode={candidate.mode} style={previewStyle} aria-label={`Accent preview (${resolvedTheme} theme, ${candidate.mode})`}>
          <span className="accent-preview-caption awkit-muted">Live preview · {resolvedTheme} · {candidate.mode}</span>
          <div className="accent-gradient-strip" aria-hidden="true" />
          <div className="accent-preview-row">
            <button type="button" className="accent-preview-btn" tabIndex={-1}>Primary</button>
            <span className="accent-preview-nav">Active nav</span>
            <span className="accent-preview-tab">Active tab</span>
          </div>
          <div className="accent-preview-row">
            <span className="accent-preview-input">Focus ring</span>
            <span className="accent-preview-toggle" aria-hidden="true"><span className="accent-preview-toggle-dot" /></span>
            <span className="accent-preview-badge">Badge</span>
            <span className="accent-preview-icon" aria-hidden="true"><Palette size={15} /></span>
            <span className="accent-preview-port" aria-hidden="true" title="Port (solid)" />
          </div>
          <div className="accent-preview-node">Selected workflow node</div>
        </div>
      </div>
    </section>
  );
}

/** Compare the effective (mode-relevant) fields of two accents. */
function accentsEqual(a: AccentSettings, b: AccentSettings): boolean {
  if (a.mode !== b.mode || a.primaryColor !== b.primaryColor) return false;
  if (a.mode === "gradient") return a.secondaryColor === b.secondaryColor && a.gradientAngle === b.gradientAngle;
  return true;
}

function savedLabel(a: AccentSettings): string {
  if (a.mode === "solid" && a.primaryColor === null) return `${DEFAULT_ACCENT_COLOR} · default purple`;
  if (a.mode === "gradient") return `${a.primaryColor} → ${a.secondaryColor}${a.preset === "specter-blue" ? " · Specter Blue" : ""}`;
  return `${a.primaryColor} · solid`;
}

function savedSwatch(a: AccentSettings): CSSProperties {
  if (a.mode === "gradient" && a.primaryColor && a.secondaryColor) {
    return { background: `linear-gradient(135deg, ${a.primaryColor}, ${a.secondaryColor})` };
  }
  return { background: a.primaryColor ?? DEFAULT_ACCENT_COLOR };
}
