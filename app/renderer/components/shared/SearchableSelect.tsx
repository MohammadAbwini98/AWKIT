import { ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface SearchableOption {
  value: string;
  label: string;
  description?: string;
}

interface SearchableSelectProps {
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  ariaLabel?: string;
}

/**
 * Lightweight searchable combobox for long option lists (Task 05). Click to open a
 * filterable list; matches label / value / description (case-insensitive). Keeps the
 * selected value, closes on outside-click / Escape / selection. No external deps.
 */
export function SearchableSelect({ value, options, onChange, placeholder = "Select…", emptyText = "No matching options found.", ariaLabel }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.value === value);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(normalized) ||
        option.value.toLowerCase().includes(normalized) ||
        (option.description ?? "").toLowerCase().includes(normalized)
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    // Use pointerdown in the CAPTURE phase: the React Flow canvas (Flow Designer / Workflow
    // Builder) consumes pointer events on its pane, so a bubble-phase listener never sees an
    // outside click on the canvas and the menu stays open. Capture fires before any handler can
    // stop propagation, and pointerdown also covers touch ("tap out").
    document.addEventListener("pointerdown", onPointerDown, true);
    inputRef.current?.focus();
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="searchable-select" ref={wrapperRef}>
      <button
        type="button"
        className="searchable-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selected ? "" : "searchable-select-placeholder"}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="searchable-select-menu" role="listbox">
          <div className="searchable-select-search">
            <Search size={13} />
            <input
              ref={inputRef}
              value={query}
              placeholder="Search…"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                }
              }}
            />
          </div>
          <div className="searchable-select-list">
            {filtered.length === 0 ? (
              <p className="searchable-select-empty">{emptyText}</p>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.value || "__empty"}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={`searchable-select-option${option.value === value ? " selected" : ""}`}
                  onClick={() => choose(option.value)}
                >
                  <strong>{option.label}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
