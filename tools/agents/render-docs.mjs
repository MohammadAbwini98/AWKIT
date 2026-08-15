/**
 * Render `docs/ai/routing/ROUTING_MATRIX.md` from the canonical registry.
 *
 * The reviewed architecture stated its routing rules three times — as pseudocode, as a markdown
 * table, and as a validator rejection list — and the three had already drifted apart before anyone
 * implemented them: the table made the Architect mandatory for persistence work that the pseudocode
 * and the validator both treated as optional. Three hand-maintained copies of one rule will always
 * end that way.
 *
 * So the table is generated. `verify:agent-routing` re-renders it and compares byte-for-byte, which
 * means a hand edit to the document fails the build rather than quietly becoming a fourth opinion.
 *
 *   node tools/agents/render-docs.mjs          print
 *   node tools/agents/render-docs.mjs --write  write the file
 */

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVATION_RULES,
  AGENTS,
  CLASSIFICATION_FLAGS,
  EVIDENCE_STATUSES,
  PATH_DOMAINS,
  RISK_1_FLAGS,
  RISK_2_FLAGS,
  PROTECTED_PATHS,
  RISK_3_FLAGS,
  SHARED_WRITE_PATHS,
  WRITER_PRECEDENCE
} from "./routing-matrix.mjs";

export const MATRIX_DOC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "docs",
  "ai",
  "routing",
  "ROUTING_MATRIX.md"
);

/** @param {string[]} cells */
const row = (cells) => `| ${cells.join(" | ")} |`;

/**
 * Build the full document.
 * @returns {string}
 */
