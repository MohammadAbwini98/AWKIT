/**
 * verify:dom-intelligence-packaged — L11 (awkit-djnl.19) the DOM-intelligence runtime inside the REAL packaged
 * application. `verify:dom-intelligence-gui` proves the same card on the dev app; this gate proves what ships:
 *
 *   0. dist/win-unpacked/resources/native-hosts/dom-intelligence is exactly the signed manifest's
 *      `domIntelligenceRuntime` tree (the package's own copy, byte-identical to the committed one): every asset
 *      present with its size and SHA-256, nothing unlisted, and the runtime's descriptor (the one unlisted file,
 *      as in validate-offline-bundle.ps1) naming the entries main launches and exactly the signed assets; and the
 *      pinned corresponding sources (LGPL-2.1 section 6 for the libiconv inside lxml) under sources/;
 *   1. dist/win-unpacked/SpecterStudio.exe on a fresh, isolated %LOCALAPPDATA% signs in its first account, and
 *      its own IPC and the Settings card report the runtime shipped and Available: Scrapling at the pinned
 *      version, parser-only, no browser or network access, the snapshot recovery engine;
 *   2. that status started exactly one host: a python.exe from the packaged tree, a child of the packaged main
 *      process;
 *   3. a graceful quit leaves no host behind (no orphan), checked BEFORE the forced teardown that every packaged
 *      gate runs, so the teardown cannot hide one.
 *
 * Exit (gateExitCode): NOT RUN (2, never a pass) without a packaged tree that carries the runtime; a stale
 * package FAILS (1); 0 only when every step ran and passed.
 *
 * Run: npm run verify:dom-intelligence-packaged   (after `npm run package:portable`)
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { stalePackagedPayload } from "./helpers/packaged-artifacts.mjs";
import { sanitizeAppEnv } from "./helpers/packaged-license.mts";
import { capturePackagedAppPids, ensurePackagedAppDead, type PackagedAppPids } from "./helpers/packaged-process-tree.mts";
import { gateExitCode } from "./lib/failure-capture-gate.mts";
import {
  navClick
  // @ts-expect-error Shared E2E helper is intentionally plain ESM JavaScript.
} from "./lib/e2e-qa-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UNPACKED = path.join(ROOT, "dist", "win-unpacked");
const EXE = path.join(UNPACKED, "SpecterStudio.exe");
const RESOURCES = path.join(UNPACKED, "resources");
const RUNTIME = path.join(RESOURCES, "native-hosts", "dom-intelligence");
const PACKAGED_MANIFEST = path.join(RESOURCES, "resources", "dependency-manifest.json");
const COMMITTED_MANIFEST = path.join(ROOT, "resources", "dependency-manifest.json");
const PINNED = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "offline", "dom-intelligence-runtime.json"), "utf8")) as {
  scrapling: string;
  correspondingSources?: { archives?: Array<{ file: string; sha256: string; license: string }> };
};
// The password policy refuses a password containing the username, so the two share no word.
const ACCOUNT = { displayName: "Packaged DOM Gate", username: "l11-dom-check", password: "Phase-L11!ParserOnly2026" };

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 400)}`}`);
  }
}

function notRun(reason: string): never {
  console.log(`NOT RUN: ${reason} — exit 2, never a pass`);
  process.exit(2);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

type PythonProcess = { ProcessId: number; ParentProcessId: number; ExecutablePath: string | null };

/** Every python.exe whose executable lives in the packaged runtime tree. */
async function packagedHosts(): Promise<PythonProcess[]> {
  const script = "@(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Select-Object ProcessId, ParentProcessId, ExecutablePath) | ConvertTo-Json -Compress";
  const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    timeout: 60_000
  });
  const parsed = stdout.trim() ? (JSON.parse(stdout.trim()) as PythonProcess | PythonProcess[]) : [];
  const prefix = `${RUNTIME.toLowerCase()}${path.sep}`;
  return ([] as PythonProcess[]).concat(parsed).filter((proc) => (proc.ExecutablePath ?? "").toLowerCase().startsWith(prefix));
}

/** The main window is the one carrying the preload bridge — never the splash window. */
async function mainWindow(app: ElectronApplication, timeoutMs = 60_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  await app.firstWindow({ timeout: timeoutMs }).catch(() => undefined);
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      const ready = await candidate.evaluate(() => typeof (window as any).playwrightFlowStudio?.domIntelligence?.getStatus === "function").catch(() => false);
      if (ready) return candidate;
    }
    await sleep(400);
  }
  throw new Error("packaged main window with the preload bridge never appeared");
}

