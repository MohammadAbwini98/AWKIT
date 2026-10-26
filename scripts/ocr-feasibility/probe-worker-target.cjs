"use strict";
// Harness self-test only: a worker-thread network attempt the shim's tripwire must catch and report.
fetch("https://example.invalid/probe").catch(() => {});
