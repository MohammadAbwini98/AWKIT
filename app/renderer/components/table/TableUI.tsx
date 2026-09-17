import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, Inbox, ListFilter, Search, SearchX, X } from "lucide-react";
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
  // The direction is drawn as a chevron, which a screen reader cannot see. aria-sort is the only
  // thing that tells a non-visual reader which column orders the table and which way.
  return (
    <th
      className="sortable-header"
      style={{ textAlign: align }}
      aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
    >
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
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const visiblePageCount = Math.min(5, totalPages);
  const firstVisiblePage = Math.min(Math.max(1, page - 2), Math.max(1, totalPages - visiblePageCount + 1));
  const visiblePages = Array.from({ length: visiblePageCount }, (_, index) => firstVisiblePage + index);

  return (
    <div className="table-pagination">
      <span className="table-total">
        {first}–{last} of {total} record{total !== 1 ? "s" : ""}
      </span>
      <label className="table-pagesize">
        Rows
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="table-page-controls">
        <button type="button" aria-label="Previous page" title="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={14} />
        </button>
        {visiblePages.map((pageNumber) => (
          <button
            type="button"
            className={pageNumber === page ? "is-current" : undefined}
            aria-current={pageNumber === page ? "page" : undefined}
            aria-label={`Page ${pageNumber}`}
            key={pageNumber}
            onClick={() => onPage(pageNumber)}
          >
            {pageNumber}
          </button>
        ))}
        <button type="button" aria-label="Next page" title="Next page" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function TableEmptyState({ filtered, title, hint, action }: { filtered: boolean; title: string; hint: string; action?: React.ReactNode }) {
  const EmptyIcon = filtered ? SearchX : Inbox;
  return (
    <div className="empty-state table-empty">
      <span className="table-empty-icon" aria-hidden="true"><EmptyIcon size={20} /></span>
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
  collapsible?: boolean;
}

export function AdvancedTableFilters({ searchText, onSearch, fields, applied, onApply, onClear, searchPlaceholder, collapsible = false }: AdvancedTableFiltersProps) {
  const [draft, setDraft] = useState<Filters>(applied);
  const [errors, setErrors] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(!collapsible);
  const collapseId = useId();

  useEffect(() => {
    setDraft(applied);
  }, [applied]);

  const activeCount = Object.values(applied).filter((v) => v !== "" && v !== undefined && v !== null && v !== "all").length;
  const activeFilters = Object.entries(applied)
    .filter(([, value]) => value !== "" && value !== undefined && value !== null && value !== "all")
    .map(([key, value]) => {
      const field = fields.find((candidate) => candidate.key === key);
      const option = field?.options?.find((candidate) => candidate.value === String(value));
      return { key, label: `${field?.label ?? key}: ${option?.label ?? String(value)}` };
    });

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

  const remove = (key: string) => {
    const next = { ...draft };
    delete next[key];
    setDraft(next);
    setErrors([]);
    onApply(next);
  };

  const filtersVisible = !collapsible || expanded;

  return (
    <div className={`table-filters${collapsible ? " is-collapsible" : ""}`} role="search" aria-label="Table filters">
      {collapsible ? (
        <button
          className="table-filter-toggle"
          type="button"
          aria-controls={collapseId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="table-filter-toggle-label">
            <ListFilter size={15} aria-hidden="true" />
            Filters
            {activeCount ? <span className="table-filter-count">{activeCount}</span> : null}
          </span>
          <ChevronDown className="table-filter-toggle-chevron" size={16} aria-hidden="true" />
        </button>
      ) : null}

      <div
        id={collapseId}
        className={`table-filters-collapse${filtersVisible ? " is-open" : ""}`}
        aria-hidden={!filtersVisible}
      >
        <div className="table-filters-collapse-inner">
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
            {fields.map((field) => (
              <label key={field.key} className="table-filter-field">
                <span>{field.label}</span>
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
            <div className="table-filters-actions">
              <button type="button" className="toolbar-button primary" onClick={apply}>
                Apply
              </button>
              <button type="button" className="toolbar-button" onClick={clear}>
                Clear
              </button>
            </div>
          </div>

          {errors.length ? (
            <div className="settings-banner error table-filter-errors">
              <ul>
                {errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {activeCount ? (
            <div className="table-applied-filters">
              <span className="table-applied-label">Applied</span>
              {activeFilters.map((filter) => (
                <span className="table-applied-chip" key={filter.key}>
                  {filter.label}
                  <button type="button" aria-label={`Remove ${filter.label}`} onClick={() => remove(filter.key)}>
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