/** First run on a fresh profile: create the account through the real setup screen. */
async function signIn(win: Page): Promise<void> {
  await win.waitForSelector(".awkit-login-card, .app-shell", { timeout: 30_000 });
  if ((await win.locator(".app-shell").count()) > 0) return;
  await win.fill("#awkit-setup-display", ACCOUNT.displayName);
  await win.fill("#awkit-setup-username", ACCOUNT.username);
  const passwords = win.locator('.awkit-login-form input[type="password"]');
  await passwords.nth(0).fill(ACCOUNT.password);
  await passwords.nth(1).fill(ACCOUNT.password);
  await win.getByRole("button", { name: "Create account" }).click();
  await win.getByRole("heading", { name: "Save your recovery code" }).waitFor({ timeout: 30_000 });
  await win.getByRole("checkbox", { name: "I saved this recovery code in a secure place." }).check();
  await win.getByRole("button", { name: "Continue to SpecterStudio" }).click();
  await win.waitForSelector(".app-shell", { timeout: 30_000 });
}

// ── Preconditions ────────────────────────────────────────────────────────────────────────────────

console.log("verify:dom-intelligence-packaged — the DOM-intelligence runtime inside the real packaged application\n");
if (!fs.existsSync(EXE) || !fs.existsSync(path.join(RUNTIME, "dom-intelligence-host-manifest.json"))) {
  notRun("dist/win-unpacked carries no packaged app with native-hosts/dom-intelligence — run `npm run package:portable`");
}
const stale = await stalePackagedPayload(ROOT);
check("the packaged payload is not older than the source", stale === null, stale ?? undefined);
check("no host from the packaged tree is running before launch", (await packagedHosts()).length === 0);

console.log("\n0. The shipped runtime is exactly the signed manifest's tree");
check(
  "the package's manifest is byte-identical to the committed signed manifest",
  fs.existsSync(PACKAGED_MANIFEST) && fs.readFileSync(PACKAGED_MANIFEST).equals(fs.readFileSync(COMMITTED_MANIFEST))
);
const signed = (JSON.parse(fs.readFileSync(COMMITTED_MANIFEST, "utf8")) as { domIntelligenceRuntime?: { scrapling?: string; fileCount?: number; assets?: Array<{ relativePath: string; size: number; sha256: string }> } })
  .domIntelligenceRuntime;
const assets = signed?.assets ?? [];
check(`the signed section lists ${signed?.fileCount ?? "?"} assets and names Scrapling ${PINNED.scrapling}`, assets.length > 0 && assets.length === signed?.fileCount && signed?.scrapling === PINNED.scrapling, {
  listed: assets.length,
  fileCount: signed?.fileCount,
  scrapling: signed?.scrapling
});
const mismatched = assets.filter((asset) => {
  const file = path.join(RESOURCES, ...asset.relativePath.split("/"));
  if (!fs.existsSync(file)) return true;
  const bytes = fs.readFileSync(file);
  return bytes.length !== asset.size || createHash("sha256").update(bytes).digest("hex") !== asset.sha256;
});
check(`every signed asset ships with its size and SHA-256 (${assets.length - mismatched.length}/${assets.length})`, assets.length > 0 && mismatched.length === 0, mismatched.slice(0, 5).map((a) => a.relativePath));
// The runtime's own descriptor is the one file not listed as an asset (validate-offline-bundle.ps1 skips it too):
// the signed section IS its file list, folded in verbatim, so it is held to that list instead of to a checksum.
const DESCRIPTOR = "native-hosts/dom-intelligence/dom-intelligence-host-manifest.json";
const listed = new Set(assets.map((asset) => asset.relativePath));
const shipped = listFiles(RUNTIME)
  .map((file) => path.relative(RESOURCES, file).split(path.sep).join("/"))
  .filter((file) => file !== DESCRIPTOR);
const unlisted = shipped.filter((file) => !listed.has(file));
check(`nothing unlisted ships in the runtime tree (${shipped.length} files besides the descriptor)`, shipped.length === assets.length && unlisted.length === 0, unlisted.slice(0, 5));
const descriptor = JSON.parse(fs.readFileSync(path.join(RESOURCES, ...DESCRIPTOR.split("/")), "utf8")) as {
  schema?: { name?: string; version?: number };
  pythonEntry?: string;
  hostEntry?: string;
  scrapling?: string;
  assets?: Array<{ relativePath: string; size: number; sha256: string }>;
};
const row = (asset: { relativePath: string; size: number; sha256: string }) => `${asset.relativePath}|${asset.size}|${asset.sha256}`;
const describedRows = (descriptor.assets ?? []).map((asset) => row({ ...asset, relativePath: `native-hosts/dom-intelligence/${asset.relativePath}` })).sort();
check(
  "the descriptor is the one main launches from (schema, entries) and lists exactly the signed assets",
  descriptor.schema?.name === "awkit-dom-intelligence-host-manifest" &&
    descriptor.schema.version === 1 &&
    descriptor.pythonEntry === "python/python.exe" &&
    descriptor.hostEntry === "host/dom_intelligence_host.py" &&
    descriptor.scrapling === PINNED.scrapling &&
    describedRows.length === assets.length &&
    JSON.stringify(describedRows) === JSON.stringify(assets.map(row).sort()),
  { schema: descriptor.schema, scrapling: descriptor.scrapling, described: describedRows.length, signed: assets.length }
);

