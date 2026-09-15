#!/usr/bin/env node
/**
 * AI-memory Stop hook gate.
 *
 * Two severity classes, deliberately distinct (2026-09 anti-loop repair):
 *
 *   BLOCKING  — confirmed secret exposure, missing/empty required memory file, broken
 *               AGENTS.md/CLAUDE.md/GEMINI.md wiring. These genuinely warrant vetoing a stop.
 *   ADVISORY  — structure drift, optional skill/command files, ambiguous-but-benign patterns,
 *               oversized HANDOFF. Printed and counted, but they must never veto session
 *               completion: an advisory loop on the Stop hook is how a session dies retrying.
 *
 * The secret patterns are tightened to require credential-shaped values (length plus a digit, or
 * a quoted literal for passwords). The previous `password: .{6,}` form matched ordinary
 * documentation prose and could block stopping forever.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "docs/ai/PROJECT_BRIEF.md",
  "docs/ai/CURRENT_STATE.md",
  "docs/ai/HANDOFF.md",
  "docs/ai/FEATURES.md",
  "docs/ai/ARCHITECTURE.md",
  "docs/ai/COMMANDS.md",
  "docs/ai/RULES.md",
  "docs/ai/KNOWN_ISSUES.md",
  "docs/ai/TASK_LOG.md",
  "docs/ai/DECISIONS.md",
  "docs/ai/SECURITY.md",
  "docs/ai/TESTING.md",
  "docs/ai/DEVELOPMENT_WORKFLOW.md"
];

/**
 * Credential-shaped values only. Unquoted values need length AND a digit; a quoted literal
 * (≥6 non-space chars) is taken as a literal secret regardless of digits.
 */
