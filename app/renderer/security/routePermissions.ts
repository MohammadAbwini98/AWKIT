import { Permission } from "@src/security/authz/Permissions";
import type { RouteId } from "../routes";

/**
 * Route → required page permission. A route absent from this map is treated as PAGE_DASHBOARD-visible
 * (always allowed to a signed-in user). Used by the nav filter and the route-mount guard; the real
 * boundary for any data/action a page performs is still the main-process IPC permission check.
 */
export const RoutePermissions: Partial<Record<RouteId, Permission>> = {
  dashboard: Permission.PAGE_DASHBOARD,
  workflowsLibrary: Permission.PAGE_WORKFLOWS,
  scenarioBuilder: Permission.PAGE_WORKFLOWS,
  workflow: Permission.PAGE_WORKFLOWS,
  runtimeInputs: Permission.PAGE_WORKFLOWS,
  flowLibrary: Permission.PAGE_FLOWS,
  flowChart: Permission.PAGE_FLOWS,
  formDesigner: Permission.PAGE_FLOWS,
  dataSources: Permission.PAGE_DATA_SOURCES,
  dataSourceEditor: Permission.PAGE_DATA_SOURCES,
  sessions: Permission.PAGE_DATA_SOURCES,
  instanceMonitor: Permission.PAGE_INSTANCES,
  executionMonitor: Permission.PAGE_INSTANCES,
  reportsOverview: Permission.PAGE_REPORTS,
  reportsWorkflows: Permission.PAGE_REPORTS,
  reportsInstances: Permission.PAGE_REPORTS,
  reportsChrome: Permission.PAGE_REPORTS,
  reportsRuntime: Permission.PAGE_REPORTS,
  reportsFailures: Permission.PAGE_REPORTS,
  reportsServer: Permission.PAGE_REPORTS,
  reports: Permission.PAGE_REPORTS,
  recorder: Permission.PAGE_RECORDER,
  roadmap: Permission.PAGE_SETTINGS,
  projectContract: Permission.PAGE_SETTINGS,
  offlineRuntime: Permission.PAGE_SETTINGS,
  settings: Permission.PAGE_SETTINGS,
  // Super User Administration area
  userManagement: Permission.USER_MANAGE,
  roles: Permission.ROLE_VIEW,
  permissionsMatrix: Permission.ROLE_VIEW,
  auditLog: Permission.AUDIT_VIEW,
  licensing: Permission.PAGE_LICENSE
};
