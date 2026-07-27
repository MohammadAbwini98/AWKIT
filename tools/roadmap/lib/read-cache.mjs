/**
 * mtime-gated reads of the repository sources.
 *
 * Two properties matter here:
 *
 *  1. An unchanged file is never re-read. The cache key is path + mtimeMs + size, so a rebuild
 *     triggered by one changed source does not re-read the other twelve.
 *
 *  2. TASK_LOG.md contains exactly one NUL byte (offset 62127). It survives a UTF-8 read and makes
 *     ripgrep call the file binary. Every text read strips it before any regex runs, because a
 *     stray NUL inside a heading would silently drop that entry from the agent tally.
 *
 * NUL is built with String.fromCharCode rather than written as an escape so that no source file
 * in this tool ever contains a literal control character of its own.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

import { sourceEntry, sourcePath } from "./sources.mjs";

const NUL = String.fromCharCode(0);

/**
 * @typedef {Object} SourceRead
 * @property {string} id
 * @property {string} rel
 * @property {string} path
 * @property {string} text        NUL-stripped file contents
 * @property {number} mtimeMs
 * @property {number} size        bytes on disk
 * @property {number} nulStripped how many NUL bytes were removed
 * @property {boolean} ok
 * @property {string|null} error  read failure message, if any
 */

/** @type {Map<string, {key: string, read: SourceRead}>} */
const cache = new Map();

/**
 * Read a registered source, reusing the cached text when the file has not changed.
 * Never throws: a missing or unreadable file returns `ok: false` so one broken path degrades a
 * single panel instead of taking down the whole snapshot.
 *
 * @param {string} id
 * @returns {SourceRead}
 */
export function readSource(id) {
  const entry = sourceEntry(id);
  const path = sourcePath(id);

  let stat;
  try {
    stat = statSync(path);
  } catch (err) {
    return failed(id, entry.rel, path, 0, 0, `not readable: ${message(err)}`);
  }

  const key = `${stat.mtimeMs}:${stat.size}`;
  const hit = cache.get(id);
  if (hit && hit.key === key) return hit.read;

  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return failed(id, entry.rel, path, stat.mtimeMs, stat.size, `read failed: ${message(err)}`);
  }

  const segments = raw.split(NUL);
  const nulStripped = segments.length - 1;
  const text = nulStripped > 0 ? segments.join("") : raw;

  /** @type {SourceRead} */
  const read = {
    id,
    rel: entry.rel,
    path,
    text,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    nulStripped,
    ok: true,
    error: null
  };

  cache.set(id, { key, read });
  return read;
}

/**
 * stat() every watched source and fold the results into one fingerprint.
 *
 * Deliberately stat-based rather than fs.watch: on Windows, editors and `bd` write via temp-file
 * plus rename, which permanently detaches a file-bound fs.watch handle with no error event. A
 * dashboard labelled "live" that has silently stopped updating is a worse outcome than 13 stat()
 * calls every 1.5s (measured ~1ms).
 *
 * @param {string[]} ids
 * @returns {{fingerprint: string, entries: {id: string, mtimeMs: number, size: number, ok: boolean}[]}}
 */
export function fingerprintSources(ids) {
  const entries = ids.map((id) => {
    try {
      const stat = statSync(sourcePath(id));
      return { id, mtimeMs: stat.mtimeMs, size: stat.size, ok: true };
    } catch {
      return { id, mtimeMs: 0, size: 0, ok: false };
    }
  });

  const hash = createHash("sha1");
  for (const e of entries) hash.update(`${e.id}:${e.mtimeMs}:${e.size}:${e.ok ? 1 : 0}|`);
  return { fingerprint: hash.digest("hex"), entries };
}

/**
 * Bypass the mtime gate. Used by the OneDrive content-hash fallback and the manual refresh.
 * @param {string} id
 * @returns {SourceRead}
 */
export function readSourceUncached(id) {
  cache.delete(id);
  return readSource(id);
}

/**
 * Content hash of a source. The OneDrive fallback: sync can rewrite a file with an identical
 * mtime and size, which the fingerprint alone would miss. Only worth paying for on small, hot
 * sources.
 *
 * @param {string} id
 * @returns {string}
 */
export function contentHash(id) {
  const read = readSourceUncached(id);
  return read.ok ? createHash("sha1").update(read.text).digest("hex") : "unreadable";
}

/** Drop every cached read. Backs POST /api/refresh. */
export function clearReadCache() {
  cache.clear();
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function message(err) {
  return err instanceof Error ? err.message : String(err);
}

/** @returns {SourceRead} */
function failed(id, rel, path, mtimeMs, size, error) {
  return { id, rel, path, text: "", mtimeMs, size, nulStripped: 0, ok: false, error };
}
