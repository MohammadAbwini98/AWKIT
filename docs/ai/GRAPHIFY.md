# GRAPHIFY — code knowledge graph for AWKIT

**Status (2026-07-30):** installed, built, verified.
**Authority:** this file documents the tool. It does **not** outrank `AGENTS.md`, `docs/ai/RULES.md`,
or any other required-reading document, and the graph never outranks source code.

Graphify turns the repository into a queryable graph so agents can ask a question instead of
sweeping the tree with `Grep`/`Glob`. It complements — never replaces — the Codebase Memory MCP,
Beads, the roadmap sources, the validation ledger, the verifiers, and native repository search.

---

## 1. What is installed, and where

| Thing | Value |
|---|---|
| PyPI package | `graphifyy` (double-y) — CLI command is `graphify` |
| Version | 0.9.30, with the `[sql]` extra so `.sql` files extract |
| Install method | `uv tool install "graphifyy[sql]"` — isolated user-scoped venv |
| Tool venv | `%APPDATA%\uv\tools\graphifyy\` |
| Executables | `%USERPROFILE%\.local\bin\graphify.exe`, `graphify-mcp.exe` (on user `PATH`) |
| Project files (tracked) | `.graphifyignore`, `.claude/skills/graphify/`, `.claude/CLAUDE.md`, the `## graphify` section of `CLAUDE.md`, the `PreToolUse` hooks in `.claude/settings.json` |
| Output (gitignored) | `graphify-out/` |

**Graphify is a developer/AI tool only.** It is not an npm dependency, is never imported by app or
runner code, and is outside `electron-builder.json`'s packaging scope (which ships only `out/**`,
`package.json`, two `sql.js` files, `resources/`, `vendor/` and the zvec native host). The packaged
app depends on no Python, no `uv`, no network and no global install. Removing graphify breaks no
build and no verifier.

**Requires no API key and no network.** Extraction is local tree-sitter parsing. This build cost
**0 input / 0 output tokens**.

### Installing it on another machine

```powershell
uv tool install "graphifyy[sql]"
```
```powershell
uv tool update-shell
```
```powershell
graphify update .
```

`update-shell` puts `%USERPROFILE%\.local\bin` on the user `PATH` — restart the shell afterwards.
Without `uv`: `pipx install "graphifyy[sql]"`, or `pip install "graphifyy[sql]"` into a per-user
Python. **No administrator rights are required by any of these.** The rebuild reproduces the same
coverage from the tracked `.graphifyignore`.

---

## 2. Current graph

Built 2026-07-30 from `main` with `graphify update .`.

| Metric | Value |
|---|---|
| Nodes | **11264** |
| Edges | **22960** |
| Communities | **605** |
| Distinct source files represented | **985** — 983 of the 1141 tracked files, plus 2 added this task |
| Edge provenance | **22747 `EXTRACTED` / 213 `INFERRED`** (99% / 1%), 0 `AMBIGUOUS` |
| Token cost | 0 in / 0 out |

Outputs: `graphify-out/graph.json` (queryable graph), `graphify-out/GRAPH_REPORT.md` (audit report,
god nodes, suggested questions), `graphify-out/graph.html` (interactive; aggregated to 605 community
nodes because the graph exceeds the 5000-node viz limit).

**Community labels are hub-derived by graphify itself** — each community is named after its most
connected node (`StepExecutor`, `WorkflowProfile.ts`, `DECISIONS`, …). They are navigation aids
produced mechanically, not analysis, and `graphify update` re-derives them on every rebuild.

### Build the graph with `graphify update .`, not by hand

`graphify update .` is the canonical build here, not just the incremental one. Driving the skill's
manual pipeline by hand with no LLM key runs the AST pass only and yields a strictly smaller graph
(7817 nodes / 19734 edges / code files only). `graphify update .` additionally performs a
**structural Markdown pass** — headings, links and containment — which is where the 237 indexed `.md`
files and ~3400 extra nodes come from. Use `graphify update .`.

### Graph health (reported, not hidden)

`graphify diagnose multigraph` flagged, on the AST-only build of the same corpus:

- **1290 dangling-endpoint edges** — imports whose target was never indexed (`node_modules`,
  Node/Electron/Playwright built-ins). Expected for a repo-scoped graph; not corruption.
