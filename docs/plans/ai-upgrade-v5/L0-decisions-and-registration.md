# L0 — Decisions & Roadmap Registration

Shared rules, architecture and decisions: `ROADMAP.md`. Deterministic; no model required.

## Goal

Register Phase L and record every owner decision before implementation.

## Tasks

1. **Roadmap** — widen `RoadmapPhase.id` in `src/roadmap/ImplementationRoadmap.ts` to include `"L"`, add
   "L — Local AI & Intelligent Automation" with L0–L7 deliverables and honest status; update every parser, baseline
   and verifier that assumes A–K in the same change. Track milestones as `bd` items with `blocks` edges.
2. **Owner audit** — one table: capability → current owner → extend/new → justification, covering recorder
   finalization (`buildRecordedFlow.ts`), locator resolution (`LocatorFactory.ts`), identity/guard, blueprint/recovery
   stores, failure evidence, reports/durable store/retention, permissions, concurrency, semantic host.
3. **Decision records** (append to `docs/ai/DECISIONS.md`) for ROADMAP "Global decisions" 1–9 and:
   - autonomy tiers T0–T3, per-feature defaults, cap at T2, self-demotion rule;
   - exact T3 list;
   - `pendingUpgrade` and `locatorProvenance` field names (audit `FlowProfile.ts`, `RecorderTypes.ts`,
     `buildRecordedFlow.ts`, `locatorApproval.ts`, editor mapping, profile round-trip);
   - `AiActionRecord` shape and retention;
   - privacy policy (categories masked, raw-UI-text suppression option, index exclusion, retention);
   - model manifest owner and release-only update rule.

## Verification

`npm run build`, `npm run verify:roadmap-dashboard` (Sources agree), `npm run verify:verifier-classification`,
`git diff --check`.

## Acceptance

- Phase L valid in roadmap types and dashboard; sources agree.
- All decisions recorded; owner audit complete; no implementation code yet.
