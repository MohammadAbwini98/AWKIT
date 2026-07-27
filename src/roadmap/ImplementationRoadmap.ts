/**
 * The A-K phase model the app renders on its Roadmap page, and the only source the Program Status
 * dashboard reads for phase state.
 *
 * THIS FILE IS HAND-MAINTAINED. Nothing derives it, so it goes stale silently: between the initial
 * commit (2026-07-04) and the 2026-07-27 reconciliation it was untouched across 282 commits, which
 * left Recorder Mode declared "pending" while it was one of the most developed features in the app.
 * Reconcile it whenever a phase's real state moves, not only when a phase closes.
 *
 * `partially-completed` exists because "complete" and "in-progress" could not describe J and K
 * honestly: the deliverables shipped, but each retains a named gap that is not active development
 * (an unexecuted manual gate, an unautomatable test case). Marking either "complete" would assert
 * an unrun check passed; "in-progress" would imply work underway that is not.
 */
export type RoadmapStatus = "complete" | "in-progress" | "partially-completed" | "pending" | "blocked";

export interface RoadmapPhase {
  id: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K";
  title: string;
  status: RoadmapStatus;
  deliverables: string[];
  acceptance: string;
  implementationNote: string;
}

export const implementationRoadmap: RoadmapPhase[] = [
  {
    id: "A",
    title: "Desktop Foundation",
    status: "complete",
    deliverables: ["Electron shell", "React routing", "Runtime path resolver", "User-profile runtime folders"],
    acceptance: "App opens on Windows and does not require admin permission for runtime folders.",
    implementationNote: "Electron, preload IPC, routing, and offline-aware runtime paths are in place."
  },
  {
    id: "B",
    title: "Flow Designer MVP",
    status: "complete",
    deliverables: ["React Flow canvas", "Node palette", "Properties inspector", "Save and reload flow JSON"],
    acceptance: "User can create and reload a simple login flow.",
    implementationNote: "Interactive flow designer supports nodes, connectors, validation, save, load, and export."
  },
  {
    id: "C",
    title: "Generic Playwright Runner",
    status: "complete",
    deliverables: ["Playwright runner", "Flow executor", "Step executor", "Locator/value resolution", "Logs and screenshots"],
    acceptance: "Saved flow runs without custom scenario-specific code.",
    implementationNote: "Profile-driven execution, retry handling, evidence capture, and offline browser policy are implemented."
  },
  {
    id: "D",
    title: "Data Binding",
    status: "complete",
    deliverables: ["JSON data sources", "Runtime input panel", "Binding editor", "Generated values", "Current-row support"],
    acceptance: "Same flow runs with different JSON/runtime values.",
    implementationNote: "Runtime inputs, JSON path lookup, generated values, flow outputs, and current-row values are supported."
  },
  {
    id: "E",
    title: "Scenario Builder / Workflow Builder",
    status: "in-progress",
    deliverables: ["Workflows Library page", "Multiple workflow CRUD", "Canvas shows enabled flows", "Flow order sync", "Save/load/clone/export"],
    acceptance: "User can create multiple workflows, view all in a library page, and open any to see its flows on the canvas.",
    implementationNote: "All five deliverables shipped: Workflows Library page, workflow CRUD, canvas load of saved flows, order sync, and save/load/clone/export. Remaining: the Workflow Builder itself has no import-from-file UI - import exists only in WorkflowsLibrary.tsx, so a workflow JSON cannot be brought in from the builder canvas."
  },
  {
    id: "F",
    title: "Concurrent UI Automation Instances",
    status: "complete",
    deliverables: ["Instance manager", "Instance pool", "Coordinator", "Browser process manager", "Instance monitor UI"],
    acceptance: "User can run the same scenario in 5 isolated concurrent UI automation instances.",
    implementationNote: "Runner fan-out is integrated: InstanceManager/InstancePool/coordinator drive real concurrent isolated instances through execution.ipc.ts, and the Instance Monitor renders live per-instance progress, workflow run grouping, and status-aware bulk controls backed by real executionEngine methods. Verified by verify:concurrency, verify:instance-monitor, and verify:instance-monitor-gui."
  },
  {
    id: "G",
    title: "Data-Driven Concurrent Runs",
    status: "complete",
    deliverables: ["JSON row fan-out", "One row per instance", "Queue overflow", "Per-row report", "Retry failed rows"],
    acceptance: "User can run onboarding for every row in customers.json with max 5 parallel instances.",
    implementationNote: "ConcurrentRunProfile exposes the dataDrivenConcurrent run mode with maxConcurrentInstances, per-instance retry (retryFailedInstance/retryCount) and failure policy; it is wired end to end through execution.ipc.ts, InstanceManager, the Instance Monitor, and ExecutionReport. Note: awkit-7bu tracks the persisted row-driven workflow never having run against a real Oracle database - that is an Oracle data-source gate, not a JSON row fan-out gap."
  },
  {
    id: "H",
    title: "Advanced Flow Control",
    status: "complete",
    deliverables: ["Conditional connectors", "Failure connectors", "Manual approvals", "Loops", "Run another flow node"],
    acceptance: "Scenario can branch, and manual handoff pauses only one instance.",
    implementationNote: "Structured conditional/parallel/loop connectors at both flow and workflow level alongside the legacy success/failure/conditional/always/outcome/loopBack kinds. FlowExecutor executes loops (iterationCount/maxIterations, exercised by the mock-loop-flow fixture) and Run Another Flow carries a depth-5 recursion guard. Manual handoff pauses a single instance."
  },
  {
    id: "I",
    title: "Reporting & Stability",
    status: "complete",
    deliverables: ["Run history", "Concurrent summary", "Instance report", "Step timeline", "Screenshot gallery", "Validation"],
    acceptance: "Every run produces clear logs, screenshots, and report details.",
    implementationNote: "Structured logging, secret masking, screenshots, reports, pre-run validation, and security policy are implemented."
  },
  {
    id: "J",
    title: "Offline Standalone Packaging",
    status: "partially-completed",
    deliverables: ["Offline packaging scripts", "Bundled Chromium", "Dependency manifest", "Portable package", "Installer", "Startup check"],
    acceptance: "App runs on production Windows with no internet, no npm install, no global Node/Playwright/Chromium, and no admin permission.",
    implementationNote: "Every deliverable is built - packaging scripts and validators, bundled Chromium, dependency manifest, portable and per-user NSIS packaging, and the startup gate. Not complete because the acceptance sentence IS the clean-machine offline GUI walkthrough, which has never been executed; owner policy (2026-07-24) made that gate optional and non-blocking for releases, which does not make it passed."
  },
  {
    id: "K",
    title: "Recorder Mode",
    status: "partially-completed",
    deliverables: ["Browser action recorder", "Locator suggestions", "Action-to-node conversion", "Editable recorded flows"],
    acceptance: "User records a flow and saves it as editable nodes.",
    implementationNote: "All four deliverables shipped and the acceptance criterion is met: ranked unique locators with compound/tree disambiguation, runtime locator self-healing, Smart Wait observation, auto-captured URLs, and the protected-login handoff. Eight verify:recorder-* suites cover it (verify:recorder-gui 103 PASS / 0 FAIL / 0 NOT RUN). Not complete because two verification cases remain open under awkit-38k: REC-024 (real browser crash) is NOT RUN, and REC-022 is permanently blocked - it needs an authorized human operator and a protected login must never be automated."
  }
];

