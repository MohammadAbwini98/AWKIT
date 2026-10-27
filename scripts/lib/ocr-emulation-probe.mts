/**
 * N7.6 (awkit-vra.9.7): a fixed CPU workload timed in two runtimes, so the x64-under-ARM64-emulation share of the OCR
 * pipeline's cost can be told apart from the pipeline itself. benchmark:ocr runs it in its own Node process and the
 * calibration harness runs it inside Electron; both record `process.arch`. The workload is the production N7.2
 * preprocessing (pure JavaScript) on a deterministic synthetic image, and SHA-256 (native crypto) over a fixed buffer.
 * It reads no page, no file and no text.
 */
import { createHash } from "node:crypto";
import { preprocessForOcr } from "../../src/visual/ocr/preprocess";
import { VisualImage } from "../../src/visual/png";

export interface EmulationProbe {
  arch: string;
  platform: string;
  /** Median of 5 runs: the N7.2 preprocessing of a deterministic 400x120 RGBA plane at 10 px text (upscaled 4x). */
  preprocessMs: number;
  /** Median of 5 runs: SHA-256 over 16 MiB. */
  sha256Ms: number;
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export function runEmulationProbe(): EmulationProbe {
  const width = 400;
  const height = 120;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const v = ((i / 4) * 2654435761) >>> 24;
    data[i] = v;
    data[i + 1] = 255 - v;
    data[i + 2] = (v * 7) & 255;
    data[i + 3] = 255;
  }
  const pre: number[] = [];
  for (let run = 0; run < 5; run += 1) {
    const started = performance.now();
    const result = preprocessForOcr({ image: new VisualImage(width, height, data), fontSizeCssPx: 10, devicePixelRatio: 1 });
    pre.push(performance.now() - started);
    if (!result.ok) throw new Error(`emulation probe preprocessing refused: ${result.code}`);
  }
  const buffer = Buffer.alloc(16 * 1024 * 1024, 7);
  const sha: number[] = [];
  for (let run = 0; run < 5; run += 1) {
    const started = performance.now();
    createHash("sha256").update(buffer).digest("hex");
    sha.push(performance.now() - started);
  }
  return { arch: process.arch, platform: process.platform, preprocessMs: Math.round(median(pre) * 10) / 10, sha256Ms: Math.round(median(sha) * 10) / 10 };
}
