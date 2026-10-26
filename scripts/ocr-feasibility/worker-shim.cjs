"use strict";
/**
 * Worker-thread entry for the N7.1a spike. A worker thread has its own module instances, so the host's tripwire does
 * not reach it: install the same tripwire here (attempts are broadcast to the host), then load the real worker
 * script named by AWKIT_OCR_SPIKE_WORKER_TARGET.
 */
require("./host-common.cjs").installTripwire({ broadcast: true });
const target = process.env.AWKIT_OCR_SPIKE_WORKER_TARGET;
if (!target) throw new Error("AWKIT_OCR_SPIKE_WORKER_TARGET is not set");
require(target);
