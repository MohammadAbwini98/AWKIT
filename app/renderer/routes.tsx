import {
  Activity,
  BarChart3,
  Boxes,
  ClipboardList,
  FileCheck2,
  Database,
  FileBarChart,
  FormInput,
  Gauge,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LineChart,
  ListChecks,
  MonitorDot,
  PanelRight,
  PlaySquare,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Table2,
  Users,
  Workflow,
  type LucideIcon
} from "lucide-react";
import type { ComponentType } from "react";
import { Dashboard } from "./pages/Dashboard";
import { DataSourceManager } from "./pages/DataSourceManager";
import { DataSourceEditor } from "./pages/DataSourceEditor";
import { ExecutionMonitor } from "./pages/ExecutionMonitor";
import { ExecutionReports } from "./pages/ExecutionReports";
import { FlowChartDesigner } from "./pages/FlowChartDesigner";
import { FlowLibrary } from "./pages/FlowLibrary";
import { FormDesigner } from "./pages/FormDesigner";
import { InstanceMonitor } from "./pages/InstanceMonitor";
import { ImplementationRoadmap } from "./pages/ImplementationRoadmap";
import { OfflineRuntimeStatus } from "./pages/OfflineRuntimeStatus";
import { ProjectContract } from "./pages/ProjectContract";
import { RuntimeInputPanel } from "./pages/RuntimeInputPanel";
import { ScenarioBuilder } from "./pages/ScenarioBuilder";
import { SettingsPage } from "./pages/Settings";
import { WorkflowDesigner } from "./pages/WorkflowDesigner";
import { WorkflowsLibrary } from "./pages/WorkflowsLibrary";
import { Recorder } from "./pages/Recorder";
import { SessionsManager } from "./pages/SessionsManager";
import { ReportsOverview } from "./pages/ReportsOverview";
import { ReportsWorkflows } from "./pages/ReportsWorkflows";
import { ReportsInstances } from "./pages/ReportsInstances";
import { ReportsChrome } from "./pages/ReportsChrome";
import { ReportsRuntime } from "./pages/ReportsRuntime";
import { ReportsFailures } from "./pages/ReportsFailures";
import { ReportsServer } from "./pages/ReportsServer";
import { UserManagement } from "./pages/admin/UserManagement";
import { RolesPage } from "./pages/admin/RolesPage";
import { PermissionsPage } from "./pages/admin/PermissionsPage";
import { AuditLogPage } from "./pages/admin/AuditLogPage";
import { LicensingPage } from "./pages/admin/LicensingPage";

export type RouteId =
  | "dashboard"
  | "workflow"
  | "flowChart"
  | "formDesigner"
  | "scenarioBuilder"
  | "workflowsLibrary"
  | "flowLibrary"
  | "runtimeInputs"
  | "dataSources"
  | "dataSourceEditor"
  | "instanceMonitor"
  | "executionMonitor"
  | "reportsOverview"
  | "reportsWorkflows"
  | "reportsInstances"
  | "reportsChrome"
  | "reportsRuntime"
  | "reportsFailures"
  | "reportsServer"
  | "reports"
  | "roadmap"
  | "projectContract"
  | "offlineRuntime"
  | "settings"
  | "recorder"
  | "sessions"
  | "userManagement"
  | "roles"
  | "permissionsMatrix"
  | "auditLog"
  | "licensing";

export interface AppRoute {
  id: RouteId;
  label: string;
  description: string;
  icon: LucideIcon;
  component: ComponentType;
}

