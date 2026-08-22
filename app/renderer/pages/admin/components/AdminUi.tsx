import type { ReactNode } from "react";
import {
  Archive,
  Ban,
  CheckCircle2,
  Clock,
  HelpCircle,
  Inbox,
  Loader2,
  Lock,
  MonitorX,
  ShieldAlert,
  TriangleAlert,
  XCircle,
  type LucideIcon
} from "lucide-react";

/*
 * Shared Administration UI kit. Every Administration page composes these so the section reads as one
 * design language: the same visible page header, metric cards, section cards, status badges, and
 * loading/empty/error states. Presentation only — pages keep their own domain logic, IPC calls, and
 * handlers. All colour flows through `global.css` tokens; badges pair an icon with text so status
 * never relies on colour alone.
 */

/** Consistent Administration page wrapper: visible title/description, primary actions, optional banner. */
export function AdminPage({
  title,
  description,
  actions,
  banner,
  children
}: {
  title?: string;
  description?: string;
  /** Deprecated inline strip; pages should prefer the AdminMetrics card row. */
  summary?: ReactNode;
  actions?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="awkit-admin-page">
      {title ? (
        <header className="awkit-admin-header">
          <div className="awkit-admin-heading">
            <h1>{title}</h1>
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="awkit-admin-header-actions">{actions}</div> : null}
        </header>
      ) : null}
      {banner}
      {children}
    </div>
  );
}

export function AdminSummaryItem({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="awkit-admin-summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

/**
 * Responsive metric-card row. Cards are list items inside a labelled group so screen readers announce
 * the collection; the grid collapses from four-across to one-across purely through CSS.
 */
export function AdminMetrics({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="awkit-admin-metrics" role="list" aria-label={label}>
      {children}
    </div>
  );
}

type MetricTone = "neutral" | "success" | "warning" | "danger" | "info";

/** One summary/status card: concise label, prominent value, optional hint, optional tone+icon. */
export function AdminMetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral"
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  tone?: MetricTone;
}) {
  return (
    <div className={`awkit-admin-metric-card tone-${tone}`} role="listitem">
      <div className="awkit-admin-metric-top">
        {Icon ? (
          <span className="awkit-admin-metric-icon" aria-hidden="true">
            <Icon size={14} strokeWidth={2.2} />
          </span>
        ) : null}
        <span className="awkit-admin-metric-label">{label}</span>
      </div>
      <strong className="awkit-admin-metric-value">{value}</strong>
      {hint ? <span className="awkit-admin-metric-hint">{hint}</span> : null}
    </div>
  );
}

/**
 * Standard Administration content card: icon + section heading, optional description/meta line, and an
 * action row aligned to the heading. Composes with `.settings-card` chrome scoped by the admin styles.
 */
export function AdminSectionCard({
  title,
  icon: Icon,
  description,
  meta,
  actions,
  className,
  children
}: {
  title: string;
  icon?: LucideIcon;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`settings-card awkit-admin-card${className ? ` ${className}` : ""}`}>
      <div className="awkit-admin-card-head">
        <h2>{Icon ? <Icon size={16} aria-hidden="true" /> : null}{title}</h2>
        {meta ? <span className="awkit-admin-muted awkit-admin-card-meta">{meta}</span> : null}
        {actions ? <div className="awkit-admin-row-actions">{actions}</div> : null}
      </div>
      {description ? <p className="awkit-admin-muted awkit-admin-card-description">{description}</p> : null}
      {children}
    </section>
  );
}

/** A page-level notice (error / warning / success / info) rendered above page content with the right ARIA role. */
export function AdminBanner({ tone, children }: { tone: "error" | "warning" | "success" | "info"; children: ReactNode }) {
  const role = tone === "error" ? "alert" : "status";
  // `warning` reuses the existing `.form-message.warn` styling rather than introducing a parallel class.
  const cls = tone === "info" ? "form-message" : `form-message ${tone === "warning" ? "warn" : tone}`;
  return (
    <p className={cls} role={role}>
      {children}
    </p>
  );
}

type BadgeTone = "success" | "warning" | "danger" | "neutral" | "info";

interface StatusMeta {
  tone: BadgeTone;
  icon: LucideIcon;
  label: string;
}

/*
 * Canonical status vocabulary shared by user/session states and licensing states. Keys are normalised
 * to lower-case with non-alphanumerics stripped, so "Machine Mismatch", "machine_mismatch", and
 * "MACHINE_MISMATCH" all resolve to one entry.
 */
const STATUS_META: Record<string, StatusMeta> = {
  active: { tone: "success", icon: CheckCircle2, label: "Active" },
  valid: { tone: "success", icon: CheckCircle2, label: "Valid" },
  success: { tone: "success", icon: CheckCircle2, label: "Success" },
  denied: { tone: "warning", icon: Ban, label: "Denied" },
  disabled: { tone: "warning", icon: Ban, label: "Disabled" },
  locked: { tone: "warning", icon: Lock, label: "Locked" },
  expiringsoon: { tone: "warning", icon: Clock, label: "Expiring soon" },
  expiring: { tone: "warning", icon: Clock, label: "Expiring soon" },
  notyetvalid: { tone: "info", icon: Clock, label: "Not yet valid" },
  clockintegritywarning: { tone: "warning", icon: TriangleAlert, label: "Clock warning" },
  archived: { tone: "neutral", icon: Archive, label: "Archived" },
  notactivated: { tone: "neutral", icon: HelpCircle, label: "Not activated" },
  unsupportedversion: { tone: "neutral", icon: HelpCircle, label: "Unsupported version" },
  expired: { tone: "danger", icon: XCircle, label: "Expired" },
  revoked: { tone: "danger", icon: Ban, label: "Revoked" },
  invalid: { tone: "danger", icon: XCircle, label: "Invalid" },
  invalidsignature: { tone: "danger", icon: ShieldAlert, label: "Invalid signature" },
  machinemismatch: { tone: "danger", icon: MonitorX, label: "Machine mismatch" },
  mismatch: { tone: "danger", icon: MonitorX, label: "Machine mismatch" },
  corrupted: { tone: "danger", icon: TriangleAlert, label: "Corrupted" },
  failure: { tone: "danger", icon: XCircle, label: "Failure" }
};

function normaliseStatus(status: string): string {
  return status.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Shared status badge for Administration. Pass the raw status string (user status, audit result, or a
 * licensing status code); an unknown value falls back to a neutral badge showing the raw text, so a new
 * backend status never renders as a broken chip. `label` overrides the display text when needed.
 */
export function AdminStatusBadge({ status, label }: { status: string; label?: string }) {
  const meta = STATUS_META[normaliseStatus(status)];
  const tone = meta?.tone ?? "neutral";
  const Icon = meta?.icon ?? HelpCircle;
  const text = label ?? meta?.label ?? status;
  return (
    <span className={`awkit-admin-badge tone-${tone}`}>
      <Icon size={12} strokeWidth={2.4} aria-hidden="true" />
      {text}
    </span>
  );
}

/** Shared inline loading state — replaces the ad-hoc reuse of the login spinner on Administration pages. */
export function AdminLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="awkit-admin-state" role="status" aria-live="polite">
      <Loader2 size={20} className="awkit-admin-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** Shared empty / no-results state. */
export function AdminEmpty({
  icon: Icon = Inbox,
  title,
  hint
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
}) {
  return (
    <div className="awkit-admin-state awkit-admin-state-empty">
      <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
      <strong>{title}</strong>
      {hint ? <span className="awkit-admin-muted">{hint}</span> : null}
    </div>
  );
}
