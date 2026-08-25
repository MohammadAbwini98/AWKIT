import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, FolderOpen, KeyRound, ShieldCheck, ShieldX, Upload } from "lucide-react";
import type { ActivationRequest, Entitlement } from "@src/licensing/LicenseTypes";
import {
  ISSUER_ENTITLEMENTS,
  ISSUER_LICENSE_TYPES,
  type IssueLicenseInput,
  type IssuedLicenseResult,
  type IssuerReadiness,
  type IssuerReadinessState
} from "@src/licensing/issuer/LicenseIssuerContracts";
import { useSession } from "../../security/SessionContext";
import { usePageChrome } from "../../state/pageChrome";
import { ReauthDialog } from "./ReauthDialog";
import { adminReasonMessage } from "./adminMessages";
import {
  AdminBanner,
  AdminEmpty,
  AdminLoading,
  AdminMetricCard,
  AdminMetrics,
  AdminPage,
  AdminSectionCard,
  AdminStatusBadge
} from "./components/AdminUi";

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
      return "The external signing key was not found on this issuer workstation. Provision it at the location below — SpecterStudio will never create one for you.";
    case "ISSUER_KEY_UNSAFE_LOCATION":
      return "The external signing key is in a cloud-synced folder. Move it to a non-synced location on this workstation before issuing.";
    case "ISSUER_KEY_INACCESSIBLE":
      return "The external signing key is there but could not be opened. Check its file permissions, and that the path is a file rather than a folder.";
    case "ISSUER_KEY_INVALID":
      return "The external signing key is not a readable PKCS8 Ed25519 private key.";
    case "ISSUER_KEY_MISMATCH":
      return "The external signing key does not match SpecterStudio's trusted public key for this key ID.";
    case "ISSUER_KEY_RETIRED":
      return "This signing key is retired and cannot issue new licenses.";
    case "ISSUER_KEY_UNKNOWN_ID":
      return "This build does not trust the configured signing key ID, so nothing it signed could validate in the field.";
    case "ISSUER_KEY_LOCATION_INVALID":
      return "The signing-key location could not be resolved. SPECTER_ISSUER_KEY must be an absolute path on this workstation.";
    case "ISSUER_WRITE_FAILED":
      return "The license or issuance history could not be written safely.";
    default:
      return adminReasonMessage(reason);
  }
}

/**
 * The badge/metric wording per readiness state.
 *
 * All five used to render as "Key unavailable", which told an operator nothing about what to do: a
 * key to provision, an ACL to fix, and a key ID this build does not trust need three different
 * actions.
 */
const READINESS_LABELS: Record<IssuerReadinessState, { badge: string; metric: string }> = {
  READY: { badge: "Ready", metric: "Ready" },
  MISSING: { badge: "Key missing", metric: "Not provisioned" },
  INACCESSIBLE: { badge: "Key unreadable", metric: "Unreadable" },
  INVALID_FORMAT: { badge: "Key unusable", metric: "Unusable" },
  CONFIGURATION_ERROR: { badge: "Configuration error", metric: "Misconfigured" }
};

function readinessLabels(readiness: IssuerReadiness | null): { badge: string; metric: string } {
  return READINESS_LABELS[readiness?.state ?? "CONFIGURATION_ERROR"];
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
    // Both preconditions, restated at the call site. The main process refuses either way; this keeps
    // a stale render or a keyboard activation from firing a request that can only be refused.
    if (!activationRequest || !readiness?.ready || busy) return;
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
  }, [activationRequest, busy, entitlements, licenseType, readiness?.ready, sessionRef, validityDays]);

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

  /**
   * Why issuance is not available yet, or `null` when it is.
   *
   * The two preconditions are deliberately INDEPENDENT: an activation request loads and is reviewed
   * whether or not a key is present (so the operator can confirm the machine before provisioning),
   * and the key is checked whether or not a request is loaded. Signing needs BOTH — the main process
   * enforces the same rule, so this only explains the gate rather than being it.
   */
  const issueBlockedReason: string | null =
    !readiness?.ready
      ? `Signing key: ${readinessLabels(readiness).badge} — issuance is blocked until it reports Ready.`
      : !activationRequest
        ? "Load an activation request before issuing."
        : entitlements.length === 0
          ? "Select at least one entitlement."
          : !Number.isInteger(validityDays) || validityDays < 1 || validityDays > 3650
            ? "Validity must be a whole number of days between 1 and 3650."
            : null;

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
      title="License Issuer"
      description="Turn an activation request into a signed, automatically saved license on this offline issuer workstation."
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
      <AdminMetrics label="Issuer summary">
        <AdminMetricCard
          label="Signing key"
          value={readinessLabels(readiness).metric}
          icon={KeyRound}
          tone={readiness?.ready ? "success" : "danger"}
          hint={readiness?.keySource === "environment-override" ? "SPECTER_ISSUER_KEY override" : undefined}
        />
        <AdminMetricCard
          label="Activation request"
          value={activationRequest ? "Loaded" : "Not loaded"}
          hint={activationRequest ? requestFileName : undefined}
        />
        <AdminMetricCard
          label="Entitlements selected"
          value={`${entitlements.length} of ${ISSUER_ENTITLEMENTS.length}`}
          hint={entitlements.length === 0 ? "select at least one" : undefined}
        />
        <AdminMetricCard
          label="Issued this session"
          value={issued ? "Saved" : "—"}
          icon={BadgeCheck}
          tone={issued ? "success" : "neutral"}
          hint={issued?.fileName}
        />
      </AdminMetrics>

      <div className="awkit-admin-dashboard-grid">
      <AdminSectionCard
        title="Signing readiness"
        icon={KeyRound}
        meta={<AdminStatusBadge status={readiness?.ready ? "valid" : "invalid"} label={readinessLabels(readiness).badge} />}
      >
        <p className="awkit-admin-muted">
          The private key stays outside the application package. SpecterStudio only reads it inside the
          trusted main process while issuing a license.
        </p>
        <div className="awkit-license-grid">
          <Field label="Signing key" value={readiness?.keyId ?? "—"} mono />
          <Field label="Readiness" value={readiness?.state ?? "—"} mono />
          {/* The expected location, so a MISSING key can actually be provisioned. It is the redacted
              path the main process resolved — a place, never key material. */}
          <Field label="Expected key location" value={readiness?.expectedKeyLocation ?? "—"} mono />
          <Field label="Output folder" value={readiness?.outputDirectory ?? "—"} mono />
        </div>
        {!readiness?.ready ? (
          <p className="form-message warn" role="status">{issuerReasonMessage(readiness?.reason)}</p>
        ) : null}
      </AdminSectionCard>

      <AdminSectionCard title="Activation request" icon={Upload} description="Select the JSON exported from the user's machine. The main process validates its product, schema, fingerprint, and bounds before signing.">
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
      </AdminSectionCard>
      </div>

      <AdminSectionCard title="License terms" icon={ShieldCheck}>
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
            disabled={busy || issueBlockedReason !== null}
            title={issueBlockedReason ?? undefined}
          >
            <ShieldCheck size={14} /> {busy ? "Issuing…" : "Issue and save license"}
          </button>
          {issueBlockedReason ? (
            <p className="form-message warn" role="status">{issueBlockedReason}</p>
          ) : null}
        </div>
      </AdminSectionCard>

      {issued ? (
        <AdminSectionCard title="Issued license" icon={ShieldCheck} meta={<AdminStatusBadge status="valid" label="Saved" />}>
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
        </AdminSectionCard>
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
