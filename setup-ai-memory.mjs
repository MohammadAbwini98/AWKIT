#!/usr/bin/env node
/**
 * setup-ai-memory.mjs
 *
 * Creates a local AI Memory Maintainer setup for Claude Code, Codex/Antigravity, and Gemini.
 * No GitHub required.
 *
 * Usage from your project root:
 *   node setup-ai-memory.mjs
 *   node setup-ai-memory.mjs --force
 *
 * Default mode creates missing files only. --force backs up and rewrites target files.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const force = process.argv.includes("--force");
const ts = new Date().toISOString().replace(/[:.]/g, "-");

const requiredFiles = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "docs/ai/PROJECT_BRIEF.md",
  "docs/ai/CURRENT_STATE.md",
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

function p(file) { return path.join(root, file); }
function mkdirFor(file) { fs.mkdirSync(path.dirname(p(file)), { recursive: true }); }
function backup(file) {
  if (!fs.existsSync(p(file))) return;
  const b = `${p(file)}.bak.${ts}`;
  fs.copyFileSync(p(file), b);
  console.log(`backup: ${file} -> ${path.relative(root, b)}`);
}
function write(file, content) {
  mkdirFor(file);
  if (fs.existsSync(p(file)) && !force) {
    console.log(`skip existing: ${file}`);
    return;
  }
  if (fs.existsSync(p(file)) && force) backup(file);
  fs.writeFileSync(p(file), content.trim() + "\n", "utf8");
  console.log(`write: ${file}`);
}
function readJson(file) {
  if (!fs.existsSync(p(file))) return null;
  try { return JSON.parse(fs.readFileSync(p(file), "utf8")); } catch { return null; }
}
function writeJson(file, obj) {
  mkdirFor(file);
  if (fs.existsSync(p(file))) backup(file);
  fs.writeFileSync(p(file), JSON.stringify(obj, null, 2) + "\n", "utf8");
  console.log(`update: ${file}`);
}

const docsTemplate = (title, body) => `# ${title}\n\nLast updated: TODO\n\n${body}\n\n## Unknown / Needs Verification\n\n- TODO: Review repository evidence and replace placeholders.\n`;

const files = {
  "AGENTS.md": `# AGENTS.md

## Purpose

This is the shared instruction file for AI coding agents working in this repository, including Claude Code, Codex, Gemini, Antigravity, and other assistants.

The repository is the source of truth. Do not depend only on chat history.

## Required Reading Order

Before changing code, read:

1. AGENTS.md
2. CLAUDE.md if using Claude Code
3. GEMINI.md if using Gemini
4. docs/ai/PROJECT_BRIEF.md
5. docs/ai/CURRENT_STATE.md
6. docs/ai/RULES.md
7. docs/ai/COMMANDS.md

Read these when relevant:

- docs/ai/FEATURES.md
- docs/ai/ARCHITECTURE.md
- docs/ai/KNOWN_ISSUES.md
- docs/ai/DECISIONS.md
- docs/ai/SECURITY.md
- docs/ai/TESTING.md
- docs/ai/DEVELOPMENT_WORKFLOW.md
- local AGENTS.md files in subdirectories

## Mandatory Memory Maintenance

After any code, test, command, architecture, configuration, or documentation change, use the local AI memory maintainer workflow before final response.

At minimum, update:

- docs/ai/TASK_LOG.md

Also update related files when relevant:

- docs/ai/CURRENT_STATE.md
- docs/ai/FEATURES.md
- docs/ai/ARCHITECTURE.md
- docs/ai/COMMANDS.md
- docs/ai/KNOWN_ISSUES.md
- docs/ai/DECISIONS.md
- docs/ai/SECURITY.md
- docs/ai/TESTING.md

Run:

\`\`\`bash
node scripts/ai-memory/check-memory.mjs
\`\`\`

Fix reported issues before finishing.

## General Rules

- Inspect relevant files before editing.
- Make minimal, safe, testable changes.
- Do not refactor unrelated code.
- Preserve existing behavior unless explicitly asked to change it.
- Follow existing architecture and style.
- Do not invent project facts.
- Mark unknowns clearly.
- Never copy secrets, tokens, API keys, passwords, certificates, session values, or production credentials into Markdown files.
- Update tests when changing logic.
- Update documentation when behavior, setup, commands, architecture, or rules change.

## End-of-Task Checklist

Report:

- Files changed
- What changed
- Tests/checks run
- Tests/checks not run and why
- AI memory files updated
- Remaining unknowns or risks
`,

  "CLAUDE.md": `@AGENTS.md

# Claude Code Instructions

Claude Code must follow AGENTS.md.

Before implementation:

- Read AGENTS.md.
- Read relevant docs/ai files.
- Inspect files before modifying them.
- Use plan mode for large or risky changes.
- Prefer minimal diffs.
- Avoid unrelated refactors.

After implementation:

- Use the ai-memory-maintainer skill before final response.
- Update docs/ai/TASK_LOG.md.
- Update other docs/ai files only when relevant.
- Run:

\`\`\`bash
node scripts/ai-memory/check-memory.mjs
\`\`\`
`,

  "GEMINI.md": `@AGENTS.md

# Gemini Instructions

Gemini must follow AGENTS.md.

Before implementation:

- Read AGENTS.md and relevant docs/ai files.
- Use docs/ai as the project source of truth.
- Inspect implementation files before editing.
- Avoid assumptions when repository evidence is missing.

After implementation:

- Run /ai-memory when available.
- Update docs/ai/TASK_LOG.md.
- Update other docs/ai files only when relevant.
- Run:

\`\`\`bash
node scripts/ai-memory/check-memory.mjs
\`\`\`

If context seems stale, run /memory refresh when available.
`,

  "docs/ai/PROJECT_BRIEF.md": docsTemplate("Project Brief", `## Confirmed\n\nTODO: Describe what this project is based on repository evidence.\n\n## Main Goal\n\nTODO\n\n## Main Users\n\nTODO\n\n## Main Workflows\n\nTODO\n\n## High-Level Modules\n\nTODO\n\n## What This Project Is Not\n\nTODO`),

  "docs/ai/CURRENT_STATE.md": docsTemplate("Current State", `## What Works\n\nTODO\n\n## Partially Implemented\n\nTODO\n\n## Broken / Risky\n\nTODO\n\n## Must Not Break\n\nTODO\n\n## Technical Debt\n\nTODO\n\n## Next Logical Steps\n\nTODO`),

  "docs/ai/FEATURES.md": docsTemplate("Features", `## Existing Features\n\nTODO\n\n## Planned / Implied Features\n\nTODO\n\n## Incomplete Features\n\nTODO\n\n## Feature Ownership By Module\n\nTODO\n\n## Important Dependencies\n\nTODO`),

  "docs/ai/ARCHITECTURE.md": docsTemplate("Architecture", `## Folder / Module Map\n\nTODO\n\n## Backend Architecture\n\nTODO\n\n## Frontend Architecture\n\nTODO\n\n## Database / Storage Architecture\n\nTODO\n\n## External Integrations\n\nTODO\n\n## Data Flow\n\nTODO\n\n## Runtime Flow\n\nTODO\n\n## Architectural Constraints\n\nTODO`),

  "docs/ai/COMMANDS.md": docsTemplate("Commands", `Only list commands confirmed by repository evidence.\n\n## Install\n\n\`\`\`bash\nTODO\n\`\`\`\n\n## Development\n\n\`\`\`bash\nTODO\n\`\`\`\n\n## Test\n\n\`\`\`bash\nTODO\n\`\`\`\n\n## Lint / Type Check\n\n\`\`\`bash\nTODO\n\`\`\`\n\n## Build\n\n\`\`\`bash\nTODO\n\`\`\`\n\n## AI Memory Check\n\n\`\`\`bash\nnode scripts/ai-memory/check-memory.mjs\n\`\`\``),

  "docs/ai/RULES.md": docsTemplate("Project Rules", `## Non-Negotiable Rules\n\n- Do not invent project facts.\n- Do not refactor unrelated code.\n- Do not expose secrets.\n- Preserve existing behavior unless explicitly asked to change it.\n- Update AI memory after implementation work.\n\n## Coding Style Rules\n\nTODO\n\n## Architecture Rules\n\nTODO\n\n## API Contract Rules\n\nTODO\n\n## Database Rules\n\nTODO\n\n## UI Rules\n\nTODO\n\n## Logging Rules\n\nTODO\n\n## Error Handling Rules\n\nTODO\n\n## Dependency Rules\n\nTODO\n\n## Documentation Rules\n\n- Update docs/ai/TASK_LOG.md after every implementation task.\n- Update docs/ai/CURRENT_STATE.md when behavior or status changes.\n- Update specific memory files only when relevant.`),

  "docs/ai/KNOWN_ISSUES.md": docsTemplate("Known Issues", `## Confirmed Issues\n\nTODO\n\n## Risky Areas\n\nTODO\n\n## Manual Verification Needed\n\nTODO`),

  "docs/ai/TASK_LOG.md": `# Task Log

## TODO — Initial AI Memory Setup

### Agent / Tool

Local setup script

### Task

Created local AI-agent memory structure and maintainer workflow.

### Files Created / Updated

- AGENTS.md
- CLAUDE.md
- GEMINI.md
- docs/ai/*
- scripts/ai-memory/check-memory.mjs
- .claude/skills/ai-memory-maintainer/SKILL.md
- .agents/skills/ai-memory-maintainer/SKILL.md
- .agents/workflows/update-memory.md
- .gemini/commands/ai-memory.toml

### Summary

Initialized repository memory files and local agent skills/commands. Replace TODO sections after repository review.

### Checks Run

TODO: Run node scripts/ai-memory/check-memory.mjs.

### Remaining Notes

Ask an agent to review the repository and fill confirmed project details.
`,

  "docs/ai/DECISIONS.md": docsTemplate("Decisions", `Document important project decisions here.\n\n## Decision Template\n\n### YYYY-MM-DD — Decision Title\n\n**Decision:** TODO\n\n**Reason:** TODO\n\n**Impact:** TODO\n\n**Related files:** TODO`),

  "docs/ai/SECURITY.md": docsTemplate("Security", `## Secret Handling\n\n- Never commit or document plaintext secrets.\n- Never copy passwords, API keys, tokens, certificates, private keys, session values, private URLs, or production credentials into Markdown files.\n- Use environment variables or approved secret stores.\n- Document variable names only, not values.\n\n## Logging Restrictions\n\n- Do not log secrets.\n- Redact tokens, cookies, credentials, and session identifiers.\n\n## Files That Must Not Contain Secrets\n\n- AGENTS.md\n- CLAUDE.md\n- GEMINI.md\n- docs/ai/*.md\n- README files\n- committed config files\n\n## Dependency / Supply Chain Notes\n\nTODO`),

  "docs/ai/TESTING.md": docsTemplate("Testing", `## Existing Test Framework\n\nTODO\n\n## Test Locations\n\nTODO\n\n## How To Run Tests\n\n\`\`\`bash\nTODO\n\`\`\`\n\n## Required Test Behavior For Future Changes\n\n- Add or update tests when changing logic.\n- Run the smallest relevant test first.\n- Run broader regression tests when changing shared behavior.\n- Report tests not run and why.\n\n## Manual Verification Checklist\n\nTODO\n\n## Known Test Gaps\n\nTODO`),

  "docs/ai/DEVELOPMENT_WORKFLOW.md": docsTemplate("Development Workflow", `## How Agents Should Start Work\n\n1. Read AGENTS.md.\n2. Read relevant docs/ai files.\n3. Inspect the relevant source files.\n4. Confirm current behavior before changing it.\n\n## How To Make Safe Changes\n\n- Keep diffs small.\n- Preserve existing architecture.\n- Avoid unrelated refactors.\n- Update tests with logic changes.\n- Update docs when behavior, commands, architecture, or setup changes.\n\n## How To Finish A Task\n\n1. Run relevant tests/checks.\n2. Update docs/ai/TASK_LOG.md.\n3. Update other memory files when relevant.\n4. Run node scripts/ai-memory/check-memory.mjs.\n5. Summarize changed files, tests, memory updates, and remaining risks.`),

  "scripts/ai-memory/check-memory.mjs": `#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = ${JSON.stringify(requiredFiles, null, 2)};
const secretPatterns = [
  { name: "API key", pattern: /api[_-]?key\\s*[:=]\\s*['"]?[a-z0-9_\\-]{16,}/i },
  { name: "Token", pattern: /token\\s*[:=]\\s*['"]?[a-z0-9_\\-.]{20,}/i },
  { name: "Password assignment", pattern: /password\\s*[:=]\\s*['"]?.{6,}/i },
  { name: "Secret assignment", pattern: /secret\\s*[:=]\\s*['"]?[a-z0-9_\\-]{12,}/i },
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
if (!exists(".claude/skills/ai-memory-maintainer/SKILL.md")) warn("Claude Code skill is missing");
if (!exists(".agents/skills/ai-memory-maintainer/SKILL.md")) warn("Codex/Antigravity skill is missing");
if (!exists(".gemini/commands/ai-memory.toml")) warn("Gemini command is missing");
if (!failed) ok("AI memory files passed required checks.");
process.exit(failed ? 1 : 0);
`,

  ".claude/skills/ai-memory-maintainer/SKILL.md": `---
name: ai-memory-maintainer
description: Update and verify AI memory files after code, architecture, command, test, configuration, or documentation changes. Use before finishing any implementation task.
allowed-tools: Bash(node *), Bash(npm *), Read, Edit, Write, Glob, Grep
---

# AI Memory Maintainer

You maintain the repository AI memory system.

## Procedure

1. Inspect recent project changes.
2. Identify whether changes affect project state, features, architecture, commands, tests, security, known issues, decisions, or agent instructions.
3. Always update docs/ai/TASK_LOG.md.
4. Update docs/ai/CURRENT_STATE.md when behavior, implementation status, risks, or incomplete work changed.
5. Update docs/ai/FEATURES.md only when feature behavior changed.
6. Update docs/ai/ARCHITECTURE.md only when module boundaries, data flow, APIs, storage, or integrations changed.
7. Update docs/ai/COMMANDS.md only when commands or scripts changed.
8. Update docs/ai/KNOWN_ISSUES.md only when a real issue, fragile area, missing test, or repeated trap was found.
9. Update docs/ai/DECISIONS.md when a meaningful technical/product decision was made.
10. Never copy secrets into Markdown files.

## Verification

Run:

\`\`\`bash
node scripts/ai-memory/check-memory.mjs
\`\`\`

Fix any reported issue before finishing.

## Final Response

Report memory files updated, why each file was updated, verification result, and remaining unknowns.
`,

  ".agents/skills/ai-memory-maintainer/SKILL.md": `---
name: ai-memory-maintainer
description: Use after any code, architecture, command, test, configuration, or documentation change to update and verify repository AI memory files.
---

# AI Memory Maintainer

Before finishing implementation work:

1. Inspect changed files.
2. Update docs/ai/TASK_LOG.md.
3. Update docs/ai/CURRENT_STATE.md if the project state changed.
4. Update docs/ai/FEATURES.md if feature behavior changed.
5. Update docs/ai/ARCHITECTURE.md if architecture changed.
6. Update docs/ai/COMMANDS.md if commands changed.
7. Update docs/ai/KNOWN_ISSUES.md if new risks, missing tests, fragile behavior, or repeated traps were found.
8. Update docs/ai/DECISIONS.md if meaningful decisions were made.
9. Verify AGENTS.md, CLAUDE.md, and GEMINI.md still point to the shared memory structure.
10. Do not copy secrets into documentation.

Run node scripts/ai-memory/check-memory.mjs and fix any reported issues.
`,

  ".agents/workflows/update-memory.md": `---
description: Update and verify AI memory files after project changes
---

# Update Memory Workflow

When this workflow runs:

1. Review recent project changes.
2. Read AGENTS.md, CLAUDE.md, GEMINI.md, docs/ai/CURRENT_STATE.md, docs/ai/TASK_LOG.md, and docs/ai/RULES.md.
3. Update relevant docs/ai files.
4. Run node scripts/ai-memory/check-memory.mjs.
5. Fix reported memory issues.
6. Summarize memory files updated and why.
`,

  ".gemini/commands/ai-memory.toml": `description = "Update and verify repository AI memory files after changes."

prompt = """
You are maintaining the AI-agent memory system for this repository.

First run this local check and use the result as context:

!{node scripts/ai-memory/check-memory.mjs}

Then inspect recent changes and update only relevant files:

- docs/ai/TASK_LOG.md
- docs/ai/CURRENT_STATE.md
- docs/ai/FEATURES.md
- docs/ai/ARCHITECTURE.md
- docs/ai/COMMANDS.md
- docs/ai/KNOWN_ISSUES.md
- docs/ai/DECISIONS.md
- docs/ai/SECURITY.md
- docs/ai/TESTING.md
- AGENTS.md
- CLAUDE.md
- GEMINI.md

Rules:

- Always update TASK_LOG.md after implementation work.
- Update CURRENT_STATE.md when project behavior or status changed.
- Do not invent project facts.
- Do not copy secrets.
- Keep AGENTS.md concise.
- Put detailed project state inside docs/ai/.
- Run the memory check again after edits.

Final response must include memory files updated, why each file was updated, verification result, and remaining unknowns.
"""
`
};

console.log("Setting up local AI Memory Maintainer...\n");
for (const [file, content] of Object.entries(files)) write(file, content);

// Merge Claude Stop hook.
const claudeSettings = readJson(".claude/settings.json") || {};
claudeSettings.hooks = claudeSettings.hooks || {};
claudeSettings.hooks.Stop = claudeSettings.hooks.Stop || [];
const stopCommand = "node scripts/ai-memory/check-memory.mjs";
if (!JSON.stringify(claudeSettings.hooks.Stop).includes(stopCommand) || force) {
  claudeSettings.hooks.Stop.push({ matcher: "*", hooks: [{ type: "command", command: stopCommand }] });
  writeJson(".claude/settings.json", claudeSettings);
} else {
  console.log("skip existing: .claude/settings.json Stop hook");
}

// Merge package.json scripts only if package.json exists and is valid.
const pkg = readJson("package.json");
if (pkg) {
  pkg.scripts = pkg.scripts || {};
  let changed = false;
  if (!pkg.scripts["ai:memory"]) { pkg.scripts["ai:memory"] = "node scripts/ai-memory/check-memory.mjs"; changed = true; }
  if (!pkg.scripts["ai:memory:check"]) { pkg.scripts["ai:memory:check"] = "node scripts/ai-memory/check-memory.mjs"; changed = true; }
  if (changed || force) writeJson("package.json", pkg); else console.log("skip existing: package.json scripts");
} else {
  console.log("No valid package.json found. Use: node scripts/ai-memory/check-memory.mjs");
}

console.log("\nRunning memory check...\n");
const result = spawnSync(process.execPath, ["scripts/ai-memory/check-memory.mjs"], { cwd: root, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(`
Done. Local AI Memory Maintainer setup is complete.

Next steps:
1. Ask Claude/Codex/Gemini to review the repository and fill TODO sections in docs/ai/*.md.
2. In Claude Code, use the ai-memory-maintainer skill before final responses after implementation tasks.
3. In Gemini, run /commands reload, then use /ai-memory after changes.
4. For any agent, run: node scripts/ai-memory/check-memory.mjs

No GitHub is required.
`);
