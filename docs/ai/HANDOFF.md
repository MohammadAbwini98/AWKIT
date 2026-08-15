# Agent Handoff

## HANDOFF (2026-08-15) — 7282178 Loop capsule visual restoration

### Objective

Restore the owner-approved `7282178` central capsule-and-ring Loop visual contract in both Flow Designer and Workflow Builder without regressing the functional Loop work, then make the canonical GUI verifiers reject the superseded full-node U-route hybrid.

The authoritative visual acceptance contract is now `docs/ai/LOOP_VISUAL_CONTRACT.md`. It supersedes the structured-self-Loop visual topology described by the older 2026-08-13/14 status text. Git history retains those earlier interpretations; do not treat their screenshots or green verifier counts as current visual authority.

### Canonical branch and checkpoint

- Repository: `MohammadAbwini98/AWKIT`
- Branch: `main`
- Baseline before this correction: `e52c2078e06fcae93d053371185a75c886dd568c`
- Latest implementation/test commit before this handoff: `4a90bc0693f8b37e698ac4caa3c90cc60755df19`
- All commits in this correction were written directly to remote `main` through the GitHub connector; no feature branch or worktree was created.
- The execution environment available to this agent did not contain a repository checkout, and outbound DNS from the container could not resolve GitHub. There is no GitHub Actions workflow/status context for these commits. Therefore build/runtime verifier commands were **not executed** in this session and must not be represented as PASS.

### Delivered product behavior

`app/renderer/components/canvas/edges/LoopEdge.tsx` now restores the structured self-Loop to the approved central control vocabulary while leaving legacy cross-node `loopBack` rendering/runtime separate:

- one node-attached horizontal capsule, exactly 160 × 20 graph units with a 10-unit end radius;
- one dominant concentric control halfway along the capsule;
- 40-unit outer ring, 30-unit main ring, and 44-unit interaction radius;
- `LoopConnectorConfig.maxIterations` centered inside the ring as design-time configuration;
- one rotating circular sweep around the main ring;
- mode-aware design-time label (`Count × N`, `While · …`, etc.) outside the ring;
- one compact same-side return path, not bottom-center → outside → top-center routing around the full card;
- no structured-self-loop `.awkit-loop-direction-path` overlay and no self-loop arrow, so the prior dotted-base + differently dashed-overlay interference cannot recur;
- the existing wide hit target, selection, pointer/keyboard configuration path, persisted edge identity, and Loop editor plumbing are retained.

`app/renderer/components/canvas/edges/LoopEdge.css` owns the sweep-only `awkit-loop-control-orbit` animation. The capsule path, ring/value, and label remain stationary. `prefers-reduced-motion: reduce` freezes the sweep at a readable angle instead of removing the Loop identity.

No Loop runtime policy, profile schema, IPC contract, Conditional-exit rule, or legacy cross-node `loopBack` execution model was intentionally changed.

### Verifier correction

The prior visual oracle was invalid because it explicitly required the rejected topology (`laneCount === 0`, no backplate/sweep/value, marker outside the node, and a route wrapping the whole node). Those assertions are no longer the canonical acceptance standard.

New shared/focused verification code:

- `scripts/lib/loop-capsule-visual-oracle.mjs`
  - requires one capsule lane, backplate, outer/main ring, configured value, sweep, focus/hit target;
  - requires exact 160×20 and 40/30/44 geometry;
  - verifies concentric centers and ring-centered value;
  - verifies same-side node attachment and compact path height;
  - explicitly requires `!pathWrapsWholeNode`, zero self-loop directional overlay, and zero self-loop arrow;
  - measures transform-based sweep motion while value/label remain stationary;
  - includes reduced-motion, drag/attachment, and pixel-motion helpers. Pixel motion is supplementary rather than the visual oracle.
- `scripts/lib/verify-flow-loop-capsule-gui.mjs`
  - real-Electron Flow fixture;
  - fresh default `Count × 3` / ring value 3;
  - While/maxIterations edit to 10;
  - capsule/ring/U-route rejection;
  - sweep-only animation and reduced motion;
  - 25/100/200% zoom;
  - physical node drag;
  - two independent Loops;
  - reopen/edit/save/reload to value 12;
  - exactly one promoted Conditional exit;
  - direct ring target and keyboard configuration.
- `scripts/lib/verify-workflow-loop-capsule-gui.mjs`
  - equivalent real-Electron Workflow coverage;
  - the final persistence assertion now performs an actual renderer reload before rereading the workflow, so it cannot pass from in-memory state alone.

The previous broad GUI walkthroughs are preserved byte-for-byte as:

- `scripts/verify-flow-designer-gui.pre-capsule.mjs`
- `scripts/verify-workflow-builder-gui.pre-capsule.mjs`

`scripts/lib/legacy-gui-verifier-coverage.mjs` runs those walkthroughs and permits only an explicit allow-list of obsolete U-route assertions to fail. Any unrelated/new failure or harness failure still fails the canonical command.

The canonical entry points are rewritten:

- `scripts/verify-flow-designer-gui.mjs`
- `scripts/verify-workflow-builder-gui.mjs`

They require both preserved broad coverage and the new focused capsule suite. The existing npm commands remain `verify:flow-designer` and `verify:workflow-builder`; no new `verify:*` or `validate:*` npm command was added, so no new verifier-classification registry entry is required.

### Commits in this correction

