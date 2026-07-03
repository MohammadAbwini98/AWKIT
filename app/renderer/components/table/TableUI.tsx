import { useEffect, useState } from "react";
import { ChevronDown, ChevronsUpDown, ChevronUp, Filter, Search, X } from "lucide-react";
import { PAGE_SIZES, validateFilters, type SortDirection } from "./tableState";

// ── Sortable header cell ──────────────────────────────────────────────────────
interface SortableHeaderCellProps {
  label: string;
  columnKey: string;
  sortBy: string | null;
  sortDirection: SortDirection;
  onSort: (column: string) => void;
  align?: "left" | "center";
}

export function SortableHeaderCell({ label, columnKey, sortBy, sortDirection, onSort, align = "left" }: SortableHeaderCellProps) {
  const active = sortBy === columnKey;
  return (
    <th className="sortable-header" style={{ textAlign: align }}>
      <button type="button" onClick={() => onSort(columnKey)} title={`Sort by ${label}`}>
        <span>{label}</span>
        {active ? (
          sortDirection === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
        ) : (
          <ChevronsUpDown size={12} className="sort-muted" />
        )}
      </button>
    </th>
  );
}

// ── Pagination footer ─────────────────────────────────────────────────────────
interface DataTablePaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

export function DataTablePagination({ page, totalPages, total, pageSize, onPage, onPageSize }: DataTablePaginationProps) {
  return (
    <div className="table-pagination">
      <span className="table-total">
        {total} matching record{total !== 1 ? "s" : ""}
      </span>
      <label className="table-pagesize">
        Rows per page
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="table-page-controls">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <span className="table-page-indicator">
          Page {page} of {totalPages}
        </span>
        <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function TableEmptyState({ filtered, title, hint, action }: { filtered: boolean; title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state table-empty">
      <strong>{title}</strong>
      <span>{hint}</span>
      {!filtered && action ? action : null}
    </div>
  );
}

// ── Advanced filters ──────────────────────────────────────────────────────────
export interface FilterFieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
}

type Filters = Record<string, unknown>;

interface AdvancedTableFiltersProps {
  searchText: string;
  onSearch: (text: string) => void;
  fields: FilterFieldDef[];
  applied: Filters;
  onApply: (filters: Filters) => void;
  onClear: () => void;
  searchPlaceholder: string;
}

export function AdvancedTableFilters({ searchText, onSearch, fields, applied, onApply, onClear, searchPlaceholder }: AdvancedTableFiltersProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(applied);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    setDraft(applied);
  }, [applied]);

  const activeCount = Object.values(applied).filter((v) => v !== "" && v !== undefined && v !== null && v !== "all").length;

  const setField = (key: string, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

  const apply = () => {
    const validation = validateFilters(draft);
    setErrors(validation);
    if (validation.length === 0) onApply(draft);
  };

  const clear = () => {
    setDraft({});
    setErrors([]);
    onClear();
  };

  return (
    <div className="table-filters">
      <div className="table-filters-bar">
        <div className="table-search">
          <Search size={15} />
          <input value={searchText} placeholder={searchPlaceholder} onChange={(e) => onSearch(e.target.value)} />
          {searchText ? (
            <button type="button" title="Clear search" onClick={() => onSearch("")}>
              <X size={14} />
            </button>
          ) : null}
        </div>
        <button type="button" className={open ? "toolbar-button primary" : "toolbar-button"} onClick={() => setOpen((v) => !v)}>
          <Filter size={15} />
          Filters{activeCount ? ` (${activeCount})` : ""}
        </button>
      </div>

      {open ? (
        <div className="table-filters-panel">
          <div className="settings-grid">
            {fields.map((field) => (
              <label key={field.key} className="table-filter-field">
                {field.label}
                {field.type === "select" ? (
                  <select value={String(draft[field.key] ?? "")} onChange={(e) => setField(field.key, e.target.value)}>
                    {field.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                    min={field.type === "number" ? 0 : undefined}
                    placeholder={field.placeholder}
                    value={String(draft[field.key] ?? "")}
                    onChange={(e) => setField(field.key, e.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
          {errors.length ? (
            <div className="settings-banner error">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="table-filters-actions">
            <button type="button" className="toolbar-button" onClick={clear}>
              Clear Filters
            </button>
            <button type="button" className="toolbar-button primary" onClick={apply}>
              Apply Filters
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
