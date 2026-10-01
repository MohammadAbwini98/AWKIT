/**
 * The A-N phase model the app renders on its Roadmap page, and the only source the Program Status
 * dashboard reads for phase state. L (Local AI & Intelligent Automation) was registered pending on
 * 2026-09-19; M (Optional Application Knowledge Base) and N (Visual Recognition and Automation)
 * were registered pending on 2026-09-22. Their milestone order lives in Beads, not in this file.
 *
 * THIS FILE IS HAND-MAINTAINED. Nothing derives it, so it goes stale silently: between the initial
 * commit (2026-07-04) and the 2026-07-27 reconciliation it was untouched across 282 commits, which
 * left Recorder Mode declared "pending" while it was one of the most developed features in the app.
 * Reconcile it whenever a phase's real state moves, not only when a phase closes.
 *
 * `partially-completed` exists because "complete" and "in-progress" could not describe J
 * honestly: the deliverables shipped, but J retains a named gap that is not active development
 * (an unexecuted manual gate). Marking it "complete" would assert an unrun check passed;
 * "in-progress" would imply work underway that is not. K used to share this status until its last
 * gate (REC-022) was executed live on 2026-08-22; it reconciled to "complete" on 2026-08-24.
 */
export type RoadmapStatus = "complete" | "in-progress" | "partially-completed" | "pending" | "blocked";

