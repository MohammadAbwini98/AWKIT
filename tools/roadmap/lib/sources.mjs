/**
 * The single registry of every repository file the dashboard reads.
 *
 * Nothing else in tools/roadmap may hardcode a repo path. Every parser, the server's /app.css
 * route, and the verifier all resolve through here, so a renamed document fails in one place
 * with a clear message instead of degrading silently in three.
 *
 * `parsed: false` entries are deliberately not parsed in v1. They are still listed so the
 * Sources view can state the dashboard's own blind spots rather than pretending they do not exist.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** tools/roadmap/lib -> tools/roadmap -> tools -> repo root */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** tools/roadmap — the dashboard's own directory (public/, assignments.json). */
export const ROADMAP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The agent claims file. Not a repository source — it is the dashboard's own input, written by
 * agents rather than read from the project — but it must still take part in the liveness
 * fingerprint. It is the one file this tool asks anyone to edit, so a claim that only appeared
 * after some unrelated document happened to change would make the feature useless.
 */
export const ASSIGNMENTS_PATH = join(ROADMAP_ROOT, "assignments.json");

const VALIDATION = "docs/testing/comprehensive-validation";

/**
 * @typedef {Object} SourceEntry
 * @property {string} id        stable key used by parsers and the Sources view
 * @property {string} rel       repo-relative path (POSIX separators)
 * @property {string} label     human name for the Sources view
 * @property {boolean} parsed   whether v1 extracts records from it
 * @property {string} role      what the dashboard uses it for
 * @property {string} [skipReason] required when parsed === false
 */

/** @type {SourceEntry[]} */
export const SOURCES = [
  {
    id: "beads",
    rel: ".beads/issues.jsonl",
    label: "Beads issue tracker (export)",
    parsed: true,
    role: "Open/closed work items, priorities, types, and the only declared dependency edges."
  },
  {
    id: "ledger",
    rel: `${VALIDATION}/RECORDER_REPORTS_SETTINGS_TEST_CASES.md`,
    label: "Validation case ledger",
    parsed: true,
    role: "The 66 Recorder/Reports/Settings cases and the authoritative PASS / NOT RUN / BLOCKED tally."
  },
  {
    id: "defects",
    rel: `${VALIDATION}/DEFECTS.md`,
    label: "Defect register",
    parsed: true,
    role: "Reported defects with severity, lifecycle state, and the 'Detected by' join to ledger cases."
  },
  {
    id: "traceability",
    rel: `${VALIDATION}/TRACEABILITY_MATRIX.csv`,
    label: "Traceability matrix",
    parsed: true,
    role: "Requirement-level coverage rows with their execution level and status."
  },
  {
    id: "phases",
    rel: "src/roadmap/ImplementationRoadmap.ts",
    label: "Implementation roadmap phases (A-K)",
    parsed: true,
    role: "The phase model rendered in-app. Read as 'what this file says', with its own staleness shown."
  },
  {
    id: "taskLog",
    rel: "docs/ai/TASK_LOG.md",
    label: "Task log",
    parsed: true,
    role: "The only per-agent signal in the repository. Past-tense activity, never an assignment."
  },
  {
    id: "currentState",
    rel: "docs/ai/CURRENT_STATE.md",
    label: "Current state",
    parsed: true,
    role: "Newest section headline plus its asserted ledger tally, used only for the consistency banner."
  },
  {
    id: "handoff",
    rel: "docs/ai/HANDOFF.md",
    label: "Handoff note",
    parsed: true,
    role: "Active handoff headline plus its asserted ledger tally, used only for the consistency banner."
  },
  {
    id: "knownIssues",
    rel: "docs/ai/KNOWN_ISSUES.md",
    label: "Known issues",
    parsed: true,
    role: "Fragile areas and risky assumptions, plus bead references found in the prose."
  },
  {
    id: "verifierClassification",
    rel: "scripts/lib/verifier-classification.ts",
    label: "Verifier classification registry",
    parsed: true,
    role: "What each verifier actually proves, reconciled against package.json script names."
  },
  {
    id: "packageJson",
    rel: "package.json",
    label: "package.json",
    parsed: true,
    role: "The verify:* / validate:* script inventory the classification registry is reconciled against."
  },
  {
    id: "globalCss",
    rel: "app/renderer/styles/global.css",
    label: "Application stylesheet",
    parsed: false,
    role: "Served verbatim at /app.css so the dashboard uses the app's real design tokens and classes.",
    skipReason: "Served byte-for-byte, never parsed. Parsing it would create the token drift this avoids."
  },
  {
    id: "features",
    rel: "docs/ai/FEATURES.md",
    label: "Feature inventory",
    parsed: false,
    role: "Feature-level implementation status.",
    skipReason:
      "Legend-driven prose with no stable IDs. It joins to nothing, so parsing it would add a second " +
      "unlinked list duplicating the Phases view."
  }
];

/** @type {Map<string, SourceEntry>} */
const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

/**
 * Absolute path for a registered source id.
 * @param {string} id
 * @returns {string}
 */
export function sourcePath(id) {
  const entry = BY_ID.get(id);
  if (!entry) {
    throw new Error(
      `Unknown source id "${id}". Known ids: ${SOURCES.map((s) => s.id).join(", ")}`
    );
  }
  return join(REPO_ROOT, ...entry.rel.split("/"));
}

/**
 * @param {string} id
 * @returns {SourceEntry}
 */
export function sourceEntry(id) {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown source id "${id}"`);
  return entry;
}

/** Ids the dashboard actually extracts records from. */
export const PARSED_SOURCE_IDS = SOURCES.filter((s) => s.parsed).map((s) => s.id);

/**
 * Every source that participates in the liveness fingerprint. globalCss is included because a
 * theme change should refresh an open tab; features is not, because nothing reads it.
 */
export const WATCHED_SOURCE_IDS = SOURCES.filter((s) => s.id !== "features").map((s) => s.id);