- **306 directed / 317 undirected collapsed edges** — several relations between the same pair of
  files (e.g. `imports_from` *and* `re_exports` between `app/main/secretStore.ts` and
  `src/secrets/SecretStore.ts`) collapse into one edge in a simple graph.
- 0 missing-endpoint edges, 0 self-loops.

Consequence: **edge multiplicity and direction are lossy.** Use the graph to find *where* to look,
then read the file to learn *what* it does.

---

## 3. What is indexed, and what is not

Full accounting against `git ls-files` (**1141 tracked files**). **983 are represented in the graph;
all 158 that are not are accounted for below — 158 of 158, nothing unexplained.**

| Bucket | Count | Detail |
|---|---|---|
| **In the graph** | **983** | `.ts` 338 · `.md` 237 · `.mts` 163 · `.tsx` 122 · `.mjs` 75 · `.ps1` 21 · `.java` 13 · `.js` 5 · `.json` 5 · `.sql` 4 · `.xml` 1 · `.cjs` 1 |
| `.html` — detected, **0 nodes** | 48 | all of `mock-site/public/**`, plus `app/renderer/index.html`, `splash.html`, `tools/roadmap/public/index.html`. Graphify classifies HTML as a document but its structural pass emits nothing for it. |
| `.json` — parsed, **0 nodes** | 41 | pure data: sample flows, mock-site fixtures, `electron-builder.json`, `tools/roadmap/assignments.json`. No symbols to emit. |
| **Unsupported by graphify** | 18 | `.css` (3), `.mdc` (5 Cursor rules), `.toml` (3 Gemini commands), `.csv` (1), `.yml` (CI), and extensionless dotfiles (`.gitignore`, `.npmrc`, `.env.example`, `.cbmignore`, `.gitattributes`) |
| Media / logos — excluded | 34 | `.png` 23, `.svg` 6, `.mp4` 3, `.ico` 1, `UI Samples/` |
| Append-only logs — excluded | 3 | `docs/ai/{TASK_LOG,CURRENT_STATE,HANDOFF}.md` |
| `.beads/` — excluded | 6 | tracker data |
| Signature material — excluded | 2 | `resources/trust/offline-manifest-public.pem`, `resources/dependency-manifest.sig` |
| Lockfile — excluded | 1 | `package-lock.json` |
| Other excluded | 5 | one-off scrapers (`capture-dribbble.mjs`, `get-videos.mjs`), `autounattend.xml`, two `00_TEMPLATE_REVIEW_FINDINGS.md` (the root one is ignored by `.gitignore` itself) |

### Markdown is STRUCTURAL only — no semantic extraction was run

The 237 indexed `.md` files contribute **document structure**: a node per file and per heading, with
`contains` and link edges. **No LLM semantic extraction has been performed.** That pass needs a
`GEMINI_API_KEY`/`GOOGLE_API_KEY` or ~13 parallel subagents over the corpus; the spend was not
authorised, so it was **not run and is not claimed**. `--allow-partial` was never used and nothing
is concealed.

To add semantic edges later: set `GEMINI_API_KEY` and run `graphify extract . --force`, or run
`/graphify .` and let the skill dispatch subagents for the doc chunks.

### What is intentionally excluded, and why

- **`docs/ai/CURRENT_STATE.md`, `HANDOFF.md`, `TASK_LOG.md`** — append-only chronological logs
  (~1.4 MB combined). Authoritative *history*, no structural value, and they change on every task,
  which would force a rebuild per commit. **Agents must still read them directly** — they are
  required reading in `AGENTS.md` and the graph never substitutes for them.
- **`.beads/`** — tracker data. `bd` is the authority for work items; a graph copy would go stale.
- **`resources/trust/offline-manifest-public.pem`, `resources/dependency-manifest.sig`** — signature
  material. Excluded as policy even though both are public artifacts.
- **`logos/`, `UI Samples/`, all raster/vector media** — no code or architecture content; indexing an
  image costs a vision pass.
- **`package-lock.json`, build output, `vendor/`, `resources/browsers/`, `.codebase-memory/`,
  `graphify-out/`** — generated or vendored.
- **`.claude/skills/graphify/`** — graphify's own vendored skill docs. AWKIT's *own* skills under
  `.claude/skills/` (`git-full-cycle`, `mock-site-maintainer`, …) stay indexed.
