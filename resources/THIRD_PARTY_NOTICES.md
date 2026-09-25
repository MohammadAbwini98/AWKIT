# Third-Party Runtime Notices

SpecterStudio packages third-party runtime software so authorized browser automation can run fully
offline. This notice identifies the bundled browser/runtime sources; it does not replace the terms
and notices embedded in those products.

## Chrome for Testing

- Product: Google Chrome for Testing
- Purpose: browser automation and testing
- Approved version and payload hashes: `offline-browser-policy.json`
- Upstream information: <https://developer.chrome.com/blog/chrome-for-testing>
- Versioned downloads: <https://googlechromelabs.github.io/chrome-for-testing/>

The bundled browser's own `ABOUT` file states:

> Google Chrome — Copyright 2026 Google LLC. All rights reserved. Chrome is made possible by the
> Chromium open source project and other open source software.

The complete terms and open-source attributions embedded in the bundled binary remain available at
`chrome://terms` and `chrome://credits`. Those embedded notices must not be removed from the staged
payload. Chrome for Testing is intended for trusted automation/testing content and is not a
general-purpose end-user browser.

## Playwright

- Product: Microsoft Playwright
- Version: pinned in `offline-browser-policy.json` and `package.json`
- Upstream: <https://github.com/microsoft/playwright>
- License: Apache License 2.0 (`node_modules/playwright/LICENSE`)
- Notice: `node_modules/playwright/NOTICE`

Playwright includes code derived from Puppeteer under the Apache License 2.0. The packaged
`node_modules` tree retains the upstream license and notice files.

## Local AI runtime (node-llama-cpp / llama.cpp)

- Product: `node-llama-cpp`, which embeds `llama.cpp`
- Purpose: optional, fully offline local inference in an Electron utility process
- Pinned build: `node-llama-cpp@3.21.1+llama.cpp@v0.4.0`, asserted in `src/offline/AiModelManifest.ts`
  (`AI_RUNTIME_PIN`) and re-checked in the host handshake; any other build is refused
- Upstream: <https://github.com/withcatai/node-llama-cpp> and <https://github.com/ggml-org/llama.cpp>
- Licenses: `node-llama-cpp` MIT (`node_modules/node-llama-cpp/LICENSE`); `llama.cpp` MIT (reproduced
  below, because the prebuilt binaries contain it and no staged file carries its notice)
- CPU only. The host sets `build: "never"` and disables downloads, so a missing or unusable prebuilt
  binary is an error rather than a source build or a network fetch. The prebuilt CUDA and Vulkan
  variants npm installs alongside `@node-llama-cpp/win-x64` are never loaded and are not staged.

`node-llama-cpp` is a development dependency: it never enters `app.asar`. Its runtime tree is staged
beside the host by `scripts/prepare-ai-native-host.mjs` and shipped as `resources/native-hosts/ai`, in
the same way as the Zvec native host: `node-llama-cpp`, the CPU prebuilt `@node-llama-cpp/win-x64`
and `node-llama-cpp`'s declared runtime dependency packages, each copied with its own package metadata
and any license or notice file it ships. Every staged file is listed with its SHA-256 in the signed
dependency manifest (`aiRuntime`). No model pack is bundled.

### Redistribution review (2026-09-24, engineering review of the staged runtime)

This is a technical review of declared licenses and shipped files. It is not legal advice and it is not
a legal approval; the release responsibility below still applies.

- **Scope:** the 130 package directories staged into `resources/native-hosts/ai`, which are the 111
  distinct package versions listed below; the prebuilt binaries inside `@node-llama-cpp/win-x64`
  (`ggml*.dll`, `llama*.dll`, `llama-common.dll`, `llama-addon.node`); and `ai-host.cjs`, which is
  SpecterStudio's own code.
- **Licenses found:** MIT (91), ISC (14), BlueOak-1.0.0 (5), and `rc` under
  `(BSD-2-Clause OR MIT OR Apache-2.0)`, redistributed under MIT. No copyleft license (GPL, LGPL, AGPL,
  MPL or similar), no unknown license and no package without a declared license.
- **Obligations and how they are met:**
  - MIT, ISC and BSD-2-Clause require the copyright notice and permission notice to accompany every
    copy. Each package ships its own license file inside its staged directory (the *License text*
    column). Five packages ship none, so their notice is reproduced below.
  - BlueOak-1.0.0 requires everyone who receives the software to get the license text or a link to
    it. Each of the five ships its `LICENSE.md`.
  - The prebuilt binaries contain `llama.cpp` and `ggml` code (MIT). The npm package ships only
    `node-llama-cpp`'s own notice, so the `llama.cpp` notice is reproduced below.
  - No license here requires source distribution, a notice of changes (no file is modified; the
    staging copies files byte for byte), or an attribution beyond these notices.
