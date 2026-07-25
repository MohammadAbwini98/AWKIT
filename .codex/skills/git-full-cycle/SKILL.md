---
name: git-full-cycle
description: Run the Git lifecycle in AWKIT under the single-branch continuous-implementation policy — inspect status, commit coherent progress to main, consolidate leftover branches, and push when permitted. Read before any Git operation.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(git *), Bash(gh *), Bash(node *), Bash(npm run *)
---

# Git Full Cycle Skill

**Authority: `docs/ai/BRANCH_AND_COMMIT_POLICY.md`.** This skill implements it. If they ever
disagree, the policy wins.

**Owner directive (2026-07-25):** AWKIT develops on ONE branch, `main`, with continuous commits.
This replaced the previous branch-per-scope / stacked-PR / freeze-until-approved workflow.

---

## 1. Non-negotiable rules

1. **`main` is the only development branch.** Never create `feature/*`, `fix/*`, `chore/*`,
   `docs/*`, `test/*`, `spike/*`, `backup/*`, `archive/*`, or `agent/*` branches.
2. **Never create a worktree for normal work.** Remove any tool-created temporary worktree as soon
   as its operation finishes.
3. **Never freeze.** Incomplete work, failing tests, pending validation, an unavailable environment,
   or an unreviewed checkpoint are NOT reasons to withhold a commit or stop implementing.
4. **Never discard user work.** No `reset --hard`, `clean -fd`, or `checkout -- <file>` over
   uncommitted changes without explicit approval.
5. **Never hide a failure.** Commit the failing state with a truthful message; never call an
   unexecuted or failing gate "passed".
6. **Never commit secrets** or generated artifacts (`dist/`, `out/`, `node_modules/`, runtime DBs,
   credentials, packaged binaries).
7. **Never force-push or rewrite shared history** without explicit owner approval.
8. **Never force-delete a branch** whose unique commits are not already on `main` or in a tag.

---

## 2. Start of any Git work

```bash
git status --short
git branch --show-current
git log --oneline --decorate -10
git diff --stat
```

If the tree is dirty: classify the changes and commit the coherent ones to `main` in scoped
commits. Do not branch, do not stash by default, do not ask permission to commit.

---

## 3. Committing

Commit after each coherent step. Message format:

```text
<type>(<scope>): <short description>
```

Types: `feat`, `fix`, `wip`, `test`, `docs`, `build`, `chore`, `refactor`, `perf`, `ci`.

Stage explicitly (`git add <paths>`), review with `git diff --cached --stat`, then commit.

For an incomplete or failing checkpoint the message must record: what works, what is incomplete,
the exact failing command, whether the cause is code / environment / test harness, and the next
step. Example:

```text
wip(semantic): host manager skeleton; restart policy not implemented

Works: fork + ready handshake + request deadlines.
Incomplete: circuit breaker, generation reconciliation.
Failing: npm run verify:zvec-host-lifecycle (3/11) - harness gap, not product.
Next: implement bounded restart window.
```

---

## 4. Verification

Run what is relevant before and after meaningful changes:

```bash
npm run build            # tsc --noEmit + bundles
npm run verify:runner    # runner/orchestrator changes
npm run validate:offline # offline/packaging changes
```

A failure does not block the commit. Commit the reproducible state, record the result truthfully in
`docs/ai/CURRENT_STATE.md` and `docs/ai/TASK_LOG.md`, and keep fixing on `main`.

---

## 5. Pushing

```bash
git push origin main
```

Pull requests are optional review records. **Never create a branch just to open a PR.**

If branch protection rejects the push, report the exact error verbatim and continue committing
locally on `main`. Do not create replacement branches. Example of the real error in this repo:

```text
GH013: Repository rule violations found for refs/heads/main.
- Changes must be made through a pull request.
```

Only the owner may change protection or authorise a temporary integration mechanism.

---

## 6. Consolidating leftover branches

Inventory, then for each branch: commit its uncommitted work, tag the tip
(`archive/<sanitized-name>-YYYYMMDD`), integrate unique commits into `main`, resolve conflicts on
`main`, run relevant tests, close any superseded PR factually, and delete the branch.

**Ordering constraint:** if `main` cannot be pushed, do NOT delete remote branches yet — a remote
branch may be the only remote copy of that work. Delete remote branches only after `origin/main`
contains the integration. Local deletion is safe once the content is on local `main` and tagged.

```bash
git branch -d <branch>              # -D only when the tip is tagged and content verified on main
git push origin --delete <branch>   # only after origin/main has the integration
git worktree remove <path>; git worktree prune
```

---

## 7. Reporting format

```markdown
## Git Status
- Branch: `main`   HEAD: `<sha>`   Working tree: clean/dirty

## Commits created
- `<sha>` <message>

## Verification
- `npm run build`: passed/failed/not run
- `<verifier>`: N passed, M failed / not run (reason)

## Push
- Pushed: yes/no (exact error if rejected)

## Consolidation
- Branches integrated / tagged / deleted; worktrees removed

## Next step
- <the next implementation step>
```

Be explicit about commands not run.

---

## 8. AWKIT defaults

- Base and only branch: `main`
- Verification: `npm run build`, `npm run verify:runner`, `npm run validate:offline`
- Do not run `bd dolt push` unless the owner explicitly asks; ordinary commits and `.beads` file
  updates are not frozen.
