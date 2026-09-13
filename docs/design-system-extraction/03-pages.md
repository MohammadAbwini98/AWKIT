# 03 — Pages and surfaces

Thirty-three routes, declared in one table: `app/renderer/routes.tsx` (341 lines).

```ts
export interface AppRoute {
  id: RouteId;
  label: string;         // shown in nav and as the TopHeader title
  description: string;   // shown as the TopHeader subtitle
  icon: LucideIcon;      // shown in nav
  component: ComponentType;
}
```

There is **no per-page header markup**. `TopHeader` renders `label` + `description` from this table, so
every page gets a title and a one-line subtitle for free. Restyling the header restyles all 33.

## Layout families

Routes do not have 33 distinct layouts. They have **five**, plus two non-route families.

| Family | Root element | Routes | Restyling it affects |
|---|---|---|---|
| **A** | `<section className="page">` | 15 | Nearly half the product |
| **B** | `<DesignerCanvasLayout>` | 3 | All canvas designers |
| **C** | `<ReportPage>` | 7 | The whole reporting area |
| **D** | `<AdminPage>` | 6 | The whole Administration area |
| **E** | `<div className="page-content">` | 2 | Recorder + Sessions |
| **F** | `<section className="work-panel settings-card">` | *(non-route)* | Settings sub-panels |
| **G** | `.modal-overlay` / `.awkit-admin-modal-backdrop` | *(non-route)* | Every dialog |

**Work family by family.** Families C and D are true wrappers — one component owns the entire page
frame for 13 routes. Family A is a shared class, not a shared component: each page composes its own
content beneath `.page`.

---

## Family A — `<section className="page">`

The generic page. A scroll container with the standard page padding; content is composed per page
from `SectionHeader`, `MetricCard`, `work-panel` sections, tables and `EmptyState`.

| Route id | Label | Description | Icon | Nav group | Permission | Root class |
|---|---|---|---|---|---|---|
| `dashboard` | Dashboard | Run readiness, recent activity, and quick actions. | `LayoutDashboard` | Build | `PAGE_DASHBOARD` | `page` |
| `workflowsLibrary` | Workflows | All saved workflows. Open, edit, clone, export, or delete. | `LayoutGrid` | Build | `PAGE_WORKFLOWS` | `page` |
| `flowLibrary` | Flows | Saved reusable automation flows. | `Boxes` | Build | `PAGE_FLOWS` | `page` |
| `semanticSearch` | Semantic Search | Search flows, workflows, past failures and locator memory by meaning. | `Sparkles` | Build | `SEMANTIC_SEARCH` | `page` |
| `runtimeInputs` | Runtime Inputs | Scenario fields, values, and run-time selections. | `FormInput` | Data | `PAGE_WORKFLOWS` | `page` |
| `dataSources` | Data Sources | JSON files, row mapping, and data binding. | `Database` | Data | `PAGE_DATA_SOURCES` | `page` |
| `dataSourceEditor` | Data Source Editor | Visually edit a JSON data source as a table. | `Table2` | *(unlisted)* | `PAGE_DATA_SOURCES` | `page` |
| `executionMonitor` | Run | Live workflow execution timeline and run readiness. | `Activity` | Run | `PAGE_INSTANCES` | `page` |
| `instanceMonitor` | Instances | Concurrent browser instance state and controls. | `MonitorDot` | Run | `PAGE_INSTANCES` | `page` |
| `offlineRuntime` | Offline Runtime | Bundled browser and offline production readiness. | `Gauge` | System | `PAGE_SETTINGS` | `page` |
| `settings` | Settings | Environment, packaging, and application preferences. | `Settings` | *(footer)* | `PAGE_SETTINGS` | `page` |
| `scenarioBuilder` | Workflow Builder | Select saved flows, link them, and save executable workflows. | `ClipboardList` | Build | `PAGE_WORKFLOWS` | `page scenario-builder-page` |
| `reports` | Run Artifacts | Stored run reports, screenshots, downloads, and errors. | `FileBarChart` | Reports | `PAGE_REPORTS` | `page reports-page` |
| `roadmap` | Program Status | Implementation phases, acceptance status, and remaining work. | `ListChecks` | System | `PAGE_ROADMAP` | `page rm-embedded-page` |
| `projectContract` | Project Contract | Master build prompt, production rules, safety rules, and module contract. | `FileCheck2` | *(footer, "Help Center")* | *(none)* | `page contract-page` |

