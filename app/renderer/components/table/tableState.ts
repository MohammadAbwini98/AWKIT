import { useCallback, useEffect, useRef, useState } from "react";
import type { TableState } from "../../../main/uiSettings";

export type { TableState };
export type SortDirection = "asc" | "desc";

const DEFAULT_TABLE_STATE: TableState = {
  page: 1,
  pageSize: 10,
  searchText: "",
  sortBy: null,
  sortDirection: "asc",
  filters: {}
};

export const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * Adapter mapping a row of type T to the generic fields the table engine
 * understands. Optional accessors (flows/dataSource/mode/maxParallel) are used
 * only by the Workflows table. Missing values must return undefined, never throw.
 */
export interface RowAdapter<T> {
  id: (row: T) => string;
  name: (row: T) => string;
  status: (row: T) => "active" | "inactive";
  version: (row: T) => number | undefined;
  nodes: (row: T) => number;
  connectors: (row: T) => number;
  createdAt: (row: T) => string | undefined;
  updatedAt: (row: T) => string | undefined;
  flows?: (row: T) => number;
  dataSource?: (row: T) => string;
  mode?: (row: T) => string;
  maxParallel?: (row: T) => number;
}

type Filters = Record<string, unknown>;

function str(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function num(value: unknown): number | null {
  const text = str(value).trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateMs(value: unknown): number | null {
  const text = str(value).trim();
  if (text === "") return null;
  const ms = new Date(text).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function matchesSearch<T>(row: T, search: string, adapter: RowAdapter<T>): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return `${adapter.name(row)} ${adapter.id(row)}`.toLowerCase().includes(q);
}

function matchesFilters<T>(row: T, filters: Filters, adapter: RowAdapter<T>): boolean {
  const name = str(filters.name).trim().toLowerCase();
  if (name && !adapter.name(row).toLowerCase().includes(name)) return false;

  const id = str(filters.id).trim().toLowerCase();
  if (id && !adapter.id(row).toLowerCase().includes(id)) return false;

  const status = str(filters.status);
  if (status && status !== "all" && adapter.status(row) !== status) return false;

  const version = num(filters.version);
  if (version !== null && adapter.version(row) !== version) return false;

  const nodes = adapter.nodes(row);
  const nodesMin = num(filters.nodesMin);
  const nodesMax = num(filters.nodesMax);
  if (nodesMin !== null && nodes < nodesMin) return false;
  if (nodesMax !== null && nodes > nodesMax) return false;

  const connectors = adapter.connectors(row);
  const connectorsMin = num(filters.connectorsMin);
  const connectorsMax = num(filters.connectorsMax);
  if (connectorsMin !== null && connectors < connectorsMin) return false;
  if (connectorsMax !== null && connectors > connectorsMax) return false;

  const created = dateMs(adapter.createdAt(row));
  const createdFrom = dateMs(filters.createdFrom);
  const createdTo = dateMs(filters.createdTo);
  if (createdFrom !== null && (created === null || created < createdFrom)) return false;
  if (createdTo !== null && (created === null || created > createdTo + 86_400_000 - 1)) return false;

  const updated = dateMs(adapter.updatedAt(row));
  const updatedFrom = dateMs(filters.updatedFrom);
  const updatedTo = dateMs(filters.updatedTo);
  if (updatedFrom !== null && (updated === null || updated < updatedFrom)) return false;
  if (updatedTo !== null && (updated === null || updated > updatedTo + 86_400_000 - 1)) return false;

  // Workflow-only filters.
  if (adapter.flows) {
    const flows = adapter.flows(row);
    const flowsMin = num(filters.flowsMin);
    const flowsMax = num(filters.flowsMax);
    if (flowsMin !== null && flows < flowsMin) return false;
    if (flowsMax !== null && flows > flowsMax) return false;
  }
  if (adapter.dataSource) {
    const ds = str(filters.dataSource).trim().toLowerCase();
    if (ds && ds !== "all" && !adapter.dataSource(row).toLowerCase().includes(ds)) return false;
  }
  if (adapter.mode) {
    const mode = str(filters.mode);
    if (mode && mode !== "all" && adapter.mode(row) !== mode) return false;
  }
  if (adapter.maxParallel) {
    const mp = adapter.maxParallel(row);
    const mpMin = num(filters.maxParallelMin);
    const mpMax = num(filters.maxParallelMax);
    if (mpMin !== null && mp < mpMin) return false;
    if (mpMax !== null && mp > mpMax) return false;
  }
  return true;
}

function sortValue<T>(row: T, key: string, adapter: RowAdapter<T>): string | number {
  switch (key) {
    case "name": return adapter.name(row).toLowerCase();
    case "id": return adapter.id(row).toLowerCase();
    case "status": return adapter.status(row);
    case "version": return adapter.version(row) ?? 0;
    case "nodes": return adapter.nodes(row);
    case "connectors": return adapter.connectors(row);
    case "createdAt": return dateMs(adapter.createdAt(row)) ?? 0;
    case "updatedAt": return dateMs(adapter.updatedAt(row)) ?? 0;
    case "flows": return adapter.flows?.(row) ?? 0;
    case "dataSource": return (adapter.dataSource?.(row) ?? "").toLowerCase();
    case "mode": return adapter.mode?.(row) ?? "";
    case "maxParallel": return adapter.maxParallel?.(row) ?? 0;
    default: return adapter.name(row).toLowerCase();
  }
}

export interface AppliedTable<T> {
  paged: T[];
  total: number;
  totalPages: number;
  page: number;
}

/** Filter → sort → paginate. Page is clamped to the available range. */
export function applyTable<T>(rows: T[], state: TableState, adapter: RowAdapter<T>): AppliedTable<T> {
  let filtered = rows.filter((row) => matchesSearch(row, state.searchText, adapter) && matchesFilters(row, state.filters, adapter));

  if (state.sortBy) {
    const dir = state.sortDirection === "asc" ? 1 : -1;
    filtered = [...filtered].sort((a, b) => {
      const av = sortValue(a, state.sortBy as string, adapter);
      const bv = sortValue(b, state.sortBy as string, adapter);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  const page = Math.min(Math.max(1, state.page), totalPages);
  const paged = filtered.slice((page - 1) * state.pageSize, page * state.pageSize);
  return { paged, total, totalPages, page };
}

/** Validate range/date filter pairs and non-negative numbers (generic by key suffix). */
export function validateFilters(filters: Filters): string[] {
  const errors: string[] = [];
  const datePairs: [string, string, string][] = [
    ["createdFrom", "createdTo", "Created date"],
    ["updatedFrom", "updatedTo", "Updated date"]
  ];
  for (const [from, to, label] of datePairs) {
    const a = dateMs(filters[from]);
    const b = dateMs(filters[to]);
    if (a !== null && b !== null && a > b) errors.push(`${label} "from" must be on or before "to".`);
  }
  const numberPairs: [string, string, string][] = [
    ["nodesMin", "nodesMax", "Nodes"],
    ["connectorsMin", "connectorsMax", "Connectors"],
    ["flowsMin", "flowsMax", "Flows"],
    ["maxParallelMin", "maxParallelMax", "Max parallel"]
  ];
  for (const [min, max, label] of numberPairs) {
    const a = num(filters[min]);
    const b = num(filters[max]);
    if (a !== null && a < 0) errors.push(`${label} minimum must be 0 or more.`);
    if (b !== null && b < 0) errors.push(`${label} maximum must be 0 or more.`);
    if (a !== null && b !== null && a > b) errors.push(`${label} minimum cannot exceed maximum.`);
  }
  const version = num(filters.version);
  if (version !== null && version < 1) errors.push("Version must be 1 or more.");
  return errors;
}

/** Loads/persists a table's state from the application settings store. */
export function useTableState(key: "flows" | "workflows") {
  const [state, setState] = useState<TableState>(DEFAULT_TABLE_STATE);
  const loaded = useRef(false);

  useEffect(() => {
    window.playwrightFlowStudio.settings
      .get()
      .then((settings) => setState(settings.tables[key]))
      .catch(() => undefined)
      .finally(() => {
        loaded.current = true;
      });
  }, [key]);

  const persist = useCallback(
    (next: TableState) => {
      const tables = key === "flows" ? { flows: next } : { workflows: next };
      window.playwrightFlowStudio.settings.update({ tables }).catch(() => undefined);
    },
    [key]
  );

  const update = useCallback(
    (patch: Partial<TableState>) => {
      setState((prev) => {
        const next = { ...prev, ...patch };
        if (loaded.current) persist(next);
        return next;
      });
    },
    [persist]
  );

  const setPage = useCallback((page: number) => update({ page }), [update]);
  const setPageSize = useCallback((pageSize: number) => update({ pageSize, page: 1 }), [update]);
  const setSearch = useCallback((searchText: string) => update({ searchText, page: 1 }), [update]);
  const applyFilters = useCallback((filters: Filters) => update({ filters, page: 1 }), [update]);
  const clearAll = useCallback(() => update({ filters: {}, searchText: "", page: 1 }), [update]);
  const toggleSort = useCallback(
    (column: string) =>
      setState((prev) => {
        const sortDirection: SortDirection = prev.sortBy === column && prev.sortDirection === "asc" ? "desc" : "asc";
        const next = { ...prev, sortBy: column, sortDirection, page: 1 };
        if (loaded.current) persist(next);
        return next;
      }),
    [persist]
  );

  return { state, setPage, setPageSize, setSearch, applyFilters, clearAll, toggleSort };
}
