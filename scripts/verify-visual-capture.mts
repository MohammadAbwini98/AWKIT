/**
 * verify:visual-capture — Phase N, N0 (awkit-vra.1): visual capture foundation on real Chromium.
 *
 * First, the PNG decoder alone: exact round trips through every row filter (against a hand-built encoder and sharp),
 * and a malformed-input matrix — CRC corruption, every truncation prefix, every single-bit flip, unsupported formats,
 * chunk-order violations, oversize headers and a decompression bomb — each refused with a PngDecodeError.
 *
 * Then drives `captureViewport` / `captureElement` against the Feature Test Lab's /visual-intelligence pages at device
 * scale factors 1, 1.25, 1.5, 1.75 and 2 and asserts, against bounds computed independently from the fixtures' CSS:
 *   - viewport, element and context crops, and their device-pixel mapping (every pixel of a solid fixture is its fill);
 *   - fractional bounds round outward; CSS zoom; a same-origin iframe; a popup page; a clipped and an offscreen target;
 *   - /visual-intelligence/frames: a target two frames deep, one inside a frame that scrolled itself (and one whose
 *     frame scrolls DURING capture), and below-the-fold targets after the test scrolls the page;
 *   - a page whose devicePixelRatio disagrees with the screenshot's measured scale is refused, never cropped;
 *   - the error taxonomy (not unique, no match, zero size, not rendered, offscreen, moved during capture, wrong page,
 *     closed page, cancelled, budget exhausted);
 *   - protected refusal: the account route, an injected credential frame, OTP / MFA / CAPTCHA / passkey surfaces,
 *     protected step types and a handed-off session, and each surface appearing only AFTER the screenshot;
 *   - no side effects: no click, key, focus or scroll on the page, and no request leaves the local mock site;
 *   - a capture's JSON form omits image bytes; evidence holds no image at all.
 *
 * Mutation controls (each must flip the check it guards):
 *   - DPR scaling removed: cropping the same screenshot with scale 1 at DPR 2 must FAIL the exact-pixel predicate;
 *   - post-capture recheck skipped: a guard that only checks once must let the late credential frame through.
 *
 * Run: npm run verify:visual-capture
 */

import { spawn } from "node:child_process";
import { deflateSync } from "node:zlib";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import sharp from "sharp";

import { captureElement, captureViewport, type VisualCrop } from "@src/visual/capture";
import type { VisualResult } from "@src/visual/errors";
import { clampPixelRect, cssRectToPixelRect, scaleMatchesDevicePixelRatio, type CssRect } from "@src/visual/geometry";
import { cropImage, decodePng, PngDecodeError, type VisualImage } from "@src/visual/png";
import { checkProtectedSurface, type ProtectedGuardVerdict } from "@src/visual/protectedGuard";
import { buildVisualEvidence } from "@src/visual/visualEvidence";

const PORT = 4423;
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 800, height: 600 };

let passed = 0;
let failed = 0;
const failures: string[] = [];
let section = "";

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(`${section}: ${label}${detail ? ` — ${detail}` : ""}`);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const keepAlive = setInterval(() => undefined, 1_000);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function outcome(result: VisualResult<unknown>): string {
  return result.ok ? "ok" : result.code;
}

type Rgb = readonly [number, number, number];
const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 160, 0];
const ORANGE: Rgb = [255, 136, 0];
const BLUE: Rgb = [0, 0, 255];
const MAGENTA: Rgb = [255, 0, 255];
const CYAN: Rgb = [0, 255, 255];

function pixelIs(image: VisualImage, x: number, y: number, rgb: Rgb, tolerance = 1): boolean {
  const p = (y * image.width + x) * 4;
  return (
    Math.abs(image.data[p] - rgb[0]) <= tolerance &&
    Math.abs(image.data[p + 1] - rgb[1]) <= tolerance &&
    Math.abs(image.data[p + 2] - rgb[2]) <= tolerance &&
    image.data[p + 3] === 255
  );
}

/** Every pixel of the image (optionally inset) is the fill. */
function solid(image: VisualImage, rgb: Rgb, inset = 0): boolean {
  if (image.width <= 2 * inset || image.height <= 2 * inset) return false;
  for (let y = inset; y < image.height - inset; y++) {
    for (let x = inset; x < image.width - inset; x++) if (!pixelIs(image, x, y, rgb)) return false;
  }
  return true;
}

/** The exact-pixel predicate the mapping checks rely on: right size AND every pixel the fill. */
function exactSolidCrop(image: VisualImage, rgb: Rgb, width: number, height: number): boolean {
  return image.width === width && image.height === height && solid(image, rgb);
}

function near(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= tolerance;
}

function rectNear(a: CssRect, b: CssRect, tolerance = 0.01): boolean {
  return near(a.x, b.x, tolerance) && near(a.y, b.y, tolerance) && near(a.width, b.width, tolerance) && near(a.height, b.height, tolerance);
}

/** The device-pixel rect must cover the requested CSS rect completely (outward rounding). */
function covers(crop: VisualCrop, scale: number): boolean {
  const r = crop.requestedBounds;
  const a = crop.actualBounds;
  return a.x <= r.x * scale + 1e-6 && a.y <= r.y * scale + 1e-6 && a.x + a.width >= (r.x + r.width) * scale - 1e-6 && a.y + a.height >= (r.y + r.height) * scale - 1e-6;
}