export interface RoadmapSummary {
  total: number;
  complete: number;
  inProgress: number;
  partiallyCompleted: number;
  pending: number;
  blocked: number;
  completionPercent: number;
}

export function getRoadmapSummary(phases: RoadmapPhase[] = implementationRoadmap): RoadmapSummary {
  const complete = phases.filter((phase) => phase.status === "complete").length;
  const inProgress = phases.filter((phase) => phase.status === "in-progress").length;
  const partiallyCompleted = phases.filter((phase) => phase.status === "partially-completed").length;
  const pending = phases.filter((phase) => phase.status === "pending").length;
  const blocked = phases.filter((phase) => phase.status === "blocked").length;

  return {
    total: phases.length,
    complete,
    inProgress,
    partiallyCompleted,
    pending,
    blocked,
    // Deliberately counts `complete` only. A partially-completed phase has a named unclosed gap, so
    // crediting it any fraction here would report progress the repository cannot evidence.
    completionPercent: Math.round((complete / phases.length) * 100)
  };
}

/**
 * The phase to show as "current focus": active development first, then a phase that shipped but
 * still carries a gap, then work not yet started.
 */
export function getNextRoadmapPhase(phases: RoadmapPhase[] = implementationRoadmap): RoadmapPhase | undefined {
  return (
    phases.find((phase) => phase.status === "in-progress") ??
    phases.find((phase) => phase.status === "partially-completed") ??
    phases.find((phase) => phase.status === "pending")
  );
}

export function formatRoadmapStatus(status: RoadmapStatus): string {
  switch (status) {
    case "complete":
      return "Complete";
    case "in-progress":
      return "In progress";
    case "partially-completed":
      return "Partially completed";
    case "pending":
      return "Pending";
    case "blocked":
      return "Blocked";
  }
}
