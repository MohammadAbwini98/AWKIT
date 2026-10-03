import { useEffect, useRef } from "react";
import { useTheme } from "../state/theme";
import { usePrefersReducedMotion } from "../components/shared/usePrefersReducedMotion";

/**
 * Full-viewport base canvas behind the whole app layout: the "emitted light" dot field from the
 * SpecterStudio Canvas design handoff. A cached 5×5 pattern tile paints the base grid once; the
 * dots near the smoothed pointer (and its decaying trail) light up, grow, bloom and push ~2px away.
 * Each frame repaints only the dirty rect around the lit area, and the requestAnimationFrame loop
 * parks as soon as the pointer is still, the trail has decayed and presence has settled.
 * Constants are the handoff's (tokens.json → dotField / motion); colors come from --awkit-field-*.
 */
const STEP = 24; // grid spacing (CSS px); every 5th dot on both axes is a major dot
const AMBIENT = 0.6;
const PAD = 8; // lit-dot overdraw: 2.4px push + bloom radius 2·(1.4 + 1.3)

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function AppBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // resolvedTheme is set after <html data-theme> is applied, so these read the active theme.
    const css = getComputedStyle(document.documentElement);
    const dot = css.getPropertyValue("--awkit-field-dot").trim();
    const major = css.getPropertyValue("--awkit-field-dot-major").trim();
    const glow = css.getPropertyValue("--awkit-field-glow").trim();
    const ambient = reduced ? AMBIENT * 0.4 : AMBIENT;

    let dpr = 1;
    let width = 0;
    let height = 0;
    let pattern: CanvasPattern | null = null;
    const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
    let inside = false;
    let presence = 0;
    let speed = 0;
    let trail: { x: number; y: number; w: number }[] = [];
    let painted: Box | null = null; // lit area drawn by the previous frame
    let raf = 0;
    let looping = false;
    let last = 0;

    // Clear a CSS-px rect and refill it with the base grid, snapped to whole device pixels so
    // the refill is pixel-identical to its surroundings.
    const paintBase = (b: Box) => {
      const x = Math.max(0, Math.floor(b.x1 * dpr));
      const y = Math.max(0, Math.floor(b.y1 * dpr));
      const w = Math.min(canvas.width, Math.ceil(b.x2 * dpr)) - x;
      const h = Math.min(canvas.height, Math.ceil(b.y2 * dpr)) - y;
      if (w <= 0 || h <= 0 || !pattern) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(x, y, w, h);
      ctx.fillStyle = pattern;
      ctx.fillRect(x, y, w, h);
    };

    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const n = Math.max(1, Math.round(STEP * 5 * dpr));
      const s = n / 5;
      const tile = document.createElement("canvas");
      tile.width = n;
      tile.height = n;
      const t = tile.getContext("2d");
      if (!t) return;
      const disc = (x: number, y: number, r: number, color: string) => {
        t.fillStyle = color;
        t.beginPath();
        t.arc(x, y, r * dpr, 0, Math.PI * 2);
        t.fill();
      };
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (i || j) disc(i * s, j * s, 1, dot);
      // the major dot sits on the tile corner: draw all four quarters so it is whole across seams
      for (const [x, y] of [[0, 0], [n, 0], [0, n], [n, n]]) disc(x, y, 1.4, major);
      pattern = ctx.createPattern(tile, "repeat");
      paintBase({ x1: 0, y1: 0, x2: width, y2: height });
      painted = null;
    };

    const draw = () => {
      const src = trail.slice();
      if (presence > 0.02) src.push({ x: ptr.x, y: ptr.y, w: presence });
      const sig = 26 + Math.min(18, speed * 0.8);
      const reach = sig * 2.6;
      let lit: Box | null = null;
      if (src.length && ambient > 0) {
        lit = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
        for (const p of src) {
          lit.x1 = Math.min(lit.x1, p.x - reach);
          lit.y1 = Math.min(lit.y1, p.y - reach);
          lit.x2 = Math.max(lit.x2, p.x + reach);
          lit.y2 = Math.max(lit.y2, p.y + reach);
        }
      }
      const prev = painted;
      if (prev) paintBase(prev);
      if (!lit) {
        painted = null;
        return;
      }
      const area = { x1: lit.x1 - PAD, y1: lit.y1 - PAD, x2: lit.x2 + PAD, y2: lit.y2 + PAD };
      paintBase(area);
      painted = area;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = glow;
      const inv = 1 / (2 * sig * sig);
      const i0 = Math.ceil(Math.max(0, lit.x1) / STEP);
      const i1 = Math.floor(Math.min(width, lit.x2) / STEP);
      const j0 = Math.ceil(Math.max(0, lit.y1) / STEP);
      const j1 = Math.floor(Math.min(height, lit.y2) / STEP);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const sx = i * STEP;
          const sy = j * STEP;
          let heat = 0;
          for (const p of src) {
            const dx = sx - p.x;
            const dy = sy - p.y;
            heat += p.w * Math.exp(-(dx * dx + dy * dy) * inv);
          }
          if (heat < 0.03) continue;
          heat = Math.min(1, heat) * Math.min(1.4, ambient);
          const dx = sx - ptr.x;
          const dy = sy - ptr.y;
          const d = Math.hypot(dx, dy) || 1;
          const push = reduced ? 0 : Math.min(2.4, 2.4 * heat);
          const cx = sx + (dx / d) * push;
          const cy = sy + (dy / d) * push;
          const r = (i % 5 === 0 && j % 5 === 0 ? 1.4 : 1) + 1.3 * heat;
          if (heat > 0.3) {
            ctx.globalAlpha = 0.1 * heat;
            ctx.beginPath();
            ctx.arc(cx, cy, r * 2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = Math.min(1, 0.12 + 0.78 * heat);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const tick = () => {
      if (looping) return;
      looping = true;
      last = performance.now();
      const loop = () => {
        const now = performance.now();
        const dt = Math.min(48, now - last);
        last = now;
        const ease = reduced ? 1 : 1 - Math.pow(0.86, dt / 16);
        const dx = ptr.tx - ptr.x;
        const dy = ptr.ty - ptr.y;
        const moving = Math.abs(dx) + Math.abs(dy) > 0.05;
        if (moving) {
          ptr.x += dx * ease;
          ptr.y += dy * ease;
        }
        const moved = Math.hypot(dx * ease, dy * ease);
        speed = speed * 0.85 + moved * 0.15;
        if (!reduced && moved > 0.6) {
          trail.push({ x: ptr.x, y: ptr.y, w: Math.min(0.55, moved / 18) });
          if (trail.length > 18) trail.shift();
        }
        const decay = Math.pow(0.86, dt / 16);
        trail = trail.filter((p) => (p.w *= decay) > 0.02);
        const goal = inside ? 1 : 0;
        presence += (goal - presence) * (reduced ? 1 : 1 - Math.pow(0.9, dt / 16));
        draw();
        if (moving || trail.length > 0 || Math.abs(goal - presence) > 0.005) raf = requestAnimationFrame(loop);
        else looping = false;
      };
      raf = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      if (!inside) {
        // jump on entry so the light does not streak in from where the pointer left
        ptr.x = e.clientX;
        ptr.y = e.clientY;
      }
      inside = true;
      ptr.tx = e.clientX;
      ptr.ty = e.clientY;
      tick();
    };
    const onLeave = () => {
      inside = false;
      tick();
    };
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) onLeave(); // pointer left the window
    };
    // The device-pixel box also changes when only the DPR does (window moved to a monitor with a
    // different scale), which a window "resize" listener misses.
    const resizeObserver = new ResizeObserver(() => {
      size();
      tick();
    });

    size(); // paint now; the observer's first callback waits for the next rendered frame
    resizeObserver.observe(canvas, { box: "device-pixel-content-box" });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerout", onOut);
    window.addEventListener("blur", onLeave);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onOut);
      window.removeEventListener("blur", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [resolvedTheme, reduced]);

  return <canvas ref={canvasRef} className="app-background" aria-hidden="true" />;
}
