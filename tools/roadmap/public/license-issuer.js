/**
 * Licenses Issue — the visual front end for AWKIT's offline license issuer.
 *
 * This file draws a form and reports what the server told it. It does not sign, does not know the
 * signing algorithm, and never sees a key: pressing "Issue License" POSTs the reviewed terms and
 * receives back a license document that a separate trusted process already signed and wrote to the
 * issuer's confined output folder. Everything shown in the result comes from that document.
 *
 * Two deliberate departures from the other views:
 *
 *   1. The root node is BUILT ONCE and cached. Every other view is a pure function of the snapshot
 *      and is rebuilt whenever one arrives; doing that here would wipe a half-typed activation
 *      request out from under the operator whenever an unrelated repository file changed.
 *   2. Nothing is issued as a side effect of editing. Choosing a preset or a date only recomputes
 *      the review panel — signing happens on one explicit press, which is disabled for the whole
 *      round trip so a double-click cannot sign twice. (The server refuses a concurrent issuance
 *      too; the disabled button is a courtesy, not the guarantee.)
 */

import { el, frag, readApiPayload } from "./dom.js";
import { icon } from "./icons.js";

const ACTION_HEADER = { "X-AWKIT-Roadmap-Action": "license-issue" };

/**
 * Validity presets. These are UX only — each resolves to an exact UTC window before it is sent, so
 * the timestamps reviewed on screen are byte-for-byte the ones that get signed. Nothing downstream
 * ever sees "30 days".
 */
const PRESETS = [
  { id: "1h", label: "1 Hour", minutes: 60 },
  { id: "1d", label: "1 Day", minutes: 60 * 24 },
  { id: "7d", label: "7 Days", minutes: 60 * 24 * 7 },
  { id: "30d", label: "30 Days", minutes: 60 * 24 * 30 },
  { id: "90d", label: "90 Days", minutes: 60 * 24 * 90 },
  { id: "180d", label: "180 Days", minutes: 60 * 24 * 180 },
  { id: "1y", label: "1 Year", minutes: 60 * 24 * 365 },
  { id: "custom", label: "Custom", minutes: null }
];

const DEFAULT_ENTITLEMENTS = ["workflow.execute", "workflow.concurrent", "automation.browser"];

/** Every reason code either layer can return, phrased as something the operator can act on. */
const REASON_MESSAGE = {
  ACTIVATION_REQUEST_NOT_JSON: "That activation request is not valid JSON.",
  ACTIVATION_REQUEST_TOO_LARGE: "That activation request is too large to be genuine (limit 64 KB).",
  ACTIVATION_REQUEST_INVALID:
    "Invalid activation request — its product, schema version, fingerprint, or algorithm version is not one this issuer accepts.",
  ISSUER_OPTIONS_INVALID: "Choose a license type, a validity window, and at least one entitlement.",
  ISSUER_TIMESTAMP_INVALID: "Enter a complete valid-from and expiration date and time.",
  ISSUER_EXPIRY_NOT_AFTER_START: "Expiration must be after Valid From.",
  ISSUER_KEY_MISSING: "No authorized signing key is configured on this machine.",
  ISSUER_KEY_UNSAFE_LOCATION:
    "The signing key is in a cloud-synced folder, so its custody cannot be assured. Move it to non-synced storage on this workstation.",
  ISSUER_KEY_INVALID: "The signing key on this machine is unreadable or malformed.",
  ISSUER_KEY_MISMATCH: "The signing key on this machine does not match the public key AWKIT trusts.",
  ISSUER_KEY_RETIRED: "This signing key is retired and may no longer sign new licenses.",
  ISSUER_WRITE_FAILED: "License signing failed — the license or its issuance record could not be written.",
  ISSUANCE_IN_PROGRESS: "Another license is being issued right now. Wait for it to finish.",
  NOT_AUTHORIZED: "That request was not authorized by this dashboard.",
  REQUEST_TOO_LARGE: "That request is too large.",
  REQUEST_INVALID: "That request could not be read.",
  ISSUER_BRIDGE_UNAVAILABLE:
    "The issuer bridge cannot run — the TypeScript loader is missing. Run npm install in the repository.",
  ISSUER_BRIDGE_FAILED: "The issuer did not complete. Check the roadmap server output.",
  BRIDGE_FAILED: "The issuer did not complete. Check the roadmap server output."
};

