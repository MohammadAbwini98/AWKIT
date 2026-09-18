import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Clock, Copy, Download, Eye, KeyRound, Monitor, RotateCw, ShieldCheck, ShieldX, Trash2, Upload } from "lucide-react";
import type { LicenseStatusView } from "@main/licensing/licenseRuntime";
import { LICENSE_REVALIDATE_INTERVAL_MS } from "@src/licensing/LicenseAttention";
import type { LicenseDocument } from "@src/licensing/LicenseTypes";
import { useSession } from "../../security/SessionContext";
import { routes } from "../../routes";
import {
  SysAdminHead,
  SysBanner,
  SysButton,
  SysCheckRow,
  SysChecklist,
  SysKv,
  SysKvItem,
  SysList,
  SysListRow,
  SysMetric,
  SysMetrics,
  SysPage,
  SysPanel,
  SysPanelEmpty,
  SysPanels,
  type SysTone
} from "../../components/system/SystemUI";
import { ReauthDialog } from "./ReauthDialog";
import { adminReasonMessage } from "./adminMessages";
import { adminStatusMeta } from "./components/AdminUi";

type Resp<T> = { ok: boolean; value?: T; reason?: string };
const licensing = () => window.playwrightFlowStudio.licensing;
const MINUTES_PER_DAY = 60 * 24;