- **Not included in this distribution:** the model packs (see below).
- **Proprietary files beside the open-source ones:** the Microsoft Visual C++ runtime that the prebuilt
  binaries import. It is not open source and is not part of this review; see "Microsoft Visual C++
  runtime" below. (Before 2026-09-25 it was not shipped, so local AI needed a globally installed
  runtime, `awkit-i6ot`.)
- **Kept current by a gate:** `npm run verify:ai-packaged-runtime` fails when a staged package is
  missing from the table below or listed with another version, license or license file, when a license
  is not one reviewed here, or when a notice this section must reproduce is absent.

### Microsoft Visual C++ runtime

- Files: `msvcp140.dll`, `vcruntime140.dll` and `vcruntime140_1.dll` (x64), copied unmodified into the
  directories of `resources/native-hosts/ai` whose binaries import them: all three beside the
  `@node-llama-cpp/win-x64` prebuilt binaries, and `vcruntime140.dll` alone beside the
  `@reflink/reflink-win32-x64-msvc` addon. Windows does not ship them.
- Source: the Visual C++ 2015-2022 redistributable files of the Visual Studio 2022 installation that
  builds the release (`VC\Redist\MSVC\<version>\x64\Microsoft.VC14x.CRT`), which is Microsoft's
  documented source for app-local deployment. The owner authorized this source on 2026-09-25.
