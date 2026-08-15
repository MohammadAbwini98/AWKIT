/**
 * The canonical routing registry — the ONE source for who may write where, which specialists a task
 * activates, and what risk level it carries.
 *
 * Why this is a `.mjs` module and not `ROUTING_MATRIX.yaml`:
 *
 *   1. The repository has no YAML parser in `dependencies` or `devDependencies`. Adding one would
 *      itself be a `new_dependency: true` change — the exact class this architecture routes to the
 *      Architect and Release specialists and reviews against the offline boundary. A governance
 *      tool must not open the boundary it exists to police.
 *   2. TypeScript would buy nothing here: `npm run build` runs `tsc --noEmit` over `include:
 *      ["app", "src", …]` only, so a registry under `tools/` or `scripts/` is NOT typechecked by the
 *      build. The claim "the build catches a malformed registry" would be false.
 *   3. `tools/roadmap/lib/sources.mjs` already establishes the pattern: a plain ESM module with
 *      JSDoc typedefs, consumed by parsers and by a verifier, that fails in ONE place with a clear
 *      message when something is renamed.
 *   4. The write-lease guard runs on EVERY Edit/Write as a `PreToolUse` hook. It must start in
 *      milliseconds, which rules out a `tsx` entry point. A `.mjs` registry is importable directly
 *      by `node`.
 *
 * The human-readable `docs/ai/routing/ROUTING_MATRIX.md` is RENDERED from this module and asserted
 * against it by `verify:agent-routing`. Never hand-edit the rendered table — that is how the
 * proposal's §17 pseudocode, §18 matrix and §24 validator came to disagree with each other.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Evidence vocabulary
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The ledger's own status words, copied deliberately rather than invented.
 *
 * `tools/roadmap/lib/parse-ledger.mjs` defines LEDGER_STATUSES as exactly these five. An earlier
 * draft of this architecture used `NOT_RUN` (underscore) and added `INCONCLUSIVE` while dropping
 * `NOT APPLICABLE`, which would have created a second, near-identical vocabulary in a system whose
 * first principle is one repository truth. An inconclusive check is `NOT RUN` with a reason.
 *
 * `verify:agent-routing` asserts this array still equals the ledger's set, so a change there fails
 * here instead of drifting silently.
 * @type {readonly string[]}
 */
export const EVIDENCE_STATUSES = Object.freeze([
  "PASS",
  "FAIL",
  "BLOCKED",
  "NOT RUN",
  "NOT APPLICABLE"
]);

/** Statuses that may never be counted as success. BLOCKED != PASS is the repository's oldest rule. */
export const NON_PASSING_STATUSES = Object.freeze(["FAIL", "BLOCKED", "NOT RUN"]);

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Agents
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} AgentEntry
 * @property {string} id            canonical agent id, used everywhere
 * @property {string} role          human-readable role
 * @property {"read-only"|"writer"|"review"} defaultMode
 * @property {string[]} ownsPaths   globs this agent may hold a write lease over
 * @property {string} [agentsMd]    the per-folder AGENTS.md that already governs this area
 * @property {string} mandate       one line: what this agent is answerable for
 */

/**
 * The eleven canonical agents.
 *
 * `ownsPaths` is the ONLY place path ownership is written down. It is deliberately anchored to the
 * per-folder `AGENTS.md` files that already exist (`app/main`, `app/renderer`, `src`, `scripts`,
 * `tests`, `mock-site`, `docs`) rather than inventing an eleventh, drifting statement of the same
 * boundaries.
 *
 * @type {readonly AgentEntry[]}
 */
