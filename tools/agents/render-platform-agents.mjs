/**
 * Generate executable platform agent definitions from the canonical registry.
 *
 * Binding decision (`docs/ai/DECISIONS.md`, 2026-08-16): platform definitions must be GENERATED FROM
 * or ASSERTED AGAINST `routing-matrix.mjs`, and may never become a second source of truth. Three
 * independently maintained per-provider architectures are explicitly rejected.
 *
 * ── Why the three platforms get different treatment ───────────────────────────────────────────
 *
 * Claude Code has a real subagent runtime that consumes `.claude/agents/*.md`, so each role is
 * generated there as an executable definition with its own tool grant. A read-only specialist is
 * given no Edit or Write tool at all, which makes "read-only" a property of the runtime rather than
 * a promise in prose.
 *
 * Codex and Gemini, in this repository, consume `SKILL.md` files — there is no per-role agent
 * runtime to feed. Emitting eleven duplicated role briefs into each would create twenty-two more
 * files that can drift while executing nothing. Each therefore receives ONE generated adapter skill
 * carrying the same registry-derived roster. Generate where it executes; point where it does not.
 *
 * All outputs are byte-compared by `verify:agent-routing`, so hand-editing any of them fails.
 *
 *   node tools/agents/render-platform-agents.mjs           check (prints what would change)
 *   node tools/agents/render-platform-agents.mjs --write   write every file
 */

import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVATION_RULES,
  AGENTS,
  EVIDENCE_STATUSES,
  ROLE_SKILLS,
  WRITER_PRECEDENCE,
  agent,
  disallowedToolsFor,
  toolsFor
} from "./routing-matrix.mjs";
import {
  DELEGATION_FIELDS,
  DELEGATION_PACKET_FIELDS,
  REPORT_SECTIONS
} from "./context-policy.mjs";

/** tools/agents -> tools -> repo root */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where each platform's generated output lives. */
export const CLAUDE_AGENTS_DIR = join(REPO_ROOT, ".claude", "agents");
export const CODEX_ADAPTER = join(REPO_ROOT, ".codex", "skills", "agent-routing", "SKILL.md");
export const GEMINI_ADAPTER = join(REPO_ROOT, ".gemini", "skills", "agent-routing", "SKILL.md");

/**
 * The conditions that activate an agent, phrased for a human.
 * @param {string} agentId
 * @returns {string[]}
 */
function triggersFor(agentId) {
  const out = [];
  for (const rule of ACTIVATION_RULES) {
    if (rule.agent !== agentId) continue;
    if (rule.anyFlag.length > 0) out.push(`any of ${rule.anyFlag.map((f) => `\`${f}\``).join(", ")}`);
    if (typeof rule.minRisk === "number") out.push(`\`risk_level >= ${rule.minRisk}\``);
    if (typeof rule.minCrossLayer === "number") out.push(`\`cross_layer_count >= ${rule.minCrossLayer}\``);
    if (rule.onOwnedPath) out.push("the task expects to touch a path it owns");
  }
  if (agentId === "manager") out.push("always — every task has exactly one orchestrator");
  return out;
}

/**
 * A one-line description for the frontmatter. Claude Code uses this to decide when a subagent
 * applies, so it names the trigger rather than restating the title.
 *
 * @param {import("./routing-matrix.mjs").AgentEntry} a
 * @returns {string}
 */
function descriptionFor(a) {
  const triggers = triggersFor(a.id);
  const when = triggers.length > 0 ? ` Activates when ${triggers.join("; or ")}.` : "";
  const mode =
    a.defaultMode === "read-only"
      ? " Read-only: advises, never edits."
      : "";
  return `${a.mandate}${when}${mode}`.replace(/\s+/g, " ").trim();
}

/**
 * The shared body every platform renders for a role.
 * @param {import("./routing-matrix.mjs").AgentEntry} a
 * @returns {string[]}
 */
