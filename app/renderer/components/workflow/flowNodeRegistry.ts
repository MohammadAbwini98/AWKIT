import type { StepType } from "@src/profiles/FlowProfile";
import type { FlowDesignerNodeData } from "./flowDesignerTypes";
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from "./flowDesignerTypes";
import { flowNodeCatalog, getFlowNodeCatalogItem, type FlowNodeCatalogItem } from "./flowNodeCatalog";

export type NodeCategory = "flow" | "navigation" | "interaction" | "input" | "capture" | "assertion" | "control";

export type PropertySection =
  | "locator"
  | "value"
  | "select"
  | "wait"
  | "assertion"
  | "screenshot"
  | "scroll"
  | "loop"
  | "runFlow"
  | "condition"
  | "routeChange"
  | "session"
  | "protectedLogin"
  | "reuseSession"
  | "oracle"
  | "execution"
  | "output";

export interface NodeTypeDefinition extends FlowNodeCatalogItem {
  category: NodeCategory;
  defaultSize: { width: number; height: number };
  sections: PropertySection[];
  /** Whether the runner can execute this node type today. */
  executable: boolean;
  validate: (data: FlowDesignerNodeData) => string[];
}

interface RegistryMeta {
  category: NodeCategory;
  sections: PropertySection[];
  executable: boolean;
  validate?: (data: FlowDesignerNodeData) => string[];
}

const META: Record<StepType, RegistryMeta> = {
  start: { category: "flow", sections: [], executable: true },
  end: { category: "flow", sections: [], executable: true },
  goto: {
    category: "navigation",
    sections: ["value", "execution"],
    executable: true,
    validate: (d) => (d.value.trim() ? [] : ["Open URL requires a URL value."])
  },
  click: { category: "interaction", sections: ["locator", "execution", "output"], executable: true },
  fill: {
    category: "input",
    sections: ["locator", "value", "execution", "output"],
    executable: true,
    validate: (d) => (d.value.trim() || d.valueSourceType === "dynamic" ? [] : ["Fill requires a value or a dynamic binding."])
  },
  select: { category: "input", sections: ["locator", "select", "value", "execution"], executable: true },
  check: { category: "input", sections: ["locator", "execution"], executable: true },
  uncheck: { category: "input", sections: ["locator", "execution"], executable: true },
  radio: { category: "input", sections: ["locator", "value", "execution"], executable: true },
  scroll: { category: "interaction", sections: ["scroll", "execution"], executable: true },
  wait: {
    category: "control",
    sections: ["wait", "execution"],
    executable: true,
    validate: (d) =>
      d.waitType !== "time" && !d.locatorValue.trim() && !d.value.trim()
        ? ["This Wait type needs a selector or text to wait for."]
        : []
  },
  uploadFile: {
    category: "input",
    sections: ["locator", "value", "execution"],
    executable: true,
    validate: (d) => (d.value.trim() ? [] : ["Upload requires a file path source."])
  },
  downloadFile: { category: "capture", sections: ["locator", "execution"], executable: true },
  readText: { category: "capture", sections: ["locator", "output", "execution"], executable: true },
  assertText: {
    category: "assertion",
    sections: ["locator", "assertion", "execution"],
    executable: true,
    validate: (d) => (d.expectedValue.trim() ? [] : ["Assertion requires an expected value."])
  },
  assertVisible: { category: "assertion", sections: ["locator", "assertion", "execution"], executable: true },
  screenshot: { category: "capture", sections: ["screenshot", "execution"], executable: true },
  manualHandoff: { category: "control", sections: ["execution"], executable: true },
  condition: {
    category: "control",
    sections: ["condition", "execution"],
    executable: true,
    validate: (d) => (d.value.trim() ? [] : ["Condition requires an expression."])
  },
  loop: {
    category: "control",
    sections: ["loop", "execution"],
    executable: true,
    validate: (d) =>
      d.loopType === "fixedCount" && d.iterationCount < 1 ? ["Fixed-count loop needs at least 1 iteration."] : []
  },
  runFlow: {
    category: "control",
    sections: ["runFlow", "execution"],
    executable: true,
    validate: (d) => (d.targetFlowId.trim() ? [] : ["Run Another Flow requires a target flow."])
  },
  routeChange: {
    category: "navigation",
    sections: ["routeChange", "execution"],
    executable: true,
    validate: (d) => validateRouteChange(d)
  },
  saveSession: {
    category: "control",
    sections: ["session", "execution"],
    executable: true,
    validate: (d) => (d.sessionName.trim() ? [] : ["Save Session requires a session name."])
  },
  protectedLoginHandoff: {
    category: "control",
    sections: ["protectedLogin", "execution"],
    executable: true,
    validate: (d) => validateProtectedLogin(d)
  },
  autoSecureLogin: {
    category: "control",
    sections: ["value", "execution"],
    executable: true,
    validate: (d) => (d.value.trim() ? [] : ["Auto Secure Login requires a target URL."])
  },
  reuseSession: {
    category: "control",
    sections: ["reuseSession", "execution"],
    executable: true,
    validate: (d) => (d.reuseSessionId.trim() ? [] : ["Reuse Session requires a saved session to be selected."])
  },
  // ── Multi-Window / Popup ──────────────────────────────────────────────────
  switchToPopup: {
    category: "navigation",
    sections: ["execution"],
    executable: true
  },
  closePopup: {
    category: "navigation",
    sections: ["execution"],
    executable: true
  },
  switchToMainPage: {
    category: "navigation",
    sections: ["execution"],
    executable: true
  },
  oracle: {
    category: "capture",
    sections: ["oracle", "output", "execution"],
    executable: true,
    validate: (d) => validateOracle(d)
  }
};

