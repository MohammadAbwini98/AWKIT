# E2E-LIC — Licensing page + enforcement gate (real Electron GUI)

Executable: `scripts/verify-e2e-licensing-gui.mjs` · Role: SuperUser ·
**Rewritten 2026-07-29 (`awkit-1cc`): enforcement is ON by default.** The pre-2026-07-29
"default OFF admits runs" invariant is deliberately gone.

Three launches:

- **A — fresh profile, default enforcement.** Deliberately **not** pre-seeded: seeding writes workflow
  JSON into the profile, which is the exact on-disk evidence the migration anchor reads as "this
  installation already existed". Pre-seeding here would hand launch A a grace window and destroy the
  case it exists to prove. The workflow is imported through the app's own IPC after bootstrap.
- **B — same profile, `AWKIT_TEST_LICENSE_BYPASS=1`.** The non-packaged test/dev bypass. Negative
  control for A: identical app, profile and run request, so A's block is attributable to the gate
  rather than to a broken fixture.
- **C — a separate profile seeded BEFORE first launch,** i.e. an upgrade. The migration window opens.

The A/C pair is what makes the grace claim real: one profile classed fresh, one classed upgraded,
opposite outcomes from the same unlicensed run. Asserting C alone would be satisfied by an
implementation that simply admits everything.

No private key material is used or written; import cases use deliberately invalid files.

| # | Step | Expected |
|---|---|---|
| A1 | SU opens Licensing on unlicensed profile | Page renders (no placeholder text): status badge = no-license state, machine code visible, actionable guidance; 0 console errors |
| A2 | Copy machine code | Non-empty stable machine code string |
| A3 | Export activation request to a temp file | File created; JSON parses; contains hashed machine fingerprint; **no raw MAC/hostname/MachineGuid values, no secrets** |
| A4 | Import an invalid license file (garbage bytes) | Safe error surfaced on-page; page remains usable; still unlicensed |
| A5 | Import a structurally-valid but unsigned/forged license | INVALID_SIGNATURE-class rejection; still unlicensed |
| A6 | Import flows + workflow through the app's own IPC | `mock-simple-workflow` present in `workflows.list()` |
| A7 | Run it (`dryRun:false`, unlicensed, fresh install) | `status:"licenseBlocked"`, `license.reason === "NOT_LICENSED"`, actionable message, no throw |
| A8 | Read `licensing.getStatus().enforcement` | `enforced:true`, `inGrace:false`, `runsAllowed:false` — a fresh install gets no migration window |
| A9 | Workflow validation / dry-run path | Still available (diagnostics unaffected by the gate) |
| B1 | Relaunch with `AWKIT_TEST_LICENSE_BYPASS=1`; same `runWorkflow` | Run admitted (`status:"started"`) — proves both gate branches are reachable |
| B2 | Licensing page + shell under the bypass | App shell fully usable |
| C1 | First launch of a pre-seeded (upgraded) profile; read `enforcement` | `inGrace:true`, parseable `graceEndsAtUtc`, `graceDaysRemaining === 14`, `enforced:true` |
| C2 | Run the same unlicensed workflow | Admitted (`status:"started"`) — saved workflows keep running during the window |
| C3 | Licensing page during grace | Banner shows the **14-day** window and the real deadline as the renderer formats it; "Export activation request" still available |

**Environment note.** The machine-wide grace mirror lives under `%PROGRAMDATA%\SpecterStudio\Licensing`
and is namespaced per profile (`migration-grace-<hash>.json`). A single shared filename would let one
profile's classification decide for every user on the machine — `fresh` wins a merge — which is both a
product bug and a cross-test leak between launches.
