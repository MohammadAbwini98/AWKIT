/**
 * verify:app-icon — the committed Windows app icon is the current brand mark, pixel for pixel.
 *
 * What regression makes this fail?
 *   - resources/icon-source.png, resources/icon.png or any resources/icon.ico frame no longer matches
 *     app/renderer/assets/brand/awkit-app-icon.svg rendered through the same sharp pipeline as
 *     scripts/generate-app-icon.mjs;
 *   - the ICO loses a Windows size (256-16) or stops being 32-bit PNG/RGBA frames;
 *   - the accent brick is not the design-system primary accent #1d4ed8.
 *
 * Why: icon:generate once defaulted to the committed icon-source.png, so after the SVG changed it
 * exited 0 and rebuilt the old concept-1c spectrum mark byte for byte (awkit-icon2). Nothing compared
 * the outputs with the SVG, so "generated" was indistinguishable from "regenerated".
 *
 * Renders in memory and writes nothing, which is why it is classified static-source-validation.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const REPO_ROOT = process.cwd();
const BRAND_SVG = join(REPO_ROOT, "app", "renderer", "assets", "brand", "awkit-app-icon.svg");
const SIZES = [256, 128, 64, 48, 32, 24, 16];
const ACCENT = [0x1d, 0x4e, 0xd8];
const SUPERSEDED_ACCENT = [0x8b, 0x5c, 0xf6];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
// Centres in the 1024 master of the accent brick (rect x0 y190 130x150) and the top-right S block
// (rect x170 y0 130x150), both under translate(302,272) scale(1.4).
const BRICK = { x: 393, y: 643 };
const S_BLOCK = { x: 631, y: 377 };

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  OK ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

async function decode(image) {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function pixel(image, x, y) {
  const index = (y * image.width + x) * 4;
  return [...image.data.subarray(index, index + 4)];
}

function isColor(image, x, y, rgb, tolerance = 6) {
  const [r, g, b, a] = pixel(image, x, y);
  return a === 255 && [r, g, b].every((value, channel) => Math.abs(value - rgb[channel]) <= tolerance);
}

// Mean absolute channel difference, plus the share of pixels off by more than 16 in any channel: a
// whole-image mean dilutes a localized change such as one recoloured brick, the share does not.
// Pixels transparent in both images compare equal whatever RGB they carry.
function difference(expected, actual) {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return { same: false, detail: `${actual.width}x${actual.height}, expected ${expected.width}x${expected.height}` };
  }
  let total = 0;
  let offPixels = 0;
  for (let index = 0; index < expected.data.length; index += 4) {
    if (expected.data[index + 3] === 0 && actual.data[index + 3] === 0) continue;
    let worst = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(expected.data[index + channel] - actual.data[index + channel]);
      total += delta;
      worst = Math.max(worst, delta);
    }
    if (worst > 16) offPixels += 1;
  }
  const mean = total / expected.data.length;
  const off = offPixels / (expected.data.length / 4);
  return {
    same: mean <= 2 && off <= 0.005,
    detail: `mean channel diff ${mean.toFixed(2)}, ${(off * 100).toFixed(2)}% of pixels off by >16`
  };
}

function readIcoFrames(buffer) {
  if (buffer.length < 6) return [];
  const count = buffer.readUInt16LE(4);
  if (6 + count * 16 > buffer.length) return [];
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const length = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    return {
      size: buffer.readUInt8(entry) || 256,
      height: buffer.readUInt8(entry + 1) || 256,
      bitCount: buffer.readUInt16LE(entry + 6),
      inBounds: offset + length <= buffer.length,
      png: buffer.subarray(offset, offset + length)
    };
  });
}

function isRgbaPngFrame(frame) {
  const png = frame.png;
  return (
    frame.inBounds &&
    frame.bitCount === 32 &&
    frame.height === frame.size &&
    png.length > 26 &&
    png.subarray(0, 8).equals(PNG_SIGNATURE) &&
    png.readUInt32BE(16) === frame.size &&
    png.readUInt32BE(20) === frame.size &&
    png.readUInt8(24) === 8 &&
    png.readUInt8(25) === 6
  );
}

console.log("Brand SVG render (same pipeline as scripts/generate-app-icon.mjs):");
const meta = await sharp(BRAND_SVG).metadata();
const side = Math.min(meta.width ?? 0, meta.height ?? 0);
const square = await sharp(BRAND_SVG)
  .extract({
    left: Math.round(((meta.width ?? side) - side) / 2),
    top: Math.round(((meta.height ?? side) - side) / 2),
    width: side,
    height: side
  })
  .png()
  .toBuffer();
const render = await decode(sharp(square));
check("renders 1024x1024", render.width === 1024 && render.height === 1024, `${render.width}x${render.height}`);
check("corner is transparent (squircle clip)", pixel(render, 0, 0)[3] === 0, pixel(render, 0, 0).join(","));
check("brick is the primary accent #1d4ed8", isColor(render, BRICK.x, BRICK.y, ACCENT), pixel(render, BRICK.x, BRICK.y).join(","));
check("S block is #f6f6f6", isColor(render, S_BLOCK.x, S_BLOCK.y, [0xf6, 0xf6, 0xf6]), pixel(render, S_BLOCK.x, S_BLOCK.y).join(","));

console.log("Controls:");
// Positive: PNGs encoded exactly as the generator writes them pass, so a regenerated set cannot fail here.
const generatorEquivalent = await Promise.all(
  [1024, ...SIZES].map(async (size) => {
    const png = await sharp(square).resize(size, size, { fit: "cover" }).png().toBuffer();
    return difference(await decode(sharp(square).resize(size, size, { fit: "cover" })), await decode(sharp(png))).same;
  })
);
check("generator-equivalent PNGs (1024 + 7 ICO sizes) pass the pixel match", generatorEquivalent.length === 8 && generatorEquivalent.every(Boolean));
const recoloured = { ...render, data: Buffer.from(render.data) };
for (let y = BRICK.y - 90; y <= BRICK.y + 90; y += 1) {
  for (let x = BRICK.x - 80; x <= BRICK.x + 80; x += 1) recoloured.data.set(SUPERSEDED_ACCENT, (y * render.width + x) * 4);
}
check("a brick in the superseded accent #8b5cf6 fails the pixel match", !difference(render, recoloured).same);
check("a brick in the superseded accent #8b5cf6 fails the accent check", !isColor(recoloured, BRICK.x, BRICK.y, ACCENT));
check("a 512px image fails the 1024 pixel match", !difference(render, await decode(sharp(square).resize(512, 512))).same);

console.log("resources/icon-source.png:");
const sourcePng = await decode(sharp(join(REPO_ROOT, "resources", "icon-source.png")));
const sourceDiff = difference(render, sourcePng);
check("matches the brand SVG render", sourceDiff.same, sourceDiff.detail);

console.log("resources/icon.png:");
const master = await decode(sharp(join(REPO_ROOT, "resources", "icon.png")));
const masterDiff = difference(await decode(sharp(square).resize(1024, 1024, { fit: "cover" })), master);
check("matches the brand SVG render at 1024x1024", masterDiff.same, masterDiff.detail);
check("brick is the primary accent #1d4ed8", isColor(master, BRICK.x, BRICK.y, ACCENT), pixel(master, BRICK.x, BRICK.y).join(","));

console.log("resources/icon.ico:");
const ico = await readFile(join(REPO_ROOT, "resources", "icon.ico"));
check("header is reserved 0, type 1", ico.length >= 6 && ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1);
const frames = readIcoFrames(ico);
check(`has ${SIZES.length} frames`, frames.length === SIZES.length, `found ${frames.length}`);
check(`frame sizes are ${SIZES.join(",")}`, frames.map((frame) => frame.size).join(",") === SIZES.join(","), frames.map((frame) => frame.size).join(","));
for (const frame of frames) {
  const label = `${frame.size}x${frame.size} frame`;
  const wellFormed = isRgbaPngFrame(frame);
  check(`${label} is an in-bounds 32-bit PNG with 8-bit RGBA IHDR`, wellFormed);
  if (!wellFormed) continue;
  const actual = await decode(sharp(frame.png));
  const frameDiff = difference(await decode(sharp(square).resize(frame.size, frame.size, { fit: "cover" })), actual);
  check(`${label} matches the brand SVG render`, frameDiff.same, frameDiff.detail);
  if (frame.size === 256) {
    const [x, y] = [Math.round((BRICK.x * 256) / 1024), Math.round((BRICK.y * 256) / 1024)];
    check(`${label} brick is the primary accent #1d4ed8`, isColor(actual, x, y, ACCENT), pixel(actual, x, y).join(","));
  }
}

console.log(`\n${passed}/${passed + failed} app-icon checks passed`);
if (failed > 0) process.exit(1);
