# Codebase Memory MCP + Beads — Setup, Workflow & Reference

Two persistent-memory tools are installed for this repository:

- **Codebase Memory MCP** (`codebase-memory-mcp`) — a code-structure **knowledge graph**. Answers
  "who calls X", "what does changing this file impact", "where are the entry points / routes / tests",
  architecture overviews — in ~500 tokens instead of a broad grep. It is **not** a replacement for Git.
- **Beads** (`bd`) — a lightweight **issue/task tracker** with first-class dependencies. It is the
  authoritative tracker for active work, blockers, discoveries, and durable engineering insights. It is
  **not** a replacement for architecture analysis.

> One-liner: **use Codebase Memory to understand the code, use Beads to track the work.**

Installed and verified 2026-07-17 on Windows 10 / PowerShell 5.1, native (no WSL).

---

## 1. Installed versions

| Tool | Version | Backend / notes |
|---|---|---|
| Codebase Memory MCP | **0.9.0** | Prebuilt Windows amd64 binary (official DeusData release, checksum-verified) |
| Beads (`bd`) | **1.1.0** | Prebuilt Windows amd64 release (official gastownhall release, checksum-verified). Storage = **Dolt (embedded)**; the legacy SQLite backend was removed upstream. |

## 2. Installation locations

- **Codebase Memory binary:** `%LOCALAPPDATA%\Programs\codebase-memory-mcp\codebase-memory-mcp.exe`
  (a second copy at `%USERPROFILE%\.local\bin\codebase-memory-mcp.exe` is what the MCP config points to).
  Both dirs were added to the **User** PATH by the installer.
- **Beads binary:** `%LOCALAPPDATA%\Programs\bd\bd.exe` (+ a `beads.exe` alias copy). This dir was added to
  the **User** PATH manually (the release installer only warns; it does not modify PATH itself).

Neither tool needs admin rights, Docker, a database server, an API key, or any network service at runtime.

## 3. Claude Code configuration locations

Codebase Memory is configured **globally** (user scope, machine-specific absolute paths), so it applies to
every project on this machine:

- `~/.claude/.mcp.json` and `~/.claude.json` → `mcpServers.codebase-memory-mcp` (single entry, no duplicate).
- `~/.claude/settings.json` (user hooks): `PreToolUse` (Grep/Glob search-graph augmenter, non-blocking),
  `SessionStart`, `SubagentStart` → scripts in `~/.claude/hooks/cbm-*`.
- Skill: `~/.claude/skills/codebase-memory/SKILL.md` (the quick-reference / decision matrix).

Beads is configured **per-project** (this repo):

