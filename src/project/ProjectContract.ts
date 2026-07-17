export interface ContractItem {
  title: string;
  detail: string;
}

export interface ContractSection {
  title: string;
  items: ContractItem[];
}

export interface ContractPhase {
  order: number;
  title: string;
  target: string;
}

export const projectContract = {
  source: "playwright_flow_studio_updated_phases/11_MASTER_CLAUDE_CODEX_PROMPT.md",
  appName: "SpecterStudio",
  goal:
    "Build a no-code / low-code Windows desktop application for authorized web UI automation using Playwright.",
  stack: [
    "Electron",
    "React",
    "TypeScript",
    "React Flow",
    "Lucide React",
    "Playwright",
    "Node.js inside Electron",
    "JSON storage with SQLite-ready boundaries",
    "Offline Windows packaging"
  ],
  productionRequirements: [
    "Run without internet.",
    "Run without npm install.",
    "Run without admin permission.",
    "Run without downloading Playwright browsers.",
    "Run without global Node.js.",
    "Run without global Playwright.",
    "Run without global Chromium.",
    "Bundle all dependencies and browser binaries.",
    "Store runtime data under the user profile.",
    "Support a portable app or per-user installer."
  ],
  safetyRules: [
    "Only automate authorized web UI workflows.",
    "Do not bypass CAPTCHA, MFA, bot detection, access restrictions, or rate limits.",
    "Use manual handoff for MFA, CAPTCHA, security confirmation, and human approval.",
    "Never load remote renderer code or production scripts from external URLs.",
    "Mask secrets in logs, screenshots metadata, and reports."
  ],
  architectureModules: [
    "app/main IPC layer",
    "app/renderer UI",
    "src/runner",
    "src/orchestrator",
    "src/instances",
    "src/profiles",
    "src/data",
    "src/offline",
    "src/reports",
    "src/storage",
    "src/utils",
    "scripts",
    "vendor",
    "resources"
  ],
  capabilitySections: [
    {
      title: "Flow Authoring",
      items: [
        { title: "Visual flows", detail: "Draw reusable automation profiles with nodes and connectors." },
        { title: "Locator configuration", detail: "Configure resilient Playwright locator strategies per step." },
        { title: "Supported actions", detail: "Click, fill, select, check, upload, download, scroll, wait, screenshot, and assertions." }
      ]
    },
    {
      title: "Scenario Execution",
      items: [
        { title: "Flow linking", detail: "Link flow profiles into ordered scenario profiles." },
        { title: "Runtime data", detail: "Bind values from JSON files, runtime UI selections, generated values, and current rows." },
        { title: "Concurrent runs", detail: "Run isolated browser automation instances with per-instance state and evidence." }
      ]
    },
    {
      title: "Production Operations",
      items: [
        { title: "Monitoring", detail: "Monitor execution, queue state, instance state, and live progress." },
        { title: "Reports", detail: "Generate structured logs, screenshots, downloads, and run reports." },
        { title: "Offline runtime", detail: "Validate bundled dependencies, browser binaries, and writable runtime folders." }
      ]
    }
  ] satisfies ContractSection[],
  phases: [
    { order: 1, title: "Desktop shell", target: "Electron, React, routing, app shell, runtime path resolver." },
    { order: 2, title: "Flow designer MVP", target: "Canvas, node palette, connectors, and flow JSON persistence." },
    { order: 3, title: "Flow JSON schema", target: "Typed reusable profile schemas for nodes, edges, and step metadata." },
    { order: 4, title: "Generic Playwright runner", target: "Profile-driven runner, flow executor, step executor, logs, and screenshots." },
    { order: 5, title: "Data binding and runtime inputs", target: "JSON data, current rows, generated values, environment values, and UI selections." },
    { order: 6, title: "Scenario builder and flow linking", target: "Ordered, conditional, optional, and output-passing flow links." },
    { order: 7, title: "Concurrent UI automation instances", target: "Instance manager, pool, coordinator, locks, workers, and isolated state." },
    { order: 8, title: "Data-driven concurrent runs", target: "One JSON row per instance, queue overflow, row reports, and failed-row retry." },
    { order: 9, title: "Reports and logs", target: "Run history, step timelines, screenshots, exports, validation, and masking." },
    { order: 10, title: "Offline standalone packaging", target: "Bundled Chromium, dependency manifest, portable package, installer, and startup checks." },
    { order: 11, title: "Recorder mode", target: "Action recorder, locator suggestions, action-to-node conversion, and editable recorded flows." },
    { order: 12, title: "Final QA", target: "End-to-end validation of offline, concurrent, and reporting behavior." }
  ] satisfies ContractPhase[]
};