/** Validation for the Oracle query node. */
function validateOracle(d: FlowDesignerNodeData): string[] {
  const messages: string[] = [];
  const cfg = d.oracle;
  if (!cfg) return ["Oracle node is not configured."];
  if (cfg.connectionSource === "dataSource") {
    if (!cfg.dataSourceId?.trim()) messages.push("Select an Oracle Data Source.");
  } else {
    if (!cfg.connectionProfileId?.trim()) messages.push("Select an Oracle connection profile.");
    if (!cfg.sql?.trim()) messages.push("A SQL query is required when using a connection profile.");
  }
  if ((cfg.returnType === "string" || cfg.returnType === "number" || cfg.returnType === "boolean") && !cfg.selectedColumn?.trim()) {
    messages.push("Select a column to read for this return type.");
  }
  if (cfg.returnType === "list" && cfg.listMode === "column" && !cfg.selectedColumn?.trim()) {
    messages.push("Select a column for a primitive list.");
  }
  return messages;
}

/** Validation + capability notes for the Protected Login Handoff node. */
function validateProtectedLogin(d: FlowDesignerNodeData): string[] {
  const messages: string[] = [];
  if (d.handoffMode === "pauseAndAsk" && !d.handoffInstructions.trim()) {
    messages.push("Provide instructions for the user when mode is 'Pause and ask user'.");
  }
  if (d.handoffTimeoutMs < 0) messages.push("Timeout must be a positive value (or 0 to disable).");
  if (d.handoffMode === "openSystemBrowserOAuth") {
    messages.push("OAuth is not configured for this project — this mode will pause and show OAuth as unavailable.");
  }
  if (d.handoffMode === "useSavedSession") {
    messages.push("Use saved session requires Load Session support, which is not implemented yet.");
  }
  if (d.handoffMode === "useTestSession") {
    messages.push("Use test session requires a configured test session, which is not available.");
  }
  return messages;
}

/** Mode-aware validation for the Route Change node (Task 05). */
function validateRouteChange(d: FlowDesignerNodeData): string[] {
  const messages: string[] = [];
  if ((d.routeMode === "switchToUrl" || d.routeMode === "navigateCurrentPage") && !d.value.trim()) {
    messages.push("Route Change requires a URL value for this mode.");
  }
  if (d.routeMode === "waitForNewTab" && (!d.timeoutMs || d.timeoutMs <= 0)) {
    messages.push("Wait for new tab requires a positive timeout.");
  }
  if (d.routeMode === "switchToUrl" && d.urlMatch === "regex" && d.value.trim()) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(d.value);
    } catch {
      messages.push("Route Change URL match is an invalid regular expression.");
    }
  }
  return messages;
}

export function getNodeDefinition(type: StepType): NodeTypeDefinition {
  const catalog = getFlowNodeCatalogItem(type);
  const meta = META[type] ?? { category: "flow" as const, sections: [], executable: true };
  return {
    ...catalog,
    category: meta.category,
    defaultSize: { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT },
    sections: meta.sections,
    executable: meta.executable,
    validate: meta.validate ?? (() => [])
  };
}

export function hasSection(type: StepType, section: PropertySection): boolean {
  return (META[type]?.sections ?? []).includes(section);
}

/** Full registry (one definition per catalog entry). */
export const nodeRegistry: NodeTypeDefinition[] = flowNodeCatalog.map((item) => getNodeDefinition(item.type));
