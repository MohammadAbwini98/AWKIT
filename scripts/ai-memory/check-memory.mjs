#!/usr/bin/env node

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
const secretPatterns = [
  { name: "API key", pattern: /api[_-]?key\s*[:=]\s*['"]?[a-z0-9_\-]{16,}/i },
  { name: "Token", pattern: /token\s*[:=]\s*['"]?[a-z0-9_\-.]{20,}/i },
  { name: "Password assignment", pattern: /password\s*[:=]\s*['"]?.{6,}/i },
  { name: "Secret assignment", pattern: /secret\s*[:=]\s*['"]?[a-z0-9_\-]{12,}/i },
  { name: "Private key", pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/i }
];
let failed = false;
function fail(message) { console.error('❌ ' + message); failed = true; }
function warn(message) { console.warn('⚠️  ' + message); }
function ok(message) { console.log('✅ ' + message); }
function exists(file) { return fs.existsSync(path.join(root, file)); }
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }
for (const file of requiredFiles) {
  if (!exists(file)) { fail('Missing required memory file: ' + file); continue; }
  const content = read(file);
  if (!content.trim()) fail('Empty memory file: ' + file);
  for (const rule of secretPatterns) {
    if (rule.pattern.test(content)) fail('Possible ' + rule.name + ' detected in memory file: ' + file);
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

if (!failed) ok("AI memory files passed required checks.");
process.exit(failed ? 1 : 0);
