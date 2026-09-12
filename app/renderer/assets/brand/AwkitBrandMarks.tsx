import { useId } from "react";

const SQUIRCLE_PATH =
  "M512 0 C880 0 1024 144 1024 512 C1024 880 880 1024 512 1024 C144 1024 0 880 0 512 C0 144 144 0 512 0 Z";

export type AwkitBrandMarkSize = 16 | 38;

interface AwkitBrandMarkBaseProps {
  className?: string;
  size?: AwkitBrandMarkSize;
}

type AwkitBrandMarkAccessibilityProps =
  | { decorative?: true; ariaLabel?: never }
  | { decorative: false; ariaLabel: string };

export type AwkitBrandMarkProps = AwkitBrandMarkBaseProps & AwkitBrandMarkAccessibilityProps;

export interface AwkitWordmarkGlyphProps {
  className?: string;
}

interface BrickGlyphProps {
  normalFill: string;
  transform?: string;
}

function BrickGlyph({ normalFill, transform }: BrickGlyphProps) {
  return (
    <g fill={normalFill} transform={transform}>
      <path d="M140 0 H75 Q0 0 0 75 Q0 150 75 150 H140 Z" />
      <rect x="170" y="0" width="130" height="150" rx="20" />
      <rect x="0" y="190" width="130" height="150" rx="20" fill="var(--awkit-accent)" />
      <path d="M160 190 H225 Q300 190 300 265 Q300 340 225 340 H160 Z" />
    </g>
  );
}

type SquircleBrandMarkProps = AwkitBrandMarkProps & {
  finish: "light" | "dark";
};

function SquircleBrandMark({ ariaLabel, className, decorative = true, finish, size = 38 }: SquircleBrandMarkProps) {
  const instanceId = useId().replace(/:/g, "");
  const clipId = `awkit-${finish}-brand-clip-${instanceId}`;
  const gradientId = `awkit-dark-brand-ground-${instanceId}`;
  const hairlineStrokeWidth = size === 16 ? 56 : 28;
  const shadow =
    size === 38
      ? finish === "light"
        ? "drop-shadow(0 2px 6px rgba(16,24,40,.16))"
        : "drop-shadow(0 2px 6px rgba(0,0,0,.38))"
      : undefined;

  return (
    <svg
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : ariaLabel}
      className={className}
      focusable="false"
      height={size}
      role={decorative ? undefined : "img"}
      style={{ display: "block", filter: shadow }}
      viewBox="0 0 1024 1024"
      width={size}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={SQUIRCLE_PATH} />
        </clipPath>
        {finish === "dark" ? (
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2b2c2e" />
            <stop offset="100%" stopColor="#161618" />
          </linearGradient>
        ) : null}
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <rect width="1024" height="1024" fill={finish === "light" ? "#f4f3f1" : `url(#${gradientId})`} />
        {finish === "dark" ? <rect width="1024" height="420" fill="#ffffff" opacity=".05" /> : null}
        <BrickGlyph normalFill={finish === "light" ? "#0f0f0f" : "#f6f6f6"} transform="translate(302,272) scale(1.4)" />
        <path
          d={SQUIRCLE_PATH}
          fill="none"
          stroke={finish === "light" ? "rgba(16,24,40,.18)" : "rgba(255,255,255,.16)"}
          strokeWidth={hairlineStrokeWidth}
        />
      </g>
    </svg>
  );
}

/** The light “Ink on paper” squircle mark. Decorative unless explicitly labelled. */
export function AwkitLightBrandMark(props: AwkitBrandMarkProps) {
  return <SquircleBrandMark {...props} finish="light" />;
}

/** The dark “Inverted” squircle mark. Decorative unless explicitly labelled. */
export function AwkitDarkBrandMark(props: AwkitBrandMarkProps) {
  return <SquircleBrandMark {...props} finish="dark" />;
}

/** Decorative brick “S” for the visible SpecterStudio login heading. */
export function AwkitWordmarkGlyph({ className }: AwkitWordmarkGlyphProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      style={{
        display: "inline-block",
        height: ".8em",
        marginRight: ".035em",
        verticalAlign: "-.075em",
        width: ".706em"
      }}
      viewBox="0 0 300 340"
    >
      <BrickGlyph normalFill="currentColor" />
    </svg>
  );
}