export function renderMatrix() {
  const lines = [];

  lines.push("# ROUTING_MATRIX");
  lines.push("");
  lines.push(
    "> **This file is DERIVED. Do not edit it.** It is generated from `tools/agents/routing-matrix.mjs`"
  );
  lines.push(
    "> by `node tools/agents/render-docs.mjs --write`, and `verify:agent-routing` re-renders it and"
  );
  lines.push(
    "> compares byte-for-byte. Change the registry, then regenerate — a hand edit fails the verifier."
  );
  lines.push("");
  lines.push(
    "The registry is the single encoding of who may write where, which specialists a task activates,"
  );
  lines.push(
    "and what risk it carries. An earlier draft stated these rules in three places that disagreed."
  );
  lines.push("");

  // ── Agents ────────────────────────────────────────────────────────────────────────────────────
  lines.push("## Agents");
  lines.push("");
  lines.push(row(["Agent", "Role", "Default mode", "Owns", "Folder authority"]));
  lines.push(row(["---", "---", "---", "---", "---"]));
  for (const a of AGENTS) {
    lines.push(
      row([
        `\`${a.id}\``,
        a.role,
        a.defaultMode,
        a.ownsPaths.length > 0 ? a.ownsPaths.map((p) => `\`${p}\``).join("<br>") : "—",
        a.agentsMd ? `\`${a.agentsMd}\`` : "—"
      ])
    );
  }
  lines.push("");
  lines.push("Mandates:");
  lines.push("");
  for (const a of AGENTS) lines.push(`- **\`${a.id}\`** — ${a.mandate}`);
  lines.push("");

  // ── Write order ───────────────────────────────────────────────────────────────────────────────
  lines.push("## Write-lease order");
  lines.push("");
  lines.push(
    "One writer at a time, so a multi-domain task is a SEQUENCE of leases. Contracts settle before"
  );
  lines.push("the code consuming them; QA writes the proof once the behavior exists.");
  lines.push("");
  lines.push("```text");
  lines.push(WRITER_PRECEDENCE.join(" -> "));
  lines.push("```");
  lines.push("");

  // ── Path map ──────────────────────────────────────────────────────────────────────────────────
  lines.push("## Path map");
  lines.push("");
  lines.push(
    "The basis for BOTH lease scoping and derived classification. `Implies` lists only flags that are"
  );
  lines.push(
    "true *whenever* the path is touched — editing the renderer proves it changed, never that the"
  );
  lines.push("change was visual. First match wins, so narrower paths come first.");
  lines.push("");
  lines.push(row(["Path", "Owner", "Implies", "Note"]));
  lines.push(row(["---", "---", "---", "---"]));
  for (const d of PATH_DOMAINS) {
    lines.push(
      row([
        `\`${d.glob}\``,
        `\`${d.owner}\``,
        d.impliesFlags.length > 0 ? d.impliesFlags.map((f) => `\`${f}\``).join(", ") : "—",
        d.note
      ])
    );
  }
  lines.push("");

  // ── Protected paths ───────────────────────────────────────────────────────────────────────────
  lines.push("## Protected paths");
  lines.push("");
  lines.push(
    "Most paths are writable when NO lease is held — failing closed everywhere would block every task"
  );
  lines.push(
    "that does not use a contract, and a gate that stops all work gets removed rather than obeyed."
  );
  lines.push("These are the exception: an unclaimed edit here leaves nobody answerable for a Risk 3");
  lines.push("change, so the guard refuses it until someone takes a lease.");
  lines.push("");
  lines.push("**Derived, not hand-listed** — a path is protected when what it implies is already Risk 3.");
  lines.push("");
  lines.push(row(["Path", "Owner", "Implies"]));
  lines.push(row(["---", "---", "---"]));
  for (const p of PROTECTED_PATHS) {
    lines.push(row([`\`${p.glob}\``, `\`${p.owner}\``, p.impliesFlags.map((f) => `\`${f}\``).join(", ")]));
  }
  lines.push("");

  // ── Shared write paths ────────────────────────────────────────────────────────────────────────
  lines.push("## Shared write paths");
  lines.push("");
  lines.push(
    "Files whose ownership is real but whose risk lives in specific KEYS rather than the whole file."
  );
  lines.push(
    "The lease guard runs BEFORE an edit and cannot see which key is about to change, so for these"
  );
  lines.push(
    "paths the edit-time gate is relaxed and the enforcement moves to a content-aware derived check"
  );
  lines.push("that compares the committed file against the working tree.");
  lines.push("");
  lines.push(row(["Path", "Owner", "Shared fields", "Shared for"]));
  lines.push(row(["---", "---", "---", "---"]));
  for (const s of SHARED_WRITE_PATHS) {
    lines.push(
      row([
        `\`${s.glob}\``,
        `\`${s.owner}\``,
        s.sharedFields.map((f) => `\`${f}\``).join(", "),
        s.sharedFor
      ])
    );
  }
  lines.push("");
  lines.push(
    "`sharedFields` is an ALLOW-list, so the default is guarded: a top-level key nobody has thought"
  );
  lines.push(
    "about yet is owned automatically rather than shared by omission. Changing any guarded field"
  );
  lines.push("without activating the owner is a scope escape and blocks completion.");
  lines.push("");

  // ── Activation ────────────────────────────────────────────────────────────────────────────────
  lines.push("## Activation rules");
  lines.push("");
  lines.push(row(["Agent", "Activates when", "Why"]));
  lines.push(row(["---", "---", "---"]));
  for (const rule of ACTIVATION_RULES) {
    const conditions = [];
    if (rule.anyFlag.length > 0) conditions.push(rule.anyFlag.map((f) => `\`${f}\``).join(" or "));
    if (typeof rule.minRisk === "number") conditions.push(`\`risk_level >= ${rule.minRisk}\``);
    if (typeof rule.minCrossLayer === "number") {
      conditions.push(`\`cross_layer_count >= ${rule.minCrossLayer}\``);
    }
    if (rule.onOwnedPath) conditions.push("a expected path it owns is touched");
    lines.push(row([`\`${rule.agent}\``, conditions.join("<br>or "), rule.why]));
  }
  lines.push("");

  // ── Risk ──────────────────────────────────────────────────────────────────────────────────────
  lines.push("## Risk levels");
  lines.push("");
  lines.push(
    "Risk is computed, never chosen. A contract may declare a HIGHER level than computed; never lower."
  );
  lines.push("");
  lines.push(`**Risk 3 — critical.** Any of: ${RISK_3_FLAGS.map((f) => `\`${f}\``).join(", ")}.`);
  lines.push("");
  lines.push(
    `**Risk 2 — cross-layer.** Any of: ${RISK_2_FLAGS.map((f) => `\`${f}\``).join(", ")}, ` +
      "or `cross_layer_count >= 3`."
  );
  lines.push("");
  lines.push(
    `**Risk 1 — localized.** Any of: ${RISK_1_FLAGS.map((f) => `\`${f}\``).join(", ")}, ` +
      "or `cross_layer_count >= 2`."
  );
  lines.push("");
  lines.push("**Risk 0 — documentation.** Nothing above applies.");
  lines.push("");
  lines.push(
    "Note that `packaging_change` alone is Risk 2, not Risk 3. Packaging reaches critical through"
  );
  lines.push(
    "`signing_change`, `offline_boundary_change` or `new_dependency` — the properties that actually"
  );
  lines.push("carry trust.");
  lines.push("");

  // ── Classification flags ──────────────────────────────────────────────────────────────────────
  lines.push("## Classification flags");
  lines.push("");
  lines.push("Routing reads only these. An unknown key is rejected, never ignored.");
  lines.push("");
  for (const flag of CLASSIFICATION_FLAGS) lines.push(`- \`${flag}\``);
  lines.push("- `cross_layer_count` (integer >= 1)");
  lines.push("");

  // ── Evidence ──────────────────────────────────────────────────────────────────────────────────
  lines.push("## Evidence vocabulary");
  lines.push("");
  lines.push(
    "Copied from the validation ledger's own `LEDGER_STATUSES`, not invented. `verify:agent-routing`"
  );
  lines.push("asserts the two still match.");
  lines.push("");
  lines.push("```text");
  lines.push(EVIDENCE_STATUSES.join(" | "));
  lines.push("```");
  lines.push("");
  lines.push(
    "`BLOCKED`, `NOT RUN` and `FAIL` are not `PASS`. An inconclusive check is `NOT RUN` with a reason —"
  );
  lines.push("there is no separate `INCONCLUSIVE` state, and no underscored `NOT_RUN` variant.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && process.argv[1].endsWith("render-docs.mjs")) {
  const content = renderMatrix();
  if (process.argv.includes("--write")) {
    writeFileSync(MATRIX_DOC_PATH, content, "utf8");
    console.log(`Wrote ${MATRIX_DOC_PATH}`);
  } else {
    process.stdout.write(content);
  }
}