const integral = (n: number): boolean => Math.abs(n - Math.round(n)) < 1e-6;

/**
 * A solid fixture's crop is its own pixels. When every edge of `box` lands on a whole device pixel at `dpr` the crop
 * must be exactly that box, pixel for pixel. When an edge lands mid-pixel (390 CSS px at 1.25 = 487.5) that edge
 * pixel is legitimately blended, so the crop must cover the box, overshoot by at most one pixel per side, and be the
 * fill everywhere inside a one-pixel inset. `frameOrigins` are the CSS viewport coordinates of every frame between
 * the page and the box: Chromium snaps a frame's content to a whole device pixel, so a mid-pixel frame origin
 * (402 CSS px at 1.25 = 502.5) shifts the content by up to half a pixel even when the box's own edges are whole.
 */
function mappedSolid(crop: VisualCrop, box: CssRect, rgb: Rgb, dpr: number, frameOrigins: number[] = []): boolean {
  if (!rectNear(crop.requestedBounds, box)) return false;
  const edges = [box.x * dpr, box.y * dpr, (box.x + box.width) * dpr, (box.y + box.height) * dpr, ...frameOrigins.map((n) => n * dpr)];
  if (edges.every(integral)) {
    const a = crop.actualBounds;
    return a.x === Math.round(edges[0]) && a.y === Math.round(edges[1]) && exactSolidCrop(crop.image, rgb, Math.round(box.width * dpr), Math.round(box.height * dpr));
  }
  return (
    covers(crop, dpr) &&
    crop.actualBounds.width <= Math.ceil(box.width * dpr) + 1 &&
    crop.actualBounds.height <= Math.ceil(box.height * dpr) + 1 &&
    solid(crop.image, rgb, 1)
  );
}