1. `dc0ef62382433457756d463137eecdb332cf0b0e` — `fix: restore capsule-and-ring loop visual`
2. `bd0beab643f899737242efca46ce55db704ba82a` — `fix: animate loop sweep without path interference`
3. `50c16813f6ed39392e9d367f970ff82780e7b1f1` — `fix: bind loop sweep to dedicated orbit animation`
4. `7ac834b46a50a305be693b6a541f9e29163d551a` — `fix: match approved loop control proportions`
5. `dfd90572aab30bd380c6753a521d2bf533ce0dd4` — `test: add shared loop capsule visual oracle`
6. `11ca3c7ce9983779dd254fb9662f547e3b1a7b84` — `test: preserve pre-capsule GUI verifier coverage`
7. `8133e595a4fe776b55532b648c38f4ef7e77acf2` — `test: preserve unaffected GUI verifier coverage`
8. `a25f5a6831f85dbcb0864d6eb5c4d2e92709cda2` — `test: verify Flow Loop capsule visual contract`
9. `2003f4f93c10255116b2b98fc8726c2481b434c4` — `test: verify Workflow Loop capsule visual contract`
10. `84b713bf437e9ca5504015c00b050445b6347a8f` — `test: make Flow GUI enforce loop capsule contract`
11. `5e3099efaed326a94160e99275e0f052a4734eaf` — `test: make Workflow GUI enforce loop capsule contract`
12. `68412028c402fb4e6ac5cc0b0ec936ce1c42fde3` — `docs: freeze approved loop capsule visual contract`
13. `4a90bc0693f8b37e698ac4caa3c90cc60755df19` — `test: reload persisted Workflow loop before visual assertion`

This handoff commit follows those commits; use current `main` HEAD as the final documentation checkpoint.

### Verification state in this session

| Verification | State | Evidence / reason |
|---|---|---|
| source/history inspection | PASS | GitHub repository files and historical commits `7282178` through the U-route sequence were inspected directly. |
| product/verifier source comparison | PASS | Current implementation, old verifier assertions, historical `7282178`, and the new shared oracle were compared in repository source. |
| `npm run build` | NOT RUN / environment-blocked | No local repository checkout; container DNS could not resolve GitHub. |
| `npm run verify:flow-designer` | NOT RUN / environment-blocked | Requires built Electron/local repository. |
| `npm run verify:workflow-builder` | NOT RUN / environment-blocked | Requires built Electron/local repository. |
| `npm run verify:runner` | NOT RUN / environment-blocked | No local repository checkout. |
| `npm run verify:mock-site` | NOT RUN / environment-blocked | No local repository checkout. |
| `npm run verify:source-hygiene` | NOT RUN / environment-blocked | No local repository checkout. |
| `npm run verify:verifier-classification` | NOT RUN / environment-blocked | Source inspection confirms classification is keyed to exact npm commands; runtime gate still needs execution. |
| `npm run verify:roadmap-dashboard` | NOT RUN / environment-blocked | No local repository checkout. |
| `git diff --check` | NOT RUN / environment-blocked | GitHub connector writes were used instead of a local worktree. |
| final light/dark screenshot comparison | NOT RUN | Requires real Electron execution and rendered evidence. |

Do not inherit the August 14 `128/128` / `74/74` U-route results as proof for this restored design. They are historical evidence for the superseded oracle only.

### Known risk / follow-up

`FlowCanvas.tsx` still contains side-selection/collision-footprint logic introduced for the later U-route-era geometry. The restored `LoopEdge` reconstructs the actual node-side anchor correctly and the new focused suites assert attachment through zoom and physical drag, but this session could not execute a dense-canvas collision scenario. If a Loop capsule chooses a poor side or collides with nearby controls/nodes, update the responsible `FlowCanvas` footprint calculation to model the frozen 160×20 / 40-radius capsule; do not change the visual contract to accommodate the old footprint.

The top historical sections of `CURRENT_STATE.md` still describe the superseded U-route closeout because this connector-only environment cannot safely patch that large cumulative history file without replacing unrelated history. Treat this handoff plus `docs/ai/LOOP_VISUAL_CONTRACT.md` as the newer authority and correct the stale top status text during the next local-repository closeout.

### NEXT AGENT START HERE

Branch: `main`

First files to inspect:

1. `docs/ai/LOOP_VISUAL_CONTRACT.md`
2. `app/renderer/components/canvas/edges/LoopEdge.tsx`
3. `app/renderer/components/canvas/edges/LoopEdge.css`
4. `scripts/lib/loop-capsule-visual-oracle.mjs`
5. `scripts/verify-flow-designer-gui.mjs`
6. `scripts/verify-workflow-builder-gui.mjs`

First commands to run on a normal AWKIT checkout:

```powershell
npm run build
npm run verify:flow-designer
npm run verify:workflow-builder
npm run verify:runner
npm run verify:mock-site
npm run verify:source-hygiene
npm run verify:verifier-classification
npm run verify:roadmap-dashboard
git diff --check
```

First implementation action if a focused GUI command fails: fix the responsible product/test defect against `LOOP_VISUAL_CONTRACT.md`; **do not rewrite the contract or weaken the oracle to match the rendered output**.

After both GUI suites pass, capture Flow Designer and Workflow Builder screenshots in light and dark at the normal desktop viewport and compare them side-by-side with the approved `7282178` central capsule-and-ring reference. Record the evidence paths and verdict.

Then correct the stale top Loop section in `CURRENT_STATE.md`, update tracker/ledger/roadmap sources if the executed evidence changes their state, confirm Program Status says `Sources agree`, and commit/push directly to `main`.