export const AGENTS = Object.freeze([
  {
    id: "manager",
    role: "Manager / Orchestrator",
    defaultMode: "writer",
    ownsPaths: ["docs/ai/**", "tools/roadmap/assignments.json", "docs/ai/contracts/**"],
    agentsMd: "docs/AGENTS.md",
    mandate:
      "Classifies, routes, grants and revokes the write lease, and reconciles authoritative sources. " +
      "Denied product code by default so it orchestrates rather than becoming a twelfth implementer."
  },
  {
    id: "architect",
    role: "Software Architect",
    defaultMode: "read-only",
    ownsPaths: ["docs/ai/ARCHITECTURE.md", "docs/ai/DECISIONS.md"],
    mandate: "Cross-layer contracts, IPC design, schema evolution, concurrency model, dependencies."
  },
  {
    id: "uiux",
    role: "UI/UX & Accessibility Specialist",
    defaultMode: "read-only",
    ownsPaths: [],
    mandate:
      "Design authority for interaction, Hologram tokens, focus, reduced motion and accessibility. " +
      "Specifies behavior; frontend implements it."
  },
  {
    id: "frontend",
    role: "React / Renderer Engineer",
    defaultMode: "writer",
    ownsPaths: ["app/renderer/**"],
    agentsMd: "app/renderer/AGENTS.md",
    mandate: "Renderer: React, both designers, admin screens, renderer state, Hologram styles."
  },
  {
    id: "runtime",
    role: "Electron Main / Runner Engineer",
    defaultMode: "writer",
    ownsPaths: ["app/main/**", "src/runner/**", "src/orchestrator/**", "src/instances/**"],
    agentsMd: "app/main/AGENTS.md",
    mandate: "Electron main, IPC implementation, runner, orchestration, execution and concurrency."
  },
  {
    id: "persistence",
    role: "Data & Persistence Specialist",
    defaultMode: "writer",
    ownsPaths: ["src/storage/**", "src/profiles/**", "src/data/**", "src/project/**"],
    agentsMd: "src/AGENTS.md",
    mandate:
      "JSON profile compatibility, migrations, atomic writes, unknown-field preservation, " +
      "import/export and backward compatibility."
  },
  {
    id: "integration",
    role: "Playwright / Browser / IPC Integration Specialist",
    defaultMode: "writer",
    ownsPaths: ["src/recorder/**", "src/session/**", "src/oracle/**"],
    agentsMd: "src/AGENTS.md",
    mandate: "Playwright, Chromium, Recorder capture, popups/frames/downloads, live browser sessions."
  },
  {
    id: "security",
    role: "Security & Trust-Boundary Specialist",
    defaultMode: "review",
    ownsPaths: ["src/licensing/**", "src/auth/**", "src/secrets/**", "src/security/**"],
    mandate:
      "Auth, licensing, secrets, protected-login handoff, IPC authorization and signing. " +
      "Prefers review; may own tightly scoped security modules."
  },
  {
    id: "qa",
    role: "Quality Assurance Engineer",
    defaultMode: "writer",
    ownsPaths: ["tests/**", "mock-site/**", "scripts/verify-*", "scripts/validate-*", "src/testing/**"],
    agentsMd: "tests/AGENTS.md",
    mandate:
      "Designs the proof: verifiers, mock-site scenarios, negative and race cases. " +
      "May never weaken an assertion to obtain green output."
  },
  {
    id: "qc",
    role: "Independent Quality Control Reviewer",
    defaultMode: "read-only",
    ownsPaths: [],
    mandate:
      "Asks whether the evidence actually proves the requested result. Rejects to the Manager; " +
      "never silently repairs a defect it found."
  },
  {
    id: "release",
    role: "Packaging / Offline / Release Engineer",
    defaultMode: "writer",
    ownsPaths: ["build/**", "resources/**", "package.json", "package-lock.json", "electron-builder*"],
    mandate: "Packaging, bundled Chromium, signing, offline boundary, installer and portable builds."
  }
]);

/** @type {ReadonlyMap<string, AgentEntry>} */
const AGENTS_BY_ID = new Map(AGENTS.map((a) => [a.id, a]));

/**
 * @param {string} id
 * @returns {AgentEntry}
 */
export function agent(id) {
  const found = AGENTS_BY_ID.get(id);
  if (!found) {
    throw new Error(`Unknown agent id "${id}". Known ids: ${AGENTS.map((a) => a.id).join(", ")}`);
  }
  return found;
}

export const AGENT_IDS = Object.freeze(AGENTS.map((a) => a.id));

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Classification flags
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Every boolean a task contract may declare. Routing reads only these — never free-form prose, and
 * never an opinion formed after implementation started.
 * @type {readonly string[]}
 */