/** Format a UTC ISO timestamp in the user's local time, or an em dash when absent/invalid. */
function localTime(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function localDate(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "Expires in" readout: the largest whole unit remaining (negative ⇒ already expired). */
function remainingParts(minutes?: number): { value: string; unit: string } {
  if (minutes == null) return { value: "—", unit: "" };
  if (minutes <= 0) return { value: "0", unit: "days" };
  const days = Math.floor(minutes / MINUTES_PER_DAY);
  if (days >= 1) return { value: String(days), unit: days === 1 ? "day" : "days" };
  const hours = Math.floor(minutes / 60);
  if (hours >= 1) return { value: String(hours), unit: hours === 1 ? "hour" : "hours" };
  return { value: String(minutes), unit: minutes === 1 ? "minute" : "minutes" };
}

function intervalLabel(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes >= 60 && minutes % 60 === 0) return `Every ${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `Every ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Licensing Administration page — per-machine, offline signed licensing. Independent of authentication and
 * RBAC: it shows and manages the installation's license, while access to the page/actions is a privileged
 * Super-User capability enforced in the trusted main process. Sensitive changes prompt re-authentication.
 */
export function LicensingPage() {
  const session = useSession();
  const sessionRef = session?.principal.sessionRef ?? "";
  const [report, setReport] = useState<LicenseStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingFn, setPendingFn] = useState<(() => Promise<Resp<unknown>>) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await licensing().getStatus(sessionRef);
    if (res.ok && res.value) {
      setReport(res.value);
      setDenied(false);
    } else if (res.reason === "NOT_AUTHORIZED") {
      setDenied(true);
    } else {
      setError(adminReasonMessage(res.reason));
    }
    setLoading(false);
  }, [sessionRef]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run a sensitive licensing call; on REAUTH_REQUIRED, prompt then retry once. */
  const run = useCallback(
    async (fn: () => Promise<Resp<unknown>>, successMsg: string) => {
      setError(null);
      setNotice(null);
      setBusy(true);
      try {
        const res = await fn();
        if (!res.ok && res.reason === "REAUTH_REQUIRED") {
          setPendingFn(() => fn);
          return;
        }
        if (!res.ok) {
          setError(adminReasonMessage(res.reason));
          return;
        }
        // Import/replace return an outcome; a rejected import is ok:true at IPC level but ok:false inside.
        const outcome = res.value as { ok?: boolean; rejectedReason?: string } | undefined;
        if (outcome && outcome.ok === false && outcome.rejectedReason) {
          setError(importRejectionMessage(outcome.rejectedReason));
        } else {
          setNotice(successMsg);
        }
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const fetchRequest = async () => {
    setError(null);
    setNotice(null);
    const res = await licensing().exportRequest(sessionRef);
    if (!res.ok || !res.value) {
      setError(adminReasonMessage(res.reason));
      return null;
    }
    return JSON.stringify(res.value, null, 2);
  };

  const onExportRequest = async () => {
    const json = await fetchRequest();
    if (!json) return;
    // Download the activation request the operator sends to the issuer (app-generated, no secrets).
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "specterstudio-activation-request.json";
    a.click();
    URL.revokeObjectURL(url);
    setNotice("Activation request exported. Send it to your license issuer.");
  };

  const onCopyRequest = async () => {
    const json = await fetchRequest();
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      setNotice("Activation request copied to the clipboard. Send it to your license issuer.");
    } catch {
      setError("Could not copy to the clipboard.");
    }
  };

  const onImportFile = async (file: File, replace: boolean) => {
    let doc: LicenseDocument;
    try {
      doc = JSON.parse(await file.text()) as LicenseDocument;
    } catch {
      setError("That file isn't a valid license file.");
      return;
    }
    const call = () =>
      replace
        ? licensing().replace({ sessionRef, license: doc })
        : licensing().import({ sessionRef, license: doc });
    await run(call, replace ? "License replaced." : "License imported.");
  };

  const copyMachineCode = async () => {
    if (!report?.machineFingerprintHash) return;
    try {
      await navigator.clipboard.writeText(report.machineFingerprintHash);
      setNotice("Machine code copied to clipboard.");
    } catch {
      setError("Could not copy to the clipboard.");
    }
  };

  const lic = report?.license;
  const shared = report?.source === "shared";
  const meta = report ? adminStatusMeta(report.status) : null;
  const remaining = remainingParts(lic ? report?.remainingMinutes : undefined);
  const expiringDays = report?.remainingMinutes != null ? Math.floor(report.remainingMinutes / MINUTES_PER_DAY) : null;
  const expiryTone: SysTone =
    !lic || report?.remainingMinutes == null
      ? "neutral"
      : report.remainingMinutes <= 0
        ? "danger"
        : report.remainingMinutes < MINUTES_PER_DAY * 14
          ? "warning"
          : "success";
  const operable = report?.status === "VALID" || report?.status === "EXPIRING_SOON";
  const clockWarning = report?.status === "CLOCK_INTEGRITY_WARNING";

  return (
    <SysPage className="licensing-page">
      <SysAdminHead
        title="Licensing"
        description={routes.find((route) => route.id === "licensing")?.description}
        actions={
          denied ? null : (
            <>
              <SysButton kind="primary" icon={Upload} disabled={busy || loading} onClick={() => fileInputRef.current?.click()}>
                Import license
              </SysButton>
              <SysButton kind="secondary" icon={Copy} disabled={busy || loading} onClick={() => void onCopyRequest()}>
                Copy activation request
              </SysButton>
              <SysButton
                kind="danger"
                icon={Ban}
                disabled={busy || !lic || shared}
                title={shared ? "A provisioned machine-wide license can't be revoked here." : "Revoke the installed license"}
                onClick={() => void run(() => licensing().revoke(sessionRef), "License revoked.")}
              >
                Revoke
              </SysButton>
            </>
          )
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".dat,.json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onImportFile(file, Boolean(lic));
        }}
      />

      {error ? <SysBanner tone="danger">{error}</SysBanner> : null}
      {notice ? <SysBanner tone="success">{notice}</SysBanner> : null}
      {report?.enforcement?.inGrace ? (
        <SysBanner tone="warning" icon={Clock}>
          This installation is running under a one-time {report.enforcement.graceDaysRemaining}-day activation period, which
          ends on {localTime(report.enforcement.graceEndsAtUtc ?? undefined)}. Saved workflows keep running until then. Export
          the activation request and import your license to keep running afterwards.
        </SysBanner>
      ) : null}
      {report?.enforcement && !report.enforcement.runsAllowed ? (
        <SysBanner tone="danger">
          Workflow execution is blocked on this machine until a valid license is activated. Editing, exporting, reports and
          settings remain available.
        </SysBanner>
      ) : null}
      {report?.status === "EXPIRING_SOON" && expiringDays != null ? (
        <SysBanner tone="warning" icon={Clock}>
          This license expires in {expiringDays} day{expiringDays === 1 ? "" : "s"}, on {localDate(lic?.expiresAtUtc)}. Generate an
          activation request, have it signed by an Issuer account, then import the returned license file.
        </SysBanner>
      ) : null}
      {report?.conflict ? (
        <SysBanner tone="info">
          Both a machine-wide (provisioned) and a per-user license are present. The provisioned license is in use. Remove one to
          resolve the conflict.
        </SysBanner>
      ) : null}

      {denied ? (
        <SysPanel icon={ShieldX} tone="danger" title="Not authorized">
          <SysPanelEmpty icon={ShieldX} title="Not authorized" hint="Licensing is managed by a Super User." />
        </SysPanel>
      ) : (
        <>
          <SysMetrics min={210} label="License summary">
            <SysMetric
              loading={loading}
              tone={meta?.tone ?? "neutral"}
              icon={meta?.icon ?? KeyRound}
              label="Status"
              value={meta?.label ?? "—"}
              detail={operable ? "Signature verified against the bundled public key" : report?.userAction}
            />
            <SysMetric
              loading={loading}
              tone={expiryTone}
              icon={Clock}
              label="Expires in"
              value={remaining.value}
              unit={remaining.unit}
              detail={lic ? localDate(lic.expiresAtUtc) : "No license installed"}
            />
            <SysMetric loading={loading} tone="info" icon={Monitor} label="Seats" value="1" unit="machine" detail="Per-machine offline license" />
            <SysMetric
              loading={loading}
              tone={clockWarning ? "warning" : "success"}
              icon={ShieldCheck}
              label="Clock integrity"
              value={clockWarning ? "Warning" : "OK"}
              detail={clockWarning ? "System clock moved backwards beyond tolerance" : "System clock within tolerance"}
            />
          </SysMetrics>

          <SysPanels min={640}>
            <SysPanel
              wide
              icon={KeyRound}
              title="License detail"
              meta={lic ? "Read-only values from the signed file" : report?.userAction ?? "No license installed"}
              actions={
                <SysButton
                  kind="smallDanger"
                  icon={Trash2}
                  disabled={busy || !lic || shared}
                  title={shared ? "A provisioned machine-wide license can't be removed here." : "Remove the installed local license"}
                  onClick={() => void run(() => licensing().remove(sessionRef), "License removed.")}
                >
                  Remove
                </SysButton>
              }
            >
              <SysKv min={220}>
                <SysKvItem
                  label="Machine code"
                  value={report?.machineFingerprintHash ?? "—"}
                  mono
                  hint={report ? `Fingerprint confidence: ${report.fingerprintConfidence}` : undefined}
                  onCopy={report?.machineFingerprintHash ? () => void copyMachineCode() : undefined}
                  copyLabel="Copy machine code"
                />
                <SysKvItem label="License type" value={lic?.licenseType ?? "—"} big />
                <SysKvItem label="License ID" value={lic?.licenseId ?? "—"} mono />
                <SysKvItem label="Serial" value={lic?.serialNumberMasked ?? "—"} mono />
                <SysKvItem label="Issued" value={localDate(lic?.issuedAtUtc)} />
                <SysKvItem label="Valid from" value={localDate(lic?.validFromUtc)} />
                <SysKvItem label="Expires" value={localDate(lic?.expiresAtUtc)} tone={lic && expiryTone !== "success" ? expiryTone : undefined} />
                <SysKvItem label="Last validated" value={localTime(report?.checkedAtUtc)} />
                <SysKvItem label="Source" value={shared ? "Machine-wide (provisioned)" : report?.source === "local" ? "This user" : "—"} />
                <SysKvItem label="Entitlements" value={lic?.entitlements?.length ? lic.entitlements.join(", ") : "—"} />
              </SysKv>
            </SysPanel>
          </SysPanels>

          <SysPanels>
            <SysPanel
              icon={Upload}
              title="Activation"
              meta="Offline, three steps"
              actions={
                <SysButton kind="small" icon={Download} disabled={busy || loading} onClick={() => void onExportRequest()}>
                  Export activation request
                </SysButton>
              }
            >
              <SysChecklist label="Activation steps">
                <SysCheckRow tone="success" title="Generate an activation request" sub="Encodes this machine's fingerprint and the app version — no personal data" badge="Ready" />
                <SysCheckRow tone="info" title="Have it signed by an Issuer" sub="Send the request file to a holder of the Issuer role" badge="Manual" />
                <SysCheckRow
                  tone={operable ? "success" : "warning"}
                  title="Import the returned license"
                  sub="The file is verified locally — no network call is made"
                  badge={operable ? "Installed" : "Ready"}
                />
              </SysChecklist>
            </SysPanel>

            <SysPanel
              icon={RotateCw}
              title="Revalidation"
              meta="When the license is re-checked"
              actions={
                <SysButton
                  kind="small"
                  icon={RotateCw}
                  disabled={busy || loading}
                  onClick={() => void run(() => licensing().revalidate(sessionRef), "License revalidated.")}
                >
                  Revalidate now
                </SysButton>
              }
            >
              <SysList label="Revalidation triggers">
                <SysListRow icon={Clock} title="On an interval" sub={`${intervalLabel(LICENSE_REVALIDATE_INTERVAL_MS)} · LICENSE_REVALIDATE_INTERVAL_MS`} badge="Active" badgeTone="success" />
                <SysListRow icon={Monitor} title="On window focus" sub="Catches a clock change while the app was in the background" badge="Active" badgeTone="success" />
                <SysListRow icon={Eye} title="On visibilitychange" sub="Same check when the window is restored" badge="Active" badgeTone="success" />
              </SysList>
            </SysPanel>
          </SysPanels>
        </>
      )}

      {pendingFn ? (
        <ReauthDialog
          sessionRef={sessionRef}
          onCancel={() => setPendingFn(null)}
          onConfirmed={() => {
            const fn = pendingFn;
            setPendingFn(null);
            if (fn) void run(fn, "Change applied.");
          }}
        />
      ) : null}
    </SysPage>
  );
}

function importRejectionMessage(reason: string): string {
  switch (reason) {
    case "SIGNATURE_INVALID":
      return "That license failed signature verification. Re-import the original signed file.";
    case "MACHINE_MISMATCH":
      return "That license is for a different machine. Request a license for this machine.";
    case "PRODUCT_MISMATCH":
      return "That license is for a different product.";
    case "UNSUPPORTED":
      return "That license needs a newer version of SpecterStudio.";
    case "CORRUPTED":
      return "That license file is unreadable.";
    default:
      return "That license could not be imported.";
  }
}
