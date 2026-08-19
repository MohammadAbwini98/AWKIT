/**
 * Dashboard side of the License Issuer — everything except the signing itself.
 *
 * This module never signs, never reads the private key, and never learns where it is. It builds a
 * whitelisted payload from the browser's request and hands it to the trusted bridge
 * (`tools/license-issuer/roadmap-bridge.mts`), which runs the repository's one real
 * `LicenseIssuerService` in a separate short-lived process.
 *
 * Two rules govern the spawn and neither is negotiable:
 *   1. `shell: false`, with argv fixed at module scope. The only variable part of the command line
 *      is a command name checked against a literal allowlist, so a path containing a space, `&`,
 *      `(` or `)` stays a literal path and no browser value can ever become a command.
 *   2. The request travels on stdin, not argv. There is therefore no command line carrying operator
 *      input at all — nothing to quote, truncate, or leak into a process listing.
 *
 * Rebuilding the payload field by field is deliberate: a spread of the parsed body would forward
 * whatever else the browser put in it, and "the service ignores unknown fields" is a property of
 * today's service rather than a boundary.
 */

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

import { REPO_ROOT } from "./sources.mjs";

const require = createRequire(import.meta.url);

/** The bridge and the TypeScript loader that runs it. Both fixed; neither derived from a request. */
const BRIDGE_SCRIPT = join(REPO_ROOT, "tools", "license-issuer", "roadmap-bridge.mts");
const TSX_CLI = resolveTsxCli();

/** Commands the bridge accepts. Anything not in this list never reaches a spawn. */
const BRIDGE_COMMANDS = new Set(["readiness", "parse", "issue", "history"]);

export const LICENSE_ISSUE_ACTION_HEADER = "license-issue";

/** Matches the bridge's own cap. Rejecting early means an oversized body costs no process. */
const MAX_REQUEST_BYTES = 64 * 1024;
/** Signing is local Ed25519 over a few hundred bytes; a slow run means something is wrong. */
const BRIDGE_TIMEOUT_MS = 30_000;
const MAX_BRIDGE_OUTPUT_BYTES = 1024 * 1024;

const LICENSE_TYPES = new Set(["trial", "standard", "enterprise"]);
const ENTITLEMENTS = new Set([
  "workflow.execute",
  "workflow.concurrent",
  "workflow.scheduled",
  "automation.browser"
]);
/** Same shape the issuer service accepts: ISO-8601 to minute precision or finer. */
const WINDOW_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function resolveTsxCli() {
  try {
    return require.resolve("tsx/cli");
  } catch {
    return null;
  }
}

/**
 * Run one bridge command. Resolves to the bridge's own `{ok, …}` envelope, or a reason code — never
 * to a message built from the child's stderr, which could carry a filesystem path.
 *
 * @param {"readiness"|"parse"|"issue"|"history"} command
 * @param {unknown} [payload] serialised to stdin; omitted entirely for commands that take none
 * @returns {Promise<{ok: true, value: any}|{ok: false, reason: string}>}
 */
export function runIssuerBridge(command, payload) {
  if (!BRIDGE_COMMANDS.has(command)) return Promise.resolve({ ok: false, reason: "ISSUER_OPTIONS_INVALID" });
  if (!TSX_CLI) return Promise.resolve({ ok: false, reason: "ISSUER_BRIDGE_UNAVAILABLE" });

  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [TSX_CLI, BRIDGE_SCRIPT, command],
      {
        cwd: REPO_ROOT,
        env: process.env,
        shell: false,
        windowsHide: true,
        timeout: BRIDGE_TIMEOUT_MS,
        maxBuffer: MAX_BRIDGE_OUTPUT_BYTES,
        encoding: "utf8"
      },
      (error, stdout) => {
        if (error && !stdout) return resolve({ ok: false, reason: "ISSUER_BRIDGE_FAILED" });
        // The loader can print warnings; the envelope is the last complete JSON line.
        const line = String(stdout)
          .split("\n")
          .map((entry) => entry.trim())
          .filter((entry) => entry.startsWith("{"))
          .pop();
        if (!line) return resolve({ ok: false, reason: "ISSUER_BRIDGE_FAILED" });
        try {
          const parsed = JSON.parse(line);
          if (parsed && parsed.ok === true) return resolve({ ok: true, value: parsed.value });
          return resolve({
            ok: false,
            reason: typeof parsed?.reason === "string" ? parsed.reason : "ISSUER_BRIDGE_FAILED"
          });
        } catch {
          return resolve({ ok: false, reason: "ISSUER_BRIDGE_FAILED" });
        }
      }
    );
    child.once("error", () => resolve({ ok: false, reason: "ISSUER_BRIDGE_FAILED" }));
    if (payload === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(JSON.stringify(payload), "utf8");
    }
  });
}

