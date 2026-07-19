import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Download, KeyRound, RotateCw, ShieldX, Trash2, Upload } from "lucide-react";
import type { LicenseStatusReport } from "@src/licensing/LicenseService";
import type { LicenseDocument } from "@src/licensing/LicenseTypes";
import { useSession } from "../../security/SessionContext";
import { usePageChrome } from "../../state/pageChrome";
import { ReauthDialog } from "./ReauthDialog";
import { adminReasonMessage } from "./adminMessages";
import { AdminBanner, AdminEmpty, AdminLoading, AdminPage, AdminStatusBadge } from "./components/AdminUi";

type Resp<T> = { ok: boolean; value?: T; reason?: string };
const licensing = () => window.playwrightFlowStudio.licensing;

/** Format a UTC ISO timestamp in the user's local time with timezone, or an em dash when absent/invalid. */
function localTime(iso?: string): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Human "time remaining" from whole minutes (negative ⇒ already expired). */
function remaining(minutes?: number): string {
  if (minutes == null) return "—";
  if (minutes <= 0) return "Expired";
  const days = Math.floor(minutes / (60 * 24));
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Licensing Administration page — per-machine, offline signed licensing. Independent of authentication and
 * RBAC: it shows and manages the installation's license, while access to the page/actions is a privileged
 * Super-User capability enforced in the trusted main process. Sensitive changes prompt re-authentication.
 */
export function LicensingPage() {
  const session = useSession();
  const sessionRef = session?.principal.sessionRef ?? "";
  const [report, setReport] = useState<LicenseStatusReport | null>(null);
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

  usePageChrome(
    {
      actions: [
        {
          id: "license-revalidate",
          label: "Revalidate",
          onClick: () => run(() => licensing().revalidate(sessionRef), "License revalidated."),
          disabled: busy || denied
        }
      ],
      dirty: false
    },
    [run, sessionRef, busy, denied]
  );

  const onExportRequest = async () => {
    setError(null);
    setNotice(null);
    const res = await licensing().exportRequest(sessionRef);
    if (!res.ok || !res.value) {
      setError(adminReasonMessage(res.reason));
      return;
    }
    // Download the activation request the operator sends to the issuer (app-generated, no secrets).
    const blob = new Blob([JSON.stringify(res.value, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "specterstudio-activation-request.json";
    a.click();
    URL.revokeObjectURL(url);
    setNotice("Activation request exported. Send it to your license issuer.");
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

  if (loading) return <AdminPage><AdminLoading label="Loading licensing…" /></AdminPage>;
  if (denied) {
    return (
      <AdminPage>
        <AdminEmpty icon={ShieldX} title="Not authorized" hint="Licensing is managed by a Super User." />
      </AdminPage>
    );
  }

  const lic = report?.license;

  return (
    <AdminPage
      banner={
        <>
          {error ? <AdminBanner tone="error">{error}</AdminBanner> : null}
          {notice ? <AdminBanner tone="success">{notice}</AdminBanner> : null}
          {report?.conflict ? (
            <AdminBanner tone="info">
              Both a machine-wide (provisioned) and a per-user license are present. The provisioned license
              is in use. Remove one to resolve the conflict.
            </AdminBanner>
          ) : null}
        </>
      }
    >
      {/* Status */}
      <section className="settings-card">
        <div className="awkit-admin-card-head">
          <h2><KeyRound size={16} /> License status</h2>
          {report ? <AdminStatusBadge status={report.status} /> : null}
        </div>
        <p className="awkit-admin-muted">{report?.userAction}</p>
        <div className="awkit-license-grid">
          <Field label="Type" value={lic?.licenseType ?? "—"} />
          <Field label="Serial" value={lic?.serialNumberMasked ?? "—"} mono />
          <Field label="License ID" value={lic?.licenseId ?? "—"} mono />
          <Field label="Issued" value={localTime(lic?.issuedAtUtc)} />
          <Field label="Valid from" value={localTime(lic?.validFromUtc)} />
          <Field label="Expires" value={localTime(lic?.expiresAtUtc)} />
          <Field label="Remaining" value={remaining(report?.remainingMinutes)} />
          <Field label="Last validated" value={localTime(report?.checkedAtUtc)} />
          <Field label="Source" value={report?.source === "shared" ? "Machine-wide (provisioned)" : report?.source === "local" ? "This user" : "—"} />
        </div>
        {lic?.entitlements?.length ? (
          <div className="awkit-license-entitlements">
            <span className="awkit-admin-muted">Entitlements</span>
            <div className="awkit-admin-perm-list">
              {lic.entitlements.map((e) => <span key={e} className="awkit-admin-role-chip">{e}</span>)}
            </div>
          </div>
        ) : null}
      </section>

      {/* Machine activation */}
      <section className="settings-card">
        <h2>Machine activation</h2>
        <p className="awkit-admin-muted">
          Export this machine's activation request and send it to your license issuer. The request contains
          no personal data — only a hashed machine fingerprint.
        </p>
        <div className="awkit-license-machine">
          <div className="awkit-license-code">
            <span className="awkit-admin-muted">Machine code</span>
            <code title={report?.machineFingerprintHash}>{report?.machineFingerprintHash?.slice(0, 24) ?? "—"}…</code>
            <span className="awkit-license-confidence">confidence: {report?.fingerprintConfidence ?? "—"}</span>
          </div>
          <div className="awkit-admin-row-actions">
            <button className="toolbar-button" onClick={copyMachineCode} disabled={!report?.machineFingerprintHash}>
              <Copy size={14} /> Copy machine code
            </button>
            <button className="toolbar-button primary" onClick={onExportRequest} disabled={busy}>
              <Download size={14} /> Export activation request
            </button>
          </div>
        </div>
      </section>

      {/* License management */}
      <section className="settings-card">
        <h2>Manage license</h2>
        <p className="awkit-admin-muted">Import a signed license file, or replace/remove the installed one.</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".dat,.json,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onImportFile(file, Boolean(lic));
          }}
        />
        <div className="awkit-admin-row-actions">
          <button className="toolbar-button primary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            <Upload size={14} /> {lic ? "Replace license…" : "Import license…"}
          </button>
          <button
            className="toolbar-button"
            onClick={() => run(() => licensing().revoke(sessionRef), "License revoked.")}
            disabled={busy || !lic || report?.source === "shared"}
            title={report?.source === "shared" ? "A provisioned machine-wide license can't be revoked here." : undefined}
          >
            <ShieldX size={14} /> Revoke
          </button>
          <button
            className="toolbar-button danger"
            onClick={() => run(() => licensing().remove(sessionRef), "License removed.")}
            disabled={busy || !lic || report?.source === "shared"}
          >
            <Trash2 size={14} /> Remove
          </button>
        </div>
      </section>

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
    </AdminPage>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="awkit-license-field">
      <span className="awkit-admin-muted">{label}</span>
      <span className={mono ? "awkit-license-mono" : undefined}>{value}</span>
    </div>
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