export const routes: AppRoute[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Run readiness, recent activity, and quick actions.",
    icon: LayoutDashboard,
    component: Dashboard
  },
  {
    id: "workflowsLibrary",
    label: "Workflows",
    description: "All saved workflows. Open, edit, clone, export, or delete.",
    icon: LayoutGrid,
    component: WorkflowsLibrary
  },
  {
    id: "scenarioBuilder",
    label: "Workflow Builder",
    description: "Select saved flows, link them, and save executable workflows.",
    icon: ClipboardList,
    component: ScenarioBuilder
  },
  {
    id: "flowLibrary",
    label: "Flows",
    description: "Saved reusable automation flows.",
    icon: Boxes,
    component: FlowLibrary
  },
  {
    id: "flowChart",
    label: "Flow Designer",
    description: "Reusable Playwright flow nodes and connectors.",
    icon: GitBranch,
    component: FlowChartDesigner
  },
  {
    id: "formDesigner",
    label: "Form Designer",
    description: "Runtime input forms and field configuration.",
    icon: PanelRight,
    component: FormDesigner
  },
  {
    id: "workflow",
    label: "Workflow Designer",
    description: "Main visual workflow workspace.",
    icon: Workflow,
    component: WorkflowDesigner
  },
  {
    id: "runtimeInputs",
    label: "Runtime Inputs",
    description: "Scenario fields, values, and run-time selections.",
    icon: FormInput,
    component: RuntimeInputPanel
  },
  {
    id: "dataSources",
    label: "Data Sources",
    description: "JSON files, row mapping, and data binding.",
    icon: Database,
    component: DataSourceManager
  },
  {
    id: "dataSourceEditor",
    label: "Data Source Editor",
    description: "Visually edit a JSON data source as a table.",
    icon: Table2,
    component: DataSourceEditor
  },
  {
    id: "instanceMonitor",
    label: "Instances",
    description: "Concurrent browser instance state and controls.",
    icon: MonitorDot,
    component: InstanceMonitor
  },
  {
    id: "executionMonitor",
    label: "Run",
    description: "Live workflow execution timeline and run readiness.",
    icon: Activity,
    component: ExecutionMonitor
  },
  {
    id: "reportsOverview",
    label: "Reports",
    description: "Automation outcomes, durations, and live activity dashboards.",
    icon: BarChart3,
    component: ReportsOverview
  },
  {
    id: "reportsWorkflows",
    label: "Workflow Reports",
    description: "Per-workflow run statistics, durations, and drill-down.",
    icon: Workflow,
    component: ReportsWorkflows
  },
  {
    id: "reportsInstances",
    label: "Instance Reports",
    description: "Live instance status distribution and run history.",
    icon: MonitorDot,
    component: ReportsInstances
  },
  {
    id: "reportsChrome",
    label: "Chrome Consumption",
    description: "Live Chrome/Playwright consumption and RPM-style pressure gauges.",
    icon: Gauge,
    component: ReportsChrome
  },
  {
    id: "reportsRuntime",
    label: "Runtime Analytics",
    description: "Concurrency, host resource, and Chrome consumption history.",
    icon: LineChart,
    component: ReportsRuntime
  },
  {
    id: "reportsFailures",
    label: "Failure Analytics",
    description: "Failure categories, reliability ranking, and insights.",
    icon: ShieldAlert,
    component: ReportsFailures
  },
  {
    id: "reportsServer",
    label: "Server Performance",
    description: "Process resource usage and on-disk storage.",
    icon: Server,
    component: ReportsServer
  },
  {
    id: "reports",
    label: "Run Artifacts",
    description: "Stored run reports, screenshots, downloads, and errors.",
    icon: FileBarChart,
    component: ExecutionReports
  },
  {
    id: "roadmap",
    label: "Roadmap",
    description: "Implementation phases, acceptance status, and remaining work.",
    icon: ListChecks,
    component: ImplementationRoadmap
  },
  {
    id: "projectContract",
    label: "Project Contract",
    description: "Master build prompt, production rules, safety rules, and module contract.",
    icon: FileCheck2,
    component: ProjectContract
  },
  {
    id: "offlineRuntime",
    label: "Offline Runtime",
    description: "Bundled browser and offline production readiness.",
    icon: Gauge,
    component: OfflineRuntimeStatus
  },
  {
    id: "settings",
    label: "Settings",
    description: "Environment, packaging, and application preferences.",
    icon: Settings,
    component: SettingsPage
  },
  {
    id: "recorder",
    label: "Recorder",
    description: "Record browser interactions into reusable flows.",
    icon: PlaySquare,
    component: Recorder
  },
  {
    id: "sessions",
    label: "Sessions",
    description: "Capture and manage browser login sessions for protected sites.",
    icon: KeyRound,
    component: SessionsManager
  },
  {
    id: "userManagement",
    label: "Users",
    description: "Create users, assign roles, disable, reset passwords, and revoke sessions.",
    icon: Users,
    component: UserManagement
  },
  {
    id: "roles",
    label: "Roles",
    description: "Built-in roles and the permissions each grants.",
    icon: ShieldCheck,
    component: RolesPage
  },
  {
    id: "permissionsMatrix",
    label: "Permissions",
    description: "Permission-to-role matrix (deny-by-default reference).",
    icon: ListChecks,
    component: PermissionsPage
  },
  {
    id: "auditLog",
    label: "Audit Log",
    description: "Security audit trail of privileged actions.",
    icon: ClipboardList,
    component: AuditLogPage
  },
  {
    id: "licensing",
    label: "Licensing",
    description: "Machine licensing (placeholder — not yet implemented).",
    icon: KeyRound,
    component: LicensingPage
  }
];