/** @param {unknown} body */
export function parseActivationRequestBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "ACTIVATION_REQUEST_INVALID" };
  }
  const text = body.activationRequestText;
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, reason: "ACTIVATION_REQUEST_INVALID" };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BYTES) {
    return { ok: false, reason: "ACTIVATION_REQUEST_TOO_LARGE" };
  }
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, reason: "ACTIVATION_REQUEST_NOT_JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "ACTIVATION_REQUEST_INVALID" };
  }
  return { ok: true, value: parsed };
}

/**
 * Rebuild the issue payload from allowlisted fields only.
 *
 * The activation request is forwarded as parsed because the bridge's `isActivationRequest` is its
 * authoritative validator — restating its rules here would create a second, drifting definition.
 * The license terms are rebuilt field by field, so no extra property reaches the signing process.
 *
 * @param {unknown} body
 */
export function buildIssuePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "ISSUER_OPTIONS_INVALID" };
  }

  const parsedRequest = parseActivationRequestBody(body);
  if (!parsedRequest.ok) return parsedRequest;

  const { licenseType, entitlements, validity } = body;
  if (typeof licenseType !== "string" || !LICENSE_TYPES.has(licenseType)) {
    return { ok: false, reason: "ISSUER_OPTIONS_INVALID" };
  }
  if (!Array.isArray(entitlements) || entitlements.length === 0 || entitlements.length > ENTITLEMENTS.size) {
    return { ok: false, reason: "ISSUER_OPTIONS_INVALID" };
  }
  if (new Set(entitlements).size !== entitlements.length) {
    return { ok: false, reason: "ISSUER_OPTIONS_INVALID" };
  }
  if (!entitlements.every((item) => typeof item === "string" && ENTITLEMENTS.has(item))) {
    return { ok: false, reason: "ISSUER_OPTIONS_INVALID" };
  }
  if (!validity || typeof validity !== "object" || Array.isArray(validity)) {
    return { ok: false, reason: "ISSUER_OPTIONS_INVALID" };
  }

  const terms = {
    activationRequest: parsedRequest.value,
    licenseType,
    entitlements: entitlements.map(String)
  };

  if (validity.mode === "days") {
    if (!Number.isInteger(validity.days) || validity.days < 1) {
      return { ok: false, reason: "ISSUER_OPTIONS_INVALID" };
    }
    return { ok: true, value: { ...terms, validityDays: validity.days } };
  }
  if (validity.mode === "window") {
    const { validFromUtc, expiresAtUtc } = validity;
    if (typeof validFromUtc !== "string" || typeof expiresAtUtc !== "string") {
      return { ok: false, reason: "ISSUER_OPTIONS_INVALID" };
    }
    if (!WINDOW_TIMESTAMP.test(validFromUtc) || !WINDOW_TIMESTAMP.test(expiresAtUtc)) {
      return { ok: false, reason: "ISSUER_TIMESTAMP_INVALID" };
    }
    if (!(Date.parse(expiresAtUtc) > Date.parse(validFromUtc))) {
      return { ok: false, reason: "ISSUER_EXPIRY_NOT_AFTER_START" };
    }
    return { ok: true, value: { ...terms, validityWindow: { validFromUtc, expiresAtUtc } } };
  }
  return { ok: false, reason: "ISSUER_OPTIONS_INVALID" };
}

export const __test__ = { BRIDGE_SCRIPT, TSX_CLI, MAX_REQUEST_BYTES, BRIDGE_COMMANDS };