// ---------------------------------------------------------------------------------------------------------------
// A hand-built PNG encoder, independent of the decoder under test, for the malformed-input matrix.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function testCrc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array = new Uint8Array(0), length = data.length): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(length >>> 0, 0);
  out.write(type, 4, "latin1");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(testCrc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

interface Header {
  width: number;
  height: number;
  bitDepth?: number;
  colorType?: number;
  compression?: number;
  filterMethod?: number;
  interlace?: number;
}

function ihdr(h: Header): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(h.width >>> 0, 0);
  data.writeUInt32BE(h.height >>> 0, 4);
  data[8] = h.bitDepth ?? 8;
  data[9] = h.colorType ?? 6;
  data[10] = h.compression ?? 0;
  data[11] = h.filterMethod ?? 0;
  data[12] = h.interlace ?? 0;
  return chunk("IHDR", data);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A tEXt payload: keyword, NUL separator, text. */
const TEXT = Buffer.from(`Comment${String.fromCharCode(0)}lab`, "latin1");
const pngOf = (...chunks: Buffer[]): Buffer => Buffer.concat([SIGNATURE, ...chunks]);

/** Deterministic pseudo-random pixels (an LCG), so every row filter has real work to do. */
function noise(count: number, seed: number): Uint8Array {
  const out = new Uint8Array(count);
  let s = seed >>> 0;
  for (let i = 0; i < count; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

/** Filter raw rows the way a PNG encoder does; `filterFor(y)` picks the row's filter type (0-4, or anything to plant). */
function filterRows(pixels: Uint8Array, width: number, height: number, channels: number, filterFor: (y: number) => number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = filterFor(y);
    out[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const raw = pixels[y * stride + x];
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * (stride + 1) + 1 + x] = (raw - predictor) & 0xff;
    }
  }
  return out;
}

function decodeOutcome(bytes: Uint8Array): "ok" | "PngDecodeError" | string {
  try {
    decodePng(bytes);
    return "ok";
  } catch (error) {
    return error instanceof PngDecodeError ? "PngDecodeError" : `${(error as Error)?.name ?? typeof error}: ${(error as Error)?.message ?? ""}`;
  }
}

function sameRgba(image: VisualImage, pixels: Uint8Array, channels: number): boolean {
  if (image.data.length !== (pixels.length / channels) * 4) return false;
  for (let i = 0, j = 0; i < image.data.length; i += 4, j += channels) {
    if (image.data[i] !== pixels[j] || image.data[i + 1] !== pixels[j + 1] || image.data[i + 2] !== pixels[j + 2]) return false;
    if (image.data[i + 3] !== (channels === 4 ? pixels[j + 3] : 255)) return false;
  }
  return true;
}

async function pngMatrix(): Promise<void> {
  console.log("\nPNG decoder, valid and malformed input:\n");
  const W = 7;
  const H = 6;
  const rgba = noise(W * H * 4, 7);
  const rgb = noise(W * H * 3, 11);
  const cycle = (y: number): number => y % 5;
  const rgbaIdat = deflateSync(filterRows(rgba, W, H, 4, cycle));
  const valid = pngOf(ihdr({ width: W, height: H }), chunk("IDAT", rgbaIdat), chunk("IEND"));

  const decoded = decodePng(valid);
  check("an RGBA image using every row filter (0-4) round-trips exactly", decoded.width === W && decoded.height === H && sameRgba(decoded, rgba, 4));
  const rgbPng = pngOf(ihdr({ width: W, height: H, colorType: 2 }), chunk("IDAT", deflateSync(filterRows(rgb, W, H, 3, cycle))), chunk("IEND"));
  check("an RGB image using every row filter round-trips exactly, opaque", decodeOutcome(rgbPng) === "ok" && sameRgba(decodePng(rgbPng), rgb, 3));
  const third = Math.ceil(rgbaIdat.length / 3);
  const split = pngOf(ihdr({ width: W, height: H }), chunk("IDAT", rgbaIdat.subarray(0, third)), chunk("IDAT", rgbaIdat.subarray(third, 2 * third)), chunk("IDAT", rgbaIdat.subarray(2 * third)), chunk("IEND"));
  check("image data split over consecutive IDAT chunks decodes", decodeOutcome(split) === "ok" && sameRgba(decodePng(split), rgba, 4));
  const ancillary = pngOf(ihdr({ width: W, height: H }), chunk("tEXt", TEXT), chunk("IDAT", rgbaIdat), chunk("teST", Buffer.from([1, 2])), chunk("IEND"));
  check("unknown ancillary chunks are skipped", decodeOutcome(ancillary) === "ok" && sameRgba(decodePng(ancillary), rgba, 4));
  const onePixel = pngOf(ihdr({ width: 1, height: 1 }), chunk("IDAT", deflateSync(Buffer.from([0, 1, 2, 3, 4]))), chunk("IEND"));
  check("a 1x1 image decodes", decodeOutcome(onePixel) === "ok" && Array.from(decodePng(onePixel).data).join(",") === "1,2,3,4");

  for (const [label, encode] of [
    ["sharp, adaptive filtering, RGBA", (raw: Buffer) => sharp(raw, { raw: { width: 37, height: 23, channels: 4 } }).png({ adaptiveFiltering: true, compressionLevel: 9 }).toBuffer()],
    ["sharp, RGB", (raw: Buffer) => sharp(raw, { raw: { width: 37, height: 23, channels: 4 } }).removeAlpha().png({ adaptiveFiltering: true }).toBuffer()]
  ] as const) {
    const raw = Buffer.from(noise(37 * 23 * 4, 23));
    for (let i = 3; i < raw.length; i += 4) raw[i] = 255;
    const encoded = await encode(raw);
    const reference = await sharp(encoded).ensureAlpha().raw().toBuffer();
    const ours = decodeOutcome(encoded) === "ok" ? decodePng(encoded) : null;
    check(`decodePng matches an independent encoder byte for byte (${label})`, !!ours && Buffer.compare(Buffer.from(ours.data), reference) === 0);
  }

  // Every malformed input must be refused with a PngDecodeError — never a RangeError, TypeError or a wrong image.
  const refusals: Array<[string, Buffer]> = [];
  const refuse = (label: string, bytes: Buffer): void => {
    refusals.push([label, bytes]);
  };
  const header = ihdr({ width: W, height: H });
  const idat = chunk("IDAT", rgbaIdat);
  const iend = chunk("IEND");
  const corrupt = (bytes: Buffer, at: number): Buffer => {
    const copy = Buffer.from(bytes);
    copy[at] ^= 0x01;
    return copy;
  };
  const ihdrEnd = 8 + header.length;
  const idatEnd = ihdrEnd + idat.length;
  refuse("a wrong signature", corrupt(valid, 1));
  refuse("an IHDR CRC mismatch", corrupt(valid, ihdrEnd - 1));
  refuse("an IHDR data byte flipped under its old CRC", corrupt(valid, 8 + 8 + 2));
  refuse("an IDAT CRC mismatch", corrupt(valid, idatEnd - 1));
  refuse("an IDAT data byte flipped under its old CRC", corrupt(valid, ihdrEnd + 8 + 5));
  refuse("an IEND CRC mismatch", corrupt(valid, valid.length - 1));
  refuse("width 0", pngOf(ihdr({ width: 0, height: H }), idat, iend));
  refuse("height 0", pngOf(ihdr({ width: W, height: 0 }), idat, iend));
  refuse("a header over the pixel ceiling (65536 x 65536)", pngOf(ihdr({ width: 65536, height: 65536 }), idat, iend));
  refuse("a header of 2^32-1 x 2^32-1", pngOf(ihdr({ width: 0xffffffff, height: 0xffffffff }), idat, iend));
  refuse("an image data stream that does not inflate", pngOf(header, chunk("IDAT", noise(64, 3)), iend));
  refuse("too little image data", pngOf(header, chunk("IDAT", deflateSync(filterRows(rgba, W, H, 4, cycle).subarray(0, 50))), iend));
  refuse("too much image data", pngOf(header, chunk("IDAT", deflateSync(Buffer.concat([filterRows(rgba, W, H, 4, cycle), Buffer.alloc(9)]))), iend));
  refuse("a decompression bomb (1x1 header, 16 MB of zeros)", pngOf(ihdr({ width: 1, height: 1 }), chunk("IDAT", deflateSync(Buffer.alloc(16 * 1024 * 1024))), iend));
  for (const colorType of [0, 3, 4]) refuse(`colour type ${colorType}`, pngOf(ihdr({ width: W, height: H, colorType }), idat, iend));
  for (const bitDepth of [1, 2, 4, 16]) refuse(`bit depth ${bitDepth}`, pngOf(ihdr({ width: W, height: H, bitDepth }), idat, iend));
  refuse("an interlaced image", pngOf(ihdr({ width: W, height: H, interlace: 1 }), idat, iend));
  refuse("compression method 1", pngOf(ihdr({ width: W, height: H, compression: 1 }), idat, iend));
  refuse("filter method 1", pngOf(ihdr({ width: W, height: H, filterMethod: 1 }), idat, iend));
  refuse("row filter type 5", pngOf(header, chunk("IDAT", deflateSync(filterRows(rgba, W, H, 4, (y) => (y === 3 ? 5 : 0)))), iend));
  refuse("a transparency (tRNS) chunk", pngOf(header, chunk("tRNS", Buffer.from([0, 0, 0, 0, 0, 0])), idat, iend));
  refuse("an unknown critical chunk", pngOf(header, chunk("XYZW", Buffer.from([1])), idat, iend));
  refuse("IDAT before IHDR", pngOf(idat, header, iend));
  refuse("an ancillary chunk before IHDR", pngOf(chunk("tEXt", TEXT), header, idat, iend));
  refuse("a second IHDR", pngOf(header, header, idat, iend));
  refuse("an IHDR of the wrong length", pngOf(chunk("IHDR", Buffer.alloc(12)), idat, iend));
  refuse("IDAT chunks that are not consecutive", pngOf(header, chunk("IDAT", rgbaIdat.subarray(0, third)), chunk("tEXt", TEXT), chunk("IDAT", rgbaIdat.subarray(third)), iend));
  refuse("no IDAT", pngOf(header, iend));
  refuse("no IEND", pngOf(header, idat));
  refuse("no IHDR", pngOf(idat, iend));
  refuse("a chunk length of 0xFFFFFFFF", pngOf(header, chunk("IDAT", rgbaIdat, 0xffffffff), iend));
  refuse("a chunk type that is not four letters", pngOf(header, chunk("ID1T", rgbaIdat), iend));
  refuse("an empty input", Buffer.alloc(0));
  refuse("the signature alone", Buffer.from(SIGNATURE));

  const leaks: string[] = [];
  let slowest = 0;
  for (const [label, bytes] of refusals) {
    const started = performance.now();
    const result = decodeOutcome(bytes);
    slowest = Math.max(slowest, performance.now() - started);
    if (result !== "PngDecodeError") leaks.push(`${label}: ${result}`);
  }
  check(`every malformed input (${refusals.length}) is refused with a PngDecodeError`, refusals.length >= 38 && leaks.length === 0, leaks.join("; "));
  check("...and every refusal is fast (no unbounded inflate or allocation)", slowest < 2000, `${slowest.toFixed(0)} ms`);

  const prefixLeaks: number[] = [];
  for (let length = 0; length < valid.length; length++) {
    if (decodeOutcome(valid.subarray(0, length)) !== "PngDecodeError") prefixLeaks.push(length);
  }
  check(`every truncation of a valid PNG (${valid.length} prefixes) is refused with a PngDecodeError`, valid.length > 50 && prefixLeaks.length === 0, `leaked at lengths ${prefixLeaks.join(",")}`);

  const flipLeaks: number[] = [];
  for (let at = 8; at < valid.length; at++) {
    const result = decodeOutcome(corrupt(valid, at));
    if (result !== "PngDecodeError") flipLeaks.push(at);
  }
  check("every single-bit flip after the signature is refused (CRC or structure), never decoded", flipLeaks.length === 0, `decoded after flipping byte ${flipLeaks.join(",")}`);
}

// ---------------------------------------------------------------------------------------------------------------

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${BASE}/visual-intelligence`);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(100);
  }
  throw new Error("mock site did not start");
}

async function openLab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/visual-intelligence`);
  await page.frameLocator('[data-testid="vi-frame"]').getByTestId("vi-frame-target").waitFor();
  return page;
}

