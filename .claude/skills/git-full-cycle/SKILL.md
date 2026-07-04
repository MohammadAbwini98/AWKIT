---
name: git-full-cycle
description: Safely run the full Git lifecycle in AWKIT — inspect status, protect in-flight work, branch, commit, push, open PRs, handle protected main, and manage stacked PRs. Read before any Git operation.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(git *), Bash(gh *), Bash(node *), Bash(npm run *)
---

# Git Full Cycle Skill

Use this skill when the user asks an agent to inspect Git status, protect existing work, create branches, pull/fetch, commit, push, open pull requests, handle stacked PRs, or prepare a safe merge/review workflow.

This skill is designed for Claude Code, Codex, Gemini, or any coding agent working inside the AWKIT repository or another Git repository.

---

## 1. Purpose

The goal is to handle the complete Git cycle safely:

1. Inspect repository state.
2. Protect uncommitted work.
3. Sync with remote.
4. Create or switch branches.
5. Stage and commit only intended files.
6. Push branches safely.
7. Open or prepare pull requests.
8. Handle protected branches and stacked PRs.
9. Verify PR scope before merge.
10. Keep the working tree clean for the next task.

The skill must prevent accidental loss of work, mixed-scope commits, accidental pushes to protected branches, and unclear pull request diffs.

---

## 2. When to Use This Skill

Use this skill when the user asks for any of the following:

- Check Git status.
- Commit current changes.
- Save in-flight work.
- Pull latest changes.
- Push a branch.
- Create a feature branch.
- Open a PR.
- Prepare PR title/body.
- Review PR scope.
- Fix stacked PRs.
- Handle protected `main` / `master`.
- Separate unrelated work into multiple commits or branches.
- Clean up before starting a new feature.
- Confirm a branch is safe to merge.

Do not use this skill for non-Git tasks unless Git safety is part of the task.

---

## 3. Non-Negotiable Safety Rules

Always follow these rules:

1. Never discard, reset, checkout, or overwrite user changes unless the user explicitly approves the exact command.
2. Never force-push unless the user explicitly approves it. Prefer `--force-with-lease` if force push is approved.
3. Never commit unrelated changes into a feature commit.
4. Never push directly to `main` if branch protection exists or if the user did not explicitly approve direct push.
5. Always inspect the working tree before staging.
6. Always show what will be committed before committing.
7. Always verify branch and upstream before pushing.
8. Always verify PR diff scope before asking the user to merge.
9. If `main` is protected, use PRs instead of direct push.
10. If a feature branch includes unrelated earlier commits, use stacked PRs or rebase only with approval.

---

## 4. Required Initial Inspection

Start every Git cycle with:

```bash
git status --short
git branch --show-current
git remote -v
git log --oneline --decorate --graph -10
```

Then inspect changed files:

```bash
git diff --stat
git diff --name-only
git diff --cached --stat
git diff --cached --name-only
```

If there are uncommitted files, classify them before doing anything:

- Existing in-flight work.
- Current requested task work.
- Generated files.
- Documentation-only changes.
- Test/report/log/build artifacts.
- Unknown or risky files.

If classification is unclear, pause and ask the user.

---

## 5. Sync Rules

Before starting new work, sync safely:

```bash
git fetch origin --prune
```

Do not blindly run `git pull` on a dirty tree.

If the current branch is clean and tracking a remote branch, inspect divergence:

```bash
git status -sb
git log --oneline --left-right --cherry-pick HEAD...@{u}
```

If the branch is behind and clean, pull using fast-forward only:

```bash
git pull --ff-only
```

If fast-forward is not possible, pause and ask before merge/rebase.

---

## 6. Branching Rules

Use a dedicated branch for each logical scope.

Recommended branch names:

```text
feature/<short-feature-name>
fix/<short-bug-name>
chore/<short-maintenance-name>
docs/<short-doc-name>
test/<short-test-name>
```

Before creating a branch:

```bash
git fetch origin --prune
git switch main
git pull --ff-only
```

Then:

```bash
git switch -c feature/<name>
```

If `main` has local commits that are not on `origin/main`, check whether `main` is protected. If protected, do not push `main` directly. Use a chore branch and stacked PRs.

---

## 7. Handling Dirty Working Trees

If the tree is dirty before starting a new task, do not mix the new task with existing work.

Recommended options:

