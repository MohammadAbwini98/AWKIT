import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { menuSpring, usePrefersReducedMotion } from "../../lib/motion";

export interface NodeMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  tone?: "default" | "danger";
  /** When set, the item renders disabled (e.g. the acting role lacks the permission) with `title` as the reason. */
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
}

interface NodeOptionsMenuProps {
  open: boolean;
  /** The kebab button the menu is anchored to (its bounding rect positions the menu). */
  anchor: HTMLElement | null;
  items: NodeMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 216;
const MENU_MARGIN = 12;

/**
 * Compact per-node context menu opened from a node's kebab ("…") affordance — the AWKIT
 * equivalent of the Workflow reference's `NodeOptionsMenu`. Rendered through a portal to
 * `document.body` (the node card clips overflow) and positioned in viewport coordinates from
 * the anchor button. Closes on Escape, outside pointerdown, or after an item is chosen.
 */
export function NodeOptionsMenu({ open, anchor, items, onClose }: NodeOptionsMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [pos, setPos] = useState<{ left: number; top: number; origin: "top" | "bottom" } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPos(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const estHeight = items.length * 36 + 12;
    const left = Math.max(MENU_MARGIN, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - MENU_MARGIN));
    // Below the button by default; flip above when it would overflow the viewport.
    let top = rect.bottom + 6;
    let origin: "top" | "bottom" = "top";
    if (top + estHeight > window.innerHeight - MENU_MARGIN) {
      top = Math.max(MENU_MARGIN, rect.top - estHeight - 6);
      origin = "bottom";
    }
    setPos({ left, top, origin });
  }, [open, anchor, items.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !pos) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={ref}
        role="menu"
        aria-label="Node actions"
        className="node-options-menu"
        style={{ left: pos.left, top: pos.top, width: MENU_WIDTH, transformOrigin: `center ${pos.origin}` }}
        initial={reducedMotion ? false : { opacity: 0, y: pos.origin === "top" ? -6 : 6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reducedMotion ? undefined : { opacity: 0, y: pos.origin === "top" ? -4 : 4, scale: 0.98 }}
        transition={reducedMotion ? { duration: 0 } : menuSpring}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={item.tone === "danger" ? "node-options-item danger" : "node-options-item"}
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                if (item.disabled) return;
                item.onSelect();
                onClose();
              }}
            >
              <Icon size={15} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </motion.div>
    </AnimatePresence>,
    // Portal into the app root (not document.body): the menu is position:fixed so it still escapes
    // the node card's overflow, while staying inside React's root container so click delegation and
    // reduced-motion context work reliably.
    document.getElementById("root") ?? document.body
  );
}