function roleBody(a) {
  const lines = [];
  const triggers = triggersFor(a.id);
  const skills = ROLE_SKILLS[a.id] ?? [];

  lines.push(`# ${a.role}`);
  lines.push("");
  lines.push(`> **Generated from \`tools/agents/routing-matrix.mjs\`. Do not edit.**`);
  lines.push(`> Regenerate with \`npm run agent:render-agents\`; \`verify:agent-routing\` compares`);
  lines.push(`> this file byte-for-byte against the registry.`);
  lines.push("");
  lines.push(a.mandate);
  lines.push("");

  lines.push("## When you are activated");
  lines.push("");
  if (triggers.length > 0) {
    for (const trigger of triggers) lines.push(`- ${trigger}`);
  } else {
    lines.push("- only when the Manager names you explicitly");
  }
  lines.push("");

  lines.push("## What you may write");
  lines.push("");
  if (a.ownsPaths.length === 0) {
    lines.push(
      "Nothing. You produce findings and decisions; an implementation specialist applies them."
    );
  } else {
    lines.push("Only inside a granted write lease, and only within:");
    lines.push("");
    for (const path of a.ownsPaths) lines.push(`- \`${path}\``);
    lines.push("");
    lines.push(
      "A lease is scoped to what the task actually expects to touch, not to everything you own."
    );
  }
  if (a.agentsMd) {
    lines.push("");
    lines.push(`Folder rules that already govern this area: \`${a.agentsMd}\` — read it first.`);
  }
  lines.push("");

  if (skills.length > 0) {
    lines.push("## Skills to use");
    lines.push("");
    lines.push("These already exist. Use them rather than reinventing their procedure:");
    lines.push("");
    for (const skill of skills) lines.push(`- \`${skill}\``);
    lines.push("");
  }

  lines.push("## Rules that bind you");
  lines.push("");
  lines.push(
    "- **One writer at a time.** A multi-domain task is a sequence of leases, not a committee. " +
      `Lease order: ${WRITER_PRECEDENCE.join(" -> ")}.`
  );
  lines.push(
    "- **Never work around a blocked write.** If the lease guard blocks a path, that is scope " +
      "expansion. Run `npm run agent:lease-amend -- --add \"<path>\" --reason \"<why>\"`, which " +
      "re-runs routing and may hand the work to whoever owns that path."
  );
  lines.push(
    `- **Evidence uses the ledger's words only:** ${EVIDENCE_STATUSES.join(" | ")}. ` +
      "`BLOCKED`, `NOT RUN` and `FAIL` are not `PASS`, and there is no `INCONCLUSIVE`."
  );
  lines.push(
    "- **Declare evidence before implementing.** Evidence chosen afterwards tends to be evidence " +
      "that passes."
  );
  lines.push(
    "- **Work in-tree.** No worktrees, no new branches — AWKIT develops on `main` only " +
      "(`docs/ai/BRANCH_AND_COMMIT_POLICY.md`)."
  );
  lines.push(
    "- **Protect context.** Do not return giant logs, full files, raw search dumps, repeated project " +
      "instructions, chain-of-thought, or irrelevant failed hypotheses."
  );
  lines.push("");
  lines.push("## Delegation and report contract");
  lines.push("");
  lines.push("The manager sends only this bounded packet:");
  lines.push("");
  for (const field of DELEGATION_PACKET_FIELDS) lines.push(`- ${field}`);
  lines.push("");
  lines.push(`Separate claims with: ${DELEGATION_FIELDS.join(" / ")}.`);
  lines.push("");
  lines.push("Return these concise sections (use `none` when genuinely empty):");
  lines.push("");
  for (const section of REPORT_SECTIONS) lines.push(`- ${section}`);
  lines.push("");
  lines.push("Process: `docs/ai/routing/ROUTING_RULES.md`. Data: `docs/ai/routing/ROUTING_MATRIX.md`.");

  return lines;
}

/**
 * One Claude Code subagent definition.
 * @param {import("./routing-matrix.mjs").AgentEntry} a
 * @returns {string}
 */
export function renderClaudeAgent(a) {
  const lines = [
    "---",
    `name: ${a.claudeName}`,
    `description: ${descriptionFor(a)}`,
    `tools: ${toolsFor(a.id)}`,
    `disallowedTools: ${disallowedToolsFor(a.id)}`,
    `model: ${a.model}`,
    `maxTurns: ${a.maxTurns}`,
    `permissionMode: ${a.defaultMode === "read-only" ? "plan" : "default"}`,
    "---",
    ""
  ];
  return `${[...lines, ...roleBody(a)].join("\n")}\n`;
}

/**
 * A single adapter skill carrying the whole roster, for a platform with no per-role agent runtime.
 * @param {string} platform
 * @returns {string}
 */