### Option A — Commit in-flight work first

Use when the existing changes are valid and belong together:

```bash
git switch -c chore/save-inflight-work
git add <intended files>
git diff --cached --stat
git commit -m "Save in-flight work"
```

Then branch from a clean base for the new task.

### Option B — Stash in-flight work

Use only when the changes should not be committed yet:

```bash
git stash push -u -m "in-flight work before <task>"
```

Only apply the stash later after confirming the target branch:

```bash
git stash list
git stash show --stat stash@{0}
git stash apply stash@{0}
```

### Option C — Pause and ask

Use when files are risky, unrelated, generated, or unclear.

Never use `git reset --hard`, `git clean -fd`, or `git checkout -- <file>` without explicit user approval.

---

## 8. Staging Rules

Prefer targeted staging over `git add .`.

Use:

```bash
git add path/to/file1 path/to/file2
```

For careful partial staging:

```bash
git add -p
```

Before committing, always run:

```bash
git diff --cached --stat
git diff --cached --name-only
git diff --cached
```

If the staged diff contains unrelated files, unstage them:

```bash
git restore --staged <file>
```

---

## 9. Commit Rules

Use clear, scoped commit messages.

Recommended format:

```text
<type>: <short description>
```

Types:

```text
feat:     new feature
fix:      bug fix
chore:    maintenance, tooling, repository setup
docs:     documentation only
test:     tests only
refactor: behavior-preserving code change
perf:     performance improvement
build:    build/dependency/configuration change
ci:       CI workflow change
```

Examples:

```bash
git commit -m "feat: add smart wait engine runtime waits"
git commit -m "fix: resolve duplicate locator matches using visible candidate"
git commit -m "chore: save in-flight recorder docs work"
```

After committing:

```bash
git status --short
git log --oneline --decorate -5
```

---

## 10. Verification Before Push

Before pushing any branch, run project-appropriate checks.

For AWKIT, prefer:

```bash
npm run verify:recorder
npm run verify:runner
npm run build
```

If a task touches tests, run the relevant test command too.

If checks fail, do not push as complete unless the user explicitly asks for a work-in-progress push. Report failures clearly.

---

## 11. Push Rules

Before push:

```bash
git status --short
git branch --show-current
git log --oneline origin/<base-branch>..HEAD
```

Push current branch:

```bash
git push -u origin <branch-name>
```

Do not push `main` directly if it is protected or PR-only.

If push is rejected because the remote has moved:

```bash
git fetch origin --prune
git status -sb
git log --oneline --left-right --cherry-pick HEAD...origin/<branch-name>
```

Then ask before rebasing or merging.

---

## 12. Pull Request Rules

Every PR should have a focused scope.

Before opening a PR:

```bash
git fetch origin --prune
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
```

Verify the PR contains only the intended commits and files.

### PR Title Format

```text
<Feature or fix name in plain English>
```

Examples:

```text
Smart Locator Engine targeted runtime fallback
Smart Wait Engine recorder and runner support
Multi-Window Popup Flow Handling
Protected Popup Manual Handoff integration
```

### PR Body Template

```markdown
## Summary

- <bullet 1>
- <bullet 2>
- <bullet 3>

## Verification

- [ ] npm run verify:recorder
- [ ] npm run verify:runner
- [ ] npm run build

## Notes

- <limitations, compatibility notes, or follow-up work>
```

If GitHub CLI is installed and authenticated:

```bash
gh pr create \
  --base main \
  --head <branch-name> \
  --title "<title>" \
  --body-file scratchpad/pr-body.md
```

If `gh` is not installed, provide a manual URL:

```text
https://github.com/<owner>/<repo>/pull/new/<branch-name>
```

Tell the user:

```text
Base: main
Compare: <branch-name>
Title: <title>
Body: <path or markdown body>
```

---

## 13. Protected Main and Stacked PRs

If `main` is protected and local `main` contains a commit that a feature branch depends on, do not force anything.

Use stacked PRs.

Example:

```text
main is protected.
feature/smart-locator-engine contains:
- 46fc59a Save in-flight recorder initialization and docs work
- adb815c Smart Locator Engine targeted runtime fallback
```

Create two PRs:

```text
PR #1:
Base: main
Compare: chore/save-inflight-recorder-work
Contains: 46fc59a

PR #2:
Base: main
Compare: feature/smart-locator-engine
Initially contains: 46fc59a + adb815c
After PR #1 merges: only adb815c
```

