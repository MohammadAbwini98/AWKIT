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
 * design language: the same page wrapper, status badges, and loading/empty/error states. Presentation
 * only — pages keep their own domain logic, IPC calls, and handlers. All colour flows through
 * `global.css` tokens; badges pair an icon with text so status never relies on colour alone.
 */

/** Consistent Administration page wrapper: width, spacing, and a slot for a page-level banner. */
export function AdminPage({ banner, children }: { banner?: ReactNode; children: ReactNode }) {
  return (
    <div className="awkit-admin-page">
      {banner}
      {children}
    </div>
  );
}

/** A page-level notice (error / success / info) rendered above page content with the right ARIA role. */
export function AdminBanner({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const role = tone === "error" ? "alert" : "status";
  const cls = tone === "info" ? "form-message" : `form-message ${tone}`;
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
