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

## 2026-09-27 — Phase L extension (after the 10/10 closeout)

- **Scope widened by the owner, nothing regressed:** L8a hardware-adaptive inference runtime
  (`awkit-djnl.11`), L8b external compatible-model registration and qualification (`.12`), L9 adaptive
  time budgets, progress and ETA (`.13`). Phase L reads 10 of 13 milestones closed (77%).
- **Modes, not a planner:** CPU & RAM only (default), GPU-Offload and GPU-Only, chosen by an
  administrator. The earlier drafts' Auto, GPU-preferred and manual-override modes were dropped.
- **GPU components user-supplied:** no GPU binary in the installer; a Settings checklist validates each
  component against a hash-pinned backend manifest, copies it into an app-managed folder and loads it
  only from there. Vulkan first; CUDA later.
- **Capability, not product names:** NVIDIA by PCI vendor ID and runtime-reported capability.
- **Compatible vs Qualified:** any compatible GGUF may be registered (copied, never referenced);
  quality qualification carries across hardware, latency class is measured locally.
- **Evidence on the development machine** with the packaged build; no external-machine benchmark.
- **Phase M/N independence:** epic-level edges removed (run by the owner); M1/N1 keep their L7 edge.
- Decisions E1–E12 in `ROADMAP.md` › *Phase L extension (2026-09-27)*.
