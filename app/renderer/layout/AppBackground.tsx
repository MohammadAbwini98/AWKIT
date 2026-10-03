import { useEffect, useLayoutEffect, useRef } from "react";
import { useTheme } from "../state/theme";
import { usePrefersReducedMotion } from "../components/shared/usePrefersReducedMotion";

/**
 * The "emitted light" dot field from the SpecterStudio Canvas design handoff: the app background
 * and the canvas space of every designer and monitor. A cached 5×5 pattern tile paints the grid;
 * the dots near the smoothed pointer (and its decaying trail) light up, grow, bloom and push ~2px
 * away. Each frame repaints only the dirty rect around the lit area, and the requestAnimationFrame
 * loop parks as soon as the pointer is still, the trail has decayed and presence has settled.
 *
 * Each field lights only while the pointer is over its own host (the canvas's parent element) and
 * no nested field host, so a designer canvas and the app background never both burn frames.
 * Constants are the handoff's (tokens.json → dotField / motion); colors come from --awkit-field-*.
 */
const BASE_STEP = 24; // grid spacing (CSS px) at zoom 1; every 5th dot on both axes is a major dot
const AMBIENT = 0.25;
const PAD = 8; // lit-dot overdraw: 2.4px push + bloom radius 2·(1.4 + 1.3)

/** World → screen transform of the surface the field sits under: screen = world · k + (x, y). */
export interface DotFieldView {
  x: number;
  y: number;
  k: number;
}

const STATIC_VIEW: DotFieldView = { x: 0, y: 0, k: 1 };

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Grid spacing and dot fade for a zoom level (handoff "Emitted light" §1 and §3). */
function gridFor(k: number) {
  let step = BASE_STEP * k;
  while (step < 12) step *= 4;
  while (step > 160) step /= 2;
  return { step, fade: Math.max(0.25, Math.min(1, (k - 0.16) * 2.4)) };
}