export const CLASSIFICATION_FLAGS = Object.freeze([
  "renderer_visual_change",
  "interaction_change",
  "accessibility_change",
  "electron_main_change",
  "ipc_change",
  "runner_change",
  "execution_change",
  "concurrency_change",
  "persisted_shape_change",
  "migration_required",
  "filesystem_write_change",
  "playwright_change",
  "recorder_change",
  "browser_behavior_change",
  "mock_site_required",
  "licensing_change",
  "auth_change",
  "authorization_change",
  "secret_handling_change",
  "protected_login_change",
  "signing_change",
  "packaging_change",
  "offline_boundary_change",
  "new_dependency",
  "public_contract_change"
]);

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Path map — the basis for BOTH lease scoping and derived classification
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} PathDomain
 * @property {string} glob
 * @property {string} owner              agent id that owns a lease over this path
 * @property {string[]} impliesFlags     flags that touching this path SOUNDLY implies
 * @property {string} note
 */

/**
 * Maps a repository path to its owning agent and to the classification flags that touching it
 * *soundly* implies.
 *
 * The soundness bar matters. Editing `app/renderer/**` proves the renderer changed; it does NOT
 * prove the change was visual rather than a comment, so `renderer_visual_change` is NOT implied
 * here. Only flags that are true whenever the path is touched appear in `impliesFlags`. Anything
 * weaker would make the derived-vs-declared comparison produce false scope-escape reports, and a
 * check that cries wolf gets switched off.
 *
 * Ordering is significant: the FIRST matching entry wins, so narrower paths precede broader ones.
 *
 * @type {readonly PathDomain[]}
 */
