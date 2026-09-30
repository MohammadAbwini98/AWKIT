/**
 * L10.0 frozen fixture set: deterministic baseline/mutated page pairs for the DOM-intelligence gate.
 *
 * Every case is rendered from this module only, so the HTML is byte-stable; the benchmark records a
 * SHA-256 of each rendered page and `verify:dom-intelligence-gate` re-renders and compares them, so a
 * fixture edit cannot silently change the evidence. `truthSelector` names the correct element in the
 * mutated page, or null when the correct answer is "no match" (any candidate is a false candidate).
 * Neither selector is ever shown to a matcher: AWKIT gets the recorded step, Scrapling gets the
 * baseline element dictionary.
 */
import { createHash } from "node:crypto";

export interface DomCase {
  id: string;
  drift: string;
  expectation: "recoverable" | "no-match";
  /** Baseline selector used only to click (record) the target and to seed Scrapling's reference. */
  targetSelector: string;
  /** The correct element in the mutated page; null when the target no longer exists. */
  truthSelector: string | null;
  baseline: string;
  mutated: string;
}

const TITLE = "Orders — Acme Admin";

interface PageOptions {
  rows?: number[];
  rowsBeforeForm?: number;
  viewHref?: (id: number) => string;
  actions?: string;
  notes?: string;
  beforeForm?: string;
  formBody?: string;
  main?: string;
}

const DEFAULT_ACTIONS =
  '<button type="button" class="btn btn-link" id="cancel-edit">Cancel</button>' +
  '<button type="button" class="btn btn-secondary" id="save-draft">Save draft</button>' +
  '<button type="button" class="btn btn-primary save-order" id="save-order">Save changes</button>';

const DEFAULT_NOTES =
  '<label for="notes">Notes</label><textarea id="notes" name="notes" placeholder="Add a note"></textarea>';

function range(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}

function row(id: number, href: (id: number) => string): string {
  const customer = ["Northwind", "Contoso", "Fabrikam", "Tailspin", "Litware", "Adatum"][id % 6];
  const status = ["Paid", "Pending", "Refunded", "Shipped"][id % 4];
  return (
    `<tr><td>#${id}</td><td>${customer} Ltd</td><td>$${(id * 7) % 900}.00</td><td><span class="badge">${status}</span></td>` +
    `<td><a class="row-link" href="${href(id)}">View</a> <button type="button" class="btn btn-small">Refund</button></td></tr>`
  );
}

