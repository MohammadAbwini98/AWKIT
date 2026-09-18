import {
  useId,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type FormEvent,
  type HTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes
} from "react";
import {
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  Inbox,
  Play,
  Search,
  TriangleAlert,
  X,
  XCircle,
  type LucideIcon
} from "lucide-react";
import { useModalFocusContract } from "../shared/useModalFocusContract";

/*
 * SpecterStudio system blocks — the approved "SpecterStudio (offline)" design vocabulary shared by the
 * Administration and operational pages: admin frame, banners, section headers, metric cards, panels
 * (list / key-value / checklist / bars / timeline / form), badges, the titled table card with sortable
 * headers, selection and pagination, the filter card, and the modal dialog. Presentation only: pages
 * keep their own state, IPC calls and handlers. Every color resolves through global.css tokens.
 */

export type SysTone = "success" | "warning" | "danger" | "info" | "running" | "neutral";

const TONE_ICON: Record<SysTone, LucideIcon> = {
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: XCircle,
  info: HelpCircle,
  running: Play,
  neutral: HelpCircle
};

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
const minStyle = (min: number | undefined, style?: CSSProperties) =>
  (min ? { ...style, "--sys-min": `${min}px` } : style) as CSSProperties | undefined;

// ── Page frame ────────────────────────────────────────────────────────────────

export function SysPage({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cx("page sys-page", className)} {...rest}>
      {children}
    </section>
  );
}

/** Administration page frame: visible 22px title, description and the page's primary actions. */
export function SysAdminHead({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="sys-admin-head">
      <div className="sys-admin-titles">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="sys-admin-actions">{actions}</div> : null}
    </header>
  );
}

// ── Buttons ───────────────────────────────────────────────────────────────────

export type SysButtonKind = "primary" | "secondary" | "danger" | "ghost" | "small" | "smallPrimary" | "smallDanger";