// LGPL-2.1 section 6 for the libiconv inside lxml: the corresponding sources ship in the packaged tree.
const pinnedSources = PINNED.correspondingSources?.archives ?? [];
const missingSources = pinnedSources.filter((source) => {
  const file = path.join(RUNTIME, "sources", source.file);
  return !fs.existsSync(file) || createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== source.sha256;
});
check(
  `the pinned corresponding sources ship with their SHA-256, an LGPL one among them (${pinnedSources.length - missingSources.length}/${pinnedSources.length})`,
  pinnedSources.some((source) => /LGPL/.test(source.license)) && missingSources.length === 0,
  missingSources.map((source) => source.file)
);

if (stale !== null || failed > 0) {
  console.log(`\n${passed} passed, ${failed} failed — FAIL`);
  process.exit(1);
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────

const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-dom-intelligence-packaged-"));
const env = sanitizeAppEnv({ ...process.env, LOCALAPPDATA: localAppData }) as Record<string, string | undefined>;
delete env.ELECTRON_RUN_AS_NODE;
delete env.AWKIT_DOM_INTELLIGENCE;
delete env.AWKIT_LOCATOR_RECOVERY_ENGINE;

let app: ElectronApplication | null = null;
let pids: PackagedAppPids = { stubPid: 0, mainPid: 0 };
try {
  app = await electron.launch({ executablePath: EXE, env: env as never, timeout: 60_000 });
  pids = await capturePackagedAppPids(app);
  const win = await mainWindow(app);
  await signIn(win);
  check("the packaged app launched on a fresh profile and signed in its first account", true);
  check("no host is started by launch or sign-in (it starts on first use)", (await packagedHosts()).length === 0);

  console.log("\n1. The packaged app reports the runtime Available");
  const status: any = await win.evaluate(() => (window as any).playwrightFlowStudio.domIntelligence.getStatus());
  check("IPC: the runtime is shipped (resources/native-hosts/dom-intelligence)", status?.runtimeShipped === true, status);
  check("IPC: available", status?.available === true, status);
  check(`IPC: Scrapling ${PINNED.scrapling}, parser-only, no browser or network access`, status?.provider === "scrapling" && status?.version === PINNED.scrapling && status?.mode === "parser-only" && status?.browserAccess === false && status?.networkAccess === false, status);
  check("IPC: the snapshot recovery engine is in effect", status?.recoveryEngine === "snapshot", status?.recoveryEngine);

  const card = win.getByTestId("dom-intelligence-status");
  for (let attempt = 0; attempt < 3 && !(await card.isVisible().catch(() => false)); attempt += 1) {
    await navClick(win, "Settings");
    await card.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  }
  await win.waitForFunction(() => document.querySelector('[data-testid="dom-intelligence-state"]')?.textContent !== "Checking…", undefined, { timeout: 20_000 }).catch(() => undefined);
  const state = (await win.getByTestId("dom-intelligence-state").innerText().catch(() => "")).trim();
  const version = (await win.getByTestId("dom-intelligence-version").innerText().catch(() => "")).trim();
  const cardText = await card.innerText().catch(() => "");
  check("Settings: the DOM Intelligence card reads Available", state === "Available", { state, cardText });
  check(`Settings: the version is the pinned Scrapling ${PINNED.scrapling}`, version === PINNED.scrapling, version);
  check("Settings: parser only, browser and network access disabled", /Mode\s*Parser only/.test(cardText) && /Browser access\s*Disabled/.test(cardText) && /Network access\s*Disabled/.test(cardText), cardText);

  console.log("\n2. The host runs from the packaged tree, as a child of the packaged main process");
  const hosts = await packagedHosts();
  check("exactly one python.exe from resources/native-hosts/dom-intelligence is running", hosts.length === 1, hosts);
  check("it is a child of the packaged main process", hosts.length === 1 && hosts[0].ParentProcessId === pids.mainPid, { hosts, mainPid: pids.mainPid });

  console.log("\n3. A graceful quit leaves no host behind");
  await app.close().catch(() => undefined);
  app = null;
  let remaining = await packagedHosts();
  for (let waited = 0; remaining.length > 0 && waited < 10_000; waited += 500) {
    await sleep(500);
    remaining = await packagedHosts();
  }
  check("no python.exe from the packaged tree survives the quit (no orphan)", remaining.length === 0, remaining);
} catch (error) {
  check("the packaged gate ran to completion", false, error instanceof Error ? error.message : String(error));
} finally {
  const leftovers = await ensurePackagedAppDead(app, pids);
  check("the packaged app's process tree terminated", leftovers.length === 0, leftovers.join(","));
  fs.rmSync(localAppData, { recursive: true, force: true, maxRetries: 5, retryDelay: 1_000 });
}

const exitCode = gateExitCode({ passed, failed, inconclusive: 0, gateNotRun: false });
console.log(`\n${passed} passed, ${failed} failed — ${exitCode === 0 ? "PASS" : "FAIL"}`);
process.exit(exitCode);