Notes that matter to a redesign:

- **`settings`** (`pages/Settings.tsx`, ~500 lines of JSX) is family A on the outside but hosts the
  family-F sub-panels inside. It is the densest form surface in the product.
- **`instanceMonitor`** (~576 lines) and **`scenarioBuilder`** (~1249 lines) are the two largest
  family-A pages. `scenarioBuilder` also carries canvas behaviour despite not using
  `DesignerCanvasLayout` — it is one of the four `CANVAS_ROUTES` excluded from the mount fade.
- **`roadmap`** carries `data-testid="embedded-roadmap"` and embeds the Program Status view.
- **`projectContract`** is deliberately **not permission-gated** — reference documentation every
  signed-in role can read.
- **`semanticSearch`** is gated by a *capability* permission (`SEMANTIC_SEARCH`), not a `PAGE_*`
  permission. The Viewer role does not hold it. Removing the line from `routePermissions.ts` would
  **open** the page, not close it; `verify:authz` asserts the line is present.
- **`dataSourceEditor`** appears in no navigation group — it is reached from Data Sources.

---

## Family B — `<DesignerCanvasLayout>`

The canvas frame: full-bleed canvas column + optional right properties column. See
`01-app-shell.md` § DesignerCanvasLayout for the props and the `--awkit-action-bar-h` measurement.

| Route id | Label | Description | Icon | Nav group | Permission | Layout invocation |
|---|---|---|---|---|---|---|
| `flowChart` | Flow Designer | Reusable Playwright flow nodes and connectors. | `GitBranch` | Build | `PAGE_FLOWS` | `<DesignerCanvasLayout>` |
| `workflow` | Workflow Designer | Main visual workflow workspace. | `Workflow` | *(unlisted)* | `PAGE_WORKFLOWS` | `<DesignerCanvasLayout flush>` + inline `<aside className="properties-panel">` |
| `formDesigner` | Form Designer | Runtime input forms and field configuration. | `PanelRight` | Build | `PAGE_FLOWS` | `<DesignerCanvasLayout propertiesTitle="Field Configuration">` |

- `flowChart` is the largest page component in the renderer (~1215 lines of JSX).
- `workflow` supplies its **own** `<aside className="properties-panel">` rather than using the
  layout's default `RightPropertiesPanel` — the same class, different owner. Any restyle of
  `.properties-panel` hits both.
- `workflow` is reached from the Workflows library, not from the navigation.
- All three, plus `scenarioBuilder`, are in `CANVAS_ROUTES` and get **no mount transition**.

---

## Family C — `<ReportPage>`

`app/renderer/components/reports/ReportPage.tsx` (39 lines) owns the entire frame:

```tsx
interface ReportPageProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  range?: TelemetryRangePreset;
  onRangeChange?: (value: TelemetryRangePreset) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: ReactNode;
}
```

Renders `<section className="page awkit-report-page">` containing a `SectionHeader` whose `actions`
slot holds a `TimeRangeSelector` and a refresh `button.awkit-icon-button[aria-label="Refresh"]`
(`RefreshCw`, 16px, `.awkit-spin` while refreshing).

