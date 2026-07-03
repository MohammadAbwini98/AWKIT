export type RoadmapStatus = "complete" | "in-progress" | "pending" | "blocked";

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
    implementationNote: "Workflow Builder now starts with empty canvas and loads saved flows on open. Workflows Library page added. Remaining: full edge/condition persistence validation, import from file UI in builder."
  },
  {
    id: "F",
    title: "Concurrent UI Automation Instances",
    status: "in-progress",
    deliverables: ["Instance manager", "Instance pool", "Coordinator", "Browser process manager", "Instance monitor UI"],
    acceptance: "User can run the same scenario in 5 isolated concurrent UI automation instances.",
    implementationNote: "Instances page now shows real state only (dummy data removed). Controls are status-aware. Full Playwright runner fan-out integration is the remaining step before marking complete."
  },
  {
    id: "G",
    title: "Data-Driven Concurrent Runs",
    status: "in-progress",
    deliverables: ["JSON row fan-out", "One row per instance", "Queue overflow", "Per-row report", "Retry failed rows"],
    acceptance: "User can run onboarding for every row in customers.json with max 5 parallel instances.",
    implementationNote: "Data row modeling, queue behavior, and per-instance reports exist; full runner fan-out is the next hardening step."
  },
  {
    id: "H",
    title: "Advanced Flow Control",
    status: "in-progress",
    deliverables: ["Conditional connectors", "Failure connectors", "Manual approvals", "Loops", "Run another flow node"],
    acceptance: "Scenario can branch, and manual handoff pauses only one instance.",
    implementationNote: "Conditional routing and manual handoff primitives exist; loop and nested-flow execution need deeper runner integration."
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
    status: "in-progress",
    deliverables: ["Offline packaging scripts", "Bundled Chromium", "Dependency manifest", "Portable package", "Installer", "Startup check"],
    acceptance: "App runs on production Windows with no internet, no npm install, no global Node/Playwright/Chromium, and no admin permission.",
    implementationNote: "Packaging scripts and validators are implemented; Chromium must be prepared locally before strict production packaging passes."
  },
  {
    id: "K",
    title: "Recorder Mode",
    status: "pending",
    deliverables: ["Browser action recorder", "Locator suggestions", "Action-to-node conversion", "Editable recorded flows"],
    acceptance: "User records a flow and saves it as editable nodes.",
    implementationNote: "Recorder mode is intentionally queued after runner, reporting, and offline packaging foundations stabilize."
  }
];

export interface RoadmapSummary {
  total: number;
  complete: number;
  inProgress: number;
  pending: number;
  blocked: number;
  completionPercent: number;
}

export function getRoadmapSummary(phases: RoadmapPhase[] = implementationRoadmap): RoadmapSummary {
  const complete = phases.filter((phase) => phase.status === "complete").length;
  const inProgress = phases.filter((phase) => phase.status === "in-progress").length;
  const pending = phases.filter((phase) => phase.status === "pending").length;
  const blocked = phases.filter((phase) => phase.status === "blocked").length;

  return {
    total: phases.length,
    complete,
    inProgress,
    pending,
    blocked,
    completionPercent: Math.round((complete / phases.length) * 100)
  };
}

export function getNextRoadmapPhase(phases: RoadmapPhase[] = implementationRoadmap): RoadmapPhase | undefined {
  return phases.find((phase) => phase.status === "in-progress") ?? phases.find((phase) => phase.status === "pending");
}

export function formatRoadmapStatus(status: RoadmapStatus): string {
  switch (status) {
    case "complete":
      return "Complete";
    case "in-progress":
      return "In progress";
    case "pending":
      return "Pending";
    case "blocked":
      return "Blocked";
  }
}
