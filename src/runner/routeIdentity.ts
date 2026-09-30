import { createHash } from "node:crypto";

import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

import { urlPathTemplate } from "./evidence/ExecutionEvidence";

/**
 * L11.F route identity: which application route a document is on, as a short hash.
 *
 * Recovery memory and DOM references are bound to it, so a structurally similar control on ANOTHER
 * route (an SPA `pushState` to a different view, a hash-router change) can never satisfy a step's
 * recovery proof by accident. The route is the origin plus the path template L5a already uses for
 * evidence (record identifiers stripped: `/orders/48213` and `/orders/48214` are one route), plus the
 * template of a hash route (`#/settings/7` → `#/settings/:id`). The query and a plain fragment are not
 * part of a route. Only the hash is ever stored, never the URL.
 *
 * Undefined for a document with no route identity (`about:blank`, `data:`, a `setContent` page): such a
 * binding cannot be compared, so it neither proves nor refuses anything.
 */

let redactor: SemanticRedactor | undefined;

export function routeKey(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  redactor ??= new SemanticRedactor();
  let template = urlPathTemplate(`${url.origin}${url.pathname}`, redactor);
  const hashRoute = /^#!?(\/[^?]*)/.exec(url.hash);
  if (hashRoute) template += `#${urlPathTemplate(`${url.origin}${hashRoute[1]}`, redactor).slice(url.origin.length)}`;
  return createHash("sha256").update(template).digest("hex").slice(0, 20);
}

/** `unbound` when either side has no route identity; never a refusal by itself. */
export function compareRoutes(recorded: string | undefined, current: string | undefined): "match" | "mismatch" | "unbound" {
  if (!recorded || !current) return "unbound";
  return recorded === current ? "match" : "mismatch";
}