export const PATH_DOMAINS = Object.freeze([
  // ── Narrow, high-signal paths first ────────────────────────────────────────────────────────────
  {
    glob: "app/main/ipc/**",
    owner: "runtime",
    impliesFlags: ["electron_main_change", "ipc_change"],
    note: "Every renderer-visible channel lives here; touching it is by definition an IPC change."
  },
  {
    glob: "app/preload.ts",
    owner: "runtime",
    impliesFlags: ["ipc_change", "public_contract_change"],
    note: "The window.playwrightFlowStudio surface — an internal contract other layers compile against."
  },
  {
    glob: "src/licensing/**",
    owner: "security",
    impliesFlags: ["licensing_change"],
    note: "Licensing is automatically Risk 3."
  },
  {
    glob: "src/auth/**",
    owner: "security",
    impliesFlags: ["auth_change"],
    note: "Authentication."
  },
  {
    glob: "src/secrets/**",
    owner: "security",
    impliesFlags: ["secret_handling_change"],
    note: "Secret storage and redaction."
  },
  {
    glob: "src/security/**",
    owner: "security",
    impliesFlags: ["authorization_change"],
    note: "Permissions registry and trust boundaries."
  },
  {
    glob: "src/session/**",
    owner: "integration",
    impliesFlags: ["browser_behavior_change"],
    note: "Session capture and reuse; protected-login handoff lands here."
  },
  {
    glob: "src/recorder/**",
    owner: "integration",
    impliesFlags: ["recorder_change"],
    note: "Recorder capture and locator synthesis."
  },
  {
    glob: "src/runner/**",
    owner: "runtime",
    impliesFlags: ["runner_change", "execution_change"],
    note: "Playwright execution path."
  },
  {
    glob: "src/orchestrator/**",
    owner: "runtime",
    impliesFlags: ["execution_change"],
    note: "Not `src/orchestration` — that directory does not exist."
  },
  {
    glob: "src/instances/**",
    owner: "runtime",
    impliesFlags: ["execution_change"],
    note: "Live instance model behind the Instance Monitor."
  },
  {
    glob: "src/storage/**",
    owner: "persistence",
    impliesFlags: ["filesystem_write_change"],
    note: "Atomic writes and the profile stores."
  },
  {
    glob: "src/profiles/**",
    owner: "persistence",
    impliesFlags: ["filesystem_write_change"],
    note: "JSON profile shapes; unknown-field preservation lives or dies here."
  },
  {
    glob: "src/data/**",
    owner: "persistence",
    impliesFlags: ["filesystem_write_change"],
    note: "Data sources and row-driven inputs."
  },
  {
    glob: "src/project/**",
    owner: "persistence",
    impliesFlags: ["filesystem_write_change"],
    note: "Project-level persisted state."
  },
  {
    glob: "src/oracle/**",
    owner: "integration",
    impliesFlags: [],
    note: "Oracle JDBC bridge; its own external gates apply."
  },
  {
    glob: "src/testing/**",
    owner: "qa",
    impliesFlags: [],
    note: "Test-only helpers that ship in src for reuse by verifiers."
  },

  // ── Broad ownership ───────────────────────────────────────────────────────────────────────────
  {
    glob: "app/renderer/**",
    owner: "frontend",
    impliesFlags: [],
    note: "Renderer. Visual/interaction/accessibility intent is not path-determinable — declare it."
  },
  {
    glob: "app/main/**",
    owner: "runtime",
    impliesFlags: ["electron_main_change"],
    note: "Electron main process."
  },
  {
    glob: "tests/**",
    owner: "qa",
    impliesFlags: [],
    note: "Test suites."
  },
  {
    glob: "mock-site/**",
    owner: "qa",
    impliesFlags: ["mock_site_required"],
    note: "The Feature Test Lab."
  },
  {
    glob: "scripts/verify-*",
    owner: "qa",
    impliesFlags: [],
    note: "Verifiers. A new one must be registered in scripts/lib/verifier-classification.ts."
  },
  {
    glob: "scripts/validate-*",
    owner: "qa",
    impliesFlags: [],
    note: "Validators, same registration rule."
  },

  // ── Packaging and the offline boundary ────────────────────────────────────────────────────────
  {
    glob: "build/**",
    owner: "release",
    impliesFlags: ["packaging_change"],
    note: "Packaging inputs."
  },
  {
    glob: "resources/**",
    owner: "release",
    impliesFlags: ["packaging_change", "offline_boundary_change"],
    note: "Shipped resources. Never a runtime write target."
  },
  {
    glob: "package.json",
    owner: "release",
    impliesFlags: ["packaging_change"],
    note: "Script inventory and dependencies. A dependency edit is also new_dependency."
  },
  {
    glob: "package-lock.json",
    owner: "release",
    impliesFlags: ["packaging_change", "new_dependency"],
    note: "The lockfile only moves when the dependency graph moves."
  },

  // ── Governance ────────────────────────────────────────────────────────────────────────────────
  {
    glob: "docs/ai/**",
    owner: "manager",
    impliesFlags: [],
    note: "AI memory and governance documents."
  },
  {
    glob: "tools/roadmap/**",
    owner: "manager",
    impliesFlags: [],
    note: "Derived dashboard. Never hand-edited to record progress."
  },
  {
    glob: "tools/agents/**",
    owner: "manager",
    impliesFlags: [],
    note: "This routing system itself."
  }
]);

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Glob matching
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Segment-wise glob matcher supporting `**` (zero or more segments), `*` (within one segment) and
 * literals. Deliberately small — a dependency-free matcher whose whole behavior is visible here and
 * mutation-tested by `verify:agent-routing`.
 *
 * A regex-substitution matcher was rejected: getting `**` and `*` to compose correctly through
 * string replacement is exactly the kind of over-restrictive pattern that silently fails to match
 * the offending path, which would let a scope escape pass as "no domain touched".
 *
 * @param {string} glob   POSIX-style pattern, e.g. "app/renderer/**" or "scripts/verify-*"
 * @param {string} path   POSIX-style repo-relative path
 * @returns {boolean}
 */
export function matchGlob(glob, path) {
  const g = glob.split("/");
  const p = path.split("/");

  /**
   * @param {number} gi
   * @param {number} pi
   * @returns {boolean}
   */
  const walk = (gi, pi) => {
    if (gi === g.length) return pi === p.length;

    if (g[gi] === "**") {
      // `**` at the end matches every remaining segment, including none.
      for (let skip = pi; skip <= p.length; skip += 1) {
        if (walk(gi + 1, skip)) return true;
      }
      return false;
    }

    if (pi === p.length) return false;
    if (!matchSegment(g[gi], p[pi])) return false;
    return walk(gi + 1, pi + 1);
  };

  return walk(0, 0);
}

