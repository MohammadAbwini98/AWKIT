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
 *     and checked against the pin's SHA-256 — `tld` is never copied.
 *
 * Build-time only. Nothing here runs in the product, and the product never downloads anything.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import { join, resolve } from "node:path";

const ROOT = resolve(".");
const PIN = JSON.parse(readFileSync(join(ROOT, "src", "offline", "dom-intelligence-runtime.json"), "utf8"));
export const INPUT_ROOT = join(ROOT, ".cache", "dom-intelligence");
export const INPUT_WHEELS = join(INPUT_ROOT, "wheels");
const BENCH_WHEELS = join(ROOT, ".cache", "l10-scrapling", "wheels");

const digest = (algorithm, file) => createHash(algorithm).update(readFileSync(file)).digest("hex");

function download(url, to, redirects = 0) {
  return new Promise((done, fail) => {
    if (!/^https:\/\/www\.python\.org\/ftp\/python\//.test(url)) {
      fail(new Error(`refusing to download from an unpinned origin: ${url}`));
      return;
    }
    get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 3) {
        response.resume();
        download(new URL(response.headers.location, url).toString(), to, redirects + 1).then(done, fail);
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
