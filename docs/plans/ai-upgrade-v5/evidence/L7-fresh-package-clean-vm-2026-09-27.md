# L7 fresh packages and clean-machine evidence (2026-09-27)

The portable and NSIS 0.1.51 artifacts were built from clean product commit
`7bc8463675ee0adcfe455fe45d0ece0e428fa6e0` (`dist/release-provenance.json`,
`treeDirty: false`). They include L4b DX revision 4. The signed dependency manifest is
`1c59dc05c65a9f90eba41621dc7ce4269558629bc666798035887f5c5b3eda1f`.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Portable `SpecterStudio 0.1.51.exe` | 243,164,322 | `7a5d22292e3a01e3d6aed39a770cd67012090b7089df5bae592e99ad1b8c464a` |
| NSIS `SpecterStudio Setup 0.1.51.exe` | 272,028,146 | `4684796c6f0416ed56732728acaebc895c4356443302749dbcdb7d60c58f8739` |
| Separate pinned Qwen3.5-0.8B model pack | 527,502,816 | `f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec` |

## Gates on the fresh artifacts

| Gate | Result |
|---|---|
| `package:portable` and `package:installer` | PASS; both build and strict offline validation passed during packaging |
| `validate:offline -- -Strict` | PASS, 1,465/1,465 AI assets |
| `verify:offline-supply-chain` | PASS, 25/0 |
| `verify:nsis-per-user-install` | PASS, 12/0 |
| `verify:packaged-runtime` and `verify:packaged-validation` | PASS, 25/0 and 119/0 |
| `verify:native-dependencies` | PASS, 14/0; 50 PE images, 562 imports, zero unresolved; loader proof with global CRT unavailable |
| `verify:ai-packaged-runtime` | PASS, 104/0, including the 13-step live harness on a staged copy |
| `verify:ai-packaged-app` | PASS, 24/0; real 0.8B inference in 52 s, imported into a writable profile and all three CRT DLLs loaded from the package |
| `verify:packaged-licensing` | BLOCKED, 28 PASS / 0 FAIL / 2 BLOCKED: offline issuer key unavailable |
| `verify:packaged-walkthrough` | BLOCKED, 42 PASS / 0 FAIL / 1 BLOCKED: licensed parts D–J need the issuer key; unlicensed boot and non-loopback network check passed |

The first simultaneous invocation of `verify:packaged-runtime` and
`verify:packaged-validation` collided in their packaged GUI harnesses. Isolated reruns passed.
The first `verify:native-dependencies` invocation could not load the signature module in a
Windows PowerShell child inheriting PowerShell 7's module path. The probe now imports its
own security module and fails on an incomplete result; the isolated rerun passed.

## Hyper-V clean machine

The operator was Codex on the owner's host. Evidence screenshots are under
`C:\AWKIT-CleanMachineVM\evidence\`; they remain outside the repository. The
`AWKIT-CleanMachine` VM was restored from `clean-before-validation`, and a new
`l7-s0-2026-09-26` checkpoint was taken before installation. It runs Windows 11 Pro
10.0.26100 x64 as standard user `awkituser`. Q1–Q5 passed: zero up network adapters,
TCP to 1.1.1.1:443 false, none of the three VC runtime DLLs in System32 or PATH,
and no VC runtime x64 registry key. The artifact ISO is read-only. The guest's hashes
of the NSIS EXE, portable EXE and separate model pack match the table above.

### NSIS from S0 — PASS

- Installed with `/currentuser /S` as the standard user: exit 0, under
  `%LOCALAPPDATA%\Programs\SpecterStudio`.
- The package contains three x64 CRT DLLs beside llama.cpp and `vcruntime140.dll`
  beside the reflink addon. All four have version 14.44.35211 and a valid
  Microsoft Corporation signature (`l7-nsis-dll-2026-09-26.png`).
- First-run Super User setup worked. Settings reported the included runtime,
  and importing the separate pinned model pack made local AI Available
  (`l7-model-import-2026-09-26.png`).
- A saved Click step without a locator produced findings. *Explain with AI*
  returned two issue-specific AI interpretations and corrective actions
  (`l7-explain-result5.png`). Settings showed **1 completed, 0 failed** jobs,
  runtime process **ready**, and the pinned checksum (`l7-nsis-diagnostics3.png`).
- In 64-bit PowerShell, AI host PID 948 had SpecterStudio parent PID 5024 and
  loaded `MSVCP140.dll`, `VCRUNTIME140.dll` and `VCRUNTIME140_1.dll` from its
  own `resources\native-hosts\ai` tree; no CRT module was loaded from outside
  the install (`l7-nsis-64bit-modules.png`). The guest had no established TCP
  connection (`l7-nsis-network.png`).

### Portable from restored S0 — PASS

The first observation was taken before the self-extracting wrapper finished, and a
second copy was accidentally started. That attempt is inconclusive. S0 was restored
again; the portable was launched once, and first-run setup appeared within the
runbook's five-minute extraction window.

- The unpacked app ran under the standard user's `%TEMP%` folder
  (`l7-portable-path.png`); the artifact and pack hashes matched the table above.
- First-run setup, included runtime detection, import of the separate pinned pack,
  and Available status passed. A saved Click step without a locator produced
  findings; *Explain with AI* returned two issue-specific interpretations and
  corrective actions (`l7-portable-explain-result.png`).
- Settings showed **1 completed, 0 failed** jobs, runtime process **ready**, and
  the pinned checksum (`l7-portable-jobs2.png`).
- In 64-bit PowerShell, AI host PID 7536 had SpecterStudio parent PID 3628 and
  loaded `MSVCP140.dll`, `VCRUNTIME140.dll` and `VCRUNTIME140_1.dll` from its
  own unpacked `resources\native-hosts\ai` tree, with no external CRT path
  (`l7-portable-modules2.png`). No established TCP connection was present
  (`l7-portable-network.png`).

Both package formats meet the clean-machine local-AI procedure. The licensed
walkthrough remains BLOCKED on the unavailable offline issuer key; no licensed
workflow PASS is claimed.
