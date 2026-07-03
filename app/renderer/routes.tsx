import {
  Activity,
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
  ListChecks,
  MonitorDot,
  PanelRight,
  PlaySquare,
  Settings,
  Table2,
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
  | "reports"
  | "roadmap"
  | "projectContract"
  | "offlineRuntime"
  | "settings"
  | "recorder"
  | "sessions";

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
    id: "reports",
    label: "Reports",
    description: "Run history, screenshots, downloads, and errors.",
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
  }
];
