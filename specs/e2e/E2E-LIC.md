# E2E-LIC — Licensing page + enforcement gate (real Electron GUI)

Executable: `scripts/verify-e2e-licensing-gui.mjs` · Role: SuperUser ·
Setup A: fresh profile, `SPECTER_LICENSE_ENFORCE` **unset** (default). Setup B: second launch with
`SPECTER_LICENSE_ENFORCE=true`. Seeded mock fixtures + local mock-site for the run-gate checks.
No private key material is used or written; import cases use deliberately invalid files.

| # | Step | Expected |
|---|---|---|
| A1 | SU opens Licensing on unlicensed profile | Page renders (no placeholder text): status badge = no-license state, machine code visible, actionable guidance; 0 console errors |
| A2 | Copy machine code | Non-empty stable machine code string |
| A3 | Export activation request to a temp file | File created; JSON parses; contains hashed machine fingerprint; **no raw MAC/hostname/MachineGuid values, no secrets** |
| A4 | Import an invalid license file (garbage bytes) | Safe error surfaced on-page; page remains usable; still unlicensed |
| A5 | Import a structurally-valid but unsigned/forged license | INVALID_SIGNATURE-class rejection; still unlicensed |
| A6 | Run a seeded workflow (enforcement OFF, unlicensed) | Run is admitted (not `licenseBlocked`) — default-OFF invariant |
| B1 | Relaunch with `SPECTER_LICENSE_ENFORCE=true`, unlicensed; `runWorkflow` | Response `status:"licenseBlocked"` with action message; no throw/crash |
| B2 | Same launch: workflow validation / dry-run path | Still available (diagnostics unaffected by the gate) |
| B3 | Licensing page under enforcement | Status shown; app shell fully usable (enforcement gates runs only) |