/** View-local state, kept outside the DOM so a rebuild (or a future one) restores what was typed. */
const state = {
  built: null,
  readiness: null,
  readinessLoaded: false,
  requestText: "",
  parsedRequest: null,
  licenseType: "standard",
  entitlements: new Set(DEFAULT_ENTITLEMENTS),
  presetId: "30d",
  /** Minute-truncated anchor for a preset window; re-taken whenever a preset is chosen. */
  anchorMs: minuteFloor(Date.now()),
  customFrom: "",
  customUntil: "",
  busy: false,
  issued: null,
  history: [],
  error: null,
  notice: null
};

/* ==========================================================================
   Time helpers — one direction only: local input in, UTC out.
   ========================================================================== */

function minuteFloor(ms) {
  return Math.floor(ms / 60000) * 60000;
}

function toUtcIso(ms) {
  return new Date(minuteFloor(ms)).toISOString();
}

/** `2026-09-18T19:30` in the browser's own zone — the value a datetime-local input carries. */
function toLocalInputValue(ms) {
  const d = new Date(minuteFloor(ms));
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localTimeLabel(iso) {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return String(iso);
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function timeZoneName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  } catch {
    return "local time";
  }
}

/** "30 days", "1 hour 30 minutes" — a duration a human can check against what they asked for. */
function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const minutes = Math.round(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (rest || parts.length === 0) parts.push(`${rest} ${rest === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}

/** `A84F…21C9` — enough to match against the requesting machine, never the whole hash in passing. */
function shortFingerprint(hash) {
  if (typeof hash !== "string" || hash.length < 12) return "—";
  const upper = hash.toUpperCase();
  return `${upper.slice(0, 4)}…${upper.slice(-4)}`;
}

function message(reason) {
  return REASON_MESSAGE[reason] ?? `The issuer refused this request (${reason ?? "unknown reason"}).`;
}

/* ==========================================================================
   The validity window currently described by the form
   ========================================================================== */

/**
 * @returns {{ok: true, validFromUtc: string, expiresAtUtc: string, spanMs: number}
 *          |{ok: false, reason: string}}
 */
function currentWindow() {
  if (state.presetId === "custom") {
    if (!state.customFrom || !state.customUntil) return { ok: false, reason: "ISSUER_TIMESTAMP_INVALID" };
    const fromMs = Date.parse(state.customFrom);
    const untilMs = Date.parse(state.customUntil);
    if (Number.isNaN(fromMs) || Number.isNaN(untilMs)) return { ok: false, reason: "ISSUER_TIMESTAMP_INVALID" };
    if (minuteFloor(untilMs) <= minuteFloor(fromMs)) return { ok: false, reason: "ISSUER_EXPIRY_NOT_AFTER_START" };
    return {
      ok: true,
      validFromUtc: toUtcIso(fromMs),
      expiresAtUtc: toUtcIso(untilMs),
      spanMs: minuteFloor(untilMs) - minuteFloor(fromMs)
    };
  }
  const preset = PRESETS.find((p) => p.id === state.presetId);
  if (!preset || preset.minutes === null) return { ok: false, reason: "ISSUER_OPTIONS_INVALID" };
  const spanMs = preset.minutes * 60000;
  return {
    ok: true,
    validFromUtc: toUtcIso(state.anchorMs),
    expiresAtUtc: toUtcIso(state.anchorMs + spanMs),
    spanMs
  };
}

function readinessReady() {
  return state.readiness?.ready === true;
}

function blockingReason() {
  if (!state.readinessLoaded) return "LOADING";
  if (!readinessReady()) return state.readiness?.reason ?? "ISSUER_BRIDGE_FAILED";
  if (!state.parsedRequest) return "NO_REQUEST";
  if (state.entitlements.size === 0) return "ISSUER_OPTIONS_INVALID";
  const window = currentWindow();
  if (!window.ok) return window.reason;
  return null;
}

/* ==========================================================================
   Network
   ========================================================================== */

async function callIssuer(path, body) {
  const init = body === undefined
    ? {}
    : { method: "POST", headers: { ...ACTION_HEADER, "Content-Type": "application/json" }, body: JSON.stringify(body) };
  try {
    const response = await fetch(path, init);
    const payload = await readApiPayload(response);
    if (payload.ok === true) return payload;
    return { ok: false, reason: payload.reason ?? payload.error ?? "ISSUER_BRIDGE_FAILED" };
  } catch {
    return { ok: false, reason: "ISSUER_BRIDGE_FAILED" };
  }
}

async function loadReadiness() {
  const payload = await callIssuer("/api/license-issuer");
  state.readinessLoaded = true;
  state.readiness = payload.ok ? payload.readiness : { ready: false, reason: payload.reason };
  paint();
}

async function loadHistory() {
  const payload = await callIssuer("/api/license-issuer/history");
  state.history = payload.ok && Array.isArray(payload.records) ? payload.records : [];
  paint();
}

async function parseRequest() {
  state.error = null;
  state.notice = null;
  state.issued = null;
  state.parsedRequest = null;
  if (state.requestText.trim().length === 0) {
    state.error = "Paste an activation request, or import one from a file.";
    paint();
    return;
  }
  state.busy = true;
  paint();
  const payload = await callIssuer("/api/license-issuer/parse", { activationRequestText: state.requestText });
  state.busy = false;
  if (!payload.ok) {
    state.error = message(payload.reason);
  } else {
    state.parsedRequest = payload.request;
    state.notice = "Activation request accepted. Review the license terms, then issue.";
  }
  paint();
}

async function issueLicense() {
  if (state.busy || blockingReason() !== null) return;
  const window = currentWindow();
  if (!window.ok) {
    state.error = message(window.reason);
    paint();
    return;
  }
  state.busy = true;
  state.error = null;
  state.notice = null;
  paint();
  const payload = await callIssuer("/api/license-issuer/issue", {
    activationRequestText: state.requestText,
    licenseType: state.licenseType,
    entitlements: [...state.entitlements],
    validity: { mode: "window", validFromUtc: window.validFromUtc, expiresAtUtc: window.expiresAtUtc }
  });
  state.busy = false;
  if (!payload.ok) {
    state.error = message(payload.reason);
    paint();
    return;
  }
  state.issued = { result: payload.result, document: payload.document };
  state.notice = `License issued and saved as ${payload.result.fileName}.`;
  paint();
  void loadHistory();
}

/* ==========================================================================
   Small builders
   ========================================================================== */

function panel(title, subtitle, children) {
  return el("section", { class: "work-panel" }, [
    el("div", { class: "section-heading" }, [
      el("h1", { text: title }),
      subtitle ? el("span", { text: subtitle }) : null
    ]),
    ...children
  ]);
}

function field(label, value, mono) {
  return el("div", { class: "rm-issuer-field" }, [
    el("span", { class: "rm-issuer-field-label", text: label }),
    el("span", { class: mono ? "rm-issuer-field-value rm-mono" : "rm-issuer-field-value", text: value })
  ]);
}

async function copyText(value, label) {
  try {
    await navigator.clipboard.writeText(value);
    state.notice = `${label} copied.`;
  } catch {
    state.notice = `${label} could not be copied. Select it and copy manually.`;
  }
  paint();
}

/* ==========================================================================
   Build — runs once
   ========================================================================== */

function build() {
  const refs = {};

  /* ---- Signing readiness ------------------------------------------------ */
  refs.readinessBadge = el("span", { class: "rm-badge", text: "Checking…" });
  refs.readinessDetail = el("p", { class: "rm-issuer-status", role: "status", "aria-live": "polite" });
  refs.readinessGrid = el("div", { class: "rm-issuer-grid" });
  const readinessPanel = panel("Signing authority", "Developer tooling — never part of a packaged build", [
    el("p", { class: "rm-panel-head-row" }, [refs.readinessBadge]),
    el("p", { class: "rm-panel-note" }, [
      `The private signing key is read only inside a separate trusted process on this workstation. It is
       never sent to this page, never stored in the browser, and never included in a response.`
    ]),
    refs.readinessGrid,
    refs.readinessDetail
  ]);

  /* ---- Banners ---------------------------------------------------------- */
  refs.errorBanner = el("p", { class: "rm-issuer-banner rm-issuer-banner-error", role: "alert" });
  refs.noticeBanner = el("p", { class: "rm-issuer-banner rm-issuer-banner-ok", role: "status", "aria-live": "polite" });

  /* ---- Target machine --------------------------------------------------- */
  refs.requestInput = el("textarea", {
    class: "rm-issuer-textarea",
    id: "rm-issuer-request",
    rows: "8",
    spellcheck: "false",
    placeholder: '{ "schemaVersion": 1, "product": "SpecterStudio", … }',
    on: {
      input: (event) => {
        state.requestText = event.target.value;
        state.parsedRequest = null;
        paint();
      }
    }
  });
  refs.fileInput = el("input", {
    type: "file",
    accept: ".json,application/json",
    id: "rm-issuer-file",
    class: "rm-issuer-file",
    on: {
      change: async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        state.requestText = await file.text();
        state.parsedRequest = null;
        refs.requestInput.value = state.requestText;
        state.notice = `Loaded ${file.name}. Parse it to confirm the machine.`;
        paint();
      }
    }
  });
  refs.parseButton = el(
    "button",
    { type: "button", class: "rm-button rm-button-primary", on: { click: () => void parseRequest() } },
    [icon("shield-check", 14), el("span", { text: "Parse Request" })]
  );
  refs.machineGrid = el("div", { class: "rm-issuer-grid" });
  refs.machineEmpty = el("p", { class: "rm-issuer-empty", text: "No activation request parsed yet." });

  const machinePanel = panel("Target machine", "Activation request from the requesting installation", [
    el("p", { class: "rm-panel-note" }, [
      `Paste or import the activation request the target machine exported. It carries a hashed
       fingerprint, never a raw hardware identifier, and the issuer validates it before anything is
       signed.`
    ]),
    el("label", { class: "rm-issuer-label", for: "rm-issuer-request", text: "Activation request (JSON)" }),
    refs.requestInput,
    el("div", { class: "rm-issuer-actions" }, [
      refs.parseButton,
      el("label", { class: "rm-button rm-issuer-file-label", for: "rm-issuer-file" }, [
        icon("file-text", 14),
        el("span", { text: "Import file…" })
      ]),
      refs.fileInput
    ]),
    refs.machineGrid,
    refs.machineEmpty
  ]);

  /* ---- Validity --------------------------------------------------------- */
  refs.presetInputs = new Map();
  const presetOptions = PRESETS.map((preset) => {
    const input = el("input", {
      type: "radio",
      name: "rm-issuer-validity",
      id: `rm-issuer-validity-${preset.id}`,
      value: preset.id,
      on: {
        change: () => {
          state.presetId = preset.id;
          // Re-anchor on every selection so "Valid from" means now, not when the page was opened.
          state.anchorMs = minuteFloor(Date.now());
          if (preset.id === "custom" && !state.customFrom) {
            state.customFrom = toLocalInputValue(Date.now());
            state.customUntil = toLocalInputValue(Date.now() + 30 * 24 * 60 * 60 * 1000);
            refs.customFrom.value = state.customFrom;
            refs.customUntil.value = state.customUntil;
          }
          paint();
        }
      }
    });
    refs.presetInputs.set(preset.id, input);
    return el("label", { class: "rm-issuer-radio", for: `rm-issuer-validity-${preset.id}` }, [
      input,
      el("span", { text: preset.label })
    ]);
  });

  refs.customFrom = el("input", {
    type: "datetime-local",
    id: "rm-issuer-from",
    class: "rm-issuer-input",
    on: {
      input: (event) => {
        state.customFrom = event.target.value;
        paint();
      }
    }
  });
  refs.customUntil = el("input", {
    type: "datetime-local",
    id: "rm-issuer-until",
    class: "rm-issuer-input",
    on: {
      input: (event) => {
        state.customUntil = event.target.value;
        paint();
      }
    }
  });
  refs.customBlock = el("div", { class: "rm-issuer-custom" }, [
    el("div", { class: "rm-issuer-input-row" }, [
      el("label", { class: "rm-issuer-label", for: "rm-issuer-from", text: "Valid from" }),
      refs.customFrom
    ]),
    el("div", { class: "rm-issuer-input-row" }, [
      el("label", { class: "rm-issuer-label", for: "rm-issuer-until", text: "Expires at" }),
      refs.customUntil
    ])
  ]);
  refs.windowSummary = el("div", { class: "rm-issuer-grid" });

  const validityPanel = panel("License validity", `Entered in ${timeZoneName()} · stored in UTC`, [
    el("p", { class: "rm-panel-note" }, [
      `Presets are a convenience only. Whichever you choose, the license carries the exact valid-from
       and expires-at timestamps shown below, to the minute.`
    ]),
    el("fieldset", { class: "rm-issuer-fieldset" }, [
      el("legend", { text: "Validity period" }),
      el("div", { class: "rm-issuer-radio-grid" }, presetOptions)
    ]),
    refs.customBlock,
    refs.windowSummary
  ]);

  /* ---- License configuration -------------------------------------------- */
  refs.typeSelect = el("select", {
    id: "rm-issuer-type",
    class: "rm-issuer-input",
    on: {
      change: (event) => {
        state.licenseType = event.target.value;
        paint();
      }
    }
  });
  refs.entitlementBox = el("div", { class: "rm-issuer-radio-grid" });
  const configPanel = panel("License configuration", "Values the issuer accepts as operator choices", [
    el("p", { class: "rm-panel-note" }, [
      `Schema version, signature algorithm, product identifier, serial number, license id and signing
       key version are not editable here — they come from the licensing implementation itself.`
    ]),
    el("div", { class: "rm-issuer-input-row" }, [
      el("label", { class: "rm-issuer-label", for: "rm-issuer-type", text: "License type" }),
      refs.typeSelect
    ]),
    el("fieldset", { class: "rm-issuer-fieldset" }, [
      el("legend", { text: "Entitlements" }),
      refs.entitlementBox
    ])
  ]);

  /* ---- Review + issue ---------------------------------------------------- */
  refs.reviewGrid = el("div", { class: "rm-issuer-grid rm-issuer-review" });
  refs.blockedNote = el("p", { class: "rm-issuer-status", role: "status", "aria-live": "polite" });
  refs.issueButton = el(
    "button",
    { type: "button", class: "rm-button rm-button-primary rm-issuer-issue", on: { click: () => void issueLicense() } },
    [icon("key-round", 14), el("span", { text: "Issue License" })]
  );
  const reviewPanel = panel("Review", "Confirm before signing", [
    refs.reviewGrid,
    el("div", { class: "rm-issuer-actions" }, [refs.issueButton]),
    refs.blockedNote
  ]);

  /* ---- Result ------------------------------------------------------------ */
  refs.resultPanel = el("section", { class: "work-panel rm-issuer-result" });

  /* ---- History ----------------------------------------------------------- */
  refs.historyBody = el("tbody");
  refs.historyEmpty = el("p", {
    class: "rm-issuer-empty",
    text: "No issuance has been recorded next to this signing key yet."
  });
  const historyPanel = panel("Recent issuance", "Read from the issuance log beside the signing key", [
    el("p", { class: "rm-panel-note" }, [
      `The same record the issuer has always written. It is stored with the key, outside this
       repository and outside the application, and holds no key material and no raw machine identifier.`
    ]),
    el("div", { class: "rm-table-wrap" }, [
      el("table", { class: "rm-table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { text: "Issued" }),
            el("th", { text: "Serial" }),
            el("th", { text: "Machine" }),
            el("th", { text: "Type" }),
            el("th", { text: "Expires" }),
            el("th", { text: "Duration" }),
            el("th", { text: "Status" })
          ])
        ]),
        refs.historyBody
      ])
    ]),
    refs.historyEmpty
  ]);

  const root = el("div", { class: "rm-stack" }, [
    refs.errorBanner,
    refs.noticeBanner,
    readinessPanel,
    el("div", { class: "rm-issuer-columns" }, [machinePanel, validityPanel]),
    configPanel,
    reviewPanel,
    refs.resultPanel,
    historyPanel
  ]);

  state.built = { root, refs };
  return state.built;
}

/* ==========================================================================
   Paint — every visible value is recomputed from `state`
   ========================================================================== */

function paint() {
  if (!state.built) return;
  const { refs } = state.built;

  /* Banners */
  refs.errorBanner.textContent = state.error ?? "";
  refs.errorBanner.hidden = !state.error;
  refs.noticeBanner.textContent = state.notice ?? "";
  refs.noticeBanner.hidden = !state.notice;

  /* Readiness */
  const ready = readinessReady();
  refs.readinessBadge.textContent = !state.readinessLoaded ? "Checking…" : ready ? "Ready to sign" : "BLOCKED";
  refs.readinessBadge.className = `rm-badge ${!state.readinessLoaded ? "rm-badge-notrun" : ready ? "rm-badge-pass" : "rm-badge-blocked"}`;
  replaceChildren(refs.readinessGrid, [
    field("Signing key", state.readiness?.keyId ?? "—", true),
    field("Product", state.readiness?.product ?? "—"),
    field("Output folder", state.readiness?.outputDirectory ?? "—", true),
    field("Maximum validity", state.readiness?.limits ? `${state.readiness.limits.maxValidityDays} days` : "—")
  ]);
  if (!state.readinessLoaded) {
    refs.readinessDetail.textContent = "Checking this workstation for an authorized signing key…";
  } else if (ready) {
    refs.readinessDetail.textContent = "An authorized signing key is present and matches the public key AWKIT trusts.";
  } else {
    refs.readinessDetail.textContent = `License issuer unavailable. ${message(state.readiness?.reason)} License generation is blocked.`;
  }
  refs.readinessDetail.dataset.tone = !state.readinessLoaded ? "muted" : ready ? "ok" : "blocked";

  /* Machine */
  if (refs.requestInput.value !== state.requestText) refs.requestInput.value = state.requestText;
  refs.parseButton.disabled = state.busy || state.requestText.trim().length === 0;
  const request = state.parsedRequest;
  refs.machineEmpty.hidden = Boolean(request);
  replaceChildren(
    refs.machineGrid,
    request
      ? [
          field("Machine fingerprint", shortFingerprint(request.fingerprintHash), true),
          field("Full fingerprint", request.fingerprintHash, true),
          field("Fingerprint algorithm", `v${request.fingerprintAlgorithmVersion}`),
          field("Fingerprint confidence", request.confidenceLevel),
          field("Signals contributing", String(request.availableSignals?.length ?? 0)),
          field("Request ID", request.requestId, true),
          field("Request generated", localTimeLabel(request.generatedAtUtc)),
          field("Product / version", `${request.product} ${request.appVersion}`)
        ]
      : []
  );

  /* Validity */
  for (const [id, input] of refs.presetInputs) input.checked = id === state.presetId;
  refs.customBlock.hidden = state.presetId !== "custom";
  if (refs.customFrom.value !== state.customFrom) refs.customFrom.value = state.customFrom;
  if (refs.customUntil.value !== state.customUntil) refs.customUntil.value = state.customUntil;
  const window = currentWindow();
  replaceChildren(
    refs.windowSummary,
    window.ok
      ? [
          field("Valid from", `${localTimeLabel(window.validFromUtc)}  ·  ${window.validFromUtc}`),
          field("Expires at", `${localTimeLabel(window.expiresAtUtc)}  ·  ${window.expiresAtUtc}`),
          field("Total validity", humanDuration(window.spanMs))
        ]
      : [field("Validity window", message(window.reason))]
  );

  /* Configuration */
  const types = state.readiness?.licenseTypes ?? ["trial", "standard", "enterprise"];
  if (refs.typeSelect.options.length !== types.length) {
    replaceChildren(refs.typeSelect, types.map((type) => el("option", { value: type, text: type })));
  }
  refs.typeSelect.value = state.licenseType;
  const available = state.readiness?.entitlements ?? DEFAULT_ENTITLEMENTS;
  if (refs.entitlementBox.childElementCount !== available.length) {
    replaceChildren(
      refs.entitlementBox,
      available.map((entitlement) =>
        el("label", { class: "rm-issuer-radio", for: `rm-issuer-ent-${entitlement}` }, [
          el("input", {
            type: "checkbox",
            id: `rm-issuer-ent-${entitlement}`,
            checked: state.entitlements.has(entitlement) ? true : null,
            on: {
              change: (event) => {
                if (event.target.checked) state.entitlements.add(entitlement);
                else state.entitlements.delete(entitlement);
                paint();
              }
            }
          }),
          el("span", { text: entitlement })
        ])
      )
    );
  }

  /* Review */
  replaceChildren(refs.reviewGrid, [
    field("Machine fingerprint", request ? shortFingerprint(request.fingerprintHash) : "—", true),
    field("License type", state.licenseType),
    field("Valid from", window.ok ? localTimeLabel(window.validFromUtc) : "—"),
    field("Expires", window.ok ? localTimeLabel(window.expiresAtUtc) : "—"),
    field("Validity", window.ok ? humanDuration(window.spanMs) : "—"),
    field("Entitlements", state.entitlements.size ? [...state.entitlements].join(", ") : "none selected"),
    field("Product", state.readiness?.product ?? "—"),
    field("Signing key", state.readiness?.keyId ?? "—", true)
  ]);
  const blocked = blockingReason();
  refs.issueButton.disabled = state.busy || blocked !== null;
  refs.issueButton.setAttribute("aria-busy", state.busy ? "true" : "false");
  refs.issueButton.lastChild.textContent = state.busy ? "Issuing…" : "Issue License";
  refs.blockedNote.textContent = blocked === null
    ? "Ready. Issuing signs the license and writes it to the issuer output folder."
    : blocked === "LOADING"
      ? "Checking the signing key…"
      : blocked === "NO_REQUEST"
        ? "Machine fingerprint is missing — parse an activation request first."
        : message(blocked);
  refs.blockedNote.dataset.tone = blocked === null ? "ok" : "muted";

  paintResult(refs);
  paintHistory(refs);
}

function paintResult(refs) {
  const issued = state.issued;
  refs.resultPanel.hidden = !issued;
  if (!issued) {
    replaceChildren(refs.resultPanel, []);
    return;
  }
  const { result, document: license } = issued;
  const spanMs = Date.parse(result.expiresAtUtc) - Date.parse(result.validFromUtc);
  const remainingMs = Date.parse(result.expiresAtUtc) - Date.now();

  replaceChildren(refs.resultPanel, [
    el("div", { class: "section-heading" }, [
      el("h1", { text: "License issued successfully" }),
      el("span", { text: result.fileName })
    ]),
    el("div", { class: "rm-issuer-grid" }, [
      field("License ID", result.licenseId, true),
      field("Serial number", result.serialNumber, true),
      field("Machine fingerprint", result.machineFingerprintHash, true),
      field("Issued at", localTimeLabel(result.issuedAtUtc)),
      field("Valid from", `${localTimeLabel(result.validFromUtc)}  ·  ${result.validFromUtc}`),
      field("Expires at", `${localTimeLabel(result.expiresAtUtc)}  ·  ${result.expiresAtUtc}`),
      field("Total validity", humanDuration(spanMs)),
      field("Remaining", remainingMs > 0 ? humanDuration(remainingMs) : "already expired"),
      field("License type", result.licenseType),
      field("Entitlements", result.entitlements.join(", ")),
      field("Product", result.product),
      field("Issuer", result.issuer),
      field("Signature algorithm", result.signatureAlgorithm),
      field("Signing key version", result.signingKeyId, true)
    ]),
    el("p", { class: "rm-panel-note" }, [
      `Import this file on the target machine through Administration → Licensing. It validates only
       against the fingerprint above; on any other machine it reports MACHINE_MISMATCH.`
    ]),
    el("div", { class: "rm-issuer-actions" }, [
      el(
        "button",
        {
          type: "button",
          class: "rm-button rm-button-primary",
          on: { click: () => downloadLicense(result.fileName, license) }
        },
        [icon("download", 14), el("span", { text: "Download License" })]
      ),
      el(
        "button",
        { type: "button", class: "rm-button", on: { click: () => void copyText(result.licenseId, "License ID") } },
        [icon("copy", 14), el("span", { text: "Copy License ID" })]
      ),
      el(
        "button",
        { type: "button", class: "rm-button", on: { click: () => void copyText(result.serialNumber, "Serial number") } },
        [icon("copy", 14), el("span", { text: "Copy Serial Number" })]
      ),
      el(
        "button",
        {
          type: "button",
          class: "rm-button",
          on: {
            click: () => {
              state.issued = null;
              state.parsedRequest = null;
              state.requestText = "";
              state.notice = null;
              state.error = null;
              paint();
            }
          }
        },
        [icon("refresh-cw", 14), el("span", { text: "Issue Another License" })]
      )
    ])
  ]);
}

function downloadLicense(fileName, license) {
  const blob = new Blob([JSON.stringify(license, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = el("a", { href: url, download: fileName });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next turn: revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function paintHistory(refs) {
  const rows = state.history;
  refs.historyEmpty.hidden = rows.length > 0;
  const now = Date.now();
  replaceChildren(
    refs.historyBody,
    rows.map((row) => {
      const expiresMs = Date.parse(row.expiresAtUtc ?? "");
      const fromMs = Date.parse(row.validFromUtc ?? "");
      const status = Number.isNaN(expiresMs) ? "unknown" : expiresMs <= now ? "expired" : "active";
      return el("tr", {}, [
        el("td", { class: "rm-num", text: row.at ? localTimeLabel(row.at) : "—" }),
        el("td", { class: "rm-mono", text: row.serialNumber ?? "—" }),
        el("td", { class: "rm-mono", text: shortFingerprint(row.machineFingerprintHash) }),
        el("td", { text: row.licenseType ?? "—" }),
        el("td", { class: "rm-num", text: row.expiresAtUtc ? localTimeLabel(row.expiresAtUtc) : "—" }),
        el("td", {
          class: "rm-num",
          text: Number.isNaN(expiresMs) || Number.isNaN(fromMs) ? "—" : humanDuration(expiresMs - fromMs)
        }),
        el("td", {}, [
          el("span", { class: `rm-badge ${status === "active" ? "rm-badge-pass" : "rm-badge-notrun"}`, text: status })
        ])
      ]);
    })
  );
}

/** `replaceChildren` without relying on the newer DOM method, matching this page's no-innerHTML rule. */
function replaceChildren(node, children) {
  while (node.firstChild) node.removeChild(node.firstChild);
  node.appendChild(frag(children));
}

/* ==========================================================================
   View entry point
   ========================================================================== */

/** @param {any} ctx */
export function renderLicenseIssuer(ctx) {
  const first = state.built === null;
  const { root } = state.built ?? build();
  if (first) {
    ctx.onMount(() => {
      paint();
      void loadReadiness();
      void loadHistory();
    });
  } else {
    ctx.onMount(paint);
  }
  return root;
}

export const __test__ = { PRESETS, REASON_MESSAGE, humanDuration, shortFingerprint, minuteFloor, currentWindow, state };