- `.claude/settings.json` → `SessionStart` hook `bd prime --hook-json` (empty matcher ⇒ fires on
  startup/resume/clear/**compact**). The pre-existing `Stop` hook (`node scripts/ai-memory/check-memory.mjs`)
  was **preserved** — beads merged, it did not overwrite.
- `CLAUDE.md` → a managed `<!-- BEGIN/END BEADS INTEGRATION -->` block (appended; the original file is intact).

## 4. Indexing behavior

- Project name (path-derived, stable): **`C-Users-moham-OneDrive-Desktop-AWTKIT`**. Pass this as `--project`
  to every CLI tool, and it is the `project` argument for the MCP tools.
- `auto_index = true`, `auto_watch = true` (`auto_index_limit = 50000`). When the MCP server is running (i.e.
  after a Claude Code restart), it re-indexes on relevant source changes. `.gitignore` **and** `.cbmignore`
  are both honored.
- Initial full index: **~8,750 nodes / ~20,500 edges in ~4s**, 0 skipped.
- Detected languages: TypeScript 302, HTML 35, Java 13, TOML 3, SQL 2, CSS 2, YAML 1.
- Packages surfaced: `runner` (core, highest fan-in), `renderer`, `main`, `src`, `oracle`, `recorder`,
  `benchmark`, `reports`, `orchestrator`, … Entry points correctly identify the Electron-main IPC registrars
  (`registerIpcHandlers`, `registerExecutionIpc`, `registerOracleIpc`, …) and `app/main/appPaths.ts`.

## 5. `.cbmignore` decisions (`/.cbmignore`, tracked)

The indexer already honors `.gitignore`; `.cbmignore` makes the intent explicit and adds a few tracked-but-
non-code assets. Key decision: **top-level runtime dirs are root-anchored** (`/reports/`, `/storage/`,
`/data/`, `/instances/`, `/profiles/`, …) because real source dirs share those names (e.g. `src/reports/`,
`app/renderer/components/reports/`, `src/storage/`) — a bare `reports/` would wrongly exclude source.

Excluded: `node_modules/`, build output (`/dist/ /out/ /build/ /release/ .vite/`), bundled runtime
(`/vendor/`, `resources/browsers/`, `resources/oracle-jdbc/{runtime,bridge,lib}/`,
`oracle-jdbc-bridge/target/`), runtime workspace (`/logs/ /temp/ /screenshots/ /downloads/ /reports/
/instances/ /storage/ /data/ /.benchmark-runtime/ /.fixtures-observability/`), test/trace output, browser
profiles/session/auth state, secrets (`.env*`), local DBs/logs/backups, design media (`/logos/`,
`UI Samples/`, `*.mp4/*.png/…`), `package-lock.json`, **`.beads/`** and **`.codebase-memory/`**.

Verified excluded at index time (23 dirs), and source dirs (`app/`, `src/`, `scripts/`, `tests/`,
`mock-site/`, `oracle-jdbc-bridge/` sources, `docs/`) are kept.

## 6. `.codebase-memory/` handling

Indexed **without** `--persistence`, so no `.codebase-memory/graph.db.zst` team artifact is produced (the
graph lives in the tool's own app-data store). `.codebase-memory/` is added to the root `.gitignore`
defensively — do **not** commit a binary graph artifact unless the team adopts an explicit sharing policy.

## 7. Beads initialization mode

- `bd init --prefix awkit --skip-agents --skip-hooks` then `bd setup claude` (deliberate, controlled).
- **Not stealth.** `.beads/` is intended to be committed (bd self-manages the policy via `.beads/.gitignore`).
- Database name `awkit`, issue IDs `awkit-<hash>` (e.g. `awkit-jz5`), hierarchical children `awkit-1yg.1`.
- Anonymous usage metrics turned **off** (`bd metrics off`). JSONL auto-export turned **on**
  (`export.auto = true`) for a git-portable record.
- `bd init` auto-created a scoped commit (`a4ce464`) of `.beads/` scaffolding + 5 `.gitignore` lines, and
  configured a Dolt remote from the git origin. **No push happened** (no upstream; auto-push disabled).

## 8. Beads files: what to commit

`.beads/.gitignore` (created by bd) already encodes the policy. **Commit** `issues.jsonl`, `config.yaml`,
`metadata.json`, `README.md`, `.gitignore`, `interactions.jsonl`. **Never commit** the Dolt store
`embeddeddolt/`, `.beads-credential-key`, runtime locks/sockets, `backup/`, `export-state.json`, `.env`.

> ⚠️ The actual issue **data** lives in the gitignored `embeddeddolt/` Dolt store. Committing `.beads/` alone
> does **not** put issues in git — that's why `.beads/issues.jsonl` (the export) is what carries task state
> across clones. A fresh clone rebuilds the DB with `bd import .beads/issues.jsonl` (or `bd bootstrap`).

## 9. Daily Claude Code workflow

**Start of a substantial task**
1. `bd prime` — load workflow context (also auto-injected by the SessionStart hook on start/resume/compact).
2. `bd ready` — pick available, unblocked work; `bd show <id>`; claim with `bd update <id> --claim`.
3. Query **Codebase Memory** before broad exploration (architecture, callers/callees, impacted files).
4. **Verify** any critical graph finding against the real source before acting on it.

**During**
5. File newly-discovered work as beads (`bd create …`), link dependencies (`bd dep <blocker> --blocks <id>`).
6. Record durable insights with `bd remember "…"` (not scattered markdown). Do not keep a parallel TODO list.

**Completion**
7. Run the relevant verifiers (`npm run build`, `npm run verify:runner`, etc.); record the result.
8. Run Codebase Memory **change-impact** (`detect_changes`) on modified files.
9. Close beads whose acceptance criteria are met (`bd close <id>`); run `bd ready` for newly-unblocked work.

## 10. Essential commands

**Codebase Memory** (CLI mirrors the MCP tools; use `--project C-Users-moham-OneDrive-Desktop-AWTKIT`):
```
codebase-memory-mcp cli get_architecture --project <p> --aspects overview
codebase-memory-mcp cli search_graph     --project <p> --query "browser launch"
codebase-memory-mcp cli trace_path        --project <p> --function-name executeScenario --direction both --depth 2
codebase-memory-mcp cli detect_changes    --project <p>          # change-impact on the working tree/branch
codebase-memory-mcp cli get_code_snippet  --project <p> --qualified-name <qn>
codebase-memory-mcp cli index_repository  --repo-path <repo> --mode full   # manual re-index
codebase-memory-mcp config get auto_index
```
(Prefer flags or `--args-file <json>`. `cli list_projects` with **no** argument blocks on stdin — pass `'{}'`.)

**Beads:**
```
bd prime | bd ready | bd status | bd list --status=open
bd show <id> | bd create "Title" --type=task -p 2 -d "why/what" | bd update <id> --claim
bd dep <blocker> --blocks <blocked> | bd close <id>
bd remember "durable insight" | bd memories <keyword> | bd export -o .beads/issues.jsonl
```

## 11. Update procedures

- Codebase Memory: `codebase-memory-mcp update -y` (or re-run the official `install.ps1`). Re-index after big
  refactors with `index_repository --mode full` (auto_watch handles incremental changes while the server runs).
- Beads: `bd upgrade` (checks/manages versions) or re-run the official `install.ps1`.

## 12. Troubleshooting

- **MCP tools not available in a session** → restart Claude Code (MCP servers load at startup). The CLI
  (`codebase-memory-mcp cli …`) works without a restart.
- **`bd` / `codebase-memory-mcp` "not recognized"** → open a **new** shell (PATH was updated at User scope),
  or call the full path under `%LOCALAPPDATA%\Programs\…`.
- **`cli list_projects` hangs** → it reads stdin with no args; pass `'{}'` or use `--args-file`.
- **Empty call graphs** → confirm the project is indexed (`index_status --project <p>`) and that `.cbmignore`
  didn't over-exclude; `trace_path` needs exact names — discover them via `search_graph --name-pattern` first.
- **`bd` says "no beads project found"** → run from the repo root (don't pass `-C` to `bd init`).
- **Beads Dolt server / lock issues** → `bd doctor` (health check + fixes), `bd ping` (connectivity).

## 13. Uninstall procedures

- Codebase Memory: `codebase-memory-mcp uninstall -y` (removes agent config), then delete
  `%LOCALAPPDATA%\Programs\codebase-memory-mcp\`, `~/.local/bin/codebase-memory-mcp.exe`, `~/.claude/.mcp.json`,
  the `cbm-*` hooks, and the skill; remove the PATH entries.
- Beads: `bd setup claude --remove`, delete `.beads/`, remove the bd PATH entry and `%LOCALAPPDATA%\Programs\bd\`,
  and revert the CLAUDE.md/`.gitignore` beads blocks.

## 14. Verification results (this setup)

- **Codebase Memory:** architecture overview, entry points, Electron main/preload/renderer boundaries,
  workflow-execution path (`executeScenario` → `PlaywrightRunner`/`FlowExecutor`/`StepExecutor`), browser-launch
  path (`SharedBrowserPool.launchBrowser`), `trace_path`, and `detect_changes` (40 changed files → 924 impacted
  symbols at depth 2) all returned real symbols. `registerOracleIpc`'s traced callees were confirmed against the
  actual `app/main/ipc/oracle.ipc.ts` imports. The live **PreToolUse Grep/Glob hook fired** during the session.
- **Beads:** full CRUD verified — create → show → claim → dep (blocking→ready confirmed) → remember/recall →
  close. `bd prime`/`bd ready`/`bd status` work; the Claude SessionStart hook + CLAUDE.md integration check as
  "current".

## 15. Division of responsibility with existing repo memory

This repo already has an AI-memory system (`MEMORY.md` auto-memory + the `Stop` hook `check-memory.mjs`, and
the `docs/ai/` handoff docs). The Beads block's phrase "do NOT use MEMORY.md" refers to **task tracking**, and
is explicitly subordinate to repo/user/orchestrator instructions. Reconciliation for this repo:

- **Beads** = active/planned/blocked work, dependencies, acceptance/verification status, and durable
  engineering insights (`bd remember`).
- **`docs/ai/` (HANDOFF, CURRENT_STATE, TASK_LOG, DECISIONS)** = the existing narrative handoff/architecture
  record — kept as-is; historical, human-facing reference.
- **`MEMORY.md` auto-memory + Stop hook** = unchanged; keep using it. Don't rip out either system.

## 16. Known limitations / remaining blockers

- The Codebase Memory **MCP server** does not load into an already-running Claude Code session — a **one-time
  Claude Code restart** is required before the `mcp__…` graph tools appear in-session. The CLI works now.
- Codebase Memory config is **global** with machine-specific absolute paths — it is not portable to teammates
  as-is (they run the installer themselves). Beads is per-project and portable via `issues.jsonl`.
- Open project work tracked in Beads: `awkit-jz5` (Oracle live-validation, **blocked** on a Docker crash-loop
  pending a Windows reboot — see `docs/ai/ORACLE_LIVE_VALIDATION_RESUME.md`) and `awkit-cm8` (the four unrun
  Oracle INTEGRATION-CANDIDATE gates — see `docs/ai/ORACLE_JDBC_VALIDATION_GATES.md`).
