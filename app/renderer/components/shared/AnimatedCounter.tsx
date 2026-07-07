import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

interface AnimatedCounterProps {
  value: number;
  /** Decimal places to render. */
  decimals?: number;
  /** Ramp duration in ms (default ~= --awkit-dur-slow). */
  durationMs?: number;
  prefix?: string;
  suffix?: string;
}

/**
 * rAF count-up to `value`. Under OS reduced-motion (or on first mount) it renders the final value
 * immediately, so no animation is required for correctness.
 */
export function AnimatedCounter({
  value,
  decimals = 0,
  durationMs = 360,
  prefix = "",
  suffix = ""
}: AnimatedCounterProps) {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number>();

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (reduced || from === to || durationMs <= 0) {
      setDisplay(to);
      fromRef.current = to;
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * eased);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      fromRef.current = to;
    };
  }, [value, durationMs, reduced]);

  const formatted = display.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

  return (
    <span>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
