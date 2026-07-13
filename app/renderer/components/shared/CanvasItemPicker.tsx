import { AnimatePresence, motion } from "framer-motion";
import { Search, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { menuSpring, usePrefersReducedMotion } from "../../lib/motion";

export interface CanvasPickerItem<T extends string = string> {
  id: T;
  label: string;
  description: string;
  category: string;
  icon: LucideIcon;
  disabled?: boolean;
}

interface CanvasItemPickerProps<T extends string> {
  open: boolean;
  title: string;
  searchPlaceholder: string;
  items: CanvasPickerItem<T>[];
  x: number;
  y: number;
  onPick: (id: T) => void;
  onClose: () => void;
  footer?: ReactNode;
}

export function CanvasItemPicker<T extends string>({
  open,
  title,
  searchPlaceholder,
  items,
  x,
  y,
  onPick,
  onClose,
  footer
}: CanvasItemPickerProps<T>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!open) return;
    setQuery("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  const grouped = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? items.filter((item) => `${item.label} ${item.description} ${item.category} ${item.id}`.toLowerCase().includes(normalized))
      : items;
    return filtered.reduce<Array<{ category: string; items: CanvasPickerItem<T>[] }>>((groups, item) => {
      const group = groups.find((entry) => entry.category === item.category);
      if (group) group.items.push(item);
      else groups.push({ category: item.category, items: [item] });
      return groups;
    }, []);
  }, [items, query]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={panelRef}
          className="canvas-item-picker"
          style={{ left: x, top: y }}
          role="menu"
          aria-label={title}
          initial={reducedMotion ? false : { opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
          transition={reducedMotion ? { duration: 0 } : menuSpring}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="canvas-item-picker-header">
            <div>
              <span>Add to canvas</span>
              <strong>{title}</strong>
            </div>
            <button type="button" className="icon-button" aria-label="Close picker" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <label className="canvas-picker-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          </label>
          <div className="canvas-picker-scroll">
            {grouped.length ? (
              grouped.map((group) => (
                <section key={group.category}>
                  <h3>{group.category}</h3>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        disabled={item.disabled}
                        onClick={() => onPick(item.id)}
                      >
                        <span className="canvas-picker-icon"><Icon size={18} /></span>
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </section>
              ))
            ) : (
              <p className="canvas-picker-empty">No matching items found.</p>
            )}
          </div>
          {footer ? <div className="canvas-picker-footer">{footer}</div> : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