export function SysButton({
  kind = "secondary",
  icon: Icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: SysButtonKind; icon?: LucideIcon }) {
  const small = kind === "small" || kind === "smallPrimary" || kind === "smallDanger";
  return (
    <button type={type} className={cx("sys-btn", `sys-btn-${kind}`, className)} {...rest}>
      {Icon ? <Icon size={small ? 13 : 15} strokeWidth={1.9} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** 28px icon-only action (table rows, list rows, dialog close). The label is the accessible name. */
export function SysIconButton({
  icon: Icon,
  label,
  tone,
  className,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { icon: LucideIcon; label: string; tone?: "danger" }) {
  return (
    <button
      type={type}
      className={cx("sys-icon-btn", tone === "danger" && "is-danger", className)}
      aria-label={label}
      title={rest.title ?? label}
      {...rest}
    >
      <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
}

// ── Banner / section header ───────────────────────────────────────────────────

export function SysBanner({
  tone,
  icon,
  children,
  actionLabel,
  onAction,
  className,
  ...rest
}: {
  tone: SysTone;
  icon?: LucideIcon;
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  const Icon = icon ?? TONE_ICON[tone];
  return (
    <div className={cx("sys-banner", `sys-tone-${tone}`, className)} role={tone === "danger" ? "alert" : "status"} {...rest}>
      <span className="sys-banner-icon" aria-hidden="true">
        <Icon size={15} strokeWidth={2} />
      </span>
      <span className="sys-banner-text">{children}</span>
      {actionLabel && onAction ? (
        <button type="button" className="sys-banner-action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function SysSection({ icon: Icon, title, text, actions }: { icon?: LucideIcon; title: string; text?: string; actions?: ReactNode }) {
  return (
    <div className="sys-section">
      {Icon ? (
        <span className="sys-tile sys-tile-30 sys-tone-running" aria-hidden="true">
          <Icon size={16} strokeWidth={1.9} />
        </span>
      ) : null}
      <div className="sys-section-titles">
        <h2>{title}</h2>
        {text ? <span>{text}</span> : null}
      </div>
      {actions ? <div className="sys-section-actions">{actions}</div> : null}
    </div>
  );
}

// ── Tiles, badges, chips ──────────────────────────────────────────────────────

export function SysTile({ tone, icon: Icon, size = 30, iconSize }: { tone: SysTone; icon: LucideIcon; size?: 26 | 28 | 30 | 40; iconSize?: number }) {
  return (
    <span className={cx("sys-tile", `sys-tile-${size}`, `sys-tone-${tone}`)} aria-hidden="true">
      <Icon size={iconSize ?? (size === 26 || size === 28 ? 14 : size === 40 ? 19 : 15)} strokeWidth={size === 26 ? 2.2 : 1.9} />
    </span>
  );
}

/** Tone pill with a leading status glyph. `md` is the table-cell badge, `sm` the list/dialog badge. */
export function SysBadge({
  tone = "neutral",
  icon,
  size = "md",
  className,
  children,
  title
}: {
  tone?: SysTone;
  icon?: LucideIcon | null;
  size?: "md" | "sm";
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  const Icon = icon === null ? null : icon ?? TONE_ICON[tone];
  return (
    <span className={cx("sys-badge", size === "sm" && "is-sm", `sys-tone-${tone}`, className)} title={title}>
      {Icon ? <Icon size={size === "sm" ? 11 : 12} strokeWidth={size === "sm" ? 2.4 : 2.3} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function SysChips({ items }: { items: string[] }) {
  return (
    <span className="sys-chips">
      {items.map((item) => (
        <span className="sys-chip" key={item}>
          {item}
        </span>
      ))}
    </span>
  );
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export function SysMetrics({ min = 232, label, children }: { min?: number; label: string; children: ReactNode }) {
  return (
    <div className="sys-metrics" role="list" aria-label={label} style={minStyle(min)}>
      {children}
    </div>
  );
}

function sparkPoints(values: number[], width: number, height: number): string {
  if (values.length < 2) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  return values
    .map((value, index) => `${((index * width) / (values.length - 1)).toFixed(1)},${(height - 3 - ((value - min) / span) * (height - 6)).toFixed(1)}`)
    .join(" ");
}

export function SysMetric({
  tone = "info",
  icon: Icon,
  label,
  value,
  unit,
  detail,
  trend,
  trendGood,
  spark,
  loading
}: {
  tone?: SysTone;
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  unit?: string;
  detail?: ReactNode;
  trend?: string;
  trendGood?: boolean;
  spark?: number[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="sys-metric" role="listitem" aria-busy="true" aria-label={`${label} loading`}>
        <span className="sys-shimmer" style={{ width: "44%", height: 9 }} />
        <span className="sys-shimmer" style={{ width: "66%", height: 22 }} />
        <span className="sys-shimmer" style={{ width: "80%", height: 8 }} />
      </div>
    );
  }
  const up = trend ? !/^[−-]/.test(trend) : false;
  const good = trendGood ?? up;
  return (
    <div className="sys-metric" role="listitem">
      <div className="sys-metric-head">
        <SysTile tone={tone} icon={Icon} size={26} />
        <span className="sys-metric-label">{label}</span>
        {trend ? (
          <span className={cx("sys-metric-trend", `sys-tone-${good ? "success" : "danger"}`)}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: up ? "none" : "rotate(180deg)" }}>
              <path d="M12 19V5" />
              <path d="M6 11l6-6 6 6" />
            </svg>
            {trend}
          </span>
        ) : null}
      </div>
      <div className="sys-metric-value">
        <strong>{value}</strong>
        {unit ? <span>{unit}</span> : null}
      </div>
      <div className="sys-metric-foot">
        <span>{detail}</span>
        {spark && spark.length > 1 ? (
          <svg className="sys-metric-spark" viewBox="0 0 160 40" preserveAspectRatio="none" role="img" aria-label={`${label} trend`}>
            <polyline points={sparkPoints(spark, 160, 40)} fill="none" stroke="var(--awkit-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
      </div>
    </div>
  );
}

// ── Panels ────────────────────────────────────────────────────────────────────

export function SysPanels({ min = 420, children, className }: { min?: number; children: ReactNode; className?: string }) {
  return (
    <div className={cx("sys-panels", className)} style={minStyle(min)}>
      {children}
    </div>
  );
}

export function SysPanel({
  tone = "running",
  icon,
  title,
  meta,
  actions,
  wide,
  className,
  children,
  ...rest
}: {
  tone?: SysTone;
  icon?: LucideIcon;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "title" | "children">) {
  const headingId = useId();
  return (
    <section className={cx("sys-panel", wide && "is-wide", className)} aria-labelledby={headingId} {...rest}>
      <div className="sys-panel-head">
        {icon ? <SysTile tone={tone} icon={icon} size={30} iconSize={16} /> : null}
        <div className="sys-panel-titles">
          <h3 id={headingId}>{title}</h3>
          {meta ? <span>{meta}</span> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function SysPanelEmpty({ icon: Icon = Inbox, title, hint, children }: { icon?: LucideIcon; title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="sys-panel-empty">
      <span className="sys-tile sys-tile-36 sys-tone-running" aria-hidden="true">
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <strong>{title}</strong>
      {hint ? <span>{hint}</span> : null}
      {children}
    </div>
  );
}

// ── List rows ─────────────────────────────────────────────────────────────────

export function SysList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="sys-list" role="list" aria-label={label}>
      {children}
    </div>
  );
}

export function SysListRow({
  tone = "running",
  icon,
  title,
  sub,
  badge,
  badgeTone = "neutral",
  value,
  actions,
  className,
  titleAttr,
  children
}: {
  tone?: SysTone;
  icon?: LucideIcon;
  title: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  badgeTone?: SysTone;
  value?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleAttr?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cx("sys-list-row", className)} role="listitem">
      {icon ? <SysTile tone={tone} icon={icon} size={28} /> : null}
      <span className="sys-list-text">
        <span className="sys-list-title" title={titleAttr}>
          {title}
        </span>
        {sub ? <span className="sys-list-sub">{sub}</span> : null}
        {children}
      </span>
      {badge ? (
        <SysBadge tone={badgeTone} size="sm">
          {badge}
        </SysBadge>
      ) : null}
      {value !== undefined && value !== null && value !== "" ? <span className="sys-list-value">{value}</span> : null}
      {actions ? <span className="sys-list-actions">{actions}</span> : null}
    </div>
  );
}

// ── Key / value tiles ─────────────────────────────────────────────────────────

export function SysKv({ min = 180, children }: { min?: number; children: ReactNode }) {
  return (
    <div className="sys-kv" style={minStyle(min)}>
      {children}
    </div>
  );
}

export function SysKvItem({
  label,
  value,
  hint,
  mono,
  big,
  tone,
  onCopy,
  copyLabel
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  mono?: boolean;
  big?: boolean;
  tone?: SysTone;
  onCopy?: () => void;
  copyLabel?: string;
}) {
  return (
    <div className="sys-kv-item">
      <span className="sys-kv-label">{label}</span>
      <span className={cx("sys-kv-value", mono && "is-mono", big && "is-big", tone && `sys-ink-${tone}`)}>{value}</span>
      {hint ? <span className="sys-kv-hint">{hint}</span> : null}
      {onCopy ? (
        <button type="button" className="sys-kv-copy" onClick={onCopy} aria-label={copyLabel ?? `Copy ${label}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M15 5H6a2 2 0 0 0-2 2v9" />
          </svg>
          Copy
        </button>
      ) : null}
    </div>
  );
}

// ── Checklist ─────────────────────────────────────────────────────────────────

export function SysChecklist({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="sys-checklist" role="list" aria-label={label}>
      {children}
    </div>
  );
}

export function SysCheckRow({ tone = "success", title, sub, badge }: { tone?: SysTone; title: ReactNode; sub?: ReactNode; badge?: ReactNode }) {
  const Icon = TONE_ICON[tone];
  return (
    <div className="sys-check-row" role="listitem">
      <span className={cx("sys-check-mark", `sys-tone-${tone}`)} aria-hidden="true">
        <Icon size={13} strokeWidth={2.4} />
      </span>
      <span className="sys-check-text">
        <span className="sys-check-title">{title}</span>
        {sub ? <span className="sys-check-sub">{sub}</span> : null}
      </span>
      {badge ? <span className={cx("sys-check-badge", `sys-ink-${tone}`)}>{badge}</span> : null}
    </div>
  );
}

// ── Bars ──────────────────────────────────────────────────────────────────────

export function SysBars({ rows, label }: { rows: Array<{ label: string; value: ReactNode; raw: number; color?: string }>; label?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.raw));
  return (
    <div className="sys-bars" role="list" aria-label={label}>
      {rows.map((row) => (
        <div className="sys-bar-row" role="listitem" key={row.label}>
          <span className="sys-bar-label">{row.label}</span>
          <span className="sys-bar-track" aria-hidden="true">
            <span className="sys-bar-fill" style={{ width: `${Math.max(2, (row.raw / max) * 100)}%`, background: row.color }} />
          </span>
          <span className="sys-bar-value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────

export function SysTimeline({ children, className, label, ...rest }: { children: ReactNode; className?: string; label?: string } & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  return (
    <div className={cx("sys-timeline", className)} role="list" aria-label={label} {...rest}>
      {children}
    </div>
  );
}

export function SysTimelineRow({
  tone = "running",
  title,
  badge,
  time,
  sub,
  live,
  percent,
  barLabel,
  actions,
  className,
  children
}: {
  tone?: SysTone;
  title: ReactNode;
  badge?: ReactNode;
  time?: ReactNode;
  sub?: ReactNode;
  live?: boolean;
  percent?: number;
  barLabel?: string;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <div className={cx("sys-timeline-row", className)} role="listitem">
      <span className="sys-timeline-rail" aria-hidden="true">
        <span className={cx("sys-timeline-dot", `sys-tone-${tone}`, live && "is-live")} />
        <span className="sys-timeline-line" />
      </span>
      <span className="sys-timeline-body">
        <span className="sys-timeline-head">
          <span className="sys-timeline-title">{title}</span>
          {badge ? (
            <span className={cx("sys-timeline-badge", `sys-tone-${tone}`)}>
              <Icon size={11} strokeWidth={2.4} aria-hidden="true" />
              {badge}
            </span>
          ) : null}
          <span className="sys-spacer" />
          {time ? <span className="sys-timeline-time">{time}</span> : null}
          {actions}
        </span>
        {sub ? <span className="sys-timeline-sub">{sub}</span> : null}
        {percent !== undefined ? (
          <span className="sys-timeline-progress">
            <span className="sys-timeline-track" aria-hidden="true">
              <span className={cx("sys-timeline-fill", `sys-tone-${tone}`)} style={{ width: `${Math.max(2, percent)}%` }} />
            </span>
            {barLabel ? <span className="sys-timeline-bar-label">{barLabel}</span> : null}
          </span>
        ) : null}
        {children}
      </span>
    </div>
  );
}

// ── Form controls ─────────────────────────────────────────────────────────────

export function SysFormGrid({ min = 220, children, className }: { min?: number; children: ReactNode; className?: string }) {
  return (
    <div className={cx("sys-form-grid", className)} style={minStyle(min)}>
      {children}
    </div>
  );
}

/**
 * Label + control + hint. The control inside should carry `className="sys-control"` (or use SysSelect).
 * `group` renders a labelled `role="group"` container instead of a <label>, for multi-control fields
 * (check pills) where a wrapping label would toggle the first checkbox on every click.
 */
export function SysField({
  label,
  hint,
  invalid,
  wide,
  group,
  className,
  children
}: {
  label: string;
  hint?: ReactNode;
  invalid?: boolean;
  wide?: boolean;
  group?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const classes = cx("sys-field", wide && "is-wide", invalid && "is-invalid", className);
  const body = (
    <>
      <span className="sys-field-label">{label}</span>
      {children}
      {hint ? <span className="sys-field-hint">{hint}</span> : null}
    </>
  );
  return group ? (
    <div className={classes} role="group" aria-label={label}>
      {body}
    </div>
  ) : (
    <label className={classes}>{body}</label>
  );
}

export function SysSelect({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="sys-select">
      <select className={cx("sys-control", className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="sys-select-chevron" size={14} strokeWidth={2.1} aria-hidden="true" />
    </span>
  );
}

export function SysSwitch({
  checked,
  onToggle,
  label,
  hint,
  wide,
  disabled,
  title,
  className
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  hint?: ReactNode;
  wide?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <div className={cx("sys-switch-field", wide && "is-wide", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={cx("sys-switch", checked && "is-on")}
        disabled={disabled}
        onClick={onToggle}
        title={title}
      >
        <span className="sys-switch-thumb" />
      </button>
      <span className="sys-switch-text">
        <span className="sys-switch-label">{label}</span>
        {hint ? <span className="sys-switch-hint">{hint}</span> : null}
      </span>
    </div>
  );
}

export function SysFormFooter({ children }: { children: ReactNode }) {
  return <div className="sys-form-footer">{children}</div>;
}

/** Pill checkbox (dialog role pickers). */
export function SysCheckPill({ checked, onChange, children, title, disabled }: { checked: boolean; onChange: () => void; children: ReactNode; title?: string; disabled?: boolean }) {
  return (
    <label className={cx("sys-check-pill", checked && "is-on", disabled && "is-disabled")} title={title}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      {children}
    </label>
  );
}

// ── Table card ────────────────────────────────────────────────────────────────

export function SysTableCard({
  title,
  selectionCount = 0,
  actions,
  children,
  className,
  ...rest
}: {
  title: string;
  selectionCount?: number;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLElement>, "title" | "children">) {
  const headingId = useId();
  return (
    <section className={cx("sys-table-card", className)} aria-labelledby={headingId} {...rest}>
      <div className="sys-table-head">
        <h2 id={headingId} className="sys-table-title">
          {title}
        </h2>
        {selectionCount > 0 ? <span className="sys-selection-pill">{selectionCount} selected</span> : null}
        <span className="sys-spacer" />
        {actions}
      </div>
      {children}
    </section>
  );
}

export function SysTable({ minWidth = 720, id, caption, children }: { minWidth?: number; id?: string; caption?: string; children: ReactNode }) {
  return (
    <div className="sys-table-scroll" id={id}>
      <table className="sys-table" style={{ minWidth }}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export type SysSortDir = "asc" | "desc";
export interface SysSortState {
  key: string;
  dir: SysSortDir;
}

export function useSysSort(initialKey: string, initialDir: SysSortDir = "asc") {
  const [sort, setSort] = useState<SysSortState>({ key: initialKey, dir: initialDir });
  const toggle = (key: string) =>
    setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  return { sort, toggle };
}

/** Sort rows by a key accessor table (strings compare with localeCompare, numbers numerically). */
export function sortRows<T>(rows: T[], sort: SysSortState, accessors: Record<string, (row: T) => string | number>): T[] {
  const read = accessors[sort.key];
  if (!read) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = read(a);
    const bv = read(b);
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

export function SysTh({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  width
}: {
  label: string;
  sortKey?: string;
  sort?: SysSortState;
  onSort?: (key: string) => void;
  align?: "left" | "right" | "center";
  width?: number | string;
}) {
  const sortable = Boolean(sortKey && onSort);
  const active = sortable && sort?.key === sortKey;
  return (
    <th
      scope="col"
      className={cx("sys-th", align !== "left" && `is-${align}`)}
      style={width !== undefined ? { width } : undefined}
      aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : sortable ? "none" : undefined}
    >
      {sortable ? (
        <button type="button" className={cx("sys-th-button", active && "is-active")} onClick={() => sortKey && onSort?.(sortKey)}>
          {label}
          <ChevronDown className={cx("sys-th-caret", active && sort?.dir === "asc" && "is-asc")} size={12} strokeWidth={2.5} aria-hidden="true" />
        </button>
      ) : (
        <span className="sys-th-button">{label}</span>
      )}
    </th>
  );
}

export function SysThCheck({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <th scope="col" className="sys-th sys-th-check">
      <input type="checkbox" className="sys-checkbox" aria-label="Select all rows" checked={checked} onChange={onChange} disabled={disabled} />
    </th>
  );
}

export function SysTdCheck({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <td className="sys-td-check" onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" className="sys-checkbox" aria-label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </td>
  );
}

export function SysMainCell({ tone = "running", icon, text, sub, textTitle }: { tone?: SysTone; icon: LucideIcon; text: ReactNode; sub?: ReactNode; textTitle?: string }) {
  return (
    <span className="sys-main-cell">
      <SysTile tone={tone} icon={icon} size={30} iconSize={14} />
      <span className="sys-main-text">
        <span className="sys-main-title" title={textTitle}>
          {text}
        </span>
        {sub ? <span className="sys-main-sub">{sub}</span> : null}
      </span>
    </span>
  );
}

export function SysCellText({
  children,
  muted,
  strong,
  mono,
  num,
  wrap,
  title
}: {
  children: ReactNode;
  muted?: boolean;
  strong?: boolean;
  mono?: boolean;
  num?: boolean;
  wrap?: boolean;
  title?: string;
}) {
  return (
    <span className={cx("sys-cell-text", muted && "is-muted", strong && "is-strong", mono && "is-mono", num && "is-num", wrap && "is-wrap")} title={title}>
      {children}
    </span>
  );
}

export function SysCellActions({ children }: { children: ReactNode }) {
  return (
    <span className="sys-cell-actions" onClick={(event) => event.stopPropagation()}>
      {children}
    </span>
  );
}

export function SysTableEmpty({
  icon: Icon = Inbox,
  title,
  hint,
  actionLabel,
  onAction,
  id
}: {
  icon?: LucideIcon;
  title: string;
  hint?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  id?: string;
}) {
  return (
    <div className="sys-table-empty" id={id}>
      <span className="sys-tile sys-tile-40 sys-tone-neutral" aria-hidden="true">
        <Icon size={20} strokeWidth={1.8} />
      </span>
      <strong>{title}</strong>
      {hint ? <span>{hint}</span> : null}
      {actionLabel && onAction ? (
        <button type="button" className="sys-btn sys-btn-secondary sys-table-empty-action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export const SYS_PAGE_SIZES = [10, 25, 50, 100] as const;

/** Client-side paging over an already-filtered row list; the page clamps as rows disappear. */
export function useSysPaging(total: number, initialSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  return {
    page: current,
    pageSize,
    totalPages,
    setPage,
    setPageSize: (size: number) => {
      setPageSizeState(size);
      setPage(1);
    },
    slice: <T,>(rows: T[]) => rows.slice((current - 1) * pageSize, current * pageSize)
  };
}

export function SysPagination({
  total,
  noun,
  page,
  pageSize,
  totalPages,
  onPage,
  onPageSize
}: {
  total: number;
  noun: string;
  page: number;
  pageSize: number;
  totalPages: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const count = Math.min(4, totalPages);
  const start = Math.min(Math.max(1, page - 1), Math.max(1, totalPages - count + 1));
  const numbers = Array.from({ length: count }, (_, index) => start + index);
  return (
    <div className="sys-table-foot">
      <span className="sys-table-range">{total === 0 ? `0 ${noun}` : `${first}–${last} of ${total} ${noun}`}</span>
      <label className="sys-table-rows">
        Rows
        <span className="sys-select sys-select-sm">
          <select value={pageSize} aria-label="Rows per page" onChange={(event) => onPageSize(Number(event.target.value))}>
            {SYS_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <ChevronDown className="sys-select-chevron" size={12} strokeWidth={2.2} aria-hidden="true" />
        </span>
      </label>
      <span className="sys-spacer" />
      <div className="sys-pages">
        <button type="button" className="sys-page-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ‹
        </button>
        {numbers.map((number) => (
          <button
            type="button"
            key={number}
            className={cx("sys-page-btn", number === page && "is-current")}
            aria-label={`Page ${number}`}
            aria-current={number === page ? "page" : undefined}
            onClick={() => onPage(number)}
          >
            {number}
          </button>
        ))}
        <button type="button" className="sys-page-btn" aria-label="Next page" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          ›
        </button>
      </div>
    </div>
  );
}

// ── Filters ───────────────────────────────────────────────────────────────────

export interface SysFilterField {
  key: string;
  label: string;
  type: "select" | "text" | "number" | "date";
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export type SysFilterValues = Record<string, string>;

/** Draft/applied filter state: typing edits the draft; Apply commits it; chips remove one key. */
export function useSysFilters() {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<SysFilterValues>({});
  const [applied, setApplied] = useState<SysFilterValues>({});
  return {
    search,
    setSearch,
    draft,
    applied,
    setDraftValue: (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value })),
    apply: () => setApplied(Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== "" && value !== "all"))),
    clear: () => {
      setDraft({});
      setApplied({});
      setSearch("");
    },
    remove: (key: string) => {
      setApplied((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setDraft((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    },
    active: Object.keys(applied).length > 0 || search.trim().length > 0
  };
}

export function SysFilters({
  label,
  searchPlaceholder,
  fields,
  state
}: {
  label: string;
  searchPlaceholder: string;
  fields: SysFilterField[];
  state: ReturnType<typeof useSysFilters>;
}) {
  const chips = useMemo(
    () =>
      Object.entries(state.applied).map(([key, value]) => {
        const field = fields.find((candidate) => candidate.key === key);
        const option = field?.options?.find((candidate) => candidate.value === value);
        return { key, label: `${field?.label ?? key}: ${option?.label ?? value}` };
      }),
    [fields, state.applied]
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    state.apply();
  };
  return (
    <form className="sys-filters" role="search" aria-label={label} onSubmit={submit}>
      <div className="sys-filters-row">
        <span className="sys-search">
          <Search size={15} strokeWidth={1.9} aria-hidden="true" />
          <input
            type="text"
            value={state.search}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder.replace(/…$/, "")}
            onChange={(event) => state.setSearch(event.target.value)}
          />
        </span>
        {fields.map((field) => (
          <label className="sys-filter-field" key={field.key}>
            <span>{field.label}</span>
            {field.type === "select" ? (
              <span className="sys-select sys-select-sm">
                <select value={state.draft[field.key] ?? ""} onChange={(event) => state.setDraftValue(field.key, event.target.value)}>
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="sys-select-chevron" size={13} strokeWidth={2.2} aria-hidden="true" />
              </span>
            ) : (
              <input
                type={field.type}
                min={field.type === "number" ? 0 : undefined}
                placeholder={field.placeholder}
                value={state.draft[field.key] ?? ""}
                onChange={(event) => state.setDraftValue(field.key, event.target.value)}
              />
            )}
          </label>
        ))}
        <span className="sys-filter-buttons">
          <button type="submit" className="sys-filter-apply">
            Apply
          </button>
          <button type="button" className="sys-filter-clear" onClick={state.clear}>
            Clear
          </button>
        </span>
      </div>
      {chips.length ? (
        <div className="sys-applied">
          <span className="sys-applied-label">Applied</span>
          {chips.map((chip) => (
            <span className="sys-applied-chip" key={chip.key}>
              {chip.label}
              <button type="button" aria-label={`Remove ${chip.label}`} onClick={() => state.remove(chip.key)}>
                <X size={9} strokeWidth={3} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </form>
  );
}

// ── Modal dialog ──────────────────────────────────────────────────────────────

/**
 * Design dialog: tone icon tile, title, message, optional body, right-aligned actions. Implements the
 * shared modal focus contract (focus in, Tab trap, Escape, focus return) through useModalFocusContract.
 * Pass `onSubmit` to render the dialog as a <form> so Enter submits.
 */
export function SysModal({
  title,
  message,
  tone = "running",
  icon,
  width = 520,
  role = "dialog",
  onClose,
  actions,
  children,
  className,
  onSubmit,
  closeDisabled
}: {
  title: string;
  message?: ReactNode;
  tone?: SysTone;
  icon: LucideIcon;
  width?: number;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  closeDisabled?: boolean;
}) {
  const titleId = useId();
  const messageId = useId();
  const close = () => {
    if (!closeDisabled) onClose();
  };
  const { dialogRef } = useModalFocusContract<HTMLFormElement>(close);
  return (
    <div className="sys-modal-backdrop" role="presentation" onMouseDown={close}>
      <form
        ref={dialogRef}
        className={cx("sys-modal", className)}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        tabIndex={-1}
        style={{ width }}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.(event);
        }}
      >
        <div className="sys-modal-head">
          <SysTile tone={tone} icon={icon} size={40} />
          <div className="sys-modal-titles">
            <h3 id={titleId}>{title}</h3>
            {message ? <p id={messageId}>{message}</p> : null}
          </div>
          <button type="button" className="sys-icon-btn sys-modal-close" aria-label="Close" title="Close" onClick={close} disabled={closeDisabled}>
            <X size={13} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
        {children}
        {actions ? <div className="sys-modal-actions">{actions}</div> : null}
      </form>
    </div>
  );
}

export function SysModalFields({ children, min = 190 }: { children: ReactNode; min?: number }) {
  return (
    <div className="sys-modal-fields" style={minStyle(min)}>
      {children}
    </div>
  );
}

export function SysModalBody({ children }: { children: ReactNode }) {
  return <div className="sys-modal-body">{children}</div>;
}

export function SysModalRows({ children }: { children: ReactNode }) {
  return <div className="sys-modal-rows">{children}</div>;
}

export function SysModalRow({ label, value, mono, badge, badgeTone = "neutral" }: { label: string; value: ReactNode; mono?: boolean; badge?: string; badgeTone?: SysTone }) {
  return (
    <div className="sys-modal-row">
      <span className="sys-modal-row-label">{label}</span>
      <span className={cx("sys-modal-row-value", mono && "is-mono")}>{value}</span>
      {badge ? (
        <SysBadge tone={badgeTone} size="sm">
          {badge}
        </SysBadge>
      ) : null}
    </div>
  );
}

/** Inline error inside a dialog body (role=alert so it is announced). */
export function SysFormError({ children }: { children: ReactNode }) {
  return (
    <p className="sys-form-error" role="alert">
      {children}
    </p>
  );
}

/** Shared selection model for selectable tables: ids that no longer resolve simply drop out. */
export function useSysSelection(visibleIds: string[]) {
  const [selected, setSelected] = useState<string[]>([]);
  const live = selected.filter((id) => visibleIds.includes(id));
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => live.includes(id));
  return {
    selected: live,
    isSelected: (id: string) => live.includes(id),
    toggle: (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id])),
    toggleAll: () => setSelected(allSelected ? [] : [...visibleIds]),
    allSelected,
    clear: () => setSelected([])
  };
}
