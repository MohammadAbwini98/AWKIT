# Local Agent Rules — `docs`

## Scope
Human- and agent-facing documentation: the AI memory layer (`docs/ai/`), the offline packaging
guide, and the implementation audit.

## Required reading
Root `AGENTS.md`. The AI memory files live in `docs/ai/` (see the map in root `AGENTS.md`).

## Local rules
- **Evidence-based only.** Document what the repository actually shows. Separate **Confirmed**,
  **Inferred**, and **Unknown / Needs Verification**. Do not invent features, commands, or status.
- **No secrets** in any doc (keys, tokens, passwords, certs, session values, private URLs). If
  secret-like values exist elsewhere, note only that they exist and where to review them.
- **Keep root `AGENTS.md` concise** — detailed/evolving context belongs in `docs/ai/`.
- **`docs/ai/CURRENT_STATE.md` and `docs/ai/TASK_LOG.md` are living files** — update them after every
  task. Update the other `docs/ai/*` files only when the thing they describe actually changed.
- Verify commands against `package.json`/scripts before listing them as confirmed; otherwise mark
  `Unknown - verify before use`.
- The clean-machine GUI walkthrough in `OFFLINE_STANDALONE_PACKAGING.md` is the production-ready
  gate — keep its status accurate.

## Do not break
- Internal links/paths between docs; the Confirmed/Inferred/Unknown structure.

## Update requirements
- Any doc change that reflects a code/behavior change should also be noted in
  `docs/ai/CURRENT_STATE.md` and `docs/ai/TASK_LOG.md`.