/**
 * Match one path segment against one glob segment, where `*` matches any run of characters that
 * contains no separator.
 *
 * @param {string} pattern
 * @param {string} segment
 * @returns {boolean}
 */
function matchSegment(pattern, segment) {
  if (!pattern.includes("*")) return pattern === segment;

  const parts = pattern.split("*");
  let cursor = 0;

  // Leading literal must sit at the start.
  if (parts[0] !== "") {
    if (!segment.startsWith(parts[0])) return false;
    cursor = parts[0].length;
  }

  // Trailing literal must sit at the end, and must not overlap what we already consumed.
  const last = parts[parts.length - 1];
  let end = segment.length;
  if (last !== "") {
    if (!segment.endsWith(last)) return false;
    end = segment.length - last.length;
    if (end < cursor) return false;
  }

  // Interior literals appear in order between cursor and end.
  for (const middle of parts.slice(1, -1)) {
    if (middle === "") continue;
    const at = segment.indexOf(middle, cursor);
    if (at === -1 || at + middle.length > end) return false;
    cursor = at + middle.length;
  }

  return true;
}

/**
 * Resolve a repository path to its owning domain entry.
 *
 * Returns `null` for an unmapped path. That is a real answer, not a shrug: an unmapped path has no
 * declared owner, so `derive-classification` reports it and the contract validator refuses to treat
 * it as covered. Silently defaulting an unknown path to "allowed" is how a governance check ends up
 * failing open.
 *
 * @param {string} path
 * @returns {PathDomain|null}
 */
export function domainForPath(path) {
  const normalized = path.replace(/\\/g, "/");
  for (const entry of PATH_DOMAINS) {
    if (matchGlob(entry.glob, normalized)) return entry;
  }
  return null;
}

/**
 * True when `path` falls inside any of `globs`.
 * @param {string} path
 * @param {readonly string[]} globs
 * @returns {boolean}
 */
export function pathInScope(path, globs) {
  const normalized = path.replace(/\\/g, "/");
  return globs.some((glob) => matchGlob(glob, normalized));
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Activation rules
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} ActivationRule
 * @property {string} agent
 * @property {string[]} anyFlag        activate when ANY of these classification flags is true
 * @property {number} [minCrossLayer]  activate when cross_layer_count reaches this
 * @property {number} [minRisk]        activate when risk_level reaches this
 * @property {boolean} [onOwnedPath]   activate when the diff touches a path this agent owns
 * @property {string} why
 */

/**
 * The single encoding of "which specialists does this task need".
 *
 * The reviewed proposal stated this three times — as pseudocode, as a markdown matrix, and as a
 * validator rejection list — and the three already disagreed about when the Architect was
 * mandatory. There is one encoding now. The matrix document and the validator both read THIS.
 *
 * @type {readonly ActivationRule[]}
 */
