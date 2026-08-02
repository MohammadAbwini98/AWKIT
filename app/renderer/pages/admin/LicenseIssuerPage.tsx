import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, KeyRound, ShieldCheck, ShieldX, Upload } from "lucide-react";
import type { ActivationRequest, Entitlement } from "@src/licensing/LicenseTypes";
import {
  ISSUER_ENTITLEMENTS,
  ISSUER_LICENSE_TYPES,
  type IssueLicenseInput,
  type IssuedLicenseResult,
  type IssuerReadiness
} from "@src/licensing/issuer/LicenseIssuerContracts";
import { useSession } from "../../security/SessionContext";
import { usePageChrome } from "../../state/pageChrome";
import { ReauthDialog } from "./ReauthDialog";
import { adminReasonMessage } from "./adminMessages";
import { AdminBanner, AdminEmpty, AdminLoading, AdminPage, AdminStatusBadge } from "./components/AdminUi";

type Resp<T> = { ok: boolean; value?: T; reason?: string };
const issuer = () => window.playwrightFlowStudio.issuer;
const MAX_REQUEST_BYTES = 64 * 1024;

function localTime(iso?: string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function issuerReasonMessage(reason?: string): string {
  switch (reason) {
    case "ACTIVATION_REQUEST_INVALID":
      return "That activation request is invalid or belongs to another product version.";
    case "ISSUER_OPTIONS_INVALID":
      return "Choose a valid license type, duration, and at least one entitlement.";
    case "ISSUER_KEY_MISSING":
      return "The external signing key was not found on this issuer workstation.";
    case "ISSUER_KEY_INVALID":
      return "The external signing key is unreadable or malformed.";
    case "ISSUER_KEY_MISMATCH":
      return "The external signing key does not match SpecterStudio's trusted public key.";
    case "ISSUER_KEY_RETIRED":
      return "This signing key is retired and cannot issue new licenses.";
    case "ISSUER_WRITE_FAILED":
      return "The license or issuance history could not be written safely.";
    default:
      return adminReasonMessage(reason);
  }
}

/** Issuer-only, offline UI for turning an activation request into an automatically saved signed license. */
export function LicenseIssuerPage() {
  const session = useSession();
  const sessionRef = session?.principal.sessionRef ?? "";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [readiness, setReadiness] = useState<IssuerReadiness | null>(null);
  const [activationRequest, setActivationRequest] = useState<ActivationRequest | null>(null);
  const [requestFileName, setRequestFileName] = useState("");
  const [licenseType, setLicenseType] = useState<(typeof ISSUER_LICENSE_TYPES)[number]>("standard");
  const [validityDays, setValidityDays] = useState(365);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([
    "workflow.execute",
    "workflow.concurrent",
    "automation.browser"
  ]);
  const [issued, setIssued] = useState<IssuedLicenseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingFn, setPendingFn] = useState<(() => Promise<Resp<IssuedLicenseResult>>) | null>(null);

  const loadReadiness = useCallback(async () => {
    setError(null);
    const response = await issuer().getReadiness(sessionRef);
    if (response.ok && response.value) {
      setReadiness(response.value);
      setDenied(false);
    } else if (response.reason === "NOT_AUTHORIZED") {
      setDenied(true);
    } else {
      setError(issuerReasonMessage(response.reason));
    }
    setLoading(false);
  }, [sessionRef]);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  usePageChrome(
    {
      actions: [{
        id: "issuer-refresh",
        label: "Check signing key",
        onClick: loadReadiness,
        disabled: busy || denied
      }],
      dirty: false
    },
    [busy, denied, loadReadiness]
  );

  const onRequestFile = async (file: File) => {
    setError(null);
    setNotice(null);
    setIssued(null);
    if (file.size === 0 || file.size > MAX_REQUEST_BYTES) {
      setError("Activation requests must be non-empty JSON files smaller than 64 KB.");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as ActivationRequest;
      setActivationRequest(parsed);
      setRequestFileName(file.name);
      setNotice("Activation request loaded. Review the license terms, then issue the license.");
    } catch {
      setActivationRequest(null);
      setRequestFileName("");
      setError("That file is not valid JSON.");
    }
  };

  const issueLicense = useCallback(async () => {
    if (!activationRequest || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const request: IssueLicenseInput = {
      activationRequest,
      licenseType,
      validityDays,
      entitlements
    };
    const call = () => issuer().issue({ sessionRef, request });
    try {
      const response = await call();
      if (!response.ok && response.reason === "REAUTH_REQUIRED") {
        setPendingFn(() => call);
        return;
      }
      if (!response.ok || !response.value) {
        setError(issuerReasonMessage(response.reason));
        return;
      }
      setIssued(response.value);
      setNotice(`License issued and saved automatically as ${response.value.fileName}.`);
    } finally {
      setBusy(false);
    }
  }, [activationRequest, busy, entitlements, licenseType, sessionRef, validityDays]);

  const retryPending = async () => {
    const call = pendingFn;
    setPendingFn(null);
    if (!call) return;
    setBusy(true);
    setError(null);
    try {
      const response = await call();
      if (!response.ok || !response.value) {
        setError(issuerReasonMessage(response.reason));
        return;
      }
      setIssued(response.value);
      setNotice(`License issued and saved automatically as ${response.value.fileName}.`);
    } finally {
      setBusy(false);
    }
  };

  const openOutputFolder = async () => {
    const response = await issuer().openOutputFolder(sessionRef);
    if (!response.ok) setError(issuerReasonMessage(response.reason));
  };

  const toggleEntitlement = (entitlement: Entitlement) => {
    setEntitlements((current) => current.includes(entitlement)
      ? current.filter((item) => item !== entitlement)
      : [...current, entitlement]);
  };

  if (loading) return <AdminPage><AdminLoading label="Loading issuer console…" /></AdminPage>;
  if (denied) {
    return (
      <AdminPage>
        <AdminEmpty icon={ShieldX} title="Not authorized" hint="Only the dedicated Issuer account can access this page." />
      </AdminPage>
    );
  }

  return (
    <AdminPage
      banner={
        <>
          {error ? <AdminBanner tone="error">{error}</AdminBanner> : null}
          {notice ? <AdminBanner tone="success">{notice}</AdminBanner> : null}
          <AdminBanner tone="info">
            Issuance is offline. The generated file is saved automatically on this workstation. For a
            different machine, transfer the `.dat` back and import it from Administration → Licensing.
          </AdminBanner>
        </>
      }
    >
      <section className="settings-card">
        <div className="awkit-admin-card-head">
          <h2><KeyRound size={16} /> Signing readiness</h2>
          <AdminStatusBadge
            status={readiness?.ready ? "valid" : "invalid"}
            label={readiness?.ready ? "Ready" : "Key unavailable"}
          />
        </div>
        <p className="awkit-admin-muted">
          The private key stays outside the application package. SpecterStudio only reads it inside the
          trusted main process while issuing a license.
        </p>
        <div className="awkit-license-grid">
          <Field label="Signing key" value={readiness?.keyId ?? "—"} mono />
          <Field label="Output folder" value={readiness?.outputDirectory ?? "—"} mono />
        </div>
        {!readiness?.ready ? (
          <p className="form-message warn" role="status">{issuerReasonMessage(readiness?.reason)}</p>
        ) : null}
      </section>

      <section className="settings-card">
        <h2><Upload size={16} /> Activation request</h2>
        <p className="awkit-admin-muted">
          Select the JSON exported from the user's machine. The main process validates its product,
          schema, fingerprint, and bounds before signing.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void onRequestFile(file);
          }}
        />
        <button className="toolbar-button primary" type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          <Upload size={14} /> {activationRequest ? "Replace activation request…" : "Select activation request…"}
        </button>
        {activationRequest ? (
          <div className="awkit-license-grid">
            <Field label="File" value={requestFileName} />
            <Field label="Product" value={activationRequest.product ?? "—"} />
            <Field label="App version" value={activationRequest.appVersion ?? "—"} />
            <Field label="Request ID" value={activationRequest.requestId ?? "—"} mono />
            <Field label="Generated" value={localTime(activationRequest.generatedAtUtc)} />
            <Field label="Confidence" value={activationRequest.confidenceLevel ?? "—"} />
            <Field label="Machine fingerprint" value={activationRequest.fingerprintHash ?? "—"} mono />
          </div>
        ) : null}
      </section>

      <section className="settings-card">
        <h2><ShieldCheck size={16} /> License terms</h2>
        <div className="awkit-admin-create-form">
          <label className="awkit-login-field">
            <span className="awkit-login-field-label">License type</span>
            <select value={licenseType} onChange={(event) => setLicenseType(event.target.value as typeof licenseType)}>
              {ISSUER_LICENSE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="awkit-login-field">
            <span className="awkit-login-field-label">Validity (days)</span>
            <input
              type="number"
              min={1}
              max={3650}
              step={1}
              value={validityDays}
              onChange={(event) => setValidityDays(Number(event.target.value))}
            />
          </label>
          <fieldset className="awkit-admin-roles">
            <legend>Entitlements</legend>
            {ISSUER_ENTITLEMENTS.map((entitlement) => (
              <label key={entitlement} className="awkit-admin-role-option">
                <input
                  type="checkbox"
                  checked={entitlements.includes(entitlement)}
                  onChange={() => toggleEntitlement(entitlement)}
                />
                {entitlement}
              </label>
            ))}
          </fieldset>
          <button
            className="toolbar-button primary"
            type="button"
            onClick={() => void issueLicense()}
            disabled={!activationRequest || !readiness?.ready || busy || entitlements.length === 0 || !Number.isInteger(validityDays) || validityDays < 1 || validityDays > 3650}
          >
            <ShieldCheck size={14} /> {busy ? "Issuing…" : "Issue and save license"}
          </button>
        </div>
      </section>

      {issued ? (
        <section className="settings-card">
          <div className="awkit-admin-card-head">
            <h2><ShieldCheck size={16} /> Issued license</h2>
            <AdminStatusBadge status="valid" label="Saved" />
          </div>
          <div className="awkit-license-grid">
            <Field label="File" value={issued.fileName} mono />
            <Field label="License ID" value={issued.licenseId} mono />
            <Field label="Serial" value={issued.serialNumber} mono />
            <Field label="Type" value={issued.licenseType} />
            <Field label="Valid from" value={localTime(issued.validFromUtc)} />
            <Field label="Expires" value={localTime(issued.expiresAtUtc)} />
          </div>
          <div className="awkit-admin-row-actions">
            <button className="toolbar-button" type="button" onClick={() => void openOutputFolder()}>
              <FolderOpen size={14} /> Open output folder
            </button>
          </div>
        </section>
      ) : null}

      {pendingFn ? (
        <ReauthDialog
          sessionRef={sessionRef}
          onCancel={() => setPendingFn(null)}
          onConfirmed={() => void retryPending()}
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