export function renderAdapter(platform) {
  const lines = [
    "---",
    "name: agent-routing",
    "description: >-",
    `  AWKIT's canonical specialist roles, ownership boundaries and write-lease rules for ${platform}.`,
    "  Read before taking on work that spans more than one area, before editing outside your own",
    "  domain, and before claiming a task is complete.",
    "allowed-tools: Read, Glob, Grep, Bash(git *), Bash(npm run *), Bash(node *)",
    "---",
    "",
    "# Agent Routing",
    "",
    "> **Generated from `tools/agents/routing-matrix.mjs`. Do not edit.**",
    `> Regenerate with \`npm run agent:render-agents\`; \`verify:agent-routing\` compares this file`,
    "> byte-for-byte against the registry.",
    "",
    `${platform} has no per-role agent runtime in this repository, so the ${AGENTS.length} roles are not emitted`,
    `as separate executable files here — that would be ${AGENTS.length} more documents able to drift while`,
    "executing nothing. This one adapter carries the same registry-derived roster. Claude Code, which",
    "does have a subagent runtime, gets generated definitions under `.claude/agents/`.",
    "",
    "## Roles",
    "",
    "| Role | Mode | Owns | Mandate |",
    "| --- | --- | --- | --- |"
  ];

  for (const a of AGENTS) {
    lines.push(
      `| \`${a.id}\` | ${a.defaultMode} | ` +
        `${a.ownsPaths.length > 0 ? a.ownsPaths.map((p) => `\`${p}\``).join("<br>") : "—"} | ` +
        `${a.mandate} |`
    );
  }

  lines.push("");
  lines.push("## The rules that matter most");
  lines.push("");
  lines.push(
    `1. **One writer at a time.** Lease order: ${WRITER_PRECEDENCE.join(" -> ")}. AWKIT develops ` +
      "directly on `main`, so a second concurrent writer has nothing to isolate it."
  );
  lines.push(
    "2. **A blocked write is scope expansion, not an obstacle.** Amend the lease " +
      "(`npm run agent:lease-amend`), which re-runs routing and may reassign the work."
  );
  lines.push(
    `3. **Evidence vocabulary is the ledger's:** ${EVIDENCE_STATUSES.join(" | ")}. No ` +
      "`INCONCLUSIVE`, no underscored `NOT_RUN`."
  );
  lines.push("4. **Declare evidence before implementing**, and never weaken an assertion to get green.");
  lines.push("5. **No worktrees, no new branches.** See `docs/ai/BRANCH_AND_COMMIT_POLICY.md`.");
  lines.push("");
  lines.push("Process: `docs/ai/routing/ROUTING_RULES.md`. Data: `docs/ai/routing/ROUTING_MATRIX.md`.");

  return `${lines.join("\n")}\n`;
}

/**
 * Every generated file as {path, content}.
 * @returns {{path: string, content: string}[]}
 */
export function allGeneratedFiles() {
  return [
    ...AGENTS.map((a) => ({
      path: join(CLAUDE_AGENTS_DIR, `${a.claudeName}.md`),
      content: renderClaudeAgent(a)
    })),
    { path: CODEX_ADAPTER, content: renderAdapter("Codex") },
    { path: GEMINI_ADAPTER, content: renderAdapter("Gemini / Antigravity") }
  ];
}

if (process.argv[1] && process.argv[1].endsWith("render-platform-agents.mjs")) {
  const write = process.argv.includes("--write");
  let drift = 0;

  if (write) {
    mkdirSync(CLAUDE_AGENTS_DIR, { recursive: true });
    const wanted = new Set(AGENTS.map((a) => `${a.claudeName}.md`));
    for (const entry of readdirSync(CLAUDE_AGENTS_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || wanted.has(entry.name)) continue;
      const path = join(CLAUDE_AGENTS_DIR, entry.name);
      let content = "";
      try {
        content = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      if (!content.includes("Generated from `tools/agents/routing-matrix.mjs`")) continue;
      unlinkSync(path);
      console.log(`removed .claude/agents/${entry.name}`);
    }
  }

  for (const file of allGeneratedFiles()) {
    let current = null;
    try {
      current = readFileSync(file.path, "utf8");
    } catch {
      /* not generated yet */
    }

    if (current === file.content) continue;
    drift += 1;

    if (write) {
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.content, "utf8");
      console.log(`wrote ${file.path.replace(REPO_ROOT, ".")}`);
    } else {
      console.log(`DRIFT ${file.path.replace(REPO_ROOT, ".")}`);
    }
  }

  if (drift === 0) console.log("All generated agent definitions are current.");
  else if (!write) {
    console.error(`\n${drift} file(s) differ. Run: npm run agent:render-agents`);
    process.exit(1);
  }
}