function ordersPage(options: PageOptions = {}): string {
  const href = options.viewHref ?? ((id: number) => `/orders/${id}`);
  const rows = (options.rows ?? range(1040, 12)).map((id) => row(id, href)).join("");
  const extraRows = options.rowsBeforeForm
    ? `<table class="archive"><tbody>${range(5000, options.rowsBeforeForm).map((id) => row(id, href)).join("")}</tbody></table>`
    : "";
  const formBody =
    options.formBody ??
    `<label for="cust">Customer</label><input id="cust" name="customer" value="Northwind Ltd">` +
      `<label for="ship">Shipping method</label><select id="ship" name="shipping"><option>Ground</option><option>Express</option></select>` +
      (options.notes ?? DEFAULT_NOTES) +
      `<div class="form-actions">${options.actions ?? DEFAULT_ACTIONS}</div>`;
  const main =
    options.main ??
    `<section class="toolbar"><input type="search" name="q" placeholder="Search orders">` +
      `<button type="button" class="btn btn-secondary" id="export-btn">Export CSV</button>` +
      `<button type="button" class="btn btn-primary" id="new-order">New order</button></section>` +
      `<table class="orders"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>` +
      extraRows +
      (options.beforeForm ?? "") +
      `<section class="order-form" aria-labelledby="edit-heading"><h2 id="edit-heading">Edit order</h2>` +
      `<form id="order-edit">${formBody}</form></section>`;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${TITLE}</title></head><body>` +
    `<header class="top-bar"><a href="/" class="brand">Acme</a><nav aria-label="Primary">` +
    `<a href="/orders">Orders</a><a href="/customers">Customers</a><a href="/reports">Reports</a><a href="/settings">Settings</a></nav>` +
    `<button type="button" class="btn btn-ghost" id="user-menu" aria-label="Account menu">MA</button></header>` +
    `<div class="layout"><aside class="sidebar"><ul>` +
    ["All", "Open", "Paid", "Refunded", "Shipped", "Archived"].map((name) => `<li><a href="/orders?f=${name.toLowerCase()}">${name}</a></li>`).join("") +
    `</ul></aside><main id="main">${main}</main></div>` +
    `<footer><p>Acme Admin</p><a href="/help">Help</a></footer></body></html>`
  );
}

const NOTIFY_PANEL =
  '<section class="notify-settings"><h2>Notifications</h2>' +
  '<label><input type="checkbox" id="n-email"> Email me about this order</label>' +
  '<button type="button" class="btn btn-primary" id="save-notify">Save changes</button></section>';

const baseline = ordersPage();

export const DOM_CASES: DomCase[] = [
  {
    id: "wrapper-insertion",
    drift: "a tooltip wrapper is inserted around the target",
    expectation: "recoverable",
    targetSelector: "#save-order",
    truthSelector: "#save-order",
    baseline,
    mutated: ordersPage({ actions: DEFAULT_ACTIONS.replace(/(<button type="button" class="btn btn-primary save-order"[^]*?<\/button>)/, '<span class="tooltip-anchor">$1</span>') })
  },
  {
    id: "moved-within-region",
    drift: "the action bar moves to the top of the form",
    expectation: "recoverable",
    targetSelector: "#save-order",
    truthSelector: "#save-order",
    baseline,
    mutated: ordersPage({
      formBody:
        `<div class="form-actions">${DEFAULT_ACTIONS}</div>` +
        `<label for="cust">Customer</label><input id="cust" name="customer" value="Northwind Ltd">` +
        `<label for="ship">Shipping method</label><select id="ship" name="shipping"><option>Ground</option><option>Express</option></select>` +
        DEFAULT_NOTES
    })
  },
  {
    id: "id-changed",
    drift: "the target id is renamed",
    expectation: "recoverable",
    targetSelector: "#save-order",
    truthSelector: "#order-save-btn",
    baseline,
    mutated: ordersPage({ actions: DEFAULT_ACTIONS.replace('id="save-order"', 'id="order-save-btn"') })
  },
  {
    id: "id-removed",
    drift: "the target id is removed",
    expectation: "recoverable",
    targetSelector: "#save-order",
    truthSelector: "#order-edit .save-order",
    baseline,
    mutated: ordersPage({ actions: DEFAULT_ACTIONS.replace(' id="save-order"', "") })
  },
  {
    id: "class-changed",
    drift: "the target classes are renamed",
    expectation: "recoverable",
    targetSelector: "#save-order",
    truthSelector: "#save-order",
    baseline,
    mutated: ordersPage({ actions: DEFAULT_ACTIONS.replace('class="btn btn-primary save-order"', 'class="button button--primary js-save"') })
  },
  {
    id: "aria-retained",
    drift: "id, classes and visible text change; aria-label is retained",
    expectation: "recoverable",
    targetSelector: "#save-order",
    truthSelector: "#btn-7f3a",
    baseline: ordersPage({ actions: DEFAULT_ACTIONS.replace('id="save-order">', 'id="save-order" aria-label="Save order">') }),
    mutated: ordersPage({
      actions: DEFAULT_ACTIONS.replace(
        '<button type="button" class="btn btn-primary save-order" id="save-order">Save changes</button>',
        '<button type="button" class="c-btn c-btn--solid" id="btn-7f3a" aria-label="Save order">Update</button>'
      )
    })
  },
  {
    id: "text-drift",
    drift: "the visible label drifts slightly",
    expectation: "recoverable",
    targetSelector: "#save-order",
    truthSelector: "#save-order",
    baseline,
    mutated: ordersPage({ actions: DEFAULT_ACTIONS.replace(">Save changes<", ">Save all changes<") })
  },
  {
    id: "sibling-reorder",
    drift: "a sibling is inserted and the action order is reversed",
    expectation: "recoverable",
    targetSelector: "#save-order",
    truthSelector: "#save-order",
    baseline,
    mutated: ordersPage({
      actions:
        '<button type="button" class="btn btn-primary save-order" id="save-order">Save changes</button>' +
        '<button type="button" class="btn btn-secondary" id="preview-order">Preview</button>' +
        '<button type="button" class="btn btn-secondary" id="save-draft">Save draft</button>' +
        '<button type="button" class="btn btn-link" id="cancel-edit">Cancel</button>'
    })
  },
  {
    id: "duplicate-text-decoy",
    drift: "the target loses its id and an identical 'Save changes' button appears in a new panel above",
    expectation: "recoverable",
    targetSelector: "#save-order",
    truthSelector: "#order-edit .save-order",
    baseline,
    mutated: ordersPage({ beforeForm: NOTIFY_PANEL, actions: DEFAULT_ACTIONS.replace(' id="save-order"', "") })
  },
  {
    id: "same-tag-decoy-target-removed",
    drift: "the target is removed; its same-tag sibling 'Save draft' remains",
    expectation: "no-match",
    targetSelector: "#save-order",
    truthSelector: null,
    baseline,
    mutated: ordersPage({ actions: DEFAULT_ACTIONS.replace(/<button type="button" class="btn btn-primary save-order"[^]*?<\/button>/, "") })
  },
  {
    id: "other-region-decoy-target-removed",
    drift: "the edit form is removed; an identical 'Save changes' button exists in another panel",
    expectation: "no-match",
    targetSelector: "#save-order",
    truthSelector: null,
    baseline,
    mutated: ordersPage({ formBody: "<p>This order is locked.</p>", beforeForm: NOTIFY_PANEL })
  },
  {
    id: "page-variant-same-url",
    drift: "same URL and title, materially different page (order not found)",
    expectation: "no-match",
    targetSelector: "#save-order",
    truthSelector: null,
    baseline,
    mutated: ordersPage({
      main:
        '<div class="empty-state"><h1>Order not found</h1><p>The order you are looking for was deleted.</p>' +
        '<button type="button" class="btn btn-primary" id="back-to-orders">Back to orders</button>' +
        '<button type="button" class="btn btn-secondary" id="contact-support">Contact support</button></div>'
    })
  },
  {
    id: "combined-drift",
    drift: "wrapper + id + classes + label all change together (redesign)",
    expectation: "recoverable",
    targetSelector: "#save-order",
    truthSelector: "#submit-order-edit",
    baseline,
    mutated: ordersPage({
      actions: DEFAULT_ACTIONS.replace(
        '<button type="button" class="btn btn-primary save-order" id="save-order">Save changes</button>',
        '<div class="ui-group"><button type="button" class="ui-button primary" id="submit-order-edit">Save order</button></div>'
      )
    })
  },
  {
    id: "large-dom-shift",
    drift: "target sits beyond 200 visible elements; 30 rows are inserted before it and its id changes",
    expectation: "recoverable",
    targetSelector: "#save-order",
    truthSelector: "#order-save",
    baseline: ordersPage({ rowsBeforeForm: 90 }),
    mutated: ordersPage({ rowsBeforeForm: 120, actions: DEFAULT_ACTIONS.replace('id="save-order"', 'id="order-save"') })
  },
  {
    id: "field-relabel",
    drift: "a textarea is relabelled and its id, name and placeholder change",
    expectation: "recoverable",
    targetSelector: "#notes",
    truthSelector: "#order-notes",
    baseline,
    mutated: ordersPage({
      notes:
        '<label for="order-notes">Internal notes</label>' +
        '<textarea id="order-notes" name="internal_notes" placeholder="Add an internal note"></textarea>'
    })
  },
  {
    id: "list-item-link",
    drift: "one of 12 identical 'View' links: rows are re-sorted and every href changes shape",
    expectation: "recoverable",
    targetSelector: 'a[href="/orders/1045"]',
    truthSelector: 'a[href="/o/1045?tab=summary"]',
    baseline,
    mutated: ordersPage({
      rows: [1051, 1045, 1040, 1049, 1042, 1047, 1041, 1050, 1043, 1046, 1044, 1048],
      viewHref: (id) => `/o/${id}?tab=summary`
    })
  }
];

/** Normalization fixture: visible facts plus canaries that a correct normalizer must NOT emit. */
export const NORMALIZATION_PAGE =
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Checkout — Acme</title>` +
  `<style>.is-hidden{display:none}.dim{color:#666}</style></head><body>` +
  `<header><nav aria-label="Primary"><a href="/">Home</a><a href="/cart">Cart</a></nav></header>` +
  `<main><h1>Checkout</h1><div role="alert" class="error">Payment failed: card declined</div>` +
  `<form id="pay"><label for="email">Email</label><input id="email" name="email" value="buyer@example.com">` +
  `<label for="pw">Password</label><input id="pw" type="password" name="password" value="PASSWORD-CANARY">` +
  `<label for="cc">Card number</label><input id="cc" name="card" value="4111 1111 1111 1111">` +
  `<button type="button" id="pay-now">Pay now</button></form>` +
  `<table><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody><tr><td>Widget</td><td>2</td></tr></tbody></table>` +
  `<div class="is-hidden">HIDDEN-CSS-CANARY internal discount code</div>` +
  `<div hidden>HIDDEN-ATTR-CANARY</div>` +
  `<template><p>TEMPLATE-CANARY</p></template>` +
  `<span aria-hidden="true" class="dim">ARIA-HIDDEN-CANARY</span>` +
  `<!-- COMMENT-CANARY -->` +
  `<script>window.__token = "SCRIPT-CANARY";</script>` +
  `</main></body></html>`;

export const NORMALIZATION_REQUIRED_FACTS = ["Checkout", "Payment failed: card declined", "Email", "Password", "Pay now", "Widget"];
/** Canaries that must never reach a model: hidden, template, script, comment and secret values. */
export const NORMALIZATION_FORBIDDEN = [
  "HIDDEN-CSS-CANARY",
  "HIDDEN-ATTR-CANARY",
  "TEMPLATE-CANARY",
  "COMMENT-CANARY",
  "SCRIPT-CANARY",
  "PASSWORD-CANARY",
  "4111 1111 1111 1111"
];

/** DOM sizes used for the relocation-latency scaling series (synthetic, generated in the host). */
export const SCALE_SIZES = [250, 1_000, 4_000, 10_000];

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Content hash of the whole fixture set: every case page plus the normalization page. */
export function fixtureSetHash(): string {
  return sha256(
    JSON.stringify({
      cases: DOM_CASES.map(({ id, targetSelector, truthSelector, expectation, baseline: b, mutated }) => ({
        id,
        targetSelector,
        truthSelector,
        expectation,
        baseline: sha256(b),
        mutated: sha256(mutated)
      })),
      normalization: sha256(NORMALIZATION_PAGE),
      scale: SCALE_SIZES
    })
  );
}
