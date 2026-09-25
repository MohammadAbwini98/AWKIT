# Clean-machine procedure: SpecterStudio 0.1.51, local AI with no global Visual C++ runtime

> **Status: NOT RUN.** An authorized operator runs this, and the owner (or a delegate) reviews the evidence.
> Nothing here passes until both have happened. PASS closes the last clause of `awkit-i6ot`: the runtime loads
> from the installed package on a machine without the Visual C++ runtime. It supersedes the shorter runbook in
> L7 › `awkit-i6ot`.

**What it proves:** on a Windows machine that never had the Visual C++ 2015–2022 runtime, with no network, the
final portable and NSIS artifacts:
- load the local-AI runtime from their own files;
- import the pinned model pack;
- run a real local inference.

**What it does not prove:**
- licensed workflow execution (the walkthrough's parts D–J, BLOCKED on the issuer key);
- performance or latency;
- L4b explanation quality.

## 1. Inputs and provenance

All from `dist/release-provenance.json`: built from clean `62aab2dc`, `treeDirty: false`, 2026-09-25T18:42:19Z.

| File | Bytes | SHA-256 |
|---|---|---|
| `SpecterStudio Setup 0.1.51.exe` (NSIS) | 272,026,668 | `f34a83e4112ea3e86676541ffbb335bf6b4a59a73b7ee96fba807129a7615030` |
| `SpecterStudio 0.1.51.exe` (portable) | 243,160,364 | `11888cfbb2afe32e328257dcd398efabaca6bda867c16762d15257abd3e118f2` |
| `Qwen3.5-0.8B-Q4_K_M.gguf` (model pack, shipped separately) | 527,502,816 | `f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec` |

- **Signed dependency manifest inside both:** sha256 `dc0532bb…`, Ed25519 key `ed25519:aa5b9dd8…` (committed at
  `c337b267`).
- **The app-local runtime it carries:** `msvcp140.dll`, `vcruntime140.dll` and `vcruntime140_1.dll`, file version
  14.44.35211, in `resources\native-hosts\ai\node_modules\@node-llama-cpp\win-x64\bins\win-x64\`. Also
  `vcruntime140.dll` beside the reflink addon.
- **Transfer:** use read-only media only, for example the ISO from `scripts/clean-machine/attach-artifacts.ps1`
  with the model pack added to its stage folder. Do not use a network share: the machine has no network.

## 2. The qualifying machine (checks Q1–Q5)

- **The machine:**
  - Windows 10 22H2 or Windows 11, x64, installed fresh. The Hyper-V lab of `scripts/clean-machine/` qualifies.
  - Never had Visual Studio, Build Tools, a Visual C++ Redistributable, Node or Python installed.
  - A standard (non-administrator) user for the app steps. An administrator shell is used only for the Q checks
    and hashes.
  - No network adapter attached (preferred), or every adapter disabled.
- **Take a snapshot, S0,** once Q1–Q5 pass and before anything is installed.

In PowerShell on the machine, keep every output:

| # | Command | Must show |
|---|---|---|
| Q1 | `Get-NetAdapter` and `Test-NetConnection 1.1.1.1 -Port 443 -InformationLevel Quiet` | no adapter up; `False` |
| Q2 | `'msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll' \| % { "$_ " + (Test-Path "$env:SystemRoot\System32\$_") }` | `msvcp140.dll False` and `vcruntime140_1.dll False`. Record `vcruntime140.dll` either way; if it exists, also record `Get-AuthenticodeSignature` of it |
| Q3 | `Test-Path 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'` | `False` |
| Q4 | `where.exe msvcp140.dll vcruntime140_1.dll` | not found (nothing on `PATH` supplies them) |
| Q5 | `[Environment]::OSVersion.Version`, `$env:PROCESSOR_ARCHITECTURE` | the Windows build, `AMD64` |

A failed Q check means the machine does not qualify. That is **NOT RUN, not FAIL**. Fix the machine, or use
another one.

## 3. NSIS (per-user install), from S0

1. **Hashes.** Run `Get-FileHash -Algorithm SHA256` on the installer and on the model pack. Both must equal §1.
2. **Install as the standard user** with the canonical arguments (`scripts/lib/nsis-per-user-install.ps1`):
   `Start-Process '.\SpecterStudio Setup 0.1.51.exe' -ArgumentList '/currentuser','/S' -Wait -PassThru`.
   - Record `ExitCode`. It must be `0`.
   - Record the install folder: the target of the Start-menu shortcut, by default
     `%LOCALAPPDATA%\Programs\SpecterStudio`.
3. **The app-local runtime on disk.** In the install folder, run:

   ```powershell
   Get-ChildItem -Recurse "$install\resources\native-hosts\ai" -Filter '*140*.dll' |
     % { [pscustomobject]@{ Path = $_.FullName; Version = $_.VersionInfo.FileVersion;
         Signer = (Get-AuthenticodeSignature $_.FullName).SignerCertificate.Subject;
         Status = (Get-AuthenticodeSignature $_.FullName).Status } }
   ```

   It must list:
   - all three DLLs beside `…\@node-llama-cpp\win-x64\bins\win-x64\`;
   - `vcruntime140.dll` beside the reflink addon;
   - for each: version 14.44.35211, status `Valid`, and a Microsoft Corporation signer.
4. **First launch.** Start SpecterStudio from the Start menu, and create the first Super User.
5. **Settings › Local AI:** tick *Enable local AI* (re-enter the password if asked).
   - The status must read **"No model pack imported"**, never "The AI runtime is not included in this build".
   - The diagnostics must show *Runtime: Included (llama.cpp …)*.
   - Take screenshot N5.
6. **Import the pack.** Use *Import Model Pack…* and choose the `.gguf` file.
   - It must report **"Model pack imported and verified."**
   - *Model checksum* must begin `f5b14da98939b60b`.
   - Take screenshot N6.
7. **Make a flow with a finding.** In the Flow Designer, create a flow, add a step that needs a locator (for
   example *Click*), leave its locator empty, and save. The validation panel must list the finding: "The step has
   no locator, and its type needs one."
8. **Explain it.** Click *Explain with AI* and wait (up to about 2 minutes on a slow VM).
   - **PASS:** an answer arrives. That is either an *AI interpretation* under the finding, or *AI explanation
     withheld* with its product sentence. Both mean the model ran.
   - **FAIL:** the bar says local AI is unavailable; an error or refusal instead of an answer; or *Runtime process*
     reads "Stopped after repeated crashes".
   - **INCONCLUSIVE:** a timeout. Retry once, then record it.
   - Take screenshot N8.
9. **Which runtime DLLs were loaded.** Within a minute of the answer, as the same user, run:

   ```powershell
   Get-Process SpecterStudio | % { $_.Modules } |
     ? { $_.ModuleName -match '^(msvcp140|vcruntime140(_1)?)\.dll$' } | Select-Object -Unique FileName
   ```

   - It must list `msvcp140.dll` and `vcruntime140_1.dll`, each from `$install\resources\native-hosts\ai\…`.
   - It must list no `*140*.dll` from outside the install folder.
10. **Settings › Local AI again.** *Jobs* must read at least `1 completed`. *Runtime process* must not read "Stopped
    after repeated crashes". Take screenshot N10.
11. **Network during the run.** `Get-NetTCPConnection -State Established` must show no remote address other than
    `127.0.0.1` or `::1`.
12. Copy `%LOCALAPPDATA%\SpecterStudio\logs` as supporting evidence. It is not a pass criterion.

## 4. Portable, from S0 again

Revert to **S0**, so the profile and the runtime state are clean. Then:
1. Hash the portable EXE and the model pack; both must equal §1.
2. Run `SpecterStudio 0.1.51.exe` as the standard user from a folder the user owns.
3. Repeat NSIS steps 4–12 (screenshots P5, P6, P8, P10). The portable app unpacks itself into `%TEMP%`, so:
   - in step 9, each DLL must come from a path containing `\resources\native-hosts\ai\`, under that unpacked
     folder;
   - no `*140*.dll` may come from `System32` or anywhere else outside it.
   - Record that unpacked folder.

## 5. Result

| Result | When |
|---|---|
| **PASS** | Q1–Q5 hold, and every NSIS step and every portable step meets its "must", with all the evidence below |
| **FAIL** | any "must" in §3 or §4 is not met. Record the step, the screenshot and the output |
| **INCONCLUSIVE** | step 8 timed out twice, with nothing else failing |
| **NOT RUN** | the machine did not qualify (§2), or the inputs' hashes did not match §1 |

**Evidence for the review:**
- Q1–Q5 outputs;
- the three hashes;
- the NSIS exit code and install folder;
- the step 3 listing;
- screenshots N5, N6, N8, N10, P5, P6, P8, P10;
- the two step 9 listings, and the step 11 output;
- the portable's unpacked folder;
- the operator's name, the date and the Windows build.

**Recording:**
- The result goes in `awkit-i6ot` (`bd update awkit-i6ot --notes …` under a project-state lease), in L7, and in
  the CURRENT_STATE and HANDOFF newest sections.
- PASS closes `awkit-i6ot`, after the owner's review of the evidence. Any other result keeps it open, with the
  failing step named.