| Route id | Label | Description | Icon | Permission | Notes |
|---|---|---|---|---|---|
| `reportsOverview` | Reports | Automation outcomes, durations, and live activity dashboards. | `BarChart3` | `PAGE_REPORTS` | Landing page of the family |
| `reportsWorkflows` | Workflow Reports | Per-workflow run statistics, durations, and drill-down. | `Workflow` | `PAGE_REPORTS` | Two `work-panel awkit-report-panel` sub-panels |
| `reportsInstances` | Instance Reports | Live instance status distribution and run history. | `MonitorDot` | `PAGE_REPORTS` | |
| `reportsChrome` | Chrome Consumption | Live Chrome/Playwright consumption and RPM-style pressure gauges. | `Gauge` | `PAGE_REPORTS` | `RpmGaugeCard` grid |
| `reportsRuntime` | Runtime Analytics | Concurrency, host resource, and Chrome consumption history. | `LineChart` | `PAGE_REPORTS` | Three `work-panel awkit-report-panel` sub-panels |
| `reportsFailures` | Failure Analytics | Failure categories, reliability ranking, and insights. | `ShieldAlert` | `PAGE_REPORTS` | |
| `reportsServer` | Server Performance | Process resource usage and on-disk storage. | `Server` | `PAGE_REPORTS` | |

All seven sit in the **Reports** nav group, alongside `reports` (Run Artifacts), which is family A.

Shared sub-structures inside the family:

- `<section className="work-panel awkit-report-panel">` — the standard chart/table panel.
- Delta chips: `` `awkit-delta-chip is-${tone}` `` (see `TrendDelta` in `04-components.md`).
- Chart series colours come from the **14-step data-viz ramp** and are assigned **by data
  category**, never by state — a category keeps its colour across every chart in the family.

---

## Family D — `<AdminPage>`

`app/renderer/pages/admin/components/AdminUi.tsx` (246 lines) is a complete, self-contained kit —
page frame, metric cards, section cards, banners, status badges, loading and empty states. Its
header comment states the family rule: *"All colour flows through `global.css` tokens; badges pair
an icon with text so status never relies on colour alone."*

```tsx
AdminPage({ title, description, summary /* deprecated */, actions, banner, children })
//   → div.awkit-admin-page > .awkit-admin-header > .awkit-admin-heading + .awkit-admin-header-actions
```

| Route id | Label | Description | Icon | Permission | Notes |
|---|---|---|---|---|---|
| `userManagement` | Users | Create users, assign roles, disable, reset passwords, and revoke sessions. | `Users` | `USER_MANAGE` | Two family-G modals |
| `roles` | Roles | Built-in roles and the permissions each grants. | `ShieldCheck` | `ROLE_VIEW` | One family-G modal |
| `permissionsMatrix` | Permissions | Permission-to-role matrix (deny-by-default reference). | `ListChecks` | `ROLE_VIEW` | Wide matrix table |
| `auditLog` | Audit Log | Security audit trail of privileged actions. | `ClipboardList` | `AUDIT_VIEW` | |
| `licensing` | Licensing | Per-machine offline license: status, activation, import, and revocation. | `KeyRound` | `PAGE_LICENSE` | `.awkit-license-field` blocks |
| `licenseIssuer` | License Issuer | Create signed machine licenses from offline activation requests. | `ShieldCheck` | `PAGE_LICENSE_ISSUER` | **Role-exclusive** |

`licenseIssuer` is the only route in `RouteExclusiveRoles` (`ISSUER_ROLE`). Issuer accounts are
redirected to it on sign-in. All six are in the **Administration** nav group; when the signed-in
role holds none of these permissions the whole group disappears from the sidebar.

Family-D sub-structures:

- `<fieldset className="awkit-admin-roles">` and
  `<fieldset className="awkit-admin-roles awkit-admin-permission-picker">` — role/permission pickers.
- `.awkit-admin-create-card.awkit-admin-quick-create` (+ `.awkit-admin-role-create`) — inline
  creation forms.
- `.awkit-license-field` — a labelled read-only license value block (`licensing` and
  `licenseIssuer`).

---

## Family E — `<div className="page-content">`

Two pages own their own padding and scroll instead of using `.page`.

