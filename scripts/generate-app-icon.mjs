// Generates the Windows application icon (resources/icon.ico) and a 1024px
// master PNG (resources/icon.png) from a source image.
//
// Usage:  node scripts/generate-app-icon.mjs [sourcePath] [left,top,width,height]
// Default source: resources/icon-source.png
//
// Without a crop argument the source is center-cropped to a square. Pass an
// explicit "left,top,width,height" rectangle (source pixels) to crop tightly to
// the artwork (e.g. the rounded tile). The crop is then rendered at the standard
// Windows icon sizes (16-256) and packed into a single multi-resolution .ico.
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.argv[2] ?? join(repoRoot, "resources", "icon-source.png"));
const icoOut = join(repoRoot, "resources", "icon.ico");
const pngOut = join(repoRoot, "resources", "icon.png");

if (!existsSync(source)) {
  console.error(`Source image not found: ${source}`);
  console.error("Save your icon artwork there (PNG) and re-run, or pass a path argument.");
  process.exit(1);
}

const meta = await sharp(source).metadata();
const cropArg = process.argv[3];

let region;
if (cropArg) {
  const [left, top, width, height] = cropArg.split(",").map((value) => parseInt(value.trim(), 10));
  if ([left, top, width, height].some((value) => !Number.isFinite(value))) {
    console.error(`Invalid crop "${cropArg}". Expected "left,top,width,height".`);
    process.exit(1);
  }
  region = { left, top, width, height };
} else {
  const side = Math.min(meta.width ?? 0, meta.height ?? 0);
  region = {
    left: Math.round(((meta.width ?? side) - side) / 2),
    top: Math.round(((meta.height ?? side) - side) / 2),
    width: side,
    height: side
  };
}

const square = await sharp(source).extract(region).png().toBuffer();

const sizes = [256, 128, 64, 48, 32, 24, 16];
const pngBuffers = await Promise.all(
  sizes.map((size) => sharp(square).resize(size, size, { fit: "cover" }).png().toBuffer())
);

const icoBuffer = packPngFramesIntoIco(
  sizes.map((size, index) => ({ size, png: pngBuffers[index] }))
);
validateIco(icoBuffer, sizes);

await writeFile(icoOut, icoBuffer);
await sharp(square).resize(1024, 1024, { fit: "cover" }).png().toFile(pngOut);

console.log(`Wrote ${icoOut} (sizes: ${sizes.join(", ")})`);
console.log(`Wrote ${pngOut} (1024x1024 master)`);

function packPngFramesIntoIco(frames) {
  const headerSize = 6;
  const directoryEntrySize = 16;
  const dataStart = headerSize + directoryEntrySize * frames.length;
  const header = Buffer.alloc(dataStart);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  let offset = dataStart;
  frames.forEach(({ size, png }, index) => {
    const entryOffset = headerSize + index * directoryEntrySize;
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(png.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += png.length;
  });

  return Buffer.concat([header, ...frames.map(({ png }) => png)], offset);
}

function validateIco(buffer, expectedSizes) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const count = buffer.readUInt16LE(4);

  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1 || count !== expectedSizes.length) {
    throw new Error("Generated ICO header is invalid.");
  }

  expectedSizes.forEach((expectedSize, index) => {
    const entryOffset = 6 + index * 16;
    const width = buffer.readUInt8(entryOffset) || 256;
    const height = buffer.readUInt8(entryOffset + 1) || 256;
    const bitCount = buffer.readUInt16LE(entryOffset + 6);
    const byteLength = buffer.readUInt32LE(entryOffset + 8);
    const imageOffset = buffer.readUInt32LE(entryOffset + 12);
    const imageEnd = imageOffset + byteLength;
    const image = buffer.subarray(imageOffset, imageEnd);

    if (
      width !== expectedSize ||
      height !== expectedSize ||
      bitCount !== 32 ||
      imageEnd > buffer.length ||
      !image.subarray(0, pngSignature.length).equals(pngSignature) ||
      image.readUInt32BE(16) !== expectedSize ||
      image.readUInt32BE(20) !== expectedSize ||
      image.readUInt8(24) !== 8 ||
      image.readUInt8(25) !== 6
    ) {
      throw new Error(`Generated ICO frame ${expectedSize}x${expectedSize} is invalid.`);
    }
  });
}
