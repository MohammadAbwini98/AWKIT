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
- Licenses: `node-llama-cpp` MIT (`node_modules/node-llama-cpp/LICENSE`); `llama.cpp` MIT
- CPU only. The host sets `build: "never"` and disables downloads, so a missing or unusable prebuilt
  binary is an error rather than a source build or a network fetch. The prebuilt CUDA and Vulkan
  variants npm installs alongside `@node-llama-cpp/win-x64` are never loaded and are not staged.

`node-llama-cpp` is a development dependency: it never enters `app.asar`, and its runtime tree is
staged beside the host in the same way as the Zvec native host.

## Local AI model pack (Qwen3.5-4B GGUF)

- Product: `Qwen3.5-4B-Q4_K_M.gguf`, from `lmstudio-community/Qwen3.5-4B-GGUF`
- Purpose: the optional local model for Phase L AI features
- License: Apache License 2.0
- Upstream: <https://huggingface.co/lmstudio-community/Qwen3.5-4B-GGUF> and the upstream Qwen release
- Identity pinned in `src/offline/AiModelManifest.ts`: 2,707,513,696 bytes, SHA-256
  `25082a7dd3776cc3c741c6347d3bd04523f05796607b3fbc32fa3a25dfa1418c`. Identity is the checksum, never
  the file name.

**The model pack is NOT bundled and is NOT redistributed.** It ships in no installer and appears in
no signed dependency manifest. The user supplies the file themselves and imports it through
Settings, where it is refused unless its checksum matches the entry above. Any future decision to
redistribute the weights requires a separate review of the upstream licence terms.

## Release responsibility

Before distributing a release outside the organization, the release owner must review the terms
embedded in the exact approved Chrome for Testing payload and confirm the intended distribution
channel and use remain permitted. The build tooling proves version, origin, and integrity; it does
not provide legal advice.