| Route id | Label | Description | Icon | Nav group | Permission | Root |
|---|---|---|---|---|---|---|
| `sessions` | Sessions | Capture and manage browser login sessions for protected sites. | `KeyRound` | Data | `PAGE_DATA_SOURCES` | `page-content` + inline `display:flex; flexDirection:column; gap:var(--space-4h); padding:var(--space-4h)` |
| `recorder` | Recorder | Record browser interactions into reusable flows. | `PlaySquare` | Build | `PAGE_RECORDER` | `page-content recorder-page` |

`SessionsManager` is the **only page that styles its own root inline**. It still uses tokens
(`--space-4h`), so it is not a token violation, but it is an inconsistency worth normalising:
a redesign that changes `.page` padding will not change this page.

**`recorder`** is the surface bound by the protected-login handoff contract: when the Recorder meets
a protected login / MFA / OTP / CAPTCHA / passkey / approval surface it **pauses**, preserves the
draft, closes the automation browser and hands off to the user's real Chrome in an app-owned scoped
session profile. The UI must make the pause, the reason and the handoff unmistakable, and the
captured session links to the `Reuse Session` node. This is a product contract, not a style choice —
see `components/auth/ProtectedLoginHandoffPanel` in `04-components.md`.

---

## Family F — Settings sub-panels *(non-route)*

Rendered inside the `settings` page, each as `<section className="work-panel settings-card">`.

| Component | Path | Purpose |
|---|---|---|
| `AccentColorSettings` | `pages/AccentColorSettings.tsx` | Accent picker; writes the 12 accent + 9 gradient tokens at runtime |
| `BrandingSettings` | `pages/BrandingSettings.tsx` | Custom logo; replaces the whole nav workspace block |
| `JavaRuntimeSettings` | `pages/JavaRuntimeSettings.tsx` | Bundled Java runtime detection/status |
| `OracleDriverSettings` | `pages/OracleDriverSettings.tsx` | Oracle JDBC driver presence/status |
| `SemanticIndexSettings` | `pages/SemanticIndexSettings.tsx` | Semantic index build/refresh state |

`settings-card` is also reused by `AdminSectionCard` (family D), which renders
`` `settings-card awkit-admin-card${…}` ``. The two families therefore share a card base — changing
`.settings-card` changes both.

---

## Family G — Modals *(non-route)*

Two distinct backdrop systems exist. A redesign should decide whether to unify them; today they are
separate class trees.

### `.modal-overlay` — the general system

| Where | Source |
|---|---|
| Data source create/edit | `pages/DataSourceManager.tsx` |
| Data source row editor | `pages/DataSourceEditor.tsx` |
| Oracle connection | `pages/OracleDataSourceModal.tsx` |
| Confirm | `components/shared/ConfirmDialog.tsx` |
| Prompt | `components/shared/PromptDialog.tsx` |
| Unsaved changes | `components/shared/UnsavedChangesDialog.tsx` |

Shared inner structure: `.modal-dialog` › `.modal-header` (+ `.modal-icon` with a variant such as
`.warn` / `.create`) › `.modal-body` (+ `.modal-field`) › `.modal-actions` with
`.toolbar-button[.primary|.modal-danger]`.

### `.awkit-admin-modal-backdrop` — the Administration system

Carries `role="presentation"`.

| Where | Source |
|---|---|
| Re-authentication | `pages/admin/ReauthDialog.tsx` |
| Create user / reset password | `pages/admin/UserManagement.tsx` (two modals) |
| Role detail | `pages/admin/RolesPage.tsx` |
| Licence activation / detail | `pages/admin/LicensingPage.tsx` |
| Issuer key + licence issue | `pages/admin/LicenseIssuerPage.tsx` |

### Instance/run modals

`components/instances/` contributes three full-screen surfaces that behave like modals but are
mounted from the Instances page: `BrowserObservationModal`, `LiveExecutionReportModal`,
`WorkflowInstancesModal`.

---

## Security surfaces *(pre-shell, non-route)*

These render **above** the application shell: `SecurityGate` decides, `LockedShell` frames. There is
no navigation, no header and no status bar — `LockedShell` is a complete second layout.

