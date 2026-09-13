# Handing this extraction to Claude Design

**Read [`README.md`](README.md) first.** This file answers one narrower question: *how do the six
documents in this directory actually reach Claude Design, and what should come back?*

---

## What to hand over

The whole directory, unmodified. It is already in the form this project has always used to
exchange material with Claude Design — a plain file package, not a tool integration.

| File | Size | What it gives the design pass |
|---|---|---|
| `README.md` | 8.5 KB | Purpose, reading order, and the twelve hard constraints |
| `01-app-shell.md` | 10.1 KB | Window chrome, shell grid, navigation, header, status bar |
| `02-design-tokens.md` | 17.1 KB | Every token + the runtime accent-override contract |
| `03-pages.md` | 18.7 KB | All 33 routes by layout family, with permission gates |
| `04-components.md` | 41.6 KB | All 98 exported components: path, props, CSS class hooks |
| `05-patterns.md` | 32.9 KB | Loading / empty / error / dirty / disabled / focus, motion, a11y |

About 129 KB of Markdown. None of it is generated or derived — it was read out of the renderer at
commit `28fb9fb`, and it deliberately proposes nothing.

## What should come back

Per `README.md` § "How to use this set for a redesign", the primary deliverable is a **token
mapping**: a new value for each existing token name in `02-design-tokens.md`. That alone re-skins
most of the application, because there is exactly one stylesheet and every rule reads through
`var(--awkit-*)`.

A redesign that renames class hooks, adds a second stylesheet or a utility framework, or hardcodes
colour is a far larger and riskier change — several hooks are matched by end-to-end test helpers and
by `data-testid`. Constraints 1–12 in `README.md` are not style preferences; each is enforced
somewhere in the repository, and breaking one produces a defect rather than a disagreement.

The two easiest to break by accident:

- **Violet is accent-only** (constraint 3). It must never return as a canvas, surface or border
  colour — that is what previously made the whole application read as a purple wash.
- **`--awkit-success` and `--awkit-success-text` must not be collapsed** (constraint 10). `#14a46c`
  is 3.20:1 on white, below AA for text, which is the entire reason the second token exists.

---

## Transport: three routes, one of which works today

### 1. Hand over the directory — works, and it is the precedent

Point Claude Design at `docs/design-system-extraction/`. This is how Claude Design material has
always moved through AWKIT: the previous renderer migration was driven by a file package dropped
into the working tree (untracked, owner-machine only), not by a tool integration. The extraction is
already in exactly that shape, so no conversion step is needed.

### 2. The Claude Design canvas preview bundled with Claude Code — blocked in a remote container

Assembling a canvas means running a helper script that lives outside this repository. AWKIT's
write-lease guard refuses that under **every** role, not merely when no lease is held:
`isAllowedActiveShellCommand` in `tools/agents/lease-guard.mjs` admits exactly four `node`
invocations across all roles, and every one of them is a repository-relative path —

- `node --check <repo-relative file>` (absolute paths are rejected explicitly),
- `node tools/agents/task-gate.mjs docs/ai/contracts/<task>.json`,
- `node tools/agents/render-docs.mjs --write`,
- `node tools/agents/render-platform-agents.mjs --write`.

An out-of-repo script is in no role's set, so taking a lease does not help. Nothing was seeded and
nothing was published. Do not spend another session rediscovering this — on a developer machine
outside the lease guard, the route is available normally.

### 3. `DesignSync` into a claude.ai/design project — needs a one-time interactive login

This route uploads from disk and needs no shell at all, so the lease guard is not the obstacle. It
refused with, verbatim:

> DesignSync needs design-system authorization, and /design-login cannot run in this
> non-interactive session. Ask the user to run /design-login once from an interactive Claude Code
> session on this machine — headless and SDK runs here then reuse that authorization. If this is
> claude.ai/code, ask them instead to use Claude Design's "Send to Claude Code Web" (which seeds the
> project into the workspace) or to provide the project files directly.

So: run `/design-login` once from an **interactive** Claude Code session on the machine that will do
the design work, and this route opens for every later session on that machine.

---

## After a redesign lands

The extraction itself needs no verification — it is documentation and touches no source. A redesign
applied *from* it does:

- `npm run build` (`tsc --noEmit` + bundles) must pass.
- Check light and dark, all three theme states, and a non-default accent — twelve accent tokens and
  nine gradient tokens are overwritten as inline custom properties on `<html>` at runtime.
- Check `prefers-reduced-motion` still neutralises the spring easings (constraint 9).
- Re-check the four canvas routes (`flowChart`, `scenarioBuilder`, `workflow`, `formDesigner`): a
  transform or layout shift on a canvas ancestor breaks node hit-testing (constraint 7).
