# Branch and Commit Policy

**Owner directive:** 2026-07-25
**Canonical development branch:** `main`
**Applies to:** every human developer and AI coding agent in this repository

**Supersedes** all earlier instructions requiring feature-per-branch workflows, frozen worktrees,
archival branches, approval checkpoints before commits, stacked PRs, or stopping implementation
because a validation gate is incomplete.

---

## 1. One canonical branch

All implementation, tests, documentation, packaging, plans, reports, and agent-memory updates are
committed to `main`.

**Do not create** `feature/*`, `fix/*`, `chore/*`, `docs/*`, `test/*`, `spike/*`, `backup/*`,
`archive/*`, or `agent/*` branches. Do not create a branch per phase or tranche, and do not create
stacked PR branches.

**Do not create new Git worktrees for normal project work.** A tool-created temporary worktree is
acceptable only while an operation is actually executing, and must be removed immediately after.

### Pull requests

Pull requests are optional review records, not a development boundary.

- Commit and push directly to `main` when repository permissions allow.
- Never create another branch solely to open a PR.
- Use commit review, compare links, tags, release notes, or commit comments for review.
- If branch protection rejects a direct push, **report the exact error and continue committing
  locally on `main`.** Do not invent replacement branches. The owner may later adjust protection or
  authorise one temporary integration mechanism.

---

## 2. Continuous commits

Commit after each coherent implementation step: partial foundations, test harnesses, packaging
changes, investigation findings, documented blockers, failing-test reproductions, migrations,
refactors, recovery checkpoints. Do not leave valuable implementation uncommitted for long periods.

### Incomplete and failing states are committable

A failure does not prohibit committing. Use truthful scoped messages:

```text
wip:   add Zvec utility host lifecycle foundation
test:  reproduce packaged native-host resolution failure
fix:   confine semantic generations to runtime root
build: stage Zvec native host for offline packaging
docs:  record inconclusive NSIS validation
```

For an incomplete or failing checkpoint, record what works, what remains incomplete, the exact
failed commands, whether the failure is code / environment / test-harness related, and the next
implementation step.

**Never label an unexecuted or failing gate as passed.**

### Verification timing

Run relevant verification before and after meaningful changes when practical. A failed verifier does
not freeze implementation: commit the reproducible state, keep fixing on `main`, and update
`CURRENT_STATE.md` and `TASK_LOG.md`. Release gates block *release promotion claims*, never
development or commits.

### Dirty working tree

Do not branch or stash merely because the tree is dirty. Classify the changes, commit coherent work
to `main` in scoped commits, keep generated artifacts ignored, and continue. **Never discard user
work.**

---

## 3. No artificial freeze

Do not stop implementation because a phase is incomplete, a validation is pending, tests fail, a
package cannot be launched here, a clean machine is unavailable, an installer test is pending,
another task or PR exists, the tree is dirty, documentation is untracked, Beads status is stale, a
checkpoint is unreviewed, or a previous instruction said "freeze" / "wait for approval".

Instead: preserve state with a commit, document the exact status, continue everything that can be
done safely, implement solutions for the blocker, and leave only genuinely impossible external steps
marked `NOT RUN`, `INCONCLUSIVE`, or `ENVIRONMENTALLY BLOCKED`.

### Interrupting one specific command

A specific command may be replaced or avoided when it would destroy uncommitted work, expose or
commit a secret, delete user data, modify a production system without authorisation, bypass
authentication / MFA / CAPTCHA / access control / endpoint protection, or perform an irreversible
external action without required credentials.

This is never permission to freeze the project. Choose a safer method and continue.

---

## 4. Consolidating existing branches and worktrees

Inventory local branches, remote branches, worktrees, and open PRs. For each, record tip SHA,
relationship to `main`, unique commits, dirty state, PR status, and the action required.

For every branch or worktree:

1. Commit its uncommitted source, tests, and documentation first.
2. Never commit generated `dist` / `out` / `node_modules`, runtime databases, credentials, or large
   package artifacts.
3. Tag the tip before deletion when traceability is useful:
   `archive/<sanitized-branch-name>-YYYYMMDD`. Tags are historical references, not branches.
4. Integrate unique commits into `main` by fast-forward, merge commit, cherry-pick, or manual
   application — whichever is safest for that content.
5. Resolve conflicts on `main` and commit each logical resolution.
6. Run relevant tests and record truthful results.
7. Close superseded PRs with a factual comment. Never open a replacement or stacked PR.
8. Delete the resolved branch and prune the worktree.

**Never force-delete a branch whose unique commits are not preserved** on `main` or in a tag.

### Ordering constraint when `main` cannot be pushed

If branch protection prevents pushing `main`, **do not delete remote branches yet.** Until the
integration exists on `origin/main`, a remote feature branch may be the only remote copy of that
work. Delete remote branches only after `origin/main` contains the integrated result. Local deletion
is safe once the content is on local `main` and tagged.

Target end state: `main` is the only active development branch, with no extra worktrees.

---

## 5. Safety and truthfulness

This policy removes process freezes, not engineering honesty. Always:

- never discard uncommitted work;
- never commit secrets;
- never hide a failing test;
- never claim an unexecuted gate passed;
- never bypass protected-login or security controls;
- never perform an unauthorised production action;
- never force-push or rewrite shared history without explicit owner approval;
- never delete an unresolved branch with unique unpreserved work.

When a safe command is unavailable, commit the current state, document the limitation, and continue
with all other work.
