# ROUTING_RULES

How a task moves through AWKIT's deterministic routing system.

`ROUTING_MATRIX.md` is the **data** — who owns what, which flags activate whom, how risk is computed
— and it is generated from `tools/agents/routing-matrix.mjs`. This file is the **process**, and it is
hand-written because a process is not a table.

> **Not yet automatic.** Phases 0–4 give the system its registry, classifier, router, validator and
> an enforced write lease. Executable per-platform agent definitions (`.claude/agents/*.md`, Codex
> and Gemini adapters) are **Phase 5, deliberately deferred** until the routing model has been proven
> on real tasks. Today a single agent follows these rules and the lease guard enforces the part that
> can be enforced.

---

## 1. Classify before you start

Write the classification into the contract **before** implementation. It drives routing, and routing
has to happen before the work does.

Only the flags in `ROUTING_MATRIX.md` count. An unknown key is rejected rather than ignored — a
contract carrying `persistance_change` would otherwise route as though persistence were untouched
while reading, to a human, as though it had been declared.

```bash
npm run agent:lease
```

Risk is **computed**, never chosen. A contract may declare a higher level than computed (caution is
free); it may never declare a lower one.

## 2. Route

The router turns a classification into a set of agents, an ordered writer sequence, and a rationale
naming the trigger for each activation. It is a pure function: identical input, identical output.

A task touching several domains is a **sequence of leases**, not a committee. One writer at a time is
not a preference on a `main`-only repository — it is the only thing standing between two concurrent
specialists and a working tree neither can reason about.

QA is a *sequential* lease holder, not a concurrent one. The implementation writer commits and
releases; QA then acquires a lease over `tests/**`, `mock-site/**` and `scripts/verify-*`. The
reviewed proposal granted QA write paths while also declaring one lease — those cannot both be true.

## 3. Hold the lease

```bash
npm run agent:lease-grant -- --task awkit-xyz --holder frontend --paths "app/renderer/**"
```

A lease is a **budget**, so it is scoped to what the task actually expects to touch rather than to
everything its holder owns. That is what makes an amendment happen at the moment scope really grows.

While a lease is active, `tools/agents/lease-guard.mjs` runs as a `PreToolUse` hook on
`Edit|Write|NotebookEdit` and blocks writes outside it.

### Two limitations, stated rather than hidden

1. **No active lease means ordinary edits are allowed — but not everywhere.** Failing closed on every
   path would block every task that does not go through a contract, and a gate that stops all work
   gets removed rather than obeyed. So ordinary paths stay unrestricted, and **protected paths do
   not**: licensing, auth, secrets, authorization, and the offline boundary refuse an unclaimed
   write outright. That set is *derived* from the risk model — anything whose implied classification
   is already Risk 3 — so it extends automatically rather than drifting from a second hand-kept list.
   The remaining gap closes at the other end: the completion gate requires a contract for any task
   that changed product code.
2. **`Bash` writes are detected, not prevented.** A shell redirect or `git checkout` never reaches
   an `Edit` matcher, and widening the hook to `Bash` would mean parsing arbitrary shell to guess at
   write intent — unreliable in both directions, missing `python -c "open(...)"` while blocking
   `echo "a > b"`. Instead a **PostToolUse audit** on `Bash` observes the filesystem: it asks git
   what is dirty and subtracts the lease scope, shared paths, and the set already dirty when the
   lease was granted. Whatever remains is named immediately and recorded onto the lease, where the
   completion gate reads it back.

   The write has already happened by then — this converts an invisible bypass into an attributable
   one, not into prevention. It costs ~100ms per `Bash` call while a lease is held, and nothing at
   all when none is.

   **Gitignored paths** need a second mechanism, because `git status` never reports them and
   enumerating them all would mean walking `node_modules/`. Most of them genuinely do not matter —
   `out/`, `dist/`, `graphify-out/` and the logs are derived. The ones that do (secrets, captured
   auth state, the local permission file, and the ignored subtrees inside the protected offline
   boundary) are listed in `WATCHED_IGNORED_PATHS` and fingerprinted by mtime and size at lease
   grant. Anything outside that list stays unwatched by design.

   If it fires, do not delete the file quietly. Either revert the path or amend the lease so the
   recorded scope is honest.