export interface RoadmapPhase {
  id: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N";
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
    status: "complete",
    deliverables: ["Workflows Library page", "Multiple workflow CRUD", "Canvas shows enabled flows", "Flow order sync", "Save/load/clone/export"],
    acceptance: "User can create multiple workflows, view all in a library page, and open any to see its flows on the canvas.",
    implementationNote: "All five deliverables shipped: Workflows Library page, workflow CRUD, canvas load of saved flows, order sync, and save/load/clone/export. Workflow JSON import is available from both the library and builder, with shared structural validation, dirty-canvas confirmation, and confirm-before-overwrite collision handling."
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
    status: "complete",
    deliverables: ["Offline packaging scripts", "Bundled Chromium", "Dependency manifest", "Portable package", "Installer", "Startup check"],
    acceptance: "App runs on production Windows with no internet, no npm install, no global Node/Playwright/Chromium, and no admin permission.",
    implementationNote: "Acceptance was executed on 2026-08-29 against canonical 0.1.21 portable and per-user NSIS artifacts in a restored offline Windows 11 Pro VM with no source tree, network adapter, global Node/Playwright/Chromium, existing AWKIT profile, admin rights or UAC: 21 PASS / 0 FAIL / 3 NOT EXECUTED. Portable launch, LocalAppData placement, guest hash match, standard-user ownership, install, installed launch and uninstall passed. The three NOT EXECUTED rows are legacy upgrade-profile/summary/migration procedures and are not counted as PASS. The later canonical recut retained the identical app.asar payload and passed packaged validation 87/87. Separate release risks remain visible outside this phase: Windows Authenticode is not configured; licensed installed-Chrome workflow evidence needs an authorized issuer key; awkit-7bu and awkit-cm8 retain real-Oracle and sustained-soak gates."
  },
  {
    id: "K",
    title: "Recorder Mode",
    status: "complete",
    deliverables: ["Browser action recorder", "Locator suggestions", "Action-to-node conversion", "Editable recorded flows"],
    acceptance: "User records a flow and saves it as editable nodes.",
    implementationNote: "All four deliverables shipped and the acceptance criterion is met: ranked unique locators with compound/tree disambiguation, runtime locator self-healing, Smart Wait observation, auto-captured URLs, and the protected-login handoff. REC-024 passed on 2026-07-27 (commit 958f575; bead awkit-38k closed). The final gate, REC-022, was executed live on 2026-08-22 by an authorized operator with an approved test identity: protected login completed manually in real Chrome on an app-owned scoped profile (session session-f11ab5c3 captured), the recorder resumed authenticated, and the saved workflow reused the captured session - final report 8edbdb98-dfd8-48cc-84cc-ebde3d5e6a4d passed 10/10 steps with Reuse Session returning outcome=sessionLoaded. Closing bead awkit-cey is closed; comprehensive-validation ledger stands at 64 PASS / 2 NOT RUN / 0 BLOCKED with REC-022 PASS. Reconciled from partially-completed to complete on 2026-08-24."
  },
  {
    id: "L",
    title: "Local AI & Intelligent Automation",
    status: "in-progress",
    deliverables: ["L0 Decisions & owner audit", "L1 AI foundation, autonomy policy & performance gate", "L2 Deterministic Recorder & Element Spy", "L3 Intelligent locators", "L4 Authoring diagnostics & AI explanations", "L5 Failure evidence & failure intelligence", "L6 Reusable fragments & templates", "L7 Release confirmation", "L8a Hardware-adaptive inference runtime", "L8b External compatible-model registration & qualification", "L9 Adaptive time budgets, progress & ETA", "L10 Deterministic DOM intelligence (Scrapling)", "L11 Performance-oriented DOM intelligence"],
    acceptance: "With no model installed the product behaves exactly as today; with the model, every automatic change is proven, audited and one-click revertible, and no model call runs on the synchronous execution path. Extension (2026-09-27): an administrator can run the model on CPU and RAM, GPU-Offload or GPU-Only on any compatible NVIDIA adapter using user-supplied, hash-pinned GPU components, register any compatible model with honest Compatible and Qualified labels, and see bounded time budgets with honest progress and ETA, while non-AI automation never depends on any of it. Extension (2026-09-30): with the optional parser-only DOM-intelligence provider (Scrapling) absent, disabled or failing, behavior is unchanged; when available it may only offer bounded deterministic locator candidates after the existing recovery is exhausted, each still passing AWKIT's identity and proof rules, and bounded sanitized DOM context to the asynchronous AI pipeline, while Playwright stays the sole browser executor.",
    implementationNote: "IN PROGRESS since 2026-09-30, now 14 of 15 milestones closed (93 percent). L11 on 2026-10-01: workstreams A to I are implemented and pushed. That covers snapshot recovery, the parser-only host, Spy/Designer diagnosis, route binding and an actionability veto, bounded run provenance, and the AI page context (off by default after the live comparison regressed one row). The acceptance benchmark found 0 wrong-element actions on the product path and a warm p95 of 170 ms on the accepted fixtures (711 ms at 8,265 elements). The packaging wiring and strict validation are done. L11 stays open: the packaged artifact is BLOCKED by the strict clean-source-tree rule, held by a preserved uncommitted evidence file, and the LGPL-2.1 libiconv code that lxml statically links needs an owner decision on how it is distributed. Later on 2026-09-30 the owner widened the scope again with L11 Performance-oriented DOM intelligence (awkit-djnl.19, open): replace the expensive candidate-discovery portion of locator recovery with one bounded DOM snapshot per attempt and measure parser-only Scrapling as candidate evidence behind AWKIT's unchanged identity proof, with Playwright the sole executor (docs/plans/ai-upgrade-v5/L11-performance-dom-intelligence.md). L11 is a new objective, not a reopening of L10 under a relaxed DI5; L10 stays closed as NO-GO with its evidence unchanged. Phase L closes when awkit-djnl.15 resolves under its own contract and L11 closes through its workstreams, unless the owner descopes either. Earlier: 14 of 14 milestones closed (100 percent), open only until the follow-up awkit-djnl.15 resolves under its own contract. L10 (awkit-djnl.18) was closed as NO-GO on the owner decision later on 2026-09-30: L10.0 found locator integration NO-GO and DOM normalization NO-GO under the pre-registered rule, because parser-only Scrapling's only gated gain is a scan-coverage gap AWKIT can close natively, it picked a wrong element in 6 of 16 cases, and its static text leaks hidden content (docs/plans/ai-upgrade-v5/evidence/L10.0-dom-intelligence-gate-2026-09-30.md). L10.1 to L10.7 are descoped and were never started; no Scrapling, Python runtime or host ships. The locator defects its fixtures exposed (awkit-epbe) were fixed in 6aedad35 and are gated by verify:locator-wrong-element. The owner widened the accepted scope with L10 Deterministic DOM intelligence (Scrapling) (awkit-djnl.18), registered planned and open with zero implementation: an optional parser-only DOM-intelligence provider that may offer deterministic locator candidates after the existing recovery is exhausted and bounded context for asynchronous AI, with Playwright the sole executor and no fetcher, crawler, stealth, proxy, CAPTCHA or anti-bot capability. The percentage fell because the scope grew, not because anything regressed. Phase L closes only when the open follow-up awkit-djnl.15 is resolved under its own contract and L10 closes through L10.0 to L10.7, unless the owner explicitly descopes either. See docs/plans/ai-upgrade-v5/L10-deterministic-dom-intelligence.md. History: COMPLETE on 2026-09-29 at 13 of 13 milestones (100 percent). L9 adaptive time budgets, progress and ETA (awkit-djnl.13) closed 2026-09-29 with QA PASS: one job-status contract pushed to the owning window, bounded per-feature time budgets refused (never clamped) outside committed bounds and un-qualifying the features whose budget moved, one accessible progress view that is determinate only from bytes copied or the runtime's own load fraction, and measured cold and warm ETA ranges under the latency class that survive a restart (verify:ai-job-status 142/142 with 53/53 mutants, verify:ai-progress-gui 41/41 with 7/7 GUI mutants, verify:ai-progress-packaged 33/0 on the fresh package with the real 0.8B in all three modes, verify:ai-progress-gpu-packaged 11/0 as E11 mechanics on AMD). Carried forward, not waived: independent QC of L8a, L8b and L9 (awkit-djnl.15, .16, .17), NVIDIA qualification when a 0x10DE adapter exists (.15), and the verify:ai-authoring DX-0 freeze bug (.14); the epic awkit-djnl stays open only as their container. History: the phase was IN PROGRESS from 2026-09-27, when the owner widened the accepted scope after closeout, not because anything regressed. The original ten technical milestones stay complete (2026-09-27): frozen Qwen3.5-0.8B DX revision 4 passed the L4b quality and latency gates, L6 passed under its approved deterministic scope, and fresh portable and NSIS 0.1.51 packages passed offline, packaged and clean-machine local-AI gates. L8a hardware-adaptive inference runtime (awkit-djnl.11) closed 2026-09-28 on the owner's E11 decision: its GPU evidence is the vendor-independent mechanics on the development machine's AMD adapter (source and packaged trees) plus fake-host cases, NVIDIA stays Compatible but unqualified, and independent QC is carried forward. L8b external compatible-model registration and qualification (awkit-djnl.12) closed 2026-09-29: any GGUF is copied after a disk-space preflight, checked in the utility host by a static header stage and a probe that shows thinking stays off, and used only when compatible and acknowledged as unverified; a release-owned qualified list keeps the 0.8B Qualified on its historical CPU key for its three limited-GO features, every other configuration reads Compatible but unqualified, latency is never claimed, and applied AI changes record their effective profile (verify:ai-model-registration 33/0 on the packaged build); independent QC is carried forward. The licensed walkthrough is BLOCKED on an unavailable issuer key. Packaging human QC and the Visual Studio redistribution statement remain external release prerequisites. See docs/plans/ai-upgrade-v5/ROADMAP.md (Phase L extension) and the L7 evidence."
  },
  {
    id: "M",
    title: "Optional Application Knowledge Base (AKB)",
    status: "pending",
    deliverables: ["M1 Optional source registration & deterministic indexing", "M2 Hybrid source retrieval & model compatibility", "M3 Source-aware locator assistance", "M4 Source-aware failure analysis", "M5 Expected-result & assertion assistance", "M6 Indexing lifecycle & user-facing readiness", "M7 Performance, security & verification"],
    acceptance: "Authorized UI source may optionally improve locator suggestions, failure diagnosis and expected-result recommendations, while recording, design, execution, sessions, data binding, assertions, failure analysis and reporting remain fully operational without the knowledge base or an AI model.",
    implementationNote: "PLANNED with zero implementation progress. The optional, offline-capable and loosely coupled plan is registered in docs/plans/ai-upgrade-v5/ROADMAP.md and tracked as Beads epic awkit-akb with seven milestones. Deterministic indexing and retrieval never require AI inference; source context is bounded rather than loading a repository into model context; browser/runtime evidence remains authoritative; normal automation remains available during indexing; no benchmark result or processing time is claimed."
  },
  {
    id: "N",
    title: "Visual Recognition and Automation",
    status: "pending",
    deliverables: ["N1 Visual capture infrastructure", "N2 Visual reference management", "N3 Deterministic image recognition", "N4 Visual locator fallback", "N5 Visual assertions & failure evidence", "N6 Headed & headless compatibility", "N7 Optional local vision assistance", "N8 Integration & acceptance verification"],
    acceptance: "Optional screenshot-based recognition, visual verification and image-assisted automation work offline in headed and headless Chromium while DOM-first Playwright locators remain primary, every visual target is independently verified, and normal recording and execution remain fully functional when visual recognition and all models are disabled or unavailable.",
    implementationNote: "NOT STARTED with zero implementation progress. The planning-only phase is registered in docs/plans/ai-upgrade-v5/ROADMAP.md and tracked as Beads epic awkit-vra with eight workstreams. Phase N reuses the existing Recorder, Runner, workflow persistence and reporting architecture after Phase L release confirmation, but has no dependency on Phase M. Deterministic recognition remains functional without a language or vision model; no runtime, schema, UI, dependency, model or service implementation is authorized by this registration."
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
