/**
 * L11 build-time inputs for the parser-only DOM-intelligence runtime (awkit-djnl.19).
 *
 * Run with: npm run benchmark:dom-intelligence-runtime-setup
 *
 * Fetches EXACTLY the pinned inputs of src/offline/dom-intelligence-runtime.json into the gitignored
 * `.cache/dom-intelligence/`, and refuses anything that does not match the pin:
 *   - the python.org Windows embeddable CPython archive, checked against the SHA-256 python.org publishes
 *     in the release SBOM AND the MD5 on its release page (two independent published values);
 *   - the six parser-only wheels, copied from the pinned venv wheel folder of
 *     `npm run benchmark:dom-intelligence-setup` (itself downloaded --no-deps --only-binary from exact pins)
 *     and checked against the pin's SHA-256 — `tld` is never copied;
 *   - the corresponding sources that ship beside the binaries (`correspondingSources`, the owner's LGPL-2.1
 *     section 6 decision for the libiconv inside lxml), each from its exact pinned URL. A GitHub archive must
 *     also carry the pinned commit in its git-archive header. An entry with no SHA-256 yet is downloaded,
 *     its commit checked and its measured SHA-256 printed, and the run FAILS until that value is pinned.
 *
 * Build-time only. Nothing here runs in the product, and the product never downloads anything.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const ROOT = resolve(".");
const PIN = JSON.parse(readFileSync(join(ROOT, "src", "offline", "dom-intelligence-runtime.json"), "utf8"));
export const INPUT_ROOT = join(ROOT, ".cache", "dom-intelligence");
export const INPUT_WHEELS = join(INPUT_ROOT, "wheels");
export const INPUT_SOURCES = join(INPUT_ROOT, "sources");
const BENCH_WHEELS = join(ROOT, ".cache", "l10-scrapling", "wheels");
const SOURCE_ARCHIVES = PIN.correspondingSources?.archives ?? [];
/** Only these exact URLs are fetched; a redirect may only stay on the pinned URL's host. */
const PINNED_URLS = new Set([PIN.python.url, ...SOURCE_ARCHIVES.map((source) => source.url)]);

const digest = (algorithm, file) => createHash(algorithm).update(readFileSync(file)).digest("hex");

/** The commit `git archive` (and so GitHub) records in a tarball's pax global header, if any. */
function gitArchiveCommit(file) {
  const tar = gunzipSync(readFileSync(file));
  if (tar.length < 1024 || tar[156] !== 0x67) return undefined;
  const size = parseInt(tar.subarray(124, 136).toString("ascii").replace(/\0/g, "").trim(), 8);
  return /(?:^|\n)\d+ comment=([0-9a-f]{40})\n/.exec(tar.subarray(512, 512 + size).toString("utf8"))?.[1];
}

function download(url, to, redirects = 0, host = undefined) {
  return new Promise((done, fail) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || (host === undefined ? !PINNED_URLS.has(url) : parsed.host !== host)) {
      fail(new Error(`refusing to download from an unpinned origin: ${url}`));
      return;
    }
    get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 3) {
        response.resume();
        download(new URL(response.headers.location, url).toString(), to, redirects + 1, parsed.host).then(done, fail);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        fail(new Error(`GET ${url} answered ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        writeFileSync(to, Buffer.concat(chunks));
        done();
      });
      response.on("error", fail);
    }).on("error", fail);
  });
}

async function main() {
  mkdirSync(INPUT_WHEELS, { recursive: true });
  const failures = [];

  const archive = join(INPUT_ROOT, PIN.python.archive);
  if (!existsSync(archive) || digest("sha256", archive) !== PIN.python.sha256) {
    const partial = `${archive}.part`;
    rmSync(partial, { force: true });
    console.log(`downloading ${PIN.python.url} ...`);
    await download(PIN.python.url, partial);
    const sha256 = digest("sha256", partial);
    const md5 = digest("md5", partial);
    if (sha256 !== PIN.python.sha256 || md5 !== PIN.python.md5) {
      rmSync(partial, { force: true });
      failures.push(`${PIN.python.archive}: sha256 ${sha256} / md5 ${md5} do not match the pin (${PIN.python.sha256} / ${PIN.python.md5}); the download was discarded`);
    } else {
      renameSync(partial, archive);
    }
  }
  if (existsSync(archive)) console.log(`  ${digest("sha256", archive)}  ${PIN.python.archive} (sha256 and md5 match the pin)`);

  for (const wheel of PIN.wheels) {
    const target = join(INPUT_WHEELS, wheel.file);
    const source = join(BENCH_WHEELS, wheel.file);
    if (!existsSync(target) && existsSync(source)) copyFileSync(source, target);
    if (!existsSync(target)) {
      failures.push(`${wheel.file} is missing: run npm run benchmark:dom-intelligence-setup first (it downloads the pinned wheels)`);
      continue;
    }
    const sha256 = digest("sha256", target);
    if (sha256 !== wheel.sha256) {
      rmSync(target, { force: true });
      failures.push(`${wheel.file}: sha256 ${sha256} does not match the pin ${wheel.sha256}; removed`);
      continue;
    }
    console.log(`  ${sha256}  ${wheel.file}`);
  }

  if (SOURCE_ARCHIVES.length > 0) mkdirSync(INPUT_SOURCES, { recursive: true });
  for (const source of SOURCE_ARCHIVES) {
    if (!/^[A-Za-z0-9._-]+$/.test(source.file ?? "")) {
      failures.push(`correspondingSources: ${JSON.stringify(source.file)} is not a plain file name`);
      continue;
    }
    const target = join(INPUT_SOURCES, source.file);
    if (existsSync(target) && source.sha256 && digest("sha256", target) !== source.sha256) rmSync(target, { force: true });
    if (!existsSync(target)) {
      const partial = `${target}.part`;
      rmSync(partial, { force: true });
      console.log(`downloading ${source.url} ...`);
      await download(source.url, partial);
      renameSync(partial, target);
    }
    const commit = source.commit ? gitArchiveCommit(target) : undefined;
    if (source.commit && commit !== source.commit) {
      rmSync(target, { force: true });
      failures.push(`sources/${source.file} is commit ${commit ?? "(none recorded)"}, not the pinned ${source.commit}; removed`);
      continue;
    }
    const sha256 = digest("sha256", target);
    const size = statSync(target).size;
    if (!source.sha256) {
      failures.push(`sources/${source.file}: no SHA-256 pinned yet. Measured ${sha256}, ${size} bytes${commit ? `, commit ${commit} verified` : ""}. Pin it in src/offline/dom-intelligence-runtime.json`);
      continue;
    }
    if (sha256 !== source.sha256 || (source.size !== undefined && size !== source.size)) {
      rmSync(target, { force: true });
      failures.push(`sources/${source.file}: sha256 ${sha256} / ${size} bytes do not match the pin ${source.sha256} / ${source.size}; removed`);
      continue;
    }
    console.log(`  ${sha256}  sources/${source.file}${commit ? ` (commit ${commit})` : ""}`);
  }

  if (failures.length > 0) {
    console.error("FAIL:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`OK pinned DOM-intelligence runtime inputs are in ${INPUT_ROOT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
