import {
  Camera,
  CheckSquare,
  Circle,
  CircleDot,
  Code2,
  Database,
  Download,
  Eye,
  ExternalLink,
  FileDown,
  FileUp,
  GitBranch,
  Hand,
  History,
  KeyRound,
  Layers,
  Link,
  ListChecks,
  MousePointerClick,
  Play,
  Radio,
  Repeat,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Square,
  SquarePen,
  Timer,
  Type,
  Upload
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { StepType } from "@src/profiles/FlowProfile";

export interface FlowNodeCatalogItem {
  type: StepType;
  label: string;
  description: string;
  icon: LucideIcon;
  requiresLocator?: boolean;
  requiresValue?: boolean;
}

export const flowNodeCatalog: FlowNodeCatalogItem[] = [
  { type: "start", label: "Start", description: "Flow entry point", icon: Play },
  { type: "goto", label: "Open URL", description: "Navigate the page", icon: Link, requiresValue: true },
  { type: "click", label: "Click", description: "Click an element", icon: MousePointerClick, requiresLocator: true },
  { type: "fill", label: "Fill Text", description: "Fill an input", icon: SquarePen, requiresLocator: true, requiresValue: true },
  { type: "select", label: "Select Dropdown", description: "Select an option", icon: ListChecks, requiresLocator: true, requiresValue: true },
  { type: "check", label: "Check Checkbox", description: "Check a box", icon: CheckSquare, requiresLocator: true },
  { type: "uncheck", label: "Uncheck Checkbox", description: "Uncheck a box", icon: Square, requiresLocator: true },
  { type: "radio", label: "Select Radio", description: "Select a radio option", icon: Radio, requiresLocator: true, requiresValue: true },
  { type: "scroll", label: "Scroll", description: "Scroll the page", icon: ScrollText, requiresValue: true },
  { type: "wait", label: "Wait", description: "Pause execution", icon: Timer, requiresValue: true },
  { type: "uploadFile", label: "Upload File", description: "Upload a file", icon: FileUp, requiresLocator: true, requiresValue: true },
  { type: "downloadFile", label: "Download File", description: "Capture a download", icon: FileDown, requiresLocator: true },
  { type: "readText", label: "Read Text", description: "Read element text", icon: Type, requiresLocator: true },
  { type: "assertText", label: "Assert Text", description: "Assert text content", icon: CircleDot, requiresLocator: true, requiresValue: true },
  { type: "assertVisible", label: "Assert Visible", description: "Assert element visibility", icon: Eye, requiresLocator: true },
  { type: "screenshot", label: "Take Screenshot", description: "Capture page image", icon: Camera },
  { type: "manualHandoff", label: "Manual Handoff", description: "Pause for human action", icon: Hand },
  { type: "condition", label: "Condition", description: "Branch by expression", icon: GitBranch, requiresValue: true },
  { type: "loop", label: "Loop", description: "Repeat over data", icon: Repeat, requiresValue: true },
  { type: "runFlow", label: "Run Another Flow", description: "Call a reusable flow", icon: Code2, requiresValue: true },
  { type: "routeChange", label: "Route Change", description: "Switch active tab / URL context", icon: ExternalLink },
  { type: "saveSession", label: "Save Session", description: "Save browser login/session state", icon: KeyRound },
  { type: "protectedLoginHandoff", label: "Protected Login Handoff", description: "Pause for protected/SSO/MFA login", icon: ShieldAlert },
  { type: "autoSecureLogin", label: "Auto Secure Login", description: "Capture manual login in real Chrome", icon: ShieldCheck, requiresValue: true },
  { type: "reuseSession", label: "Reuse Session", description: "Load a previously saved session profile", icon: History },
  // ── Multi-Window / Popup ──────────────────────────────────────────────────
  { type: "switchToPopup", label: "Switch to Popup", description: "Wait for a new popup/window and switch to it", icon: Layers },
  { type: "closePopup", label: "Close Popup", description: "Wait for a popup/window to close and return to main", icon: Layers },
  { type: "switchToMainPage", label: "Switch to Main Page", description: "Return automation context to the main page", icon: Layers },
  { type: "oracle", label: "Oracle Query", description: "Run a read-only Oracle SQL query", icon: Database },
  { type: "end", label: "End", description: "Flow exit point", icon: Download }
];

export function getFlowNodeCatalogItem(type: StepType): FlowNodeCatalogItem {
  return flowNodeCatalog.find((item) => item.type === type) ?? flowNodeCatalog[0];
}
