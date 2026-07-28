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

## Release responsibility

Before distributing a release outside the organization, the release owner must review the terms
embedded in the exact approved Chrome for Testing payload and confirm the intended distribution
channel and use remain permitted. The build tooling proves version, origin, and integrity; it does
not provide legal advice.
