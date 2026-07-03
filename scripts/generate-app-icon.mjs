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
import pngToIco from "png-to-ico";

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

await writeFile(icoOut, await pngToIco(pngBuffers));
await sharp(square).resize(1024, 1024, { fit: "cover" }).png().toFile(pngOut);

console.log(`Wrote ${icoOut} (sizes: ${sizes.join(", ")})`);
console.log(`Wrote ${pngOut} (1024x1024 master)`);
