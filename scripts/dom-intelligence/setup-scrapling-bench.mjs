/**
 * L10.0 dev-only setup: an isolated, parser-only Scrapling venv for `benchmark:dom-intelligence`.
 *
 * Run with: npm run benchmark:dom-intelligence-setup
 *
 * Never shipped and never used by the app. Downloads EXACTLY the pinned parser-only wheels below
 * (binary-only, --no-deps, so no fetcher/Playwright/Patchright extra can be resolved), records each
 * wheel's local SHA-256 and size, then installs them offline from that folder into
 * `.cache/l10-scrapling/venv` (gitignored). Re-running reuses the downloaded wheels.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const BENCH_ROOT = resolve(".cache/l10-scrapling");
export const WHEELS = join(BENCH_ROOT, "wheels");
export const VENV = join(BENCH_ROOT, "venv");
export const VENV_PYTHON = join(VENV, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

/** Parser-only closure of scrapling 0.4.15 (its base requires_dist, nothing from any extra). */
export const PINS = [
  "scrapling==0.4.15",
  "lxml==6.1.3",
  "cssselect==1.5.0",
  "orjson==3.12.0",
  "tld==0.13.2",
  "w3lib==2.5.0",
  "typing_extensions==4.16.0"
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

function must(command, args) {
  const result = run(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/** A Python >= 3.10 to build the venv from. AWKIT_BENCH_PYTHON overrides discovery. */
function findBasePython() {
  const candidates = process.env.AWKIT_BENCH_PYTHON
    ? [[process.env.AWKIT_BENCH_PYTHON, []]]
    : [["py", ["-3.12"]], ["py", ["-3"]], ["python", []], ["python3", []]];
  for (const [command, prefix] of candidates) {
    try {
      const probe = run(command, [...prefix, "-c", "import sys;print(sys.version_info >= (3, 10), sys.executable)"]);
      const [ok, executable] = (probe.stdout || "").trim().split(" ");
      if (probe.status === 0 && ok === "True" && executable) return executable;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("No Python >= 3.10 found. Set AWKIT_BENCH_PYTHON to a python.exe.");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main() {
  mkdirSync(WHEELS, { recursive: true });
  const basePython = findBasePython();
  console.log(`base python: ${basePython}`);

  if (!existsSync(VENV_PYTHON)) {
    console.log("creating venv ...");
    must(basePython, ["-m", "venv", VENV]);
  }

  const haveAll = PINS.every((pin) => {
    const name = pin.split("==")[0].toLowerCase().replace(/-/g, "_");
    const version = pin.split("==")[1];
    return readdirSync(WHEELS).some((file) => file.toLowerCase().startsWith(`${name}-${version}-`));
  });
  if (!haveAll) {
    console.log("downloading pinned parser-only wheels from PyPI ...");
    must(VENV_PYTHON, [
      "-m", "pip", "download", "--disable-pip-version-check", "--no-deps", "--only-binary=:all:",
      "--dest", WHEELS, ...PINS
    ]);
  }

  console.log("installing offline from the local wheel folder ...");
  must(VENV_PYTHON, [
    "-m", "pip", "install", "--disable-pip-version-check", "--no-index", "--no-deps",
    "--find-links", WHEELS, ...PINS
  ]);
  const check = run(VENV_PYTHON, ["-m", "pip", "check", "--disable-pip-version-check"], { stdio: ["ignore", "pipe", "pipe"] });
  const frozen = must(VENV_PYTHON, ["-m", "pip", "freeze", "--disable-pip-version-check"]).trim().split(/\r?\n/);

  const wheels = readdirSync(WHEELS)
    .filter((file) => file.endsWith(".whl"))
    .sort()
    .map((file) => ({ file, bytes: statSync(join(WHEELS, file)).size, sha256: sha256(join(WHEELS, file)) }));
  const record = {
    createdAt: new Date().toISOString(),
    basePython,
    pythonVersion: must(VENV_PYTHON, ["-c", "import sys;print(sys.version.split()[0])"]).trim(),
    pins: PINS,
    pipFreeze: frozen,
    pipCheck: { status: check.status, output: (check.stdout || check.stderr).trim() },
    wheels,
    totalWheelBytes: wheels.reduce((sum, wheel) => sum + wheel.bytes, 0)
  };
  writeFileSync(join(BENCH_ROOT, "install-record.json"), `${JSON.stringify(record, null, 2)}\n`);

  for (const wheel of wheels) console.log(`  ${wheel.sha256}  ${String(wheel.bytes).padStart(9)}  ${wheel.file}`);
  console.log(`pip freeze: ${frozen.join(", ")}`);
  console.log(`pip check: ${record.pipCheck.output} (exit ${check.status})`);
  const extra = frozen.filter((line) => !PINS.some((pin) => pin.toLowerCase() === line.toLowerCase().replace(/-/g, "_") || pin.toLowerCase() === line.toLowerCase()));
  if (extra.length > 0) {
    console.error(`FAIL: venv holds packages outside the pinned parser-only set: ${extra.join(", ")}`);
    process.exit(1);
  }
  console.log(`OK ${wheels.length} wheels, ${record.totalWheelBytes} bytes, record at .cache/l10-scrapling/install-record.json`);
}

main();
