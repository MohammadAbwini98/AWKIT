# ROUTING_RULES

Routing is a safety tool, not the normal development process. The default is one primary Claude
Code agent completing one task directly on `main`.

## Ordinary work

Use this loop:

1. Reason about the request and inspect only the directly affected files.
2. Decide the smallest correct change.
3. Implement it.
4. Run the narrowest meaningful verification once.
5. Inspect the final diff, commit it to `main`, then push `origin/main`.

Ordinary code, documentation, test, and configuration changes do not need a task contract, route,
lease, handoff, or subagent. The root primary is the only writer. A rejected push is the terminal
Git result: report its exact error and do not create a branch or workaround.

## Reviews and delegation

Do not call another agent automatically. One independent review is allowed only when the requester
explicitly asks for it. That reviewer neither writes nor delegates further. External-model
delegation follows the same rule.

## Protected work

The lease guard derives protected paths from the Risk-3 routing flags. These include licensing,
authentication, authorization, secrets, protected-login handoff, required migrations, signing, and
the offline boundary. A protected change must use a validated task contract and a scoped lease:

```bash
npm run agent:lease-grant -- --task awkit-xyz --holder security --paths "src/security/**"
```

While that lease is active, its scope, identity, and shell rules remain enforced. Amend it when a
protected scope genuinely grows; do not widen it informally. The contract gate and terminal
finalizer remain available for work that needs that audit trail.

## Verification and records

Run checks in proportion to the changed boundary. Record the result once as `PASS`, `FAIL`,
`BLOCKED`, `NOT RUN`, or `NOT APPLICABLE`; do not rerun an unchanged green check. Update project
state only when this task changed the fact it records. The roadmap dashboard is for tracked work,
not a prerequisite for an ordinary scoped change.

## Source of truth

`tools/agents/routing-matrix.mjs` remains the data authority for ownership and Risk-3 paths.
`ROUTING_MATRIX.md` is generated from it. `tools/agents/context-policy.mjs` is the authority for
single-agent execution and the explicit-review rule.