- Microsoft's "Distributable Code Files for Visual Studio 2022" list
  (<https://learn.microsoft.com/visualstudio/releases/2022/redistribution>, read 2026-09-25) permits
  holders of a validly licensed Visual Studio Enterprise, Professional or Community 2022 to copy and
  distribute the files in `VC\redist` with their program, unmodified, subject to the license terms
  (`debug_nonredist` excluded). Build Tools is not on that list, so the staging accepts only those three
  editions of Visual Studio 2022.
- The staging accepts them only when each is a validly Microsoft-signed x64 image, at least as new as the
  linker of every staged binary. It never takes them from the Windows system directory, and it records
  their version in `ai-native-host-manifest.json` (`msvcRuntime`). Without them it stages nothing.
- © Microsoft Corporation. These files are proprietary. Microsoft's license terms for them govern their
  redistribution and use, not this file. The release owner confirms that their own Visual Studio license
  is valid for this use and that those terms cover the intended distribution (see "Release
  responsibility").

### Staged runtime packages

| Package | Version | License | License text |
|---|---|---|---|
| `@huggingface/jinja` | 0.5.10 | MIT | `LICENSE` |
| `@isaacs/fs-minipass` | 4.0.1 | ISC | `LICENSE` |
| `@kwsites/file-exists` | 1.1.1 | MIT | `LICENSE` |
| `@kwsites/promise-deferred` | 1.1.1 | MIT | `LICENSE` |
| `@node-llama-cpp/win-x64` | 3.21.1 | MIT | `LICENSE` |
| `@reflink/reflink-win32-x64-msvc` | 0.1.19 | MIT | reproduced below |
| `@reflink/reflink` | 0.1.19 | MIT | reproduced below |
| `@simple-git/args-pathspec` | 1.0.3 | MIT | reproduced below |
| `@simple-git/argv-parser` | 1.1.1 | MIT | reproduced below |
| `@tinyhttp/content-disposition` | 2.2.4 | MIT | `LICENSE` |
| `ansi-escapes` | 6.2.1 | MIT | `license` |
| `ansi-regex` | 5.0.1 | MIT | `license` |
| `ansi-regex` | 6.3.0 | MIT | `license` |
| `ansi-styles` | 4.3.0 | MIT | `license` |
| `ansi-styles` | 6.2.3 | MIT | `license` |
| `async-retry` | 1.3.3 | MIT | `LICENSE.md` |
| `bytes` | 3.1.2 | MIT | `LICENSE` |
| `chalk` | 5.6.2 | MIT | `license` |
| `chmodrp` | 1.0.2 | MIT | `license` |
| `chownr` | 3.0.0 | BlueOak-1.0.0 | `LICENSE.md` |
| `ci-info` | 4.4.0 | MIT | `LICENSE` |
| `cli-cursor` | 5.0.0 | MIT | `license` |
| `cli-spinners` | 2.9.2 | MIT | `license` |
| `cli-spinners` | 3.4.0 | MIT | `license` |
| `cliui` | 8.0.1 | ISC | `LICENSE.txt` |
| `cmake-js` | 8.0.0 | MIT | `LICENSE` |
| `color-convert` | 2.0.1 | MIT | `LICENSE` |
| `color-name` | 1.1.4 | MIT | `LICENSE` |
| `commander` | 10.0.1 | MIT | `LICENSE` |
| `cross-spawn` | 7.0.6 | MIT | `LICENSE` |
| `debug` | 4.4.3 | MIT | `LICENSE` |
| `deep-extend` | 0.6.0 | MIT | `LICENSE` |
| `emoji-regex` | 10.6.0 | MIT | `LICENSE-MIT.txt` |
| `emoji-regex` | 8.0.0 | MIT | `LICENSE-MIT.txt` |
| `env-var` | 7.5.0 | MIT | `LICENSE` |
| `escalade` | 3.2.0 | MIT | `license` |
| `eventemitter3` | 5.0.4 | MIT | `LICENSE` |
| `filename-reserved-regex` | 3.0.0 | MIT | `license` |
| `filenamify` | 6.0.0 | MIT | `license` |
| `fs-extra` | 11.4.0 | MIT | `LICENSE` |
| `get-caller-file` | 2.0.5 | ISC | `LICENSE.md` |
| `get-east-asian-width` | 1.7.0 | MIT | `license` |
| `graceful-fs` | 4.2.11 | ISC | `LICENSE` |
| `ignore` | 7.0.9 | MIT | `LICENSE-MIT` |
| `ini` | 1.3.8 | ISC | `LICENSE` |
| `ipull` | 3.9.5 | MIT | `LICENSE` |
| `is-fullwidth-code-point` | 3.0.0 | MIT | `license` |
| `is-fullwidth-code-point` | 5.1.0 | MIT | `license` |
| `is-interactive` | 2.0.0 | MIT | `license` |
| `is-unicode-supported` | 2.1.0 | MIT | `license` |
| `isexe` | 2.0.0 | ISC | `LICENSE` |
| `isexe` | 4.0.0 | BlueOak-1.0.0 | `LICENSE.md` |
| `jsonfile` | 6.2.1 | MIT | `LICENSE` |
| `lifecycle-utils` | 2.1.0 | MIT | `LICENSE` |
| `lifecycle-utils` | 4.5.1 | MIT | `LICENSE` |
| `lodash.debounce` | 4.0.8 | MIT | `LICENSE` |
| `log-symbols` | 7.0.1 | MIT | `license` |
| `lowdb` | 7.0.1 | MIT | `LICENSE` |
| `mimic-function` | 5.0.1 | MIT | `license` |
| `minimist` | 1.2.8 | MIT | `LICENSE` |
| `minipass` | 7.1.3 | BlueOak-1.0.0 | `LICENSE.md` |
| `minizlib` | 3.1.0 | MIT | `LICENSE` |
| `ms` | 2.1.3 | MIT | `license.md` |
| `nanoid` | 5.1.16 | MIT | `LICENSE` |
| `node-addon-api` | 8.9.2 | MIT | `LICENSE.md` |
| `node-api-headers` | 1.9.0 | MIT | `LICENSE` |
| `node-llama-cpp` | 3.21.1 | MIT | `LICENSE` |
| `onetime` | 7.0.0 | MIT | `license` |
| `ora` | 9.4.1 | MIT | `license` |
| `parse-ms` | 3.0.0 | MIT | `license` |
| `parse-ms` | 4.0.0 | MIT | `license` |
| `path-key` | 3.1.1 | MIT | `license` |
| `pretty-bytes` | 6.1.1 | MIT | `license` |
| `pretty-ms` | 8.0.0 | MIT | `license` |
| `pretty-ms` | 9.3.1 | MIT | `license` |
| `proper-lockfile` | 4.1.2 | MIT | `LICENSE` |
| `rc` | 1.2.8 | (BSD-2-Clause OR MIT OR Apache-2.0) | `LICENSE.APACHE2`, `LICENSE.BSD`, `LICENSE.MIT` |
| `require-directory` | 2.1.1 | MIT | `LICENSE` |
| `restore-cursor` | 5.1.0 | MIT | `license` |
| `retry` | 0.12.0 | MIT | `License` |
| `retry` | 0.13.1 | MIT | `License` |
| `semver` | 7.8.5 | ISC | `LICENSE` |
| `shebang-command` | 2.0.0 | MIT | `license` |
| `shebang-regex` | 3.0.0 | MIT | `license` |
| `signal-exit` | 3.0.7 | ISC | `LICENSE.txt` |
| `signal-exit` | 4.1.0 | ISC | `LICENSE.txt` |
| `simple-git` | 3.36.0 | MIT | reproduced below |
| `sleep-promise` | 9.1.0 | MIT | `LICENSE.md` |
| `slice-ansi` | 7.1.2 | MIT | `license` |
| `slice-ansi` | 8.0.0 | MIT | `license` |
| `stdin-discarder` | 0.3.2 | MIT | `license` |
| `stdout-update` | 4.0.1 | MIT | `LICENSE` |
| `steno` | 4.0.2 | MIT | `LICENSE` |
| `string-width` | 4.2.3 | MIT | `license` |
| `string-width` | 7.2.0 | MIT | `license` |
| `string-width` | 8.2.2 | MIT | `license` |
| `strip-ansi` | 6.0.1 | MIT | `license` |
| `strip-ansi` | 7.2.0 | MIT | `license` |
| `strip-json-comments` | 2.0.1 | MIT | `license` |
| `tar` | 7.5.22 | BlueOak-1.0.0 | `LICENSE.md` |
| `universalify` | 2.0.1 | MIT | `LICENSE` |
| `url-join` | 4.0.1 | MIT | `LICENSE` |
| `validate-npm-package-name` | 7.0.2 | ISC | `LICENSE` |
| `which` | 2.0.2 | ISC | `LICENSE` |
| `which` | 6.0.1 | ISC | `LICENSE` |
| `wrap-ansi` | 7.0.0 | MIT | `license` |
| `y18n` | 5.0.8 | ISC | `LICENSE` |
| `yallist` | 5.0.0 | BlueOak-1.0.0 | `LICENSE.md` |
| `yargs-parser` | 21.1.1 | ISC | `LICENSE.txt` |
| `yargs` | 17.7.2 | MIT | `LICENSE` |
| `yoctocolors` | 2.2.0 | MIT | `license` |

### License texts reproduced here

#### `llama.cpp`

Compiled into the prebuilt `@node-llama-cpp/win-x64` binaries. Source:
<https://github.com/ggml-org/llama.cpp> (`LICENSE`, read 2026-09-24).

> MIT License
>
> Copyright (c) 2023-2026 The ggml authors
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
> OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
> CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

#### `simple-git@3.36.0`

#### `@simple-git/args-pathspec@1.0.3`

#### `@simple-git/argv-parser@1.1.1`

These three packages declare MIT and ship no license file. Source of the notice:
<https://github.com/steveukx/git-js> (`LICENSE`, read 2026-09-24).

> MIT License
>
> Copyright (c) 2025 Steve King
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
> OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
> CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

#### `@reflink/reflink@0.1.19`

#### `@reflink/reflink-win32-x64-msvc@0.1.19`

Both declare MIT in their package metadata and ship no license file, and their upstream repository
(<https://github.com/pnpm/reflink>) publishes none, so there is no copyright line to reproduce. The
copyright belongs to the authors of `pnpm/reflink`. The MIT terms they declare:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
> OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
> CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Local AI model pack (Qwen3.5-4B GGUF)

- Product: `Qwen3.5-4B-Q4_K_M.gguf`, from `lmstudio-community/Qwen3.5-4B-GGUF`
- Purpose: the optional local model for Phase L AI features
- License: Apache License 2.0
- Upstream: <https://huggingface.co/lmstudio-community/Qwen3.5-4B-GGUF> and the upstream Qwen release
- Identity pinned in `src/offline/AiModelManifest.ts`: 2,707,513,696 bytes, SHA-256
  `25082a7dd3776cc3c741c6347d3bd04523f05796607b3fbc32fa3a25dfa1418c`. Identity is the checksum, never
  the file name.

## Local AI model pack (Qwen3.5-0.8B GGUF)

- Product: `Qwen3.5-0.8B-Q4_K_M.gguf`, from `lmstudio-community/Qwen3.5-0.8B-GGUF`
- Purpose: the optional local model for Phase L AI features, the pack the L1.8 performance gate was
  re-scoped to
- License: Apache License 2.0
- Upstream: <https://huggingface.co/lmstudio-community/Qwen3.5-0.8B-GGUF> and the upstream Qwen release
- Identity pinned in `src/offline/AiModelManifest.ts`: 527,502,816 bytes, SHA-256
  `f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec`. Identity is the checksum, never
  the file name.

**The model packs are NOT bundled and are NOT redistributed.** They ship in no installer and appear in
no signed dependency manifest. The user supplies the file themselves and imports it through
Settings, where it is refused unless its checksum matches one of the entries above. Any future decision to
redistribute the weights requires a separate review of the upstream licence terms.

## Release responsibility

Before distributing a release outside the organization, the release owner must review the terms
embedded in the exact approved Chrome for Testing payload and confirm the intended distribution
channel and use remain permitted. The same applies to the Microsoft Visual C++ runtime files, under the
Visual Studio license of the installation that built the release. The build tooling proves version,
origin, and integrity; it does not provide legal advice.
