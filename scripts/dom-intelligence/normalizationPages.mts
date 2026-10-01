/**
 * L11.G page fixtures for AI-context normalization (verify:dom-normalization, benchmark:dom-normalization).
 *
 *  - safety:    every kind of content the path must keep away from AI context, each marked by a unique
 *               canary: CSS-hidden, [hidden], aria-hidden and visibility-hidden text, script, style,
 *               template, comment and noscript bodies, input values, a hidden input, textarea and option
 *               text, SVG text, a data: URI, an event handler, a non-allowlisted attribute, a URL query
 *               and fragment, an iframe document; plus secrets in VISIBLE text the redactor must remove
 *               (a session token, a bearer token, an email address, a long account number).
 *  - protected: a password sign-in, a one-time code, a CAPTCHA frame and a passkey prompt: refused before
 *               anything is serialized. `sso-text` is the false-positive control (no refusal).
 *  - scale:     a page far past every bound (truncated, still bounded).
 *  - labelled:  one page per synthetic L5 labelled case (scripts/ai-harness/errorQualitySet.ts), the page as
 *               it stood when that step failed, with the causal facts a context must keep. Authored from
 *               each case's own events, before any model saw a context; several carry an unrelated on-page
 *               message on purpose, so a context can also mislead.
 */

export interface NormalizationPage {
  id: string;
  kind: "safety" | "protected" | "control" | "scale" | "labelled";
  html: string;
  /** Phrases the normalized context must keep (case-insensitive). */
  facts: string[];
  /** Strings that must never reach the HTML handed to the provider, the context or a prompt. */
  canaries: string[];
  /** The L5 labelled case this page belongs to, and which of its rows (default 0). */
  caseId?: string;
  row?: number;
}

