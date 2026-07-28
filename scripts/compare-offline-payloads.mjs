/**
 * Compare two unpacked or packaged AWKIT artifacts by semantic payload identity.
 *
 * Whole-installer hashes are intentionally not compared: NSIS/Electron metadata embeds volatile
 * timestamps. This tool compares each decompressed payload entry by path, size and CRC32, excluding
 * only the generated dependency manifest and its detached signature (resources + vendor copies).
 */
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEVEN_ZIP = resolve(ROOT, "node_modules", "7zip-bin", "win", "x64", "7za.exe");
const EXCLUDED = new Set([
  "resources/resources/dependency-manifest.json",
  "resources/resources/dependency-manifest.sig",
  "resources/vendor/dependency-manifest.json",
  "resources/vendor/dependency-manifest.sig"
]);

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.?\//, "");
}

function crc32File(path) {
  return new Promise((resolveCrc, reject) => {
    let crc = 0xffffffff;
    const stream = createReadStream(path);
    stream.on("data", (chunk) => {
      for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    });
    stream.on("error", reject);
    stream.on("end", () => resolveCrc(((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0").toUpperCase()));
  });
}

async function inventoryDirectory(root) {
  const entries = new Map();
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const path = normalizePath(relative(root, absolute));
        if (EXCLUDED.has(path)) continue;
        const metadata = await stat(absolute);
        entries.set(path, { size: metadata.size, crc32: await crc32File(absolute) });
      }
    }
  }
  await walk(root);
  return entries;
}

function inventoryArchive(path) {
  const result = spawnSync(SEVEN_ZIP, ["l", "-slt", path], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  if (![0, 1].includes(result.status ?? -1)) {
    throw new Error(`7-Zip could not list ${path}: ${result.stderr || result.stdout}`);
  }

  const entries = new Map();
  for (const block of result.stdout.split(/\r?\n\r?\n/)) {
    const fields = new Map();
    for (const line of block.split(/\r?\n/)) {
      const match = /^([^=]+) = (.*)$/.exec(line);
      if (match) fields.set(match[1].trim(), match[2].trim());
    }
    const entryPath = normalizePath(fields.get("Path") ?? "");
    const crc32 = fields.get("CRC");
    const size = fields.get("Size");
    if (!entryPath || !crc32 || size === undefined || EXCLUDED.has(entryPath)) continue;
    entries.set(entryPath, { size: Number(size), crc32: crc32.toUpperCase() });
  }
  return entries;
}

async function inventory(path) {
  const metadata = await stat(path);
  return metadata.isDirectory() ? inventoryDirectory(path) : inventoryArchive(path);
}

function compare(left, right) {
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
  const differences = [];
  for (const path of paths) {
    const leftEntry = left.get(path);
    const rightEntry = right.get(path);
    if (!leftEntry) {
      differences.push({ path, kind: "missing-left", right: rightEntry });
    } else if (!rightEntry) {
      differences.push({ path, kind: "missing-right", left: leftEntry });
    } else if (leftEntry.size !== rightEntry.size || leftEntry.crc32 !== rightEntry.crc32) {
      differences.push({ path, kind: "content", left: leftEntry, right: rightEntry });
    }
  }
  return differences;
}

async function main() {
  const args = process.argv.slice(2);
  const leftPath = args[args.indexOf("--left") + 1];
  const rightPath = args[args.indexOf("--right") + 1];
  const reportIndex = args.indexOf("--report");
  if (!leftPath || !rightPath) {
    throw new Error("Usage: node scripts/compare-offline-payloads.mjs --left <artifact|directory> --right <artifact|directory> [--report <json>]");
  }

  const left = await inventory(resolve(leftPath));
  const right = await inventory(resolve(rightPath));
  const differences = compare(left, right);
  const report = {
    model: "decompressed-path-size-crc32",
    excluded: [...EXCLUDED],
    left: { path: resolve(leftPath), entries: left.size },
    right: { path: resolve(rightPath), entries: right.size },
    equivalent: differences.length === 0,
    differences
  };
  if (reportIndex >= 0) await writeFile(resolve(args[reportIndex + 1]), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (differences.length) {
    process.stderr.write(`Offline payloads differ in ${differences.length} entries.\n`);
    for (const difference of differences.slice(0, 50)) process.stderr.write(`${JSON.stringify(difference)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Offline payloads are semantically equivalent (${left.size} entries; generated manifest/signature excluded).\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
