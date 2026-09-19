# V5 Changelog (vs external V4 draft)

- **Consolidated**: one ROADMAP holds all cross-cutting rules/decisions; milestone files carry no repeated rules;
  orientation "Master Plan" dropped; stale V3 "rescue / unique-locator exhaustion" wording removed from L1/L7;
  permissions and manifest specified once.
- **Intelligent automation added**: event-driven job triggers, idle flow health sweep, policy-tiered autonomy
  (T0 Observe / T1 Suggest / T2 Auto-apply with proof / T3 Forbidden), `AiActionRecord` audit + one-click revert,
  revert-rate self-demotion. Owner chose policy-tiered autonomy (2026-09-19).
- **M1 fixed**: unproven candidates live in `pendingUpgrade`, never `alternatives` (which `LocatorFactory` executes
  as fallbacks) or remembered-winner memory.
- **M2 fixed**: intent guard rejects/parameterizes data-bound scope text; position→text is a meaning change that
  blocks auto-apply.
- **M3 fixed**: replay only records proof; promotion is a single-writer save-path job gated on same-element proof
  across ≥N replays and ≥2 data rows, audited and revertible.
- **S1 fixed**: L4b is explanation-first; AI ranks only validator-emitted `safeFix` kinds.
- Coalescing signature uses path templates; L1 benchmark covers upgrade job, replay path and coalesced batch.