- **Secrets and session state** — `.env*`, `*.pem`/`*.key`/`*.p12`/`*.pfx`, `storage-state.json`,
  `session-profiles.json`, `*.har`, browser profiles, `*.sqlite`/`*.db`. Defence in depth: the same
  patterns are in `.gitignore`, so none of it is in the repo either.

**Verified after the final build: zero exclusion leaks.** A path scan of every `source_file` in
`graph.json` found nothing from `node_modules/`, `.beads/`, `logos/`, `vendor/`, `dist/`, `out/`,
`graphify-out/`, `.codebase-memory/`, `UI Samples/` or `.claude/skills/graphify/`, and confirmed the
three big logs, `package-lock.json`, `global.css`, the `.pem` and `.npmrc` are all absent. The only
file graphify's own sensitive-file heuristic flagged was `.npmrc`, which holds three npm flags
(`fund`, `audit`, `save-exact`) and no token; it is excluded regardless. **No secret and no mutable
user data entered the graph.**

### Two gaps worth remembering

1. **`app/renderer/styles/global.css`** — the entire Hologram design-token system, central to
   `docs/ai/RULES.md` › UI — is **not in the graph**: graphify does not support `.css`. Same for
   `mock-site/public/styles.css` and `tools/roadmap/public/dashboard.css`. **Use `Grep` for token and
   style questions.**
2. **The mock-site scenario pages are not in the graph.** All 48 `.html` files yield zero nodes, so
   the Feature Test Lab is reachable only through the `.mjs`/`.mts` server and verifier code that
   references it. **Use `Grep` and `mock-site/README.md` for scenario questions.**

---

## 4. How agents use it

The rule lives in `CLAUDE.md` › *graphify — graph-first code retrieval*. In short:

1. Required-reading docs first (`AGENTS.md` order) — `CURRENT_STATE`, `HANDOFF` and `TASK_LOG` are
   not in the graph at all.
2. `graphify query "<question>"` before broad `Glob`/`Grep`/repeated reads.
3. `graphify explain "<Symbol>"` for a symbol; `graphify path "<A>" "<B>"` for dependency tracing;
   `graphify affected "<X>"` for reverse impact.
4. `Read` the returned `source_file`/`source_location` before editing or asserting anything.
5. Fall back to native search whenever the graph is stale, incomplete, or unsupported.
6. Never rank a graph edge above source code, tests, Git state, or an authoritative document.

### Query recipes validated on this repo

```bash
graphify query "How does AWKIT execute a workflow?" --budget 3000
```
Returns `StepExecutor`, `FlowExecutor`, `PlaywrightRunner.runFlowWithChildren()`, `WorkflowProfile`,
`InstanceExecutionContext` — plus the Zvec architecture plan doc.

