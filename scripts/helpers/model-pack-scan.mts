/**
 * Model-pack exclusion, read from the REAL packaged artifact (Phase L, L7 › Packaging: "model pack separate").
 *
 * The earlier checks read lists — the signed manifest's `aiRuntime` paths — and the packaged app's own
 * diagnostics. Neither sees a file electron-builder copied from anywhere else (`resources/**`, `vendor/**`,
 * `app.asar`). This walks the packaged tree itself: every file on disk and every file packed inside an
 * `.asar`. A file is a model file on ANY one of three signals, so renaming a pack or editing its header
 * does not hide it:
 *
 *   - a model extension (`.gguf`, `.ggml`);
 *   - the GGUF magic in its first four bytes;
 *   - the exact byte size of a pack pinned in `AI_MODEL_MANIFEST`.
 *
 * A link is reported rather than followed: the scan cannot vouch for what it points at.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { AI_MODEL_MANIFEST } from "../../src/offline/AiModelManifest";

interface AsarEntry {
  files?: Record<string, AsarEntry>;
  size?: number;
  offset?: string;
  unpacked?: boolean;
  link?: string;
}

// @electron/asar is CJS and ships with electron-builder's dependency tree (as in verify-packaged-validation).
const asar = createRequire(import.meta.url)("@electron/asar") as {
  getRawHeader(archive: string): { headerSize: number; header: AsarEntry };
};

const MODEL_EXTENSION = /\.(gguf|ggml)$/i;
const GGUF_MAGIC = "GGUF";
const PINNED_PACK_SIZES = new Set(AI_MODEL_MANIFEST.map((entry) => entry.sizeBytes));

export interface ModelFileScan {
  /** Files read on disk. */
  files: number;
  /** Files read inside `.asar` archives (unpacked members are counted on disk instead). */
  asarEntries: number;
  /** One line per model file or unfollowed link: its path and the signal that caught it. */
  found: string[];
}

function magicAt(fd: number, position: number): string {
  const buffer = Buffer.alloc(4);
  const read = fs.readSync(fd, buffer, 0, 4, position);
  return buffer.toString("latin1", 0, read);
}

function modelSignal(name: string, size: number, magic: string): string | null {
  if (MODEL_EXTENSION.test(name)) return "model extension";
  if (magic === GGUF_MAGIC) return "GGUF magic";
  if (PINNED_PACK_SIZES.has(size)) return "the byte size of a pinned model pack";
  return null;
}

/** Packed members only: an unpacked member is a real file under `<archive>.unpacked`, read by the walk. */
function scanAsar(archive: string, label: string, scan: ModelFileScan): void {
  const { headerSize, header } = asar.getRawHeader(archive);
  // The asar layout: an 8-byte size pickle, the header, then every packed file at its header offset.
  const dataStart = 8 + headerSize;
  const fd = fs.openSync(archive, "r");
  try {
    const walk = (entries: Record<string, AsarEntry>, prefix: string): void => {
      for (const [name, entry] of Object.entries(entries)) {
        const rel = `${prefix}/${name}`;
        if (entry.files) walk(entry.files, rel);
        else if (entry.link === undefined && entry.unpacked !== true) {
          scan.asarEntries += 1;
          const size = entry.size ?? 0;
          const signal = modelSignal(name, size, size >= 4 ? magicAt(fd, dataStart + Number(entry.offset)) : "");
          if (signal) scan.found.push(`${label}${rel} (${signal})`);
        }
      }
    };
    walk(header.files ?? {}, "");
  } finally {
    fs.closeSync(fd);
  }
}

export function scanForModelFiles(root: string): ModelFileScan {
  const scan: ModelFileScan = { files: 0, asarEntries: 0, found: [] };
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        scan.found.push(`${rel} (a link the scan does not follow)`);
      } else if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        scan.files += 1;
        const size = fs.statSync(full).size;
        const fd = fs.openSync(full, "r");
        let magic = "";
        try {
          magic = size >= 4 ? magicAt(fd, 0) : "";
        } finally {
          fs.closeSync(fd);
        }
        const signal = modelSignal(entry.name, size, magic);
        if (signal) scan.found.push(`${rel} (${signal})`);
        if (/\.asar$/i.test(entry.name)) scanAsar(full, rel, scan);
      }
    }
  };
  walk(root);
  return scan;
}