async function interactions(page: Page): Promise<{ count: number; scrollY: number }> {
  return page.evaluate("({ count: window.__visualLab.interactions, scrollY: window.scrollY })") as Promise<{ count: number; scrollY: number }>;
}

async function injectAccountFrame(page: Page): Promise<void> {
  await page.evaluate("window.__visualLab.injectAccountFrame()");
  await page.frameLocator('[data-testid="vi-account-frame"]').locator('input[type="password"]').waitFor();
}

const server = spawn(process.execPath, ["mock-site/server.mjs"], {
  env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
  stdio: ["ignore", "ignore", "inherit"],
  windowsHide: true
});

let browser: Browser | undefined;
try {
  section = "PNG";
  await pngMatrix();
  section = "scale";

  console.log("\nScale consistency (browser zoom):\n");
  check("a measured scale equal to devicePixelRatio is consistent (1.25)", scaleMatchesDevicePixelRatio({ scaleX: 1.25, scaleY: 1.25 }, 1.25, 800, 600));
  check("...within one pixel of rounding (Chromium at 110% zoom: 1000 px over 909 CSS px)", scaleMatchesDevicePixelRatio({ scaleX: 1000 / 909, scaleY: 660 / 600 }, 1.1, 909, 600));
  check("a scale that disagrees with devicePixelRatio is inconsistent", !scaleMatchesDevicePixelRatio({ scaleX: 1, scaleY: 1 }, 1.5, 800, 600) && !scaleMatchesDevicePixelRatio({ scaleX: 1.1, scaleY: 1.1 }, 1, 800, 600));
  check("a non-finite or zero devicePixelRatio is inconsistent", !scaleMatchesDevicePixelRatio({ scaleX: 1, scaleY: 1 }, Number.NaN, 800, 600) && !scaleMatchesDevicePixelRatio({ scaleX: 1, scaleY: 1 }, 0, 800, 600));

  await waitForServer();
  browser = await chromium.launch();

  const offSite: string[] = [];

  for (const dpr of [1, 1.25, 1.5, 1.75, 2]) {
    section = `DPR ${dpr}`;
    console.log(`\nDevice scale factor ${dpr}:\n`);
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: dpr });
    context.on("request", (request) => {
      if (!request.url().startsWith(BASE) && !request.url().startsWith("about:")) offSite.push(request.url());
    });
    const page = await openLab(context);
    const before = await interactions(page);

    const viewport = await captureViewport(page);
    check("viewport capture succeeds", viewport.ok, outcome(viewport));
    if (viewport.ok) {
      const v = viewport.value;
      check("the screenshot is the viewport at device scale", v.image.width === VIEWPORT.width * dpr && v.image.height === VIEWPORT.height * dpr, `${v.image.width}x${v.image.height}`);
      check("the measured scale is the device scale factor on both axes", v.viewport.scaleX === dpr && v.viewport.scaleY === dpr && v.viewport.devicePixelRatio === dpr, JSON.stringify(v.viewport));
      check("the calibration fill is where its CSS puts it", pixelIs(v.image, Math.floor(70 * dpr), Math.floor(50 * dpr), RED) && pixelIs(v.image, Math.floor(10 * dpr), Math.floor(10 * dpr), [255, 255, 255]));
      const json = JSON.stringify(v);
      check("the capture's JSON form omits the image bytes", json.length < 1000 && json.includes("[omitted]"), `${json.length} chars`);
    }

    const red = await captureElement(page, page.getByTestId("vi-cal-red"));
    check("element capture succeeds", red.ok, outcome(red));
    if (red.ok) {
      const crop = red.value.element;
      check("requested bounds are the element's CSS box", rectNear(crop.requestedBounds, { x: 20, y: 20, width: 100, height: 60 }), JSON.stringify(crop.requestedBounds));
      check(
        "actual bounds are that box in device pixels",
        crop.actualBounds.x === 20 * dpr && crop.actualBounds.y === 20 * dpr && crop.actualBounds.width === 100 * dpr && crop.actualBounds.height === 60 * dpr,
        JSON.stringify(crop.actualBounds)
      );
      check("every pixel of the element crop is the fill", exactSolidCrop(crop.image, RED, 100 * dpr, 60 * dpr));
      check("the element crop is not clipped", crop.wasClipped === false);
      check("the frame is the main frame", red.value.frame.isMainFrame && red.value.frame.depth === 0);

      const context24 = red.value.context;
      check("a context crop is produced by default", !!context24);
      if (context24) {
        check("the context request is the box padded by 24 CSS px", rectNear(context24.requestedBounds, { x: -4, y: -4, width: 148, height: 108 }), JSON.stringify(context24.requestedBounds));
        check("...clipped at the viewport's top-left edge", context24.wasClipped && rectNear(context24.actualCssBounds, { x: 0, y: 0, width: 144, height: 104 }), JSON.stringify(context24.actualCssBounds));
        check("...and it contains the element's fill at the element's offset", pixelIs(context24.image, Math.floor(70 * dpr), Math.floor(50 * dpr), RED) && pixelIs(context24.image, Math.floor(2 * dpr), Math.floor(2 * dpr), [255, 255, 255]));
      }

      const evidence = buildVisualEvidence(red.value);
      const evidenceJson = evidence.ok ? JSON.stringify(evidence.value) : "";
      check("evidence builds within its size ceiling and holds no image", evidence.ok && evidenceJson.length <= 4096 && !evidenceJson.includes("[omitted]") && !/"data"/.test(evidenceJson), `${evidenceJson.length} chars`);
    }

    const noContext = await captureElement(page, page.getByTestId("vi-cal-red"), { contextPaddingCss: 0 });
    check("padding 0 omits the context crop", noContext.ok && noContext.value.context === undefined);

    if (dpr === 2 && viewport.ok) {
      // Mutation: the same screenshot, cropped as if DPR were 1. The exact-pixel predicate must reject it.
      const box = { x: 20, y: 20, width: 100, height: 60 };
      const unscaled = clampPixelRect(cssRectToPixelRect(box, { scaleX: 1, scaleY: 1 }), viewport.value.image.width, viewport.value.image.height);
      const mutant = unscaled ? cropImage(viewport.value.image, unscaled.rect) : null;
      check("MUTATION: removing DPR scaling fails the exact-pixel check", !!mutant && !exactSolidCrop(mutant, RED, 100 * dpr, 60 * dpr) && !solid(mutant, RED));
      const scaled = clampPixelRect(cssRectToPixelRect(box, { scaleX: dpr, scaleY: dpr }), viewport.value.image.width, viewport.value.image.height);
      check("...while the scaled crop of the same screenshot passes it", !!scaled && exactSolidCrop(cropImage(viewport.value.image, scaled.rect), RED, 100 * dpr, 60 * dpr));
    }

    const fraction = await captureElement(page, page.getByTestId("vi-cal-fraction"));
    check("a fractional box is captured", fraction.ok, outcome(fraction));
    if (fraction.ok) {
      const crop = fraction.value.element;
      check("its requested bounds keep the fractions", rectNear(crop.requestedBounds, { x: 140.5, y: 20.25, width: 50.5, height: 30.75 }, 0.02), JSON.stringify(crop.requestedBounds));
      check("its device-pixel crop rounds outward to cover the whole box", covers(crop, dpr) && crop.actualBounds.width <= Math.ceil(50.5 * dpr) + 1, JSON.stringify(crop.actualBounds));
      check("its interior is the fill", solid(crop.image, GREEN, 2));
    }

    const zoom = await captureElement(page, page.getByTestId("vi-zoom-inner"));
    check("a CSS-zoomed box maps to its zoomed size", zoom.ok && mappedSolid(zoom.value.element, { x: 260, y: 20, width: 60, height: 60 }, ORANGE, dpr), zoom.ok ? JSON.stringify(zoom.value.element.actualBounds) : outcome(zoom));

    const framed = await captureElement(page, page.frameLocator('[data-testid="vi-frame"]').getByTestId("vi-frame-target"));
    check("an iframe target is captured", framed.ok, outcome(framed));
    if (framed.ok) {
      check("its frame is reported as a depth-1 child", !framed.value.frame.isMainFrame && framed.value.frame.depth === 1);
      check("its bounds are mapped into the main viewport (frame origin + target offset)", rectNear(framed.value.element.requestedBounds, { x: 390, y: 40, width: 80, height: 40 }), JSON.stringify(framed.value.element.requestedBounds));
      check(
        `the frame crop is the frame target's fill (${integral(390 * dpr) ? "exact" : "390 CSS px is mid-pixel: covered, inset solid"})`,
        mappedSolid(framed.value.element, { x: 390, y: 40, width: 80, height: 40 }, BLUE, dpr, [360, 20]),
        JSON.stringify(framed.value.element.actualBounds)
      );
    }

    const clipped = await captureElement(page, page.getByTestId("vi-clipped"), { contextPaddingCss: 0 });
    check("a half-visible target is captured", clipped.ok, outcome(clipped));
    if (clipped.ok) {
      const crop = clipped.value.element;
      check("...flagged wasClipped", crop.wasClipped === true);
      check("...cut at the viewport edge", near(crop.actualCssBounds.x + crop.actualCssBounds.width, VIEWPORT.width, 1 / dpr) && near(crop.actualCssBounds.width, 50, 1 / dpr), JSON.stringify(crop.actualCssBounds));
      // Its left edge (750 CSS px) is mid-pixel at 1.25 and 1.75, so that edge column is legitimately blended.
      check("...and the visible part is the fill", solid(crop.image, CYAN, integral(750 * dpr) ? 0 : 1));
    }

    const after = await interactions(page);
    check("no capture clicked, typed, focused or scrolled the page", after.count === before.count && after.scrollY === before.scrollY && after.scrollY === 0, JSON.stringify({ before, after }));

    // Frames: two deep, inside a frame that scrolled itself, and below the fold after the TEST scrolls the page.
    const frames = await context.newPage();
    await frames.goto(`${BASE}/visual-intelligence/frames`);
    const nestedTarget = frames.frameLocator('[data-testid="vi-frames-nested"]').frameLocator('[data-testid="vi-frame-inner"]').getByTestId("vi-frame-target");
    const scrolledFrame = frames.frameLocator('[data-testid="vi-frames-scrolled"]');
    const belowTarget = frames.frameLocator('[data-testid="vi-frames-below"]').getByTestId("vi-frame-target");
    await nestedTarget.waitFor();
    await scrolledFrame.locator("body[data-scrolled]").waitFor();
    await belowTarget.waitFor({ state: "attached" });
    check("the scrolled frame scrolled its own document to 260", (await scrolledFrame.locator("body").getAttribute("data-scrolled")) === "260");

    const nested = await captureElement(frames, nestedTarget);
    check("a target two frames deep is captured", nested.ok, outcome(nested));
    if (nested.ok) {
      check("...reported as depth 2", !nested.value.frame.isMainFrame && nested.value.frame.depth === 2, JSON.stringify(nested.value.frame));
      check("...mapped through both frame origins, pixel for pixel", mappedSolid(nested.value.element, { x: 92, y: 80, width: 80, height: 40 }, BLUE, dpr, [40, 40, 40 + 22, 40 + 20]), JSON.stringify(nested.value.element.actualBounds));
    }
    const inScrolled = await captureElement(frames, scrolledFrame.getByTestId("vi-frame-target"));
    check("a target inside a frame scrolled by its own document is captured", inScrolled.ok, outcome(inScrolled));
    if (inScrolled.ok) {
      check("...mapped with the frame's inner scroll applied, pixel for pixel", mappedSolid(inScrolled.value.element, { x: 432, y: 100, width: 80, height: 40 }, BLUE, dpr, [402, 40, 40 - 260]), JSON.stringify(inScrolled.value.element.requestedBounds));
    }
    const frameScroll = { afterScreenshot: (p: Page) => p.frames().find((f) => f.url().includes("scroll=1"))!.evaluate("window.scrollTo(0, 280)").then(() => undefined) };
    check("a frame that scrolls during capture makes its target TARGET_STALE", outcome(await captureElement(frames, scrolledFrame.getByTestId("vi-frame-target"), {}, frameScroll)) === "TARGET_STALE");

    check("a frame target below the fold is TARGET_OFFSCREEN", outcome(await captureElement(frames, belowTarget)) === "TARGET_OFFSCREEN");
    await frames.evaluate("window.scrollTo(0, 800)");
    await frames.waitForFunction("window.scrollY === 800");
    const below = await captureElement(frames, belowTarget);
    check("after the page scrolls, the frame target is mapped at its post-scroll position, pixel for pixel", below.ok && mappedSolid(below.value.element, { x: 72, y: 120, width: 80, height: 40 }, BLUE, dpr, [42, 900 - 800]), below.ok ? JSON.stringify(below.value.element.requestedBounds) : outcome(below));
    const belowSolid = await captureElement(frames, frames.getByTestId("vi-frames-below-solid"));
    check("...and so is a page-level box", belowSolid.ok && mappedSolid(belowSolid.value.element, { x: 400, y: 100, width: 80, height: 40 }, [0, 255, 0], dpr), belowSolid.ok ? JSON.stringify(belowSolid.value.element.requestedBounds) : outcome(belowSolid));
    const scrolledViewport = await captureViewport(frames);
    check(
      "the post-scroll viewport capture holds the scrolled content, and capture left the scroll where the test put it",
      scrolledViewport.ok && pixelIs(scrolledViewport.value.image, Math.floor(440 * dpr), Math.floor(120 * dpr), [0, 255, 0]) && (await frames.evaluate("window.scrollY")) === 800
    );
    await frames.close();
    await context.close();
  }

  section = "after DPR";
  console.log("\nError taxonomy:\n");
  {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await openLab(context);
    check("more than one match is TARGET_NOT_UNIQUE", outcome(await captureElement(page, page.locator(".vi-row-open"))) === "TARGET_NOT_UNIQUE");
    check("no match is TARGET_STALE", outcome(await captureElement(page, page.getByTestId("vi-not-on-the-page"))) === "TARGET_STALE");
    check("a zero-size box is INVALID_BOUNDS", outcome(await captureElement(page, page.getByTestId("vi-cal-zero"))) === "INVALID_BOUNDS");
    check("a box that is not rendered is INVALID_BOUNDS", outcome(await captureElement(page, page.getByTestId("vi-cal-none"))) === "INVALID_BOUNDS");
    check("a target below the fold is TARGET_OFFSCREEN (never scrolled to)", outcome(await captureElement(page, page.getByTestId("vi-offscreen"))) === "TARGET_OFFSCREEN" && (await page.evaluate("window.scrollY")) === 0);

    const moved = await captureElement(page, page.getByTestId("vi-mover"), {}, { afterScreenshot: (p) => p.evaluate("window.__visualLab.moveMover()").then(() => undefined) });
    check("a target that moves during capture is TARGET_STALE, not a crop of the old box", outcome(moved) === "TARGET_STALE", outcome(moved));

    const controller = new AbortController();
    controller.abort();
    check("an aborted signal is CANCELLED", outcome(await captureViewport(page, { signal: controller.signal })) === "CANCELLED");
    const slowGuard = async (): Promise<ProtectedGuardVerdict> => {
      await sleep(400);
      return { protected: false };
    };
    const started = Date.now();
    const exhausted = await captureViewport(page, { timeoutMs: 150 }, { guard: slowGuard });
    check("a call over budget is BUDGET_EXHAUSTED, inside the budget", outcome(exhausted) === "BUDGET_EXHAUSTED" && Date.now() - started < 400, `${outcome(exhausted)} after ${Date.now() - started} ms`);

    console.log("\nActive page, popup and wrong page:\n");
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByTestId("vi-open-popup").click()]);
    await popup.getByTestId("vi-popup-target").waitFor();
    const popupCapture = await captureElement(popup, popup.getByTestId("vi-popup-target"));
    check("the popup's target is captured from the popup page", popupCapture.ok && exactSolidCrop(popupCapture.value.element.image, MAGENTA, 120, 50), outcome(popupCapture));
    const parentAfterPopup = await captureViewport(page);
    check("the parent page still captures its own pixels while the popup is open", parentAfterPopup.ok && pixelIs(parentAfterPopup.value.image, 70, 50, RED));
    check("a locator from another page is FRAME_MAPPING_FAILED", outcome(await captureElement(page, popup.getByTestId("vi-popup-target"))) === "FRAME_MAPPING_FAILED");
    await popup.close();
    check("a closed page is PAGE_CLOSED", outcome(await captureViewport(popup)) === "PAGE_CLOSED");
    await context.close();
  }

  console.log("\nProtected surfaces:\n");
  {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await openLab(context);
    const plain = await checkProtectedSurface(page);
    check("NEGATIVE CONTROL: the lab itself is not a protected surface", plain.protected === false, JSON.stringify(plain));
    check("...so captures on it succeed", (await captureViewport(page)).ok);

    const account = await context.newPage();
    await account.goto(`${BASE}/visual-intelligence/account`);
    check("the account route's viewport is refused", outcome(await captureViewport(account)) === "PROTECTED_SURFACE");
    check("an ordinary button on the account route is refused too", outcome(await captureElement(account, account.getByTestId("vi-account-continue"))) === "PROTECTED_SURFACE");

    await injectAccountFrame(page);
    check("an injected credential frame refuses the whole page", outcome(await captureViewport(page)) === "PROTECTED_SURFACE");
    check("...including a target outside that frame", outcome(await captureElement(page, page.getByTestId("vi-cal-red"))) === "PROTECTED_SURFACE");
    await page.evaluate("window.__visualLab.removeAccountFrame()");
    check("removing the frame lifts the refusal", (await captureViewport(page)).ok);

    for (const kind of ["otp", "mfa", "captcha", "passkey"]) {
      const inject = (p: Page): Promise<void> => p.evaluate(`window.__visualLab.injectProtected(${JSON.stringify(kind)})`).then(() => undefined);
      await inject(page);
      const verdict = await checkProtectedSurface(page);
      check(`${kind}: the guard reports the surface protected`, verdict.protected === true, JSON.stringify(verdict));
      check(`${kind}: viewport and element captures are refused`, outcome(await captureViewport(page)) === "PROTECTED_SURFACE" && outcome(await captureElement(page, page.getByTestId("vi-cal-red"))) === "PROTECTED_SURFACE");
      await page.evaluate("window.__visualLab.removeProtected()");
      check(`${kind}: removing it lifts the refusal (so the case discriminates)`, (await captureViewport(page)).ok);
      const lateKind = await captureElement(page, page.getByTestId("vi-cal-red"), {}, { afterScreenshot: inject });
      check(`${kind}: appearing only after the screenshot is still refused`, outcome(lateKind) === "PROTECTED_SURFACE" && !lateKind.ok && lateKind.message.includes("after capture"), lateKind.ok ? "ok" : lateKind.message);
      await page.evaluate("window.__visualLab.removeProtected()");
    }

    for (const stepType of ["protectedLoginHandoff", "autoSecureLogin", "reuseSession"]) {
      check(`step type ${stepType} is refused before the page is read`, outcome(await captureViewport(page, { stepType })) === "PROTECTED_SURFACE");
    }
    check("a handed-off session is refused", outcome(await captureElement(page, page.getByTestId("vi-cal-red"), { handedOff: true })) === "PROTECTED_SURFACE");
    check("NEGATIVE CONTROL: an ordinary step type is not refused", (await captureViewport(page, { stepType: "click" })).ok);

    const late = { afterScreenshot: (p: Page) => injectAccountFrame(p) };
    const lateViewport = await captureViewport(page, {}, late);
    check("a credential frame that appears after the screenshot is still refused", outcome(lateViewport) === "PROTECTED_SURFACE" && !lateViewport.ok && lateViewport.message.includes("after capture"), lateViewport.ok ? "ok" : lateViewport.message);
    await page.evaluate("window.__visualLab.removeAccountFrame()");
    const lateElement = await captureElement(page, page.getByTestId("vi-cal-red"), {}, late);
    check("...for an element capture too", outcome(lateElement) === "PROTECTED_SURFACE");
    await page.evaluate("window.__visualLab.removeAccountFrame()");

    // Mutation: a guard that only checks before the screenshot (the recheck skipped) must let the late frame through.
    let calls = 0;
    const checkOnce = (p: Page): Promise<ProtectedGuardVerdict> => (calls++ === 0 ? checkProtectedSurface(p) : Promise.resolve({ protected: false }));
    const mutant = await captureViewport(page, {}, { ...late, guard: checkOnce });
    check("MUTATION: skipping the post-capture recheck lets the late frame through (so the case discriminates)", mutant.ok && calls === 2, outcome(mutant));
    await context.close();
  }

  console.log("\nBrowser zoom / device-pixel-ratio disagreement:\n");
  {
    // Playwright has no browser-zoom API, so a real Ctrl+zoom is not driven here. Chromium folds zoom into
    // devicePixelRatio (so a zoomed page stays consistent and maps exactly); what must never happen is a crop when
    // the page's ratio and the screenshot's measured scale disagree. A page reporting 1.5 at a 1x screenshot is that.
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    await context.addInitScript("Object.defineProperty(window, 'devicePixelRatio', { get: () => 1.5, configurable: true })");
    const page = await openLab(context);
    check("the spoof is in effect", (await page.evaluate("window.devicePixelRatio")) === 1.5);
    check("a viewport capture whose scale disagrees with devicePixelRatio is CAPTURE_UNAVAILABLE", outcome(await captureViewport(page)) === "CAPTURE_UNAVAILABLE");
    check("...and so is an element capture (never a crop at a guessed offset)", outcome(await captureElement(page, page.getByTestId("vi-cal-red"))) === "CAPTURE_UNAVAILABLE");
    await context.close();
  }

  check("no request left the local mock site", offSite.length === 0, offSite.join(", "));
} catch (error) {
  failed += 1;
  console.error(error);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  server.kill();
  clearInterval(keepAlive);
}

if (failures.length > 0) console.error(`\nFailed:\n${failures.map((f) => `  ✗ ${f}`).join("\n")}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