export function DotField({ className, view = STATIC_VIEW }: { className?: string; view?: DotFieldView }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef(view);
  const redrawRef = useRef<(() => void) | null>(null);
  const { resolvedTheme } = useTheme();
  const reduced = usePrefersReducedMotion();

  // Follow the host surface's pan/zoom before paint, so the grid never tears from its world layer.
  useLayoutEffect(() => {
    viewRef.current = view;
    redrawRef.current?.();
  }, [view.x, view.y, view.k]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    host.setAttribute("data-dot-field-host", "");
    // resolvedTheme is set after <html data-theme> is applied, so these read the active theme.
    const css = getComputedStyle(document.documentElement);
    const dot = css.getPropertyValue("--awkit-field-dot").trim();
    const major = css.getPropertyValue("--awkit-field-dot-major").trim();
    const glow = css.getPropertyValue("--awkit-field-glow").trim();
    const ambient = reduced ? AMBIENT * 0.4 : AMBIENT;

    let dpr = 1;
    let width = 0;
    let height = 0;
    let grid = gridFor(1);
    let origin = { x: 0, y: 0 };
    let tile: { step: number; size: number; pattern: CanvasPattern } | null = null;
    const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
    let inside = false;
    let presence = 0;
    let speed = 0;
    let trail: { x: number; y: number; w: number }[] = [];
    let painted: Box | null = null; // lit area drawn by the previous frame
    let raf = 0;
    let looping = false;
    let last = 0;

    const makeTile = (step: number) => {
      const n = Math.max(1, Math.round(step * 5 * dpr));
      const s = n / 5;
      const tileCanvas = document.createElement("canvas");
      tileCanvas.width = n;
      tileCanvas.height = n;
      const t = tileCanvas.getContext("2d");
      if (!t) return null;
      const disc = (x: number, y: number, r: number, color: string) => {
        t.fillStyle = color;
        t.beginPath();
        t.arc(x, y, r * dpr, 0, Math.PI * 2);
        t.fill();
      };
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (i || j) disc(i * s, j * s, 1, dot);
      // the major dot sits on the tile corner: draw all four quarters so it is whole across seams
      for (const [x, y] of [[0, 0], [n, 0], [0, n], [n, n]]) disc(x, y, 1.4, major);
      const pattern = ctx.createPattern(tileCanvas, "repeat");
      return pattern ? { step, size: n, pattern } : null;
    };

    // Re-anchor the grid to the current view: the pattern is offset to the world origin and scaled
    // so one tile spans exactly 5 grid steps (the tile's whole-pixel size would otherwise drift).
    const applyView = () => {
      const v = viewRef.current;
      grid = gridFor(v.k);
      origin = { x: v.x, y: v.y };
      if (!tile || tile.step !== grid.step) tile = makeTile(grid.step);
      if (!tile) return;
      const period = grid.step * 5;
      tile.pattern.setTransform(
        new DOMMatrix()
          .translateSelf(mod(origin.x, period) * dpr, mod(origin.y, period) * dpr)
          .scaleSelf((period * dpr) / tile.size)
      );
    };

    // Clear a CSS-px rect and refill it with the base grid, snapped to whole device pixels so
    // the refill is pixel-identical to its surroundings.
    const paintBase = (b: Box) => {
      const x = Math.max(0, Math.floor(b.x1 * dpr));
      const y = Math.max(0, Math.floor(b.y1 * dpr));
      const w = Math.min(canvas.width, Math.ceil(b.x2 * dpr)) - x;
      const h = Math.min(canvas.height, Math.ceil(b.y2 * dpr)) - y;
      if (w <= 0 || h <= 0 || !tile) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(x, y, w, h);
      ctx.globalAlpha = grid.fade;
      ctx.fillStyle = tile.pattern;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
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

      const { step, fade } = grid;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = glow;
      const inv = 1 / (2 * sig * sig);
      const i0 = Math.ceil((Math.max(0, lit.x1) - origin.x) / step);
      const i1 = Math.floor((Math.min(width, lit.x2) - origin.x) / step);
      const j0 = Math.ceil((Math.max(0, lit.y1) - origin.y) / step);
      const j1 = Math.floor((Math.min(height, lit.y2) - origin.y) / step);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const sx = origin.x + i * step;
          const sy = origin.y + j * step;
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
          const r = (mod(i, 5) === 0 && mod(j, 5) === 0 ? 1.4 : 1) + 1.3 * heat;
          if (heat > 0.3) {
            ctx.globalAlpha = 0.1 * heat * fade;
            ctx.beginPath();
            ctx.arc(cx, cy, r * 2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = Math.min(1, 0.12 + 0.78 * heat) * fade;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    // Full repaint after a size, DPR or view change.
    const redraw = () => {
      applyView();
      paintBase({ x1: 0, y1: 0, x2: width, y2: height });
      painted = null;
      draw();
    };

    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      tile = null;
      redraw();
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

    const onLeave = () => {
      if (!inside) return;
      inside = false;
      tick();
    };
    const onMove = (e: PointerEvent) => {
      // Light only this field's own surface, never a nested field host's.
      const owner = e.target instanceof Element ? e.target.closest("[data-dot-field-host]") : null;
      if (owner !== host) {
        onLeave();
        return;
      }
      const r = host.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (!inside) {
        // jump on entry so the light does not streak in from where the pointer left
        ptr.x = x;
        ptr.y = y;
      }
      inside = true;
      ptr.tx = x;
      ptr.ty = y;
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
    redrawRef.current = redraw;
    resizeObserver.observe(canvas, { box: "device-pixel-content-box" });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerout", onOut);
    window.addEventListener("blur", onLeave);
    return () => {
      redrawRef.current = null;
      host.removeAttribute("data-dot-field-host");
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onOut);
      window.removeEventListener("blur", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [resolvedTheme, reduced]);

  return <canvas ref={canvasRef} className={["awkit-dot-field", className].filter(Boolean).join(" ")} aria-hidden="true" />;
}

/** Full-viewport base canvas behind the whole app layout. */
export function AppBackground() {
  return <DotField className="app-background" />;
}