export const ACTIVATION_RULES = Object.freeze([
  {
    agent: "uiux",
    anyFlag: ["renderer_visual_change", "interaction_change", "accessibility_change"],
    why: "Design, focus, motion and accessibility decisions are not the implementer's to make alone."
  },
  {
    agent: "frontend",
    anyFlag: ["renderer_visual_change", "interaction_change", "accessibility_change"],
    onOwnedPath: true,
    why: "Owns app/renderer/**."
  },
  {
    agent: "runtime",
    anyFlag: [
      "electron_main_change",
      "ipc_change",
      "runner_change",
      "execution_change",
      "concurrency_change"
    ],
    onOwnedPath: true,
    why: "Owns the main process and the execution path."
  },
  {
    agent: "persistence",
    anyFlag: ["persisted_shape_change", "migration_required", "filesystem_write_change"],
    onOwnedPath: true,
    why: "A persisted shape that changes without this agent is how unknown fields get dropped."
  },
  {
    agent: "integration",
    anyFlag: [
      "playwright_change",
      "recorder_change",
      "browser_behavior_change",
      "mock_site_required"
    ],
    onOwnedPath: true,
    why: "Real browser behavior cannot be reasoned about from the renderer alone."
  },
  {
    agent: "security",
    anyFlag: [
      "licensing_change",
      "auth_change",
      "authorization_change",
      "secret_handling_change",
      "protected_login_change",
      "signing_change"
    ],
    onOwnedPath: true,
    why: "Trust boundaries are reviewed, never assumed."
  },
  {
    agent: "release",
    anyFlag: ["packaging_change", "offline_boundary_change", "signing_change", "new_dependency"],
    onOwnedPath: true,
    why: "Offline-first is a release property; a dependency is a packaging decision."
  },
  {
    agent: "architect",
    anyFlag: [
      "public_contract_change",
      "migration_required",
      "new_dependency",
      "concurrency_change",
      "licensing_change"
    ],
    minCrossLayer: 3,
    why: "Cross-layer contracts and schema evolution need a designer, not three local decisions."
  },
  {
    agent: "qa",
    anyFlag: [],
    minRisk: 1,
    why: "Anything above documentation must state how it is proven."
  },
  {
    agent: "qc",
    anyFlag: [
      "licensing_change",
      "auth_change",
      "authorization_change",
      "secret_handling_change",
      "signing_change",
      "migration_required",
      "concurrency_change",
      "packaging_change"
    ],
    minRisk: 2,
    minCrossLayer: 2,
    why: "Independent review of whether the evidence proves the requested result."
  }
]);

/**
 * The order in which sequential write leases are granted when a task touches several domains.
 *
 * One writer at a time is a hard rule on a `main`-only repository, so a multi-domain task is a
 * SEQUENCE of leases, not a committee. The order is fixed here rather than chosen per task so that
 * the same task always produces the same plan.
 *
 * It runs contracts-first: persisted shapes and trust boundaries settle before the code that
 * consumes them, the renderer follows the surface it renders, QA writes the proof once the behavior
 * exists, and Release packages what is already proven. Reversing it produces the familiar failure
 * where tests are written against an interface that then changes.
 * @type {readonly string[]}
 */
export const WRITER_PRECEDENCE = Object.freeze([
  "persistence",
  "security",
  "runtime",
  "integration",
  "frontend",
  "qa",
  "release",
  "manager"
]);

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Risk
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Flags that make a task Risk 3 outright, no judgement involved.
 *
 * Note what is NOT here: `packaging_change` alone. The reviewed proposal listed "packaging trust"
 * as automatically critical in one section and as conditional in another. Resolved in favour of the
 * conditional reading — packaging reaches Risk 3 through `signing_change`, `offline_boundary_change`
 * or `new_dependency`, which are the properties that actually carry trust.
 * @type {readonly string[]}
 */
export const RISK_3_FLAGS = Object.freeze([
  "licensing_change",
  "auth_change",
  "authorization_change",
  "secret_handling_change",
  "protected_login_change",
  "signing_change",
  "migration_required",
  "concurrency_change",
  "offline_boundary_change"
]);

/** Flags that reach at least Risk 2 — cross-layer work with real runtime or persisted consequences. */
export const RISK_2_FLAGS = Object.freeze([
  "electron_main_change",
  "ipc_change",
  "runner_change",
  "execution_change",
  "persisted_shape_change",
  "filesystem_write_change",
  "recorder_change",
  "browser_behavior_change",
  "packaging_change",
  "public_contract_change",
  "new_dependency"
]);

/** Flags that reach at least Risk 1 — localized behavior a user can observe. */
export const RISK_1_FLAGS = Object.freeze([
  "renderer_visual_change",
  "interaction_change",
  "accessibility_change",
  "playwright_change",
  "mock_site_required"
]);

/**
 * Deterministic risk level for a classification. Same input, same output, every time.
 *
 * @param {Record<string, boolean|number>} classification
 * @returns {0|1|2|3}
 */
export function riskLevelFor(classification) {
  const on = (flag) => classification[flag] === true;
  const crossLayer = Number(classification.cross_layer_count ?? 1);

  if (RISK_3_FLAGS.some(on)) return 3;
  if (RISK_2_FLAGS.some(on) || crossLayer >= 3) return 2;
  if (RISK_1_FLAGS.some(on) || crossLayer >= 2) return 1;
  return 0;
}
