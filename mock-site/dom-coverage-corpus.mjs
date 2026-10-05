/**
 * L12.23 DOM Coverage Lab corpus (awkit-djnl.21.23): deterministic pages for the DOM-intelligence coverage
 * verifier (`verify:dom-intelligence-coverage`), served by the mock site at `/dom-coverage-lab/<page>`.
 *
 * Every page is generated here from constants only (no randomness, no clock), so it renders byte-identically.
 * Each recovery fixture marks exactly ONE target with `data-testid="oracle-target"`. That attribute is the
 * verifier's oracle: the verifier reads and strips it before the Recorder or any recovery engine sees the page,
 * so it never helps a lookup. The `existing` fixtures reuse the frozen L10.0 orders page
 * (scripts/dom-intelligence/fixtures.mts), which the verifier serves itself; their oracle is a selector.
 *
 * A case is one mutation applied in place after the step is recorded and its locator forced to miss:
 * a generic operator from COVERAGE_RUNTIME, or `page:<name>`, a page's own deterministic change
 * (window.__fixture). `expect` is the only acceptable outcome: "recover" (the exact target) or "refuse"
 * (no element). Any other element is a wrong-element result and fails the verifier. A refusal while the
 * target still exists states why (`SENSITIVE`: an Approve/Delete/Submit step never recovers by design;
 * `SAFE_MISS`: AWKIT cannot prove it, measured 2026-10-05; `HIDDEN`: the target is hidden, a twin shown).
 *
 * Layers: `existing` = L12.23 Layer 2 (mutations on the existing fixtures), `lab` = Layer 1, `enterprise` =
 * Layer 4 (SYNTHETIC enterprise-style pages written by hand to the markup patterns of common enterprise stacks:
 * WebForms, Angular Material, UI5. They are not sanitized captures of any real application). CHALLENGE_PAGES
 * feed Layer 3 (protected-login detection and the read-time challenge check).
 *
 * SIMILAR_ROW_LAB (L12.24) feeds verify:similar-rows-safety: one picked control per page, and every control
 * carries a verifier-only `data-oracle-intent` (what it really does), read and stripped with the oracle target.
 */

export const ORACLE_SELECTOR = '[data-testid="oracle-target"]';
const ORACLE = ' data-testid="oracle-target"';
const mark = (yes) => (yes ? ORACLE : "");
const range = (start, count) => Array.from({ length: count }, (_, i) => start + i);
const VENDORS = ["Northwind", "Contoso", "Fabrikam", "Tailspin", "Litware", "Adatum"];

const CSS =
  "body{font:14px system-ui,sans-serif;margin:0}main{padding:16px}table{border-collapse:collapse}td,th{padding:4px 8px;border-bottom:1px solid #ddd}" +
  ".dialog,.modal{border:1px solid #888;padding:12px;margin:12px 0;background:#fff}[hidden]{display:none}.grid{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0}" +
  ".card{border:1px solid #ddd;padding:8px;width:160px}";