```bash
graphify explain "window.playwrightFlowStudio"
```
Resolves to the ADR at `docs/ai/DECISIONS.md:L337` ("Keep `window.playwrightFlowStudio` API
identifier"). For the *code* contract use `graphify explain "PlaywrightFlowStudioApi"`, which returns
`app/main/preload.ts:L510` and the renderer `Window` interface in `app/renderer/types/preload.d.ts`.
Both work — pick the one matching what you are asking about.

```bash
graphify path "FlowProfile" "JsonProfileStore"
```
```bash
graphify god-nodes --top 15
```

Notes from validating these:

- **Raise `--budget`.** The 2000-token default truncates on this graph — a workflow-execution query
  finds 327 nodes and shows ~26 at a 900-token budget. Truncation is announced, never silent.
- **`graphify path` is undirected.** A hop may read `A <--imports-- B`. That is connectivity, not a
  call chain.
- **Query by the name that exists.** AST nodes are named by TypeScript symbol; document nodes by
  heading text. A miss means "not indexed under that name", never "does not exist" — fall back to
  `Grep`.

---

## 5. Refresh procedure

The graph is derived. It is stale the moment code changes, and a stale graph that looks fresh is
worse than none.

**After changing code or docs — the normal case:**

```bash
graphify update .
```

Incremental, offline, no API key, no token cost; re-extracts only files whose hash changed
(`graphify-out/manifest.json` tracks them). Equivalent to `/graphify . --update` from the skill.

**After deleting or moving a lot of code**, the shrink guard refuses to overwrite a larger graph with
a smaller one. That refusal is correct — override it only when the shrink is intended:

```bash
graphify update . --force
```

**After changing `.graphifyignore`**, run `graphify update . --force` — coverage changes are not
picked up by the hash gate alone.

**When to refresh:** before relying on the graph in a new session if `main` has moved; after any task
that adds, deletes or renames files. **Do not** wire this to a git hook or a file watcher without
review — `graphify hook install` and `graphify watch` are deliberately **not** configured here (§6).

---

## 6. Coexistence with AWKIT's existing tooling

| Tool | Relationship |
|---|---|
| **Codebase Memory MCP** | Both are code graphs and both stay. Codebase Memory has richer typed queries (`trace_path`, `get_code_snippet`, Cypher) and its own `.cbmignore`; graphify is a fast local CLI needing no MCP round-trip. Use either; verify both against source. |
| **Beads (`bd`)** | Untouched. `bd` remains the only task/blocker authority. The graph tracks no work items, and `.beads/` is not indexed. |
| **Roadmap dashboard** | Untouched. Its 13 derived sources are unchanged and `tools/roadmap/assignments.json` is not a graph input. `verify:roadmap-dashboard` is 135/135, banner reads "Sources agree". |
| **Validation ledger / `DEFECTS.md`** | Untouched — not graph inputs, and the graph is never evidence for a ledger row. |
| **Verifiers / TypeScript / Playwright** | Untouched. No new npm script, so nothing to register in `scripts/lib/verifier-classification.ts`. `npm run build` is unaffected. |
| **Project skills** | Additive. `.claude/skills/graphify/` sits beside `git-full-cycle`, `mock-site-maintainer`, etc.; none were modified. |
| **Git / GitHub workflow** | Unchanged. Single-branch policy intact; **no git hooks installed** (`.git/hooks/` holds only samples), **no merge driver** configured. |
| **Native search** | Explicitly preserved as the fallback, and mandatory for `.css`, `mock-site/*.html`, the three big logs, and anything else the graph does not cover. |

### The Claude Code hooks

`graphify install --project` registered two `PreToolUse` hooks in `.claude/settings.json`:

```
Bash|Grep  ->  graphify hook-guard search
Read|Glob  ->  graphify hook-guard read
```

Reviewed and verified: **non-strict, non-blocking.** Exercised against `Grep`, `Read` and `Bash`
payloads both with and without `graphify-out/graph.json` present — every invocation exited `0` with
no output and no injected text. The existing `SessionStart` (`bd prime`) and `Stop`
(`scripts/ai-memory/check-memory.mjs`) hooks were preserved byte-for-byte; the merge was additive.

`--strict` — which blocks the first raw file read per session until a `graphify query` runs — was
**not** used and should not be: AWKIT's required-reading documents are not in the graph and must be
read first.

The hook command is written as bare `graphify`, not graphify's installed absolute path, so no
machine-specific private path is committed. If graphify is not installed the hook fails as a
non-blocking warning and every tool still runs.

---

## 7. Commit policy for graphify artifacts

`graphify-out/` is **gitignored**, same as `.codebase-memory/`:

- `graph.json` is ~10 MB and rewrites on every code change — committing it would churn the tree on
  every commit and defeat prompt caching for every agent session.
- `cost.json` is local token-cost data.
- `.graphify_python` and `.graphify_root` hold machine-specific absolute paths.
- `manifest.json` holds local mtimes; `cache/` is a machine-local AST cache.

`.graphifyignore` **is** tracked — it is index configuration, exactly like `.cbmignore`, and it is
what makes a rebuild on another machine reproduce the same coverage.

---

## 8. Limitations to keep in mind

1. **Markdown is structural only** — headings, links, containment. No semantic/LLM edges were
   extracted, so the graph will not tell you what a document *argues*, only where a heading lives.
2. **`.css` is unsupported**, so `global.css` is invisible — use `Grep`.
3. **`mock-site/*.html` produces zero nodes** — the Feature Test Lab pages are not in the graph.
4. **`.json` fixtures produce no nodes**; flow/workflow fixture *schemas* are visible only through
   the TypeScript types that describe them.
5. **Undirected paths** — connectivity, not call direction.
6. **~1290 dangling edges** to unindexed external modules.
7. **Default `--budget` truncates** on a graph this size; raise it.
8. **Nothing refreshes automatically.** No watcher, no git hook. A stale graph is silent — if a query
   result disagrees with the working tree, trust the tree and run `graphify update .`.