const secretPatterns = [
  { name: "API key", pattern: /api[_-]?key\s*[:=]\s*['"]?(?=[a-z0-9_.\-]{16,})(?=[a-z0-9_.\-]*\d)[a-z0-9_.\-]{16,}/i },
  { name: "Token", pattern: /token\s*[:=]\s*['"]?(?=[a-z0-9_.\-]{20,})(?=[a-z0-9_.\-]*\d)[a-z0-9_.\-]{20,}/i },
  { name: "Password assignment", pattern: /password\s*[:=]\s*(?:['"][^'"\s]{6,}['"]|(?=[^\s]*\d)[^\s'"]{8,})/i },
  { name: "Secret assignment", pattern: /secret\s*[:=]\s*['"]?(?=[a-z0-9_.\-]{12,})(?=[a-z0-9_.\-]*\d)[a-z0-9_.\-]{12,}/i },
  { name: "Private key", pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/i }
];

/** Above this size the canonical HANDOFF should archive older sections (advisory, never blocking). */
export const HANDOFF_SOFT_LIMIT_BYTES = 64 * 1024;

/**
 * @param {string} text
 * @returns {Array<{name:string, match:string}>}
 */
export function findSecretHits(text) {
  const hits = [];
  for (const rule of secretPatterns) {
    const match = rule.pattern.exec(String(text ?? ""));
    if (match) hits.push({ name: rule.name, match: match[0].slice(0, 60) });
  }
  return hits;
}

/**
 * @param {number} sizeBytes
 * @returns {string|null} advisory message, or null when within the soft limit
 */
export function handoffSizeWarning(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= HANDOFF_SOFT_LIMIT_BYTES) return null;
  return (
    `docs/ai/HANDOFF.md is ${Math.round(sizeBytes / 1024)} KiB (soft limit ` +
    `${Math.round(HANDOFF_SOFT_LIMIT_BYTES / 1024)} KiB). Move older \`## HANDOFF (...)\` sections to ` +
    "docs/ai/HANDOFF_ARCHIVE.md so startup reading stays bounded (see DEVELOPMENT_WORKFLOW.md)."
  );
}

function exists(file) { return fs.existsSync(path.join(root, file)); }
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

function main() {
  let failed = false;
  let warnings = 0;
  function fail(message) { console.error(`❌ [blocking] ${message}`); failed = true; }
  function warn(message) { console.warn(`⚠️  [advisory] ${message}`); warnings += 1; }
  function ok(message) { console.log(`✅ ${message}`); }

  for (const file of requiredFiles) {
    if (!exists(file)) { fail(`Missing required memory file: ${file}`); continue; }
    const content = read(file);
    if (!content.trim()) { fail(`Empty memory file: ${file}`); continue; }
    for (const hit of findSecretHits(content)) {
      fail(`Possible ${hit.name} detected in memory file: ${file} ("${hit.match}")`);
    }
  }
  if (exists("CLAUDE.md") && !read("CLAUDE.md").includes("AGENTS.md")) fail("CLAUDE.md should reference AGENTS.md");
  if (exists("GEMINI.md") && !read("GEMINI.md").includes("AGENTS.md")) fail("GEMINI.md should reference AGENTS.md");
  if (exists("AGENTS.md") && !read("AGENTS.md").includes("docs/ai/")) fail("AGENTS.md should point agents to docs/ai/");
  if (exists("docs/ai/HANDOFF.md")) {
    const handoff = read("docs/ai/HANDOFF.md");
    const requiredHandoffSections = [
      "## Purpose",
      "## Current Handoff",
      "### From Agent / Tool",
      "### To Agent / Tool",
      "### Timestamp",
      "### Branch / Commit",
      "### Active Task",
      "### Completed Work",
      "### Files Changed",
      "### Commands / Tests Run",
      "### Current State Summary",
      "### Remaining Work",
      "### Known Risks / Blockers",
      "### Do Not Touch Without Confirmation",
      "### Recommended Next Step",
      "### Required First Actions For Next Agent",
      "## Handoff History"
    ];
    for (const section of requiredHandoffSections) {
      if (!handoff.includes(section)) warn("docs/ai/HANDOFF.md should include section: " + section);
    }
    if (!handoff.includes("No active handoff.") && handoff.includes("TODO")) {
      warn("docs/ai/HANDOFF.md contains TODO placeholders; replace them or mark no active handoff.");
    }
    const sizeWarning = handoffSizeWarning(fs.statSync(path.join(root, "docs/ai/HANDOFF.md")).size);
    if (sizeWarning) warn(sizeWarning);
  }
  if (!exists(".claude/skills/ai-memory-maintainer/SKILL.md")) warn("Claude Code skill is missing");
  if (!exists(".claude/commands/HANDOFF.md")) warn("Claude Code /HANDOFF command is missing");
  if (!exists(".claude/commands/TAKEOFF.md")) warn("Claude Code /TAKEOFF command is missing");
  if (!exists(".agents/skills/ai-memory-maintainer/SKILL.md")) warn("Codex/Antigravity skill is missing");
  if (!exists(".agents/skills/agent-handoff/SKILL.md")) warn("Agent handoff skill is missing");
  if (!exists(".agents/skills/agent-takeoff/SKILL.md")) warn("Agent takeoff skill is missing");
  if (!exists(".agents/workflows/HANDOFF.md")) warn("Agent HANDOFF workflow is missing");
  if (!exists(".agents/workflows/TAKEOFF.md")) warn("Agent TAKEOFF workflow is missing");
  if (!exists(".gemini/commands/ai-memory.toml")) warn("Gemini command is missing");
  if (!exists(".gemini/commands/HANDOFF.toml")) warn("Gemini HANDOFF command is missing");
  if (!exists(".gemini/commands/TAKEOFF.toml")) warn("Gemini TAKEOFF command is missing");

  // Optional adapter/skill files: warn (non-fatal) so agent coverage stays visible
  // without blocking the required-memory gate. Cursor rules are intentionally soft.
  const optionalFiles = [
    "docs/ai/README.md",
    ".cursor/rules/00-project.mdc",
    ".cursor/rules/10-electron-react.mdc",
    ".cursor/rules/20-playwright-runner.mdc",
    ".cursor/rules/30-storage-ipc.mdc",
    ".cursor/rules/90-safety.mdc",
    ".claude/skills/codebase-review/SKILL.md",
    ".claude/skills/feature-implementation/SKILL.md",
    ".claude/skills/bug-fix/SKILL.md",
    ".claude/skills/test-and-verify/SKILL.md",
    ".claude/skills/docs-sync/SKILL.md",
    ".claude/skills/refactor-safe/SKILL.md",
    ".claude/skills/pr-review/SKILL.md",
    ".agents/skills/codebase-review/SKILL.md",
    ".agents/skills/feature-implementation/SKILL.md",
    ".agents/skills/bug-fix/SKILL.md",
    ".agents/skills/test-and-verify/SKILL.md"
  ];
  for (const file of optionalFiles) {
    if (!exists(file)) warn("Optional adapter/skill file is missing: " + file);
  }

  if (failed) {
    console.error(`❌ AI memory check FAILED with blocking issue(s); advisory warnings: ${warnings}.`);
    process.exit(1);
  }
  ok(warnings === 0
    ? "AI memory files passed required checks."
    : `AI memory files passed required checks (${warnings} advisory warning(s), non-blocking).`);
}

const invokedAsScript = process.argv[1] && /check-memory\.mjs$/i.test(String(process.argv[1]).replace(/\\/g, "/"));
if (invokedAsScript) main();