function shell(title, body, script = "") {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body>` +
    body +
    (script ? `<script>${script}</script>` : "") +
    "</body></html>"
  );
}

const header = (app) =>
  `<header class="top-bar"><a href="/" class="brand">${app}</a><nav aria-label="Primary"><a href="/home">Home</a><a href="/reports">Reports</a>` +
  `<a href="/settings">Settings</a></nav><button type="button" class="avatar" aria-label="Account menu">JD</button></header>`;

// ── Layer 1: Test Lab fixtures ─────────────────────────────────────────────────────────────────────────

function tableActions() {
  const row = (n) =>
    `<tr><td>INV-${n}</td><td>${VENDORS[n % 6]} Ltd</td><td>$${((n * 37) % 900) + 100}.00</td>` +
    `<td><button type="button" class="btn approve"${mark(n === 2042)}>Approve</button> <button type="button" class="btn reject">Reject</button></td></tr>`;
  return shell(
    "Pending invoices",
    header("Payables") +
      `<main><h1>Pending invoices</h1><table aria-label="Pending invoices"><thead><tr><th>Invoice</th><th>Vendor</th><th>Amount</th><th>Actions</th></tr></thead>` +
      `<tbody id="inv-body">${range(2031, 15).map(row).join("")}</tbody></table></main>`,
    "window.__fixture={sort:function(){var b=document.getElementById('inv-body');Array.prototype.slice.call(b.rows).reverse().forEach(function(r){b.appendChild(r);});}," +
      "removeRow:function(){var b=document.getElementById('inv-body');Array.prototype.slice.call(b.rows).forEach(function(r){if(r.cells[0].textContent==='INV-2042')r.remove();});}};"
  );
}

const PRODUCTS = ["Trail Runner 1", "Trail Runner 2", "Road Racer", "Peak Hiker", "City Walker", "Aqua Sandal", "Summit Boot", "Track Spike", "Studio Flat", "Harbor Loafer", "Canyon Clog", "Ridge Mid"];
function cardGrid() {
  const card = (name, i) =>
    `<li class="card"><h3>${name}</h3><p class="price">$${89 + i * 7}.00</p><button type="button" class="btn add-to-cart"${mark(name === "Trail Runner 2")}>Add to cart</button></li>`;
  return shell(
    "Catalog",
    header("Shop") + `<main><h1>Running shoes</h1><ul class="grid" aria-label="Products" id="products">${PRODUCTS.map(card).join("")}</ul></main>`,
    "window.__fixture={shuffle:function(){var g=document.getElementById('products');for(var i=0;i<5;i++)g.appendChild(g.firstElementChild);}," +
      "removeCard:function(){Array.prototype.slice.call(document.querySelectorAll('#products h3')).forEach(function(h){if(h.textContent==='Trail Runner 2')h.parentElement.remove();});}};"
  );
}

function formLabels() {
  const fields = [
    ["display-name", "displayName", "Display name"],
    ["work-email", "email", "Work email"],
    ["phone", "phone", "Phone"],
    ["job-title", "jobTitle", "Job title"],
    ["department", "department", "Department"]
  ];
  const field = ([id, name, label]) =>
    `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="text" placeholder="Enter ${label.toLowerCase()}"${mark(id === "job-title")}></div>`;
  return shell(
    "Profile settings",
    header("Directory") + `<main><h1>Profile</h1><form aria-label="Profile">${fields.map(field).join("")}<button type="button" class="btn primary">Save profile</button></form></main>`
  );
}

function dialogConfirm() {
  const dialog = (n) =>
    `<div role="dialog" aria-modal="true" aria-labelledby="dlg-${n}-title" class="dialog" id="dlg-${n}"><h2 id="dlg-${n}-title">Delete project Atlas?</h2>` +
    `<p>This permanently deletes 14 flows and their run history.</p><div class="dialog-actions"><button type="button" class="btn" id="dlg-${n}-cancel">Cancel</button>` +
    `<button type="button" class="btn danger" id="dlg-${n}-confirm"${ORACLE}>Delete project</button></div></div>`;
  const projects = ["Atlas", "Borealis", "Cygnus", "Draco"].map((p) => `<li><a href="/projects/${p.toLowerCase()}">${p}</a></li>`).join("");
  return shell(
    "Project settings",
    header("Projects") +
      `<main><h1>Projects</h1><ul aria-label="Projects">${projects}</ul>` +
      `<section class="danger-zone" aria-labelledby="dz"><h2 id="dz">Danger zone</h2><p>Deleting a project removes all its data.</p><button type="button" class="btn danger">Delete project</button></section>` +
      `<div id="dialog-root">${dialog(41)}</div></main>`,
    `var T=${JSON.stringify(dialog("__N__"))};window.__fixture={reopen:function(){document.getElementById('dialog-root').innerHTML=T.replace(/__N__/g,'42');},` +
      "close:function(){document.getElementById('dialog-root').innerHTML='';}};"
  );
}

function nestedContainers() {
  return shell(
    "Documents",
    header("Accounts") +
      `<main><div class="l1"><div class="l2"><section class="l3 statements" aria-label="Statements"><h2>September 2026</h2><div class="l4"><div class="l5"><ul class="l6 doc-list">` +
      `<li class="l7"><span class="l8"><a class="doc-link" href="/statements/2026-09.pdf"${ORACLE}>Download statement</a></span></li>` +
      `<li class="l7"><span class="l8"><a class="doc-link" href="/invoices/2026-09.pdf">Download invoice</a></span></li>` +
      `<li class="l7"><span class="l8"><a class="doc-link" href="/receipts/2026-09.pdf">Download receipt</a></span></li></ul></div></div></section></div></div>` +
      `<aside class="archive" aria-label="Archive"><h2>Archive</h2><ul><li><a class="doc-link" href="/statements/2026-08.pdf">Download statement</a></li></ul></aside></main>`
  );
}

function duplicateLabels() {
  const section = (id, title, lines, target) =>
    `<section id="${id}" aria-labelledby="${id}-h"><h2 id="${id}-h">${title}</h2><address>${lines}</address><button type="button" class="link-btn edit"${mark(target)}>Edit</button></section>`;
  return shell(
    "Checkout addresses",
    header("Store") +
      `<main id="addresses"><h1>Addresses</h1>${section("billing", "Billing address", "1 Main St<br>Springfield", false)}${section("shipping", "Shipping address", "22 Dock Rd<br>Harbor City", true)}</main>`,
    "window.__fixture={swap:function(){var m=document.getElementById('addresses');m.insertBefore(document.getElementById('shipping'),document.getElementById('billing'));}};"
  );
}

const TASKS = ["Rotate API keys", "Renew certificate", "Review access", "Archive logs", "Patch servers", "Update runbook", "Audit backups", "Close tickets", "Plan sprint", "Test failover"];
function reorderedRows() {
  const task = (t) =>
    `<li class="task"><label><input type="checkbox"> ${t}</label><button type="button" class="icon-btn" aria-label="More actions for ${t}"${mark(t === "Renew certificate")}>...</button></li>`;
  return shell(
    "Operations tasks",
    header("Ops") + `<main><h1>This week</h1><ul aria-label="Tasks" id="tasks">${TASKS.map(task).join("")}</ul></main>`,
    "window.__fixture={sort:function(){var l=document.getElementById('tasks');Array.prototype.slice.call(l.children).sort(function(a,b){return a.textContent.trim()<b.textContent.trim()?-1:1;}).forEach(function(c){l.appendChild(c);});}};"
  );
}

function dynamicIds() {
  const form =
    `<form class="MuiBox-root css-1x2y3z" id=":r0:"><div class="MuiFormControl-root css-13sljp9"><label for=":r1:" class="MuiInputLabel-root css-1jy569b">Subject</label><input id=":r1:" class="MuiInputBase-input css-1x5jdmq" name="subject"></div>` +
    `<div class="MuiFormControl-root css-13sljp9"><label for=":r3:" class="MuiInputLabel-root css-1jy569b">Details</label><textarea id=":r3:" class="MuiInputBase-input css-10oer18" name="details"></textarea></div>` +
    `<div class="MuiStack-root css-1d9cypr"><button id=":r7:" class="MuiButton-root MuiButton-contained css-1hw9j7s" type="button"${ORACLE}>Submit request</button>` +
    `<button id=":r8:" class="MuiButton-root MuiButton-text css-1ujsas3" type="button">Save as draft</button></div></form>`;
  return shell(
    "New request",
    header("Service desk") + `<main><h1>New request</h1><div id="form-root">${form}</div><aside><button type="button" class="MuiButton-root css-1ujsas3">Submit feedback</button></aside></main>`,
    `var T=${JSON.stringify(form)};window.__fixture={rerender:function(){document.getElementById('form-root').innerHTML=T.replace(/:r(\\d+):/g,function(m,n){return ':r'+(Number(n)+20)+':';}).replace(/css-([a-z0-9]+)/g,'css-$1q');}};`
  );
}

function utilityClasses() {
  const cls = "inline-flex items-center px-3 py-2 text-sm font-medium rounded-md bg-white border border-gray-300";
  const btn = (label) => `<button type="button" class="${cls}"${mark(label === "Export")}>${label}</button>`;
  return shell(
    "Contacts",
    header("CRM") + `<main><div class="flex justify-between"><h1 class="text-xl font-semibold">Contacts</h1><div class="flex gap-2">${["Import", "Export", "Share", "Archive"].map(btn).join("")}</div></div></main>`
  );
}

function iconToolbar() {
  const tool = (label, path) =>
    `<button type="button" class="tool" aria-label="${label}" title="${label}"${mark(label === "Refresh")}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${path}"/></svg></button>`;
  return shell(
    "Usage table",
    header("Analytics") +
      `<main><h1>Usage</h1><div role="toolbar" aria-label="Table tools">${tool("Refresh", "M2 8a6 6 0 1 0 2-4")}${tool("Filter", "M2 3h12L9 9v4l-2 1V9z")}${tool("Columns", "M2 2h4v12H2zM10 2h4v12h-4z")}${tool("Download", "M8 2v8M4 7l4 4 4-4M2 14h12")}</div>` +
      `<table aria-label="Usage"><tbody><tr><td>API calls</td><td>18,204</td></tr><tr><td>Storage</td><td>4.2 GB</td></tr></tbody></table></main>`
  );
}

const NOTES = ["Payment received", "Report ready", "Backup completed", "New device added", "Quota at 80%", "Export finished"];
function notificationList() {
  const note = (t) => `<li class="note"><p>${t}</p><button type="button" class="btn dismiss"${mark(t === "Backup completed")}>Dismiss</button></li>`;
  return shell(
    "Notifications",
    header("Console") + `<main><h1>Notifications</h1><ul aria-label="Notifications" id="notes">${NOTES.map(note).join("")}</ul></main>`,
    "window.__fixture={removeFirst:function(){document.getElementById('notes').firstElementChild.remove();}};"
  );
}

function iframeForm() {
  const child =
    `<!doctype html><html><head><title>Checkout frame</title></head><body><form aria-label="Discount"><label for="code">Discount code</label><input id="code" name="code">` +
    `<button type="button" class="btn apply" id="apply-discount"${ORACLE}>Apply discount</button></form></body></html>`;
  return shell(
    "Checkout",
    header("Store") +
      `<main><h1>Checkout</h1><section class="promo" aria-label="Promotion"><p>Members save 10%.</p><button type="button" class="btn apply">Apply discount</button></section>` +
      `<iframe title="Checkout" id="checkout-frame" width="480" height="160" srcdoc="${child.replace(/"/g, "&quot;")}"></iframe></main>`
  );
}

function spaViews() {
  const views = {
    reports: `<h1>Reports</h1><p>12 saved reports.</p><button type="button" class="btn primary create"${ORACLE}>Create report</button><ul><li>Weekly revenue</li><li>Churn</li></ul>`,
    dashboard: `<h1>Dashboard</h1><div class="shortcuts"><button type="button" class="btn primary create">Create report</button></div><p>All systems normal.</p>`
  };
  const nav = ["dashboard", "reports"].map((v) => `<button type="button" class="nav-btn" data-view="${v}">${v[0].toUpperCase()}${v.slice(1)}</button>`).join("");
  return shell(
    "Insights",
    header("Insights") + `<main><nav aria-label="Views">${nav}</nav><div id="view">${views.reports}</div></main>`,
    `var V=${JSON.stringify(views)};var B='/dom-coverage-lab/spa-views/';function go(v){history.pushState({},'',B+v);document.getElementById('view').innerHTML=V[v];}` +
      "document.querySelectorAll('.nav-btn').forEach(function(b){b.addEventListener('click',function(){go(b.getAttribute('data-view'));});});" +
      "window.__fixture={revisit:function(){go('dashboard');go('reports');},leave:function(){go('dashboard');}};"
  );
}

function largeDom() {
  const accounts = ["1000 Cash", "1200 Receivables", "2000 Payables", "4000 Revenue", "5000 Expenses"];
  const row = (n) =>
    `<tr><td>JE-${n}</td><td>2026-09-${String((n % 28) + 1).padStart(2, "0")}</td><td>${accounts[n % 5]}</td><td class="num">${((n * 131) % 9000) + 100}.00</td><td><a href="/je/${n}">Open</a></td></tr>`;
  return shell(
    "General ledger",
    header("Finance") +
      `<main><h1>September close</h1><table aria-label="Journal entries"><tbody id="je-body">${range(100000, 1150).map(row).join("")}</tbody></table>` +
      `<div class="period-actions"><button type="button" class="btn" id="reopen-period">Reopen period</button><button type="button" class="btn primary" id="close-period"${ORACLE}>Close period</button></div></main>`,
    `var R=${JSON.stringify(range(90000, 30).map(row).join(""))};window.__fixture={prependRows:function(){document.getElementById('je-body').insertAdjacentHTML('afterbegin',R);}};`
  );
}

function tabPanels() {
  const tabs = ["General", "Security", "Notifications"];
  const tab = (t) => `<button role="tab" id="tab-${t.toLowerCase()}" aria-controls="panel-${t.toLowerCase()}" aria-selected="${t === "Security"}">${t}</button>`;
  const body = { General: "Workspace name", Security: "Lock idle sessions", Notifications: "Weekly digest" };
  const panel = (t) =>
    `<section role="tabpanel" id="panel-${t.toLowerCase()}" aria-labelledby="tab-${t.toLowerCase()}"${t === "Security" ? "" : " hidden"}><h2>${t}</h2>` +
    `<label><input type="checkbox"> ${body[t]}</label><button type="button" class="btn primary"${mark(t === "Security")}>Save</button></section>`;
  return shell(
    "Workspace settings",
    header("Admin") + `<main><h1>Settings</h1><div role="tablist" aria-label="Settings">${tabs.map(tab).join("")}</div>${tabs.map(panel).join("")}</main>`,
    "window.__fixture={switchTab:function(){document.getElementById('panel-security').hidden=true;document.getElementById('panel-general').hidden=false;" +
      "document.getElementById('tab-security').setAttribute('aria-selected','false');document.getElementById('tab-general').setAttribute('aria-selected','true');}};"
  );
}

function pagination() {
  const articles = range(1, 10).map((n) => `<li><a href="/articles/${200 + n}">Release notes ${n}</a></li>`).join("");
  return shell(
    "Articles",
    header("Docs") +
      `<main><h1>Articles</h1><ol>${articles}</ol><nav aria-label="Pagination"><a href="/articles?page=1" aria-current="page">1</a> <a href="/articles?page=2">2</a> ` +
      `<a href="/articles?page=3">3</a> <a href="/articles?page=2" rel="next" class="next"${ORACLE}>Next</a></nav></main>`
  );
}

// L12.24: eight distinguishable "Save" look-alikes earlier in the page (score ~0.87) and one near-identical twin
// after the target (~0.98). Remembering only the first 8 twins in page order left the closest one unvetoed.
function crowdedTwins() {
  const draft = (n) => `<li><span>Draft ${n}</span><button type="button" id="draft-${n}-save" name="save-draft-${n}">Save</button></li>`;
  return shell(
    "Profile editor",
    header("Directory") +
      `<aside><h2>Recent drafts</h2><ul id="drafts">${range(1, 8).map(draft).join("")}</ul></aside>` +
      `<main><h1>Profile</h1><section id="profile"><label>Display name <input name="displayName"></label>` +
      `<div class="actions"><button type="button" id="save-profile" name="save"${ORACLE}>Save</button></div>` +
      `<div class="actions"><button type="button" id="save-profile-copy" name="save">Save</button></div></section></main>`
  );
}

// ── Layer 4: enterprise-style stand-ins (synthetic markup written to common enterprise patterns) ───────

function bankTransfer() {
  const panel = (p) =>
    `<div id="${p}_MainContent_pnlTransfer" class="panel"><h1>Make a transfer</h1>` +
    `<div class="row"><label for="${p}_MainContent_ddlFrom">From account</label><select name="${p}$MainContent$ddlFrom" id="${p}_MainContent_ddlFrom"><option>Current 0000-4821</option><option>Savings 0000-1177</option></select></div>` +
    `<div class="row"><label for="${p}_MainContent_ddlPayee">Payee</label><select name="${p}$MainContent$ddlPayee" id="${p}_MainContent_ddlPayee"><option>City Utilities</option><option>Harbor Rent Co</option></select></div>` +
    `<div class="row"><label for="${p}_MainContent_txtAmount">Amount</label><input name="${p}$MainContent$txtAmount" type="text" id="${p}_MainContent_txtAmount" class="form-control amount" inputmode="decimal"${ORACLE}></div>` +
    `<div class="row"><label for="${p}_MainContent_txtReference">Reference</label><input name="${p}$MainContent$txtReference" type="text" id="${p}_MainContent_txtReference" class="form-control"></div>` +
    `<input type="submit" value="Review transfer" id="${p}_MainContent_btnReview" class="btn btn-primary"></div>`;
  return shell(
    "Online banking - Transfer",
    header("Online banking") +
      `<main><form method="post" action="./Transfer.aspx" id="aspnetForm" onsubmit="return false"><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="SANITIZED">` +
      `<div id="panel-root">${panel("ctl00")}</div></form></main>`,
    `var T=${JSON.stringify(panel("__P__"))};window.__fixture={postback:function(){document.getElementById('panel-root').innerHTML=T.replace(/__P__/g,'ctl01');}};`
  );
}

const TXN_DESC = ["Card payment", "Direct debit", "Transfer in", "ATM withdrawal", "Standing order", "Refund"];
function transactionLedger() {
  const row = (id) =>
    `<tr id="txn-row-${id}" data-txn="${id}"><td>2026-09-${String((id % 28) + 1).padStart(2, "0")}</td><td>${TXN_DESC[id % 6]} ${id}</td><td class="num">${((id * 53) % 4000) + 10}.00</td>` +
    `<td><span class="status">Posted</span></td><td><button type="button" class="btn btn-sm dispute"${mark(id === 883210)}>Dispute</button></td></tr>`;
  return shell(
    "Transactions",
    header("Online banking") +
      `<main><h1>Current account transactions</h1><table aria-label="Transactions" class="ledger"><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th><th></th></tr></thead>` +
      `<tbody id="txn-body">${range(883074, 400).map(row).join("")}</tbody></table></main>`,
    `var N=${JSON.stringify(range(884000, 5).map(row).join(""))};window.__fixture={` +
      "sortByAmount:function(){var b=document.getElementById('txn-body');Array.prototype.slice.call(b.rows).sort(function(x,y){return parseFloat(y.cells[2].textContent)-parseFloat(x.cells[2].textContent)||(x.id<y.id?-1:1);}).forEach(function(r){b.appendChild(r);});}," +
      "prepend:function(){document.getElementById('txn-body').insertAdjacentHTML('afterbegin',N);}," +
      "filterOut:function(){document.getElementById('txn-row-883210').remove();}};"
  );
}

function approvalModal() {
  const modal = (n) =>
    `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title-${n}" id="modal-${n}"><h2 id="m-title-${n}">Confirm approval</h2><p>Approve PO-7731 for $12,480.00?</p>` +
    `<button type="button" class="btn" data-action="cancel">Cancel</button><button type="button" class="btn btn-primary" data-action="confirm"${ORACLE}>Confirm</button></div>`;
  const po = (n) => `<tr><td>PO-${n}</td><td>${VENDORS[n % 6]} Ltd</td><td><button type="button" class="btn">Approve</button> <button type="button" class="btn">Reject</button></td></tr>`;
  return shell(
    "Approvals",
    header("Procurement") +
      `<main><div class="banner" role="status">PO-7702 needs your sign-off <button type="button" class="btn">Confirm</button></div><h1>Approval queue</h1>` +
      `<table aria-label="Purchase orders"><tbody>${range(7726, 8).map(po).join("")}</tbody></table><div id="modal-root">${modal(3)}</div></main>`,
    `var T=${JSON.stringify(modal("__N__"))};window.__fixture={reopen:function(){document.getElementById('modal-root').innerHTML=T.replace(/__N__/g,'4');},close:function(){document.getElementById('modal-root').innerHTML='';}};`
  );
}

function angularDashboard() {
  const ng = "_ngcontent-ng-c2213";
  const btn = (label, target) =>
    `<button ${ng}="" mat-flat-button="" color="primary" class="mdc-button mat-mdc-button-base mdc-button--unelevated mat-mdc-unelevated-button mat-primary"${mark(target)}>` +
    `<span class="mat-mdc-button-persistent-ripple"></span><span class="mdc-button__label">${label}</span></button>`;
  const card = (title, value) => `<mat-card ${ng}="" class="mat-mdc-card mdc-card"><mat-card-title ${ng}="">${title}</mat-card-title><p ${ng}="">${value}</p></mat-card>`;
  const app =
    `<app-dashboard _nghost-ng-c2213=""><div ${ng}="" class="cards">${card("Balance", "$48,210.00")}${card("Pending", "3 payments")}</div>` +
    `<div ${ng}="" class="actions"><div ${ng}="" class="action-group">${btn("Download CSV", false)}${btn("Generate statement", true)}</div></div></app-dashboard>`;
  return shell(
    "Account dashboard",
    header("Portal") + `<main><app-root id="app-root">${app}</app-root><footer><button type="button" class="mdc-button">Generate statement</button> for a closed account</footer></main>`,
    `var T=${JSON.stringify(app)};window.__fixture={recompile:function(){document.getElementById('app-root').innerHTML=T.replace(/ng-c2213/g,'ng-c9071');}};`
  );
}

function erpGrid() {
  const toolbar = (base) => {
    const button = (offset, label, target) =>
      `<button id="__button${base + offset}" class="sapMBtn sapMBtnBase" type="button"${mark(target)}><span id="__button${base + offset}-inner" class="sapMBtnInner"><span class="sapMBtnContent">${label}</span></span></button>`;
    return `<div id="__toolbar${base}" class="sapMTB sapMTBNewFlex" role="toolbar">${button(0, "Simulate", false)}${button(1, "Park", false)}${button(2, "Post", true)}</div>`;
  };
  const items = range(1, 12)
    .map((n) => `<tr id="__item12-__clone${n}" class="sapMLIB sapMListTblRow"><td class="sapMListTblCell">${n * 10}</td><td class="sapMListTblCell">GL 4000${n}</td><td class="sapMListTblCell">${n * 125}.00</td></tr>`)
    .join("");
  return shell(
    "Post incoming invoice",
    header("ERP") +
      `<main><div id="__xmlview0--page" class="sapMPage"><h1>Post incoming invoice</h1><div id="tb-root">${toolbar(37)}</div>` +
      `<table id="__xmlview0--items" class="sapMListTbl" aria-label="Line items"><tbody>${items}</tbody></table></div></main>`,
    `var T=${JSON.stringify(toolbar(9000))};window.__fixture={regenerate:function(){document.getElementById('tb-root').innerHTML=T.replace(/9(\\d{3})/g,function(m,n){return String(137+Number(n));});}};`
  );
}

// ── Layer 3: protected-login pages (detection and the read-time challenge check) ─────────────────────

const signIn = (extra = "") =>
  shell(
    "Sign in",
    `<main><section class="sign-in"><h1>Welcome back</h1>${extra}<form><label for="user">Email</label><input id="user" type="email" name="username">` +
      `<label for="pw">Password</label><input id="pw" type="password" name="password"><div class="actions"><button id="sign-in" type="submit">Sign in</button></div></form></section></main>`
  );

/** `detect`: the reason the Recorder detector must report. `read`: whether the Super-User read-time check may read it. */
export const CHALLENGE_PAGES = [
  { id: "sign-in-plain", detect: "login-form", read: true, html: signIn() },
  { id: "sign-in-turnstile", detect: "captcha", read: false, html: signIn('<div class="cf-turnstile" data-sitekey="0x4AAAAAAAsanitized"></div>') },
  { id: "sign-in-arkose", detect: "captcha", read: false, html: signIn('<iframe title="Challenge" src="about:blank#client-api.arkoselabs.com"></iframe>') },
  { id: "sign-in-sitekey", detect: "captcha", read: false, html: signIn('<div data-sitekey="sanitized"></div>') },
  { id: "sign-in-recaptcha", detect: "captcha", read: false, html: signIn('<iframe title="reCAPTCHA" src="about:blank#recaptcha"></iframe>') },
  { id: "sign-in-hcaptcha", detect: "captcha", read: false, html: signIn('<div class="h-captcha" data-sitekey="sanitized"></div>') },
  { id: "sign-in-security-check", detect: "login-form", read: false, html: signIn("<p>Security check</p>") },
  { id: "otp", detect: "mfa", read: true, html: shell("Enter code", '<main><h1>Enter the code we sent</h1><form><label for="otp">Code</label><input id="otp" autocomplete="one-time-code" inputmode="numeric"><button type="submit">Continue</button></form></main>') }
];

// ── L12.24: similar-rows semantic lab (verify:similar-rows-safety) ───────────────────────────────────

const PICK = 3003;
const act = (intent, label, attrs = "") => `<button type="button"${attrs} data-oracle-intent="${intent}">${label}</button>`;
/** The picked row's Approve carries the oracle target; `attrs` go on every row's Approve. */
const approve = (n, attrs = "") => act("approve", "Approve", attrs + mark(n === PICK));
const icon = (intent, label, target) =>
  `<button type="button"${label ? ` aria-label="${label}"` : ""}${mark(target)} data-oracle-intent="${intent}"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">` +
  `<path d="${intent === "approve" ? "M2 8l4 4 8-8" : "M3 3l10 10M13 3L3 13"}"/></svg></button>`;

function rowLab(title, actions, extraRows = "") {
  const row = (n) => `<tr><td>INV-${n}</td><td>${VENDORS[n % 6]} Ltd</td><td>$${((n * 37) % 900) + 100}.00</td><td>${actions(n)}</td></tr>`;
  return shell(
    title,
    header("Payables") +
      `<main><h1>${title}</h1><table aria-label="Pending invoices"><thead><tr><th>Invoice</th><th>Vendor</th><th>Amount</th><th>Actions</th></tr></thead>` +
      `<tbody id="lab-body">${range(3001, 6).map(row).join("")}${extraRows}</tbody></table></main>`
  );
}

/**
 * One picked control per page. `expect`: how many rows the loop must cover, every one of them the picked
 * control's own action, or "refuse" (no loop may be offered). An intent other than the picked one inside a loop
 * is a mixed loop: the defect L12.24 exists to stop.
 */
export const SIMILAR_ROW_LAB = [
  { id: "rows-approve-reject", title: "Approve beside Reject in every row", expect: 6,
    html: () => rowLab("Approve or reject", (n) => `${approve(n)} ${act("reject", "Reject")}`) },
  { id: "rows-approve-delete", title: "Approve beside Delete in every row", expect: 6,
    html: () => rowLab("Approve or delete", (n) => `${approve(n)} ${act("delete", "Delete", ' class="danger"')}`) },
  { id: "rows-same-text", title: "Two Approve buttons per row, told apart only by data-action", expect: 6,
    html: () => rowLab("Approve invoice or vendor", (n) => `${approve(n, ' data-action="approve-invoice"')} ${act("approve-vendor", "Approve", ' data-action="approve-vendor"')}`) },
  { id: "rows-icon-only", title: "Icon-only Approve and Reject named by aria-label", expect: 6,
    html: () => rowLab("Icon actions", (n) => `${icon("approve", "Approve", n === PICK)}${icon("reject", "Reject", false)}`) },
  // INV-3005's Approve is disabled and a hidden template row follows: neither is clickable, so neither is looped.
  { id: "rows-disabled-hidden", title: "Disabled and hidden sibling actions", expect: 5,
    html: () =>
      rowLab(
        "Disabled and hidden actions",
        (n) => `${n === 3005 ? act("approve-unavailable", "Approve", " disabled") : approve(n)} ${act("reject-unavailable", "Reject", " disabled")} ${act("delete", "Delete", " hidden")}`,
        `<tr hidden><td>INV-0000</td><td></td><td></td><td>${act("approve-unavailable", "Approve")} ${act("reject-unavailable", "Reject")}</td></tr>`
      ) },
  { id: "rows-reordered", title: "Approve and Reject swap places from row to row", expect: 6,
    html: () => rowLab("Reordered actions", (n) => (n % 2 ? `${act("reject", "Reject")} ${approve(n)}` : `${approve(n)} ${act("reject", "Reject")}`)) },
  { id: "rows-nested", title: "Row menu and line approvals nested in every row", expect: 6,
    html: () =>
      rowLab(
        "Nested controls",
        (n) =>
          `${approve(n)}<div class="row-menu">${act("delete", "Delete")}${act("archive", "Archive")}</div>` +
          `<details><summary>Lines</summary><ul><li>${act("approve-line", "Approve line")}</li><li>${act("reject-line", "Reject line")}</li></ul></details>`
      ) },
  { id: "rows-subset", title: "Rows holding only some of the actions", expect: 4,
    html: () => rowLab("Partial actions", (n) => [n % 3 !== 2 ? approve(n) : "", n % 2 === 1 || n % 3 === 2 ? act("reject", "Reject") : ""].filter(Boolean).join(" ")) },
  // Deliberately ambiguous: which of two indistinguishable Approve buttons was meant cannot be known.
  { id: "rows-twin-approve", title: "Two indistinguishable Approve buttons per row", expect: "refuse",
    html: () => rowLab("Twin approvals", (n) => `${approve(n)} ${act("approve-line", "Approve")}`) },
  { id: "rows-unlabelled-icons", title: "Icon-only actions with no accessible name", expect: "refuse",
    html: () => rowLab("Unlabelled icons", (n) => `${icon("approve", "", n === PICK)}${icon("reject", "", false)}`) }
];

// ── Manifest ──────────────────────────────────────────────────────────────────────────────────────────

const SENSITIVE = "sensitive step: never recovers to another element";
const SAFE_MISS = "safe miss: no layer proves the target";
const HIDDEN = "target hidden, a look-alike shown";

const PAGES = {
  "table-actions": tableActions,
  "card-grid": cardGrid,
  "form-labels": formLabels,
  "dialog-confirm": dialogConfirm,
  "nested-containers": nestedContainers,
  "duplicate-labels": duplicateLabels,
  "reordered-rows": reorderedRows,
  "dynamic-ids": dynamicIds,
  "utility-classes": utilityClasses,
  "icon-toolbar": iconToolbar,
  "notification-list": notificationList,
  "iframe-form": iframeForm,
  "spa-views": spaViews,
  "large-dom": largeDom,
  "tab-panels": tabPanels,
  pagination,
  "crowded-twins": crowdedTwins,
  "bank-transfer": bankTransfer,
  "transaction-ledger": transactionLedger,
  "approval-modal": approvalModal,
  "angular-dashboard": angularDashboard,
  "erp-grid": erpGrid
};

/**
 * One recovery fixture = one page and one target. `path` is the URL the step is recorded on (default
 * `/dom-coverage-lab/<page>`). `cases`: [mutation, expected outcome].
 */
export const COVERAGE_FIXTURES = [
  // Layer 2: the existing frozen L10.0 orders page (served by the verifier).
  { id: "l10-save-order", layer: "existing", page: "l10-orders", target: "#save-order", action: "click", title: "L10.0 orders: Save changes",
    cases: [["wrapper", "recover"], ["move", "recover"], ["id-drift", "recover"], ["id-remove", "recover"], ["class-drift", "recover"], ["text-drift", "recover"], ["sibling-insert", "recover"], ["sibling-reorder", "recover"], ["decoy", "recover"], ["remove", "refuse"], ["remove-decoy", "refuse"]] },
  { id: "l10-notes", layer: "existing", page: "l10-orders", target: "#notes", action: "fill", title: "L10.0 orders: Notes field",
    cases: [["id-drift", "refuse", SAFE_MISS], ["attr-drift", "recover"], ["text-drift", "recover"], ["wrapper", "refuse", SAFE_MISS], ["remove", "refuse"]] },
  // Twelve View links with one fingerprint: once the href-based locator misses, nothing tells them apart.
  { id: "l10-view-link", layer: "existing", page: "l10-orders", target: 'a[href="/orders/1045"]', action: "click", title: "L10.0 orders: View link of order #1045",
    cases: [["attr-drift", "refuse", SAFE_MISS], ["class-drift", "refuse", SAFE_MISS], ["sibling-reorder", "refuse", SAFE_MISS], ["remove", "refuse"]] },
  // Layer 1: Test Lab fixtures.
  { id: "table-actions", layer: "lab", page: "table-actions", action: "click", title: "Table with repeated row actions",
    cases: [["page:sort", "refuse", SENSITIVE], ["class-drift", "refuse", SENSITIVE], ["page:removeRow", "refuse"], ["remove", "refuse"]] },
  { id: "card-grid", layer: "lab", page: "card-grid", action: "click", title: "Product cards with identical buttons",
    cases: [["page:shuffle", "recover"], ["wrapper", "recover"], ["class-drift", "recover"], ["page:removeCard", "refuse"]] },
  { id: "form-labels", layer: "lab", page: "form-labels", action: "fill", title: "Labelled form field",
    cases: [["id-drift", "recover"], ["attr-drift", "recover"], ["sibling-insert", "recover"], ["remove", "refuse"]] },
  { id: "dialog-confirm", layer: "lab", page: "dialog-confirm", action: "click", title: "Confirmation dialog beside a same-label button",
    cases: [["page:reopen", "refuse", SENSITIVE], ["wrapper", "refuse", SENSITIVE], ["decoy", "refuse", SENSITIVE], ["page:close", "refuse"]] },
  // The Archive link is the target's twin (same label, no href in the fingerprint): moved, the two tie.
  { id: "nested-containers", layer: "lab", page: "nested-containers", action: "click", title: "Link eight containers deep",
    cases: [["wrapper", "refuse", SAFE_MISS], ["move", "refuse", SAFE_MISS], ["attr-drift", "recover"], ["remove", "refuse"]] },
  { id: "duplicate-labels", layer: "lab", page: "duplicate-labels", action: "click", title: "Two Edit buttons under different headings",
    cases: [["page:swap", "recover"], ["class-drift", "recover"], ["remove", "refuse"]] },
  { id: "reordered-rows", layer: "lab", page: "reordered-rows", action: "click", title: "Task rows re-sorted",
    cases: [["page:sort", "recover"], ["attr-drift", "recover"], ["remove", "refuse"]] },
  { id: "dynamic-ids", layer: "lab", page: "dynamic-ids", action: "click", title: "Generated React ids and hashed classes",
    cases: [["page:rerender", "refuse", SENSITIVE], ["id-drift", "refuse", SENSITIVE], ["class-drift", "refuse", SENSITIVE], ["remove-decoy", "refuse"]] },
  { id: "utility-classes", layer: "lab", page: "utility-classes", action: "click", title: "Utility-class toolbar",
    cases: [["class-drift", "recover"], ["wrapper", "recover"], ["remove", "refuse"]] },
  // A control with no text scores at most 0.82 locally (text weighs 0.18), below the 0.86 threshold.
  { id: "icon-toolbar", layer: "lab", page: "icon-toolbar", action: "click", title: "Icon-only buttons named by aria-label",
    cases: [["sibling-insert", "refuse", SAFE_MISS], ["sibling-reorder", "refuse", SAFE_MISS], ["remove-decoy", "refuse"]] },
  { id: "notification-list", layer: "lab", page: "notification-list", action: "click", title: "Dismiss buttons with an item removed above",
    cases: [["page:removeFirst", "recover"], ["decoy", "recover"], ["remove", "refuse"]] },
  { id: "iframe-form", layer: "lab", page: "iframe-form", action: "click", title: "Button inside an iframe with a top-level look-alike",
    cases: [["wrapper", "recover"], ["id-drift", "recover"], ["remove", "refuse"]] },
  { id: "spa-views", layer: "lab", page: "spa-views", path: "/dom-coverage-lab/spa-views/reports", action: "click", title: "SPA view re-rendered by navigation",
    cases: [["page:revisit", "recover"], ["class-drift", "recover"], ["page:leave", "refuse"]] },
  { id: "large-dom", layer: "lab", page: "large-dom", action: "click", title: "Target after about 8,000 elements",
    cases: [["id-drift", "recover"], ["page:prependRows", "recover"], ["remove", "refuse"]] },
  { id: "tab-panels", layer: "lab", page: "tab-panels", action: "click", title: "Same Save button in every tab panel",
    cases: [["class-drift", "recover"], ["wrapper", "recover"], ["page:switchTab", "refuse", HIDDEN], ["remove", "refuse"]] },
  { id: "pagination", layer: "lab", page: "pagination", action: "click", title: "Pagination Next link",
    cases: [["attr-drift", "recover"], ["sibling-insert", "recover"], ["decoy", "recover"], ["remove", "refuse"]] },
  // L12.24: the closest twin is the 9th distinguishable look-alike in page order.
  { id: "crowded-twins", layer: "lab", page: "crowded-twins", action: "click", title: "Nine Save look-alikes, the nearest one last",
    cases: [["remove", "refuse"]] },
  // Layer 4: enterprise-style stand-ins (synthetic).
  // Local 0.75-0.80 and the provider 81-85, under its 85 agreement floor: never acted on.
  { id: "bank-transfer", layer: "enterprise", page: "bank-transfer", action: "fill", title: "WebForms transfer form amount field",
    cases: [["page:postback", "refuse", SAFE_MISS], ["attr-drift", "refuse", SAFE_MISS], ["wrapper", "refuse", SAFE_MISS], ["remove", "refuse"]] },
  { id: "transaction-ledger", layer: "enterprise", page: "transaction-ledger", action: "click", title: "400-row ledger, Dispute on one transaction",
    cases: [["page:sortByAmount", "recover"], ["page:prepend", "recover"], ["class-drift", "recover"], ["page:filterOut", "refuse"]] },
  // `escape` (L12.24): the target is gone and its copy now sits just outside the recorded container.
  { id: "approval-modal", layer: "enterprise", page: "approval-modal", action: "click", title: "Approval confirmation modal",
    cases: [["page:reopen", "recover"], ["decoy", "recover"], ["page:close", "refuse"], ["escape", "refuse"]] },
  { id: "angular-dashboard", layer: "enterprise", page: "angular-dashboard", action: "click", title: "Angular Material action with compiled attributes",
    cases: [["page:recompile", "recover"], ["class-drift", "recover"], ["wrapper", "recover"], ["remove-decoy", "refuse"]] },
  { id: "erp-grid", layer: "enterprise", page: "erp-grid", action: "click", title: "UI5-style toolbar with generated ids",
    cases: [["page:regenerate", "recover"], ["sibling-insert", "recover"], ["sibling-reorder", "recover"], ["remove", "refuse"]] }
];

/** The mock-site page for a corpus key, or a challenge page by id, or undefined. */
export function coveragePage(key) {
  if (PAGES[key]) return PAGES[key]();
  return CHALLENGE_PAGES.find((page) => page.id === key)?.html ?? SIMILAR_ROW_LAB.find((page) => page.id === key)?.html();
}

export function coverageIndexPage() {
  const items = COVERAGE_FIXTURES.filter((f) => f.layer !== "existing")
    .map((f) => `<li data-testid="coverage-fixture-${f.id}"><a href="${f.path ?? `/dom-coverage-lab/${f.page}`}">${f.title}</a> <small>(${f.layer}, ${f.cases.length} cases)</small></li>`)
    .join("");
  const challenges = CHALLENGE_PAGES.map((p) => `<li data-testid="coverage-challenge-${p.id}"><a href="/dom-coverage-lab/${p.id}">${p.id}</a></li>`).join("");
  const rows = SIMILAR_ROW_LAB.map((p) => `<li data-testid="coverage-similar-${p.id}"><a href="/dom-coverage-lab/${p.id}">${p.title}</a> <small>(loop: ${p.expect})</small></li>`).join("");
  return shell(
    "DOM Coverage Lab",
    `<main><h1>DOM Coverage Lab</h1><h2>Recovery fixtures</h2><ul>${items}</ul><h2>Protected-login pages</h2><ul>${challenges}</ul><h2>Similar-rows semantic lab</h2><ul>${rows}</ul></main>`
  );
}

/**
 * The verifier's in-page runtime, as a plain JS expression string (never transformed by esbuild, so no
 * `__name` helper can leak into the page). `arm` stores the oracle target and strips every oracle attribute;
 * `mutate` applies one case and reports whether the DOM changed and whether the target still exists.
 */
export const COVERAGE_RUNTIME = String.raw`(function () {
  if (window.__awkitCoverage) return true;
  var cov = {
    target: null,
    docs: function () {
      var out = [document];
      var frames = document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) { try { if (frames[i].contentDocument) out.push(frames[i].contentDocument); } catch (e) {} }
      return out;
    },
    strip: function () {
      var found = [];
      this.docs().forEach(function (d) {
        Array.prototype.slice.call(d.querySelectorAll('[data-testid="oracle-target"]')).forEach(function (el) { found.push(el); el.removeAttribute('data-testid'); });
      });
      return found;
    },
    intents: new Map(),
    intentOf: function (el) { return this.intents.get(el) || ''; },
    arm: function (selector) {
      var hits = [];
      var intents = this.intents;
      if (selector) this.docs().forEach(function (d) { Array.prototype.slice.call(d.querySelectorAll(selector)).forEach(function (el) { hits.push(el); }); });
      this.docs().forEach(function (d) {
        Array.prototype.slice.call(d.querySelectorAll('[data-oracle-intent]')).forEach(function (el) { intents.set(el, el.getAttribute('data-oracle-intent')); el.removeAttribute('data-oracle-intent'); });
      });
      var oracles = this.strip();
      if (!selector) hits = oracles;
      this.target = hits.length === 1 ? hits[0] : null;
      return hits.length;
    },
    leaks: function () {
      return this.docs().reduce(function (n, d) { return n + d.querySelectorAll('[data-testid^="oracle"],[data-oracle-intent]').length; }, 0);
    },
    clearAnchor: function () {
      this.docs().forEach(function (d) { Array.prototype.slice.call(d.querySelectorAll('[data-l11-anchor]')).forEach(function (el) { el.removeAttribute('data-l11-anchor'); }); });
    },
    panel: function (doc, el) {
      var section = doc.createElement('section');
      section.className = 'cv-quick-actions';
      section.innerHTML = '<h2>Quick actions</h2>';
      section.appendChild(el);
      doc.body.insertBefore(section, doc.body.firstChild);
    },
    mutate: function (op) {
      if (op.indexOf('page:') === 0) {
        var fn = window.__fixture && window.__fixture[op.slice(5)];
        if (!fn) return { changed: false, present: !!this.target };
        var before = document.documentElement.outerHTML;
        var previous = this.target;
        fn();
        var fresh = this.strip();
        if (fresh.length === 1) this.target = fresh[0];
        else if (this.target && !this.target.isConnected) this.target = null;
        // A re-render can produce identical markup with a NEW target node: that is a change too.
        return { changed: document.documentElement.outerHTML !== before || this.target !== previous, present: !!this.target };
      }
      var t = this.target;
      if (!t) return { changed: false, present: false };
      var doc = t.ownerDocument;
      var p = t.parentElement;
      var field = /^(input|textarea|select)$/.test(t.localName);
      switch (op) {
        case 'id-drift':
          if (!t.id) return { changed: false, present: true };
          t.id = /\d/.test(t.id) ? t.id.replace(/\d+/g, function (n) { return String(Number(n) + 17); }) : t.id + '-v2';
          break;
        case 'id-remove':
          if (!t.id) return { changed: false, present: true };
          t.removeAttribute('id');
          break;
        case 'class-drift': {
          var c = (t.getAttribute('class') || '').trim();
          if (!c) return { changed: false, present: true };
          t.setAttribute('class', c.split(/\s+/).map(function (x) { return x + '_k3f9'; }).join(' '));
          break;
        }
        case 'text-drift': {
          if (field) {
            var ph = t.getAttribute('placeholder');
            if (!ph) return { changed: false, present: true };
            t.setAttribute('placeholder', ph + ' (required)');
            break;
          }
          var walker = doc.createTreeWalker(t, NodeFilter.SHOW_TEXT);
          var node = walker.nextNode();
          while (node && !node.nodeValue.trim()) node = walker.nextNode();
          if (!node) return { changed: false, present: true };
          node.nodeValue = node.nodeValue.replace(/\s*$/, ' now');
          break;
        }
        case 'wrapper': {
          var w = doc.createElement('span');
          w.className = 'cv-tooltip-anchor';
          p.insertBefore(w, t);
          w.appendChild(t);
          break;
        }
        case 'sibling-insert': {
          var s;
          if (field) {
            s = doc.createElement('input');
            s.setAttribute('name', 'cv-reference');
            s.setAttribute('placeholder', 'Reference');
          } else {
            s = doc.createElement(t.localName);
            ['type', 'class', 'role'].forEach(function (a) { if (t.hasAttribute(a)) s.setAttribute(a, t.getAttribute(a)); });
            if (t.localName === 'a') s.setAttribute('href', '#preview');
            s.textContent = 'Preview';
          }
          p.insertBefore(s, t);
          break;
        }
        case 'sibling-reorder': {
          if (p.children.length < 2) return { changed: false, present: true };
          Array.prototype.slice.call(p.children).reverse().forEach(function (k) { p.appendChild(k); });
          break;
        }
        case 'move': {
          var gp = p.parentElement;
          if (!gp) return { changed: false, present: true };
          gp.insertBefore(t, gp.firstChild);
          break;
        }
        case 'attr-drift': {
          var n = 0;
          ['href', 'name', 'aria-label', 'title', 'placeholder', 'data-action', 'data-testid'].forEach(function (a) {
            var v = t.getAttribute(a);
            if (v === null) return;
            n += 1;
            if (a === 'href') t.setAttribute(a, '/app' + (v.charAt(0) === '/' ? v : '/' + v) + (v.indexOf('?') >= 0 ? '&' : '?') + 'ref=nav');
            else if (a === 'aria-label' || a === 'title') t.setAttribute(a, v + ' (beta)');
            else if (a === 'placeholder') t.setAttribute(a, v + ' (optional)');
            else t.setAttribute(a, v + '_v2');
          });
          if (!n) return { changed: false, present: true };
          break;
        }
        case 'decoy': {
          var clone = t.cloneNode(true);
          clone.removeAttribute('id');
          this.panel(doc, clone);
          break;
        }
        case 'remove':
          t.remove();
          this.target = null;
          break;
        case 'remove-decoy': {
          var copy = t.cloneNode(true);
          copy.removeAttribute('id');
          t.remove();
          this.target = null;
          this.panel(doc, copy);
          break;
        }
        case 'escape': {
          var outside = t.cloneNode(true);
          outside.removeAttribute('id');
          t.remove();
          this.target = null;
          p.parentElement.insertBefore(outside, p.nextSibling);
          break;
        }
        default:
          return { changed: false, present: true };
      }
      return { changed: true, present: !!this.target };
    }
  };
  window.__awkitCoverage = cov;
  return true;
})()`;