Neither is a reason to skip the gate. Both are reasons not to call it airtight.

### Shared write paths

Some files are genuinely owned but carry their risk in specific keys. `package.json` is release-owned
because it holds the dependency graph — yet it also holds the npm script inventory, and requiring a
full lease handoff to add a one-line `verify:*` script was measured ceremony that bought nothing.

For those paths the edit-time gate is **relaxed**, because it runs before the edit and cannot see
which key is changing. The enforcement moves rather than disappearing: `deriveGuardedFieldChanges()`
compares the committed file against the working tree, and a change to any non-shared field is a scope
escape that blocks completion.

```bash
node -e "import('./tools/agents/classify.mjs').then(m=>console.log(m.findGuardedFieldEscapes(['manager','qa'])))"
```

`sharedFields` is an allow-list, so a top-level key nobody listed is guarded automatically. Adding a
script is free; touching `dependencies` still requires the Release specialist and is reported if it
happens without them.

## 4. When scope grows — amend, never work around

Discovering that the work is bigger than declared is normal. Hiding it is not.

```bash
npm run agent:lease-amend -- --add "src/storage/**" --reason "Persistence impact discovered"
```

An amendment **re-runs routing**. Two outcomes:

- **Extended** — the added paths are still yours. The lease widens and the amendment is logged with
  its reason.
- **Rerouted** — the added paths belong to someone else. The lease is **released, not widened**, and
  the CLI names the specialist who owns them. Commit what you have, then grant the next lease.

That second outcome is the point. Adding `src/storage/**` to a `frontend` lease does not quietly
turn frontend into a persistence engineer; it makes the change a persistence change, which makes the
Persistence specialist mandatory. Specialization survives contact with surprise.

### Emergency override

Rare recovery only. Narrow, logged, and it forces QC:

```json
"overrides": [{
  "timestamp": "2026-08-16T00:12:00+03:00",
  "reason": "Repository repair after malformed generated state",
  "affected_paths": ["tools/roadmap/assignments.json"],
  "qc_required": true
}]
```

`verify:agent-routing` rejects an override with no reason, no affected paths, `qc_required: false`,
or a forced QC that never resolved to `APPROVED`. There is deliberately **no environment-variable
bypass** — one keystroke, invisible afterwards, leaving no trace that scope grew.

## 5. Prove it, then check what you actually touched

Declare evidence **before** implementation. Evidence chosen afterwards tends to be evidence that
passes.

Statuses are the validation ledger's own — `PASS | FAIL | BLOCKED | NOT RUN | NOT APPLICABLE`. There
is no `INCONCLUSIVE`; an inconclusive check is `NOT RUN` with a reason. `BLOCKED`, `NOT RUN` and
`FAIL` are not `PASS`, and development-tree evidence never substitutes for packaged evidence.

At least one evidence item must be `required: true`. A list where everything is optional makes the
completion gate vacuous — `.every()` over an empty filtered array returns true, which is how a gate
comes to pass hardest when nothing was proven.

Then compare declared against **derived**:

```bash
node -e "import('./tools/agents/classify.mjs').then(m=>console.log(m.deriveClassification(m.changedFiles())))"
```

Derived classification is computed from `git diff --name-only` through the path map. Declared is a
prediction; derived is a measurement. A domain in `derived` that the contract never activated is a
**scope escape**, and any unresolved escape blocks completion.

## 6. Complete

`completionBlockers()` returns the reasons a task may not be marked complete: an invalid contract,
any required evidence not `PASS`, `qa_status` not `PASS`, unresolved QC when QC is a reviewer, or an
unresolved scope escape.

Then finish the normal `AGENTS.md` end-of-task checklist. The contract is execution mechanics; Beads
remains the work, status and dependency source, and the Program Status dashboard remains derived
from the sources it already reads.

---

## Changing the rules

Edit `tools/agents/routing-matrix.mjs`, then:

```bash
npm run agent:render-docs
```

```bash
npm run verify:agent-routing
```

Never hand-edit `ROUTING_MATRIX.md`. The verifier re-renders it and compares byte-for-byte, because
the reviewed proposal stated its routing rules in three places that had already drifted into
disagreement before anyone implemented them.