const page = (title: string, body: string, head = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>
<header><nav aria-label="Main"><a href="/">Home</a> <a href="/orders">Orders</a> <a href="/account">Account</a></nav></header>
<main>${body}</main>
<footer><p>Shop Example · Help centre</p></footer></body></html>`;

const C = (label: string) => `QZX${label}CANARY`;

export const SAFETY_CANARIES = [
  "CSSHIDDEN",
  "HIDDENATTR",
  "ARIAHIDDEN",
  "VISHIDDEN",
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
  "COMMENT",
  "NOSCRIPT",
  "VALUE",
  "HIDDENINPUT",
  "TEXTAREA",
  "OPTION",
  "SVG",
  "DATAURI",
  "HANDLER",
  "DATAATTR",
  "QUERY",
  "FRAGMENT",
  "SRCDOC"
].map(C);

/** Visible secrets the redactor must remove (they are page text, so they reach the provider by design). */
export const VISIBLE_SECRETS = ["QZXTOKEN-9f2a7b", "abcdEFGH12345678QZXBEARER", "billing.team@shop.example", "48213977"];

export const NORMALIZATION_PAGES: readonly NormalizationPage[] = Object.freeze([
  {
    id: "safety",
    kind: "safety",
    // The visible secrets come first, so they sit inside every bound: only the redactor can remove them,
    // and the words around them ("Session", "Header", "Contact") must survive it.
    facts: ["Order summary", "Card declined", "Place order", "Email", "Items", "Session", "Header", "Contact"],
    canaries: [...SAFETY_CANARIES, ...VISIBLE_SECRETS],
    html: page(
      "Order summary",
      `<h1>Order summary</h1>
<p>Session token: QZXTOKEN-9f2a7b</p><p>Header Bearer abcdEFGH12345678QZXBEARER</p>
<p>Contact billing.team@shop.example about account 48213977.</p>
<div role="alert">Card declined. Use another card.</div>
<div style="display:none">${C("CSSHIDDEN")}</div><p hidden>${C("HIDDENATTR")}</p><span aria-hidden="true">${C("ARIAHIDDEN")}</span>
<div style="visibility:hidden">${C("VISHIDDEN")}</div>
<script>window.x = "${C("SCRIPT")}";</script><style>.a::after { content: "${C("STYLE")}"; }</style>
<template><p>${C("TEMPLATE")}</p></template><!-- ${C("COMMENT")} --><noscript>${C("NOSCRIPT")}</noscript>
<form aria-label="Checkout">
  <label for="email">Email</label><input id="email" type="email" required aria-invalid="true" value="${C("VALUE")}">
  <input type="hidden" name="csrf" value="${C("HIDDENINPUT")}">
  <label for="note">Note</label><textarea id="note">${C("TEXTAREA")}</textarea>
  <label for="ship">Shipping</label><select id="ship"><option>${C("OPTION")}</option></select>
  <button type="submit" disabled>Place order</button>
</form>
<svg width="10" height="10"><text>${C("SVG")}</text></svg>
<img alt="Card logo" src="data:image/png;base64,iVBORw0KGgo${C("DATAURI")}">
<div onclick="track('${C("HANDLER")}')" data-secret="${C("DATAATTR")}">Need help?</div>
<a href="https://help.shop.example/cards?ref=${C("QUERY")}#${C("FRAGMENT")}">Card help</a>
<iframe srcdoc="<p>${C("SRCDOC")}</p>" title="promo"></iframe>
<table aria-label="Items"><tr><th>Item</th><th>Price</th></tr><tr><td>Lamp</td><td>12</td></tr><tr><td>Desk</td><td>80</td></tr></table>`
    )
  },
  {
    id: "protected-password",
    kind: "protected",
    facts: [],
    canaries: [C("PROTECTEDPW")],
    html: page("Sign in", `<h1>Sign in</h1><form><label for="u">Username</label><input id="u"><label for="p">Password</label><input id="p" type="password"><button>Sign in</button></form><p>${C("PROTECTEDPW")}</p>`)
  },
  {
    id: "protected-otp",
    kind: "protected",
    facts: [],
    canaries: [C("PROTECTEDOTP")],
    html: page("Verify", `<h1>Enter the code</h1><form><label for="c">Code</label><input id="c" autocomplete="one-time-code"><button>Verify</button></form><p>${C("PROTECTEDOTP")}</p>`)
  },
  {
    id: "protected-captcha",
    kind: "protected",
    facts: [],
    canaries: [C("PROTECTEDCAPTCHA")],
    html: page(
      "Checkout",
      `<h1>Checkout</h1><iframe title="reCAPTCHA" src="about:blank#recaptcha" data-src="https://www.google.com/recaptcha/api2/anchor"></iframe><div aria-label="captcha challenge">Prove you are human</div><p>${C("PROTECTEDCAPTCHA")}</p>`
    )
  },
  {
    id: "protected-passkey",
    kind: "protected",
    facts: [],
    canaries: [C("PROTECTEDPASSKEY")],
    html: page("Approve sign-in", `<h1>Use your passkey</h1><p>Approve this sign-in with your security key (WebAuthn).</p><button>Use passkey</button><p>${C("PROTECTEDPASSKEY")}</p>`)
  },
  {
    id: "sso-text",
    kind: "control",
    facts: ["Reports", "Open reports"],
    canaries: [],
    html: page("Reports", `<h1>Reports</h1><p>Your company uses single sign-on through its identity provider.</p><button>Open reports</button>`)
  },
  {
    id: "scale",
    kind: "scale",
    facts: ["Audit log"],
    canaries: [],
    html: page(
      "Audit log",
      `<h1>Audit log</h1>${Array.from({ length: 60 }, (_, i) => `<h2>Section ${i}</h2>`).join("")}<form aria-label="Filters">${Array.from({ length: 40 }, (_, i) => `<label for="f${i}">Filter ${i}</label><input id="f${i}">`).join("")}</form>` +
        `${Array.from({ length: 300 }, (_, i) => `<button>Action ${i}</button>`).join("")}<table aria-label="Entries">${Array.from({ length: 4000 }, (_, i) => `<tr><td>Entry ${i}</td><td>${"x".repeat(40)}</td></tr>`).join("")}</table>`
    )
  },
  // ── The labelled set: the page each failed step was on ───────────────────────────────────────────
  {
    id: "lbl-toast-timeout",
    caseId: "toast-timeout",
    kind: "labelled",
    // The toast came and went before the timeout: the page no longer shows it.
    facts: ["Checkout", "Place order"],
    canaries: [],
    html: page("Checkout", `<h1>Checkout</h1><form aria-label="Payment"><label for="card">Card number</label><input id="card"><button type="submit">Place order</button></form><p>Delivery in 2 to 3 days.</p>`)
  },
  {
    id: "lbl-native-validation",
    caseId: "native-validation",
    kind: "labelled",
    facts: ["Email", "required", "INVALID", "Submit"],
    canaries: [],
    html: page("Contact us", `<h1>Contact us</h1><form aria-label="Contact"><label for="name">Name</label><input id="name"><label for="email">Email</label><input id="email" type="email" required aria-invalid="true"><button type="submit">Submit</button></form>`)
  },
  {
    id: "lbl-conflict-409",
    caseId: "conflict-and-validation",
    kind: "labelled",
    facts: ["changed by someone else", "Save order"],
    canaries: [],
    html: page("Edit order", `<h1>Edit order</h1><div role="alert">This order was changed by someone else. Reload it before saving.</div><form aria-label="Order"><label for="qty">Quantity</label><input id="qty"><button type="submit">Save order</button></form>`)
  },
  {
    id: "lbl-conflict-422",
    caseId: "conflict-and-validation",
    row: 1,
    kind: "labelled",
    facts: ["Postcode", "INVALID", "Save order"],
    canaries: [],
    html: page(
      "Edit order",
      `<h1>Edit order</h1><form aria-label="Delivery"><label for="pc">Postcode</label><input id="pc" aria-invalid="true" aria-describedby="pc-e"><span id="pc-e">Enter a valid postcode.</span><button type="submit">Save order</button></form>`
    )
  },
  {
    id: "lbl-server-error",
    caseId: "server-error-rows",
    kind: "labelled",
    facts: ["Something went wrong on our side"],
    canaries: [],
    html: page("Server error", `<h1>Something went wrong on our side</h1><p>Please try again later.</p>`)
  },
  {
    id: "lbl-transport-noise",
    caseId: "transport-noise",
    kind: "labelled",
    facts: ["Submit order"],
    canaries: [],
    html: page("Basket", `<h1>Basket</h1><div role="status">Tip: you can reorder items by dragging them.</div><button>Submit order</button><p>2 items in your basket.</p>`)
  },
  {
    id: "lbl-pageerror-timeout",
    caseId: "pageerror-timeout",
    kind: "labelled",
    facts: ["Your order", "Order total"],
    canaries: [],
    html: page("Your order", `<h1>Your order</h1><h2>Order total</h2><p></p><button>Pay now</button>`)
  },
  {
    id: "lbl-burst",
    caseId: "burst",
    kind: "labelled",
    facts: ["Saving is temporarily unavailable", "Save draft"],
    canaries: [],
    html: page("Drafts", `<h1>Drafts</h1><div role="alert">Saving is temporarily unavailable. Try again in a few minutes.</div><button>Save draft</button>`)
  },
  {
    id: "lbl-unrelated-server-error-first",
    caseId: "unrelated-server-error-first",
    kind: "labelled",
    // The unrelated recommendations failure is visible on the page: a context can mislead here.
    facts: ["Save address"],
    canaries: [],
    html: page(
      "Address book",
      `<h1>Address book</h1><section aria-label="Recommended for you"><h2>Recommended for you</h2><div role="status">Recommendations are unavailable right now.</div></section><form aria-label="Address"><label for="street">Street</label><input id="street"><button type="submit">Save address</button></form>`
    )
  },
  {
    id: "lbl-cause-then-unrelated-console",
    caseId: "cause-then-unrelated-console",
    kind: "labelled",
    facts: ["could not take your payment"],
    canaries: [],
    html: page("Payment", `<h1>Payment</h1><div role="alert">We could not take your payment. You have not been charged.</div><button>Try again</button>`)
  },
  {
    id: "lbl-timeout-unrelated-console",
    caseId: "timeout-unrelated-console",
    kind: "labelled",
    // The table is empty, so the download link the step waited for never appears.
    facts: ["Invoices", "0 row"],
    canaries: [],
    html: page("Invoices", `<h1>Invoices</h1><table aria-label="Invoices"><tr><th>Invoice</th><th>Date</th></tr></table><p>No invoices for this period.</p>`)
  },
  {
    id: "lbl-earlier-step-unrelated-error",
    caseId: "earlier-step-unrelated-error",
    kind: "labelled",
    facts: ["Save address"],
    canaries: [],
    html: page(
      "Address book",
      `<h1>Address book</h1><section aria-label="Recommended for you"><h2>Recommended for you</h2><div role="status">Recommendations are unavailable right now.</div></section><form aria-label="Address"><label for="street">Street</label><input id="street"><button type="submit">Save address</button></form>`
    )
  },
  {
    id: "lbl-earlier-step-cause",
    caseId: "earlier-step-cause",
    kind: "labelled",
    facts: ["Save address"],
    canaries: [],
    html: page("Address book", `<h1>Address book</h1><form aria-label="Address"><label for="street">Street</label><input id="street"><button type="submit">Save address</button></form><p>Changes are saved when you press Save address.</p>`)
  }
]);