Tell the user:

```text
Do not merge PR #2 before PR #1.
After PR #1 merges, re-check PR #2 scope.
```

After PR #1 merges, verify:

```bash
git fetch origin --prune
git switch feature/smart-locator-engine
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
```

Expected:

```text
Only the feature commit remains in the PR diff.
```

Note: a squash or rebase merge of PR #1 rewrites its SHA, so `origin/main` will not
literally contain `46fc59a`. Confirm scope by the diff (`git diff --stat origin/main..HEAD`
shows only the feature files) and by the authoritative remote tip
(`git ls-remote origin refs/heads/main`), not by the old SHA.

---

## 14. Rebase and Merge Rules

Do not rebase shared branches without user approval.

Safe update after base branch changes:

```bash
git fetch origin --prune
git switch <feature-branch>
git rebase origin/main
```

Only do this when:

- The user approves rebase, or
- The branch is clearly owned by the current user/agent and not shared.

If conflicts occur:

1. Stop and summarize conflicted files.
2. Resolve only files related to the task.
3. Run tests.
4. Continue rebase:

```bash
git rebase --continue
```

Abort only with approval:

```bash
git rebase --abort
```

---

## 15. Merge Readiness Checklist

Before telling the user a PR is ready to merge:

```bash
git fetch origin --prune
git status --short
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
npm run verify:recorder
npm run verify:runner
npm run build
```

Confirm:

- Working tree is clean.
- PR contains only intended commits.
- PR contains only intended files.
- Verification passed.
- Known limitations are documented.
- No unrelated generated artifacts are included.

---

## 16. Post-Merge Cleanup

After a PR is merged:

```bash
git fetch origin --prune
git switch main
git pull --ff-only
```

Delete local branch if no longer needed:

```bash
git branch -d <branch-name>
```

Delete remote branch if the platform did not delete it automatically:

```bash
git push origin --delete <branch-name>
```

Then start the next feature from clean `main`:

```bash
git switch -c feature/<next-feature>
```

---

## 17. Required Agent Response Format

When reporting Git actions, use this format:

```markdown
## Git Status

- Branch: `<branch>`
- Working tree: clean/dirty
- Remote tracking: `<upstream>`

## Changes

- Files changed: <count>
- Commits ahead of base:
  - `<hash>` <message>

## Verification

- `npm run verify:recorder`: passed/failed/not run
- `npm run verify:runner`: passed/failed/not run
- `npm run build`: passed/failed/not run

## Push / PR

- Pushed branch: yes/no
- PR URL/manual link: <url>
- Base: `main`
- Compare: `<branch>`

## Notes

- <risks, limitations, or next step>
```

Be explicit about commands not run.

---

## 18. Common Decision Guide

### User asks: "Can you start the next feature?"

Do:

```bash
git status --short
git fetch origin --prune
git switch main
git pull --ff-only
git switch -c feature/<next-feature>
```

Only proceed if the tree is clean.

### User has uncommitted files on main

Do not start feature work directly.

Ask whether to:

1. Commit in-flight work.
2. Stash it.
3. Analyze only.

### Feature PR includes unrelated commit

If main is protected, use stacked PRs.

### `gh` is missing

Prepare the PR manually and provide:

```text
https://github.com/<owner>/<repo>/pull/new/<branch>
```

### Tests fail

Do not hide it. Report:

- command
- failure summary
- likely cause
- files involved
- recommended next step

---

## 19. AWKIT-Specific Defaults

For AWKIT, use these defaults unless the user says otherwise:

- Base branch: `main`
- Feature branches: `feature/<name>`
- Chore branches: `chore/<name>`
- Verification before PR:
  - `npm run verify:recorder`
  - `npm run verify:runner`
  - `npm run build`
- Do not start Smart Wait Engine on top of Smart Locator Engine branch unless explicitly requested.
- Keep Smart Locator, Smart Wait, Popup Handling, and Manual Handoff in separate PRs.
- Do not add UI diagnostics into core runtime PRs unless explicitly requested.

---

## 20. Final Rule

The Git cycle is complete only when:

1. The working tree is clean.
2. The branch has been pushed or intentionally left local.
3. The PR link or manual PR instructions are provided.
4. The PR scope has been verified.
5. The user knows the next safe action.
