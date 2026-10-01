# NVIDIA machine setup for the Phase L GPU qualification

Setup steps for the separate NVIDIA machine that runs item 2 of `awkit-djnl.15`, the NVIDIA qualification.
They were written on 2026-10-01 from the repository's scripts and docs. **No step here has been executed
on an NVIDIA machine yet.**

## Settle these two things first

1. **The machine must show only NVIDIA GPUs.** If Windows also sees an Intel or AMD integrated GPU next to
   the NVIDIA card, the product marks the GPU `VENDOR_UNPROVEN` and refuses the GPU modes
   (`classifyAdapters` in `src/ai/AiExecutionProfile.ts`). That is open item 3 of `awkit-djnl.15`, so a
   typical hybrid laptop cannot qualify.
   - Use a desktop with integrated graphics turned off in BIOS/UEFI (not just in Device Manager), or a CPU
     that has no integrated graphics.
   - Windows' built-in software adapter (vendor 0x1414) is fine.
2. **Building the package needs the release signing key.** `package:portable` signs the dependency
   manifest with the key that matches the committed `resources/trust/offline-manifest-public.pem`.
   - On the development machine the key is at
     `%LOCALAPPDATA%\SpecterStudio\release-keys\offline-manifest-private.pem`.
   - Move it by USB, never through OneDrive or git. The signing script refuses a key that sits in a synced
     folder (`docs/security/RELEASE_KEY_CUSTODY.md`).
   - Don't run `generate-key` on the NVIDIA machine: that would create a different trust root.

## Software to install on the NVIDIA machine

- **Current NVIDIA driver.** It supplies `vulkan-1.dll` and `nvidia-smi.exe`. The CUDA Toolkit is not
  needed.
- **Git for Windows.**
- **Node.js 18.16.0 x64.** That is the version the 2026-10-01 evidence on the development machine
  records. node-llama-cpp 3.21.1 declares Node ≥20, but npm only warns about that (`.npmrc` doesn't set
  `engine-strict`). If `npm ci` fails in node-llama-cpp's install script, stop and report it.
- **Visual Studio 2022 17.10 or newer, Community, Professional or Enterprise, with the C++ tools and
  redist.** Build Tools is rejected for licensing reasons. `scripts/prepare-ai-native-host.mjs` copies the
  VC++ runtime DLLs (14.40 or newer) from there.
- **Python 3.12 x64.** Only needed for option B in step 7.
- **At least 1,536 MiB of free Windows commit (RAM + pagefile) while packaging, and internet during
  setup.** The app itself stays offline.

```powershell
winget install --id Microsoft.VisualStudio.2022.Community --override "--add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.VC.Redist.14.Latest --passive --wait"
```

## Steps

**1. Check the adapters.** Every display device should show `VEN_10DE`; the Microsoft Basic Display
adapter is fine.

```powershell
Get-CimInstance Win32_VideoController | Select-Object Name, PNPDeviceID
```

```powershell
nvidia-smi
```

**2. Clone outside OneDrive, using a short path.**

```powershell
git config --global core.longpaths true
```

```powershell
git clone https://github.com/MohammadAbwini98/AWKIT.git C:\src\AWKIT
```

```powershell
cd C:\src\AWKIT
```

Record the commit the qualification runs at:

```powershell
git log -1 --oneline
```

**3. Install dependencies.** Don't add `--omit=optional`: the Vulkan prebuilt
(`@node-llama-cpp/win-x64-vulkan`) is an optional dependency.

```powershell
npm ci
```

**4. Put the model in `~/Downloads`.** The verifiers look only there. You can also copy the file from the
development machine's `Downloads` folder instead.

```powershell
curl.exe -L -C - --retry 5 --retry-all-errors -o "$env:USERPROFILE\Downloads\Qwen3.5-0.8B-Q4_K_M.gguf" https://huggingface.co/lmstudio-community/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf
```

```powershell
Get-FileHash "$env:USERPROFILE\Downloads\Qwen3.5-0.8B-Q4_K_M.gguf" -Algorithm SHA256
```

The hash must be `F5B14DA98939B60BBE1019A964EBA656407E1E0B64F1FE3003FF6D650E93BFEC` and the size
527,502,816 bytes (the pin in `src/offline/AiModelManifest.ts`).

**5. Put the signing key in place,** from USB, then delete the USB copy. Replace `E:\` with your USB drive.

```powershell
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\SpecterStudio\release-keys"
```

```powershell
Copy-Item "E:\offline-manifest-private.pem" "$env:LOCALAPPDATA\SpecterStudio\release-keys\offline-manifest-private.pem"
```

**6. Stage the pinned Chromium.**

```powershell
npm run prepare:offline
```

**7. Get the DOM-intelligence runtime inputs. Pick one option.**

- **Option A (simpler):** copy the development machine's `.cache\dom-intelligence\` folder to
  `C:\src\AWKIT\.cache\dom-intelligence\`. Staging re-checks the SHA-256 of every file in it.
- **Option B:** build it on the NVIDIA machine. This needs Python 3.12:

```powershell
npm run benchmark:dom-intelligence-setup
```

```powershell
npm run benchmark:dom-intelligence-runtime-setup
```

**8. Build the package.** Do this before any GPU check, for two reasons:

- The packaged checks need `dist\win-unpacked`.
- The source checks compare the VC++ runtime against the signed manifest, and packaging re-signs the
  manifest with this machine's runtime.

A warning that the Oracle JDBC bridge isn't bundled is expected and harmless.

```powershell
npm run package:portable
```

**9. Run the five qualification checks and save the output.** Exit code 0 means PASS, 1 means FAIL, and 2
means NOT RUN or INCONCLUSIVE.

```powershell
New-Item -ItemType Directory -Force C:\nvidia-evidence
```

```powershell
cmd /c "npm run verify:ai-gpu-backend-gate 2>&1" | Tee-Object C:\nvidia-evidence\backend-gate.log
```

```powershell
Copy-Item "$env:TEMP\awkit-l8a0-record.json" C:\nvidia-evidence\
```

```powershell
cmd /c "npm run verify:ai-gpu-host 2>&1" | Tee-Object C:\nvidia-evidence\gpu-host.log
```

```powershell
cmd /c "npm run verify:ai-gpu-lifecycle 2>&1" | Tee-Object C:\nvidia-evidence\gpu-lifecycle.log
```

```powershell
cmd /c "npm run verify:ai-gpu-packaged 2>&1" | Tee-Object C:\nvidia-evidence\gpu-packaged.log
```

```powershell
cmd /c "npm run verify:ai-gpu-lifecycle-packaged 2>&1" | Tee-Object C:\nvidia-evidence\gpu-lifecycle-packaged.log
```

**10. Clean up.** Packaging rewrote the two tracked manifest files with the NVIDIA machine's signature. The
committed pair (`fdb10cc5`) is the release record, so don't commit these. Restore them once the checks are
done:

```powershell
git restore resources/dependency-manifest.json resources/dependency-manifest.sig
```

## Bringing the results back

Copy `C:\nvidia-evidence\` back to the development machine and record the results against
`awkit-djnl.15` there. That way only one machine writes to `main`.

If you record them on the NVIDIA machine instead, run `bd import .beads/issues.jsonl` there first, and pull
on the development machine before doing anything else there.