```
LockedShell                                   ← .awkit-login-stage
├── .awkit-login-form-pane                    ← left: the active screen
│   ├── .awkit-login-brand-row                ← brand + appearance switch
│   │   ├── .awkit-login-brand-row-spacer
│   │   ├── .awkit-login-appearance-label
│   │   └── .awkit-login-appearance-switch > .awkit-login-appearance-thumb
│   ├── .awkit-login-scroll-body > .awkit-login-content
│   └── .awkit-login-footnote
└── .awkit-login-run-panel                    ← right: animated marketing panel
```

| Screen | Path | When |
|---|---|---|
| `LoginScreen` | `security/screens/LoginScreen.tsx` | Normal sign-in |
| `FirstRunSetup` | `security/screens/FirstRunSetup.tsx` | No account exists yet |
| `ForcedPasswordChange` | `security/screens/ForcedPasswordChange.tsx` | Password reset required |
| `RecoveryCodeNotice` | `security/screens/RecoveryCodeNotice.tsx` | One-time recovery code display |
| `RecoveryPasswordReset` | `security/screens/RecoveryPasswordReset.tsx` | Recovery-code sign-in |
| `SecurityUnavailable` | `security/screens/SecurityUnavailable.tsx` | Security subsystem failed to start |

Loading state between decisions: `.awkit-login-loading` + `.awkit-login-spin` (`SecurityGate`).

**The right-hand panel is a designed animation, not a static image.** It renders a fake live run:
`.awkit-login-run-grid`, `-run-spot`, `-run-scanline`, `-run-kicker` with a `-run-live-dot`,
`-run-demo-label`, `-run-lead`, then a `-run-timeline` of `-run-step-rail` / `-run-step-dot` /
`-run-step-line` / `-run-step-card` rows, a `-run-progress` bar and a `-run-stats` row of
`-run-stat` figures. It carries a **`demo` label by design** so it is never mistaken for real data.

`NotAuthorized` (`security/NotAuthorized.tsx`) is different: it renders *inside* the shell, reusing
the Administration classes (`.awkit-admin-page`, `.awkit-admin-modal-icon`, `.awkit-admin-muted`),
and replaces the page when a route mount fails its permission check.

---

## Route → permission reference

`app/renderer/security/routePermissions.ts` (56 lines). Header comment: *"A route absent from this
map is treated as PAGE_DASHBOARD-visible (always allowed to a signed-in user). Used by the nav
filter and the route-mount guard; the real boundary for any data/action a page performs is still the
main-process IPC permission check."*

| Permission | Routes |
|---|---|
| `PAGE_DASHBOARD` | `dashboard` |
| `PAGE_WORKFLOWS` | `workflowsLibrary`, `scenarioBuilder`, `workflow`, `runtimeInputs` |
| `PAGE_FLOWS` | `flowLibrary`, `flowChart`, `formDesigner` |
| `SEMANTIC_SEARCH` | `semanticSearch` |
| `PAGE_DATA_SOURCES` | `dataSources`, `dataSourceEditor`, `sessions` |
| `PAGE_INSTANCES` | `instanceMonitor`, `executionMonitor` |
| `PAGE_REPORTS` | `reportsOverview`, `reportsWorkflows`, `reportsInstances`, `reportsChrome`, `reportsRuntime`, `reportsFailures`, `reportsServer`, `reports` |
| `PAGE_RECORDER` | `recorder` |
| `PAGE_ROADMAP` | `roadmap` |
| `PAGE_SETTINGS` | `settings`, `offlineRuntime` |
| `USER_MANAGE` | `userManagement` |
| `ROLE_VIEW` | `roles`, `permissionsMatrix` |
| `AUDIT_VIEW` | `auditLog` |
| `PAGE_LICENSE` | `licensing` |
| `PAGE_LICENSE_ISSUER` | `licenseIssuer` *(+ `RouteExclusiveRoles: ISSUER_ROLE`)* |
| *(ungated)* | `projectContract` |

A role that holds no permission in a group makes the **whole navigation group vanish**; the redesign
must keep that behaviour rather than rendering a disabled or empty group.
