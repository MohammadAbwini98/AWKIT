import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import type { StructuredLog } from "@src/reports/StructuredLog";

export const sampleLogs: StructuredLog[] = [
  {
    timestamp: "2026-06-16T08:30:00.000Z",
    level: "info",
    executionId: "exec-20260616-001",
    instanceId: "instance-1",
    scenarioId: "customer-onboarding-scenario",
    flowId: "login-flow",
    stepId: "open-login",
    message: "Opening login page"
  },
  {
    timestamp: "2026-06-16T08:30:03.000Z",
    level: "info",
    executionId: "exec-20260616-001",
    instanceId: "instance-1",
    scenarioId: "customer-onboarding-scenario",
    flowId: "create-customer-flow",
    stepId: "read-customer-id",
    message: "Captured customer id output"
  },
  {
    timestamp: "2026-06-16T08:30:10.000Z",
    level: "warn",
    executionId: "exec-20260616-001",
    instanceId: "instance-2",
    scenarioId: "customer-onboarding-scenario",
    flowId: "login-flow",
    stepId: "mfa-handoff",
    message: "Manual handoff required for MFA"
  },
  {
    timestamp: "2026-06-16T08:30:42.000Z",
    level: "error",
    executionId: "exec-20260616-001",
    instanceId: "instance-3",
    scenarioId: "customer-onboarding-scenario",
    flowId: "validate-customer-flow",
    stepId: "assert-customer-visible",
    message: "Customer confirmation element was not visible"
  }
];

export const sampleConcurrentReport: ConcurrentRunReport = {
  executionId: "exec-20260616-001",
  scenarioId: "customer-onboarding-scenario",
  scenarioName: "Customer Onboarding Scenario",
  runMode: "dataDrivenConcurrent",
  maxConcurrentInstances: 5,
  status: "failed",
  startedAt: "2026-06-16T08:30:00.000Z",
  endedAt: "2026-06-16T08:31:12.000Z",
  durationMs: 72000,
  passedFlows: 9,
  failedFlows: 1,
  skippedFlows: 0,
  runtimeInputs: {
    selectedAccountType: "BUSINESS",
    selectedCountry: "JO",
    password: "[masked]"
  },
  instances: [
    {
      instanceId: "instance-1",
      status: "passed",
      durationMs: 50000,
      currentDataRowIndex: 0,
      screenshots: ["screenshots/exec-20260616-001/instance-1/login-flow/click-login.png"],
      downloadedFiles: ["downloads/exec-20260616-001/instance-1/customer-summary.pdf"]
    },
    {
      instanceId: "instance-2",
      status: "manualHandoff",
      durationMs: 64000,
      currentDataRowIndex: 1,
      screenshots: ["screenshots/exec-20260616-001/instance-2/login-flow/mfa-handoff.png"],
      downloadedFiles: []
    },
    {
      instanceId: "instance-3",
      status: "failed",
      durationMs: 45000,
      currentDataRowIndex: 2,
      error: "Customer confirmation element was not visible",
      screenshots: ["screenshots/exec-20260616-001/instance-3/validate-customer-flow/assert-customer-visible.png"],
      downloadedFiles: []
    }
  ]
};

export const preRunChecks = [
  { label: "Scenario exists", status: "passed" },
  { label: "Referenced flows exist", status: "passed" },
  { label: "Runtime inputs provided", status: "passed" },
  { label: "JSON paths resolve", status: "passed" },
  { label: "Locators configured", status: "passed" },
  { label: "Resource lock conflicts absent", status: "passed" },
  { label: "Bundled browser in production", status: "warning" }
];
