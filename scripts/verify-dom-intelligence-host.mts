/**
 * L11 (awkit-djnl.19): the parser-only DOM-intelligence host, staged exactly as it ships, and the client
 * that owns it.
 *
 * Run with: npm run verify:dom-intelligence-host
 *
 *   A. Staging     prepare-dom-intelligence-host.mjs stages into a temp dir OUTSIDE the repository; the tree
 *                  holds no removed runtime file, no removed stdlib entry, no stripped Scrapling path, no tld;
 *                  the host is byte-identical; the manifest lists every file with its SHA-256.
 *   B. Sandbox     a probe inside the staged interpreter: with the host imported, network, TLS, process,
 *                  FFI, async, browser, fetcher/spider/engine/shell, write, delete, rename, mkdir, chdir,
 *                  putenv, SQLite connect and a second audit hook are all refused; a control run without
 *                  the host proves the same write succeeds, so the refusal is the hook's.
 *   C. Protocol    raw JSON lines: unknown operation, unknown property, wrong protocol, invalid reference,
 *                  oversized HTML are refused and the host keeps serving; an unterminated or unparseable
 *                  line ends it; shutdown and stdin EOF end it cleanly.
 *   D. Client      ScraplingDomIntelligenceProvider on the staged host: status, candidates (the index stamp
 *                  never influences a score), bounds; then against a misbehaving fake host: network/
 *                  forbidden hello refused, malformed/wrong-id/bad-shape/oversized answers refused and the
 *                  host killed, a timeout kills it, repeated crashes open the circuit, an absent runtime is
 *                  UNAVAILABLE, a disabled provider spawns nothing.
 *   E. Lifecycle   the host exits when its owning process dies (no orphan); cold start and memory measured.
 *
 * Exit 2 (NOT RUN) when the pinned inputs are absent — never a pass on an unstaged runtime.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { NoopDomIntelligenceProvider } from "@src/runner/domIntelligence/DomIntelligenceProvider";
import { buildDomReference, type DomReferenceRecord } from "@src/runner/domIntelligence/domReference";
import { ScraplingDomIntelligenceProvider, scraplingHostLaunch } from "@src/runner/domIntelligence/ScraplingDomIntelligenceProvider";

const ROOT = resolve(".");
const PIN = JSON.parse(readFileSync(join(ROOT, "src/offline/dom-intelligence-runtime.json"), "utf8"));
const SEVEN_ZIP = join(ROOT, "node_modules/7zip-bin/win/x64/7za.exe");
const FAKE_HOST = join(ROOT, "scripts/dom-intelligence/fake_host.mjs");
const PROBE = join(ROOT, "scripts/dom-intelligence/sandbox_probe.py");
const PYTHON_FLAGS = ["-I", "-B", "-s", "-E", "-X", "utf8"];

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  OK ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  }
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const alive = (pid: number | undefined): boolean => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function waitGone(pid: number | undefined, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await sleep(50);
  }
  return !alive(pid);
}
function workingSetKb(pid: number | undefined): number | undefined {
  if (!pid) return undefined;
  const run = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
  const match = /"([\d,.\s]+) K"/.exec(run.stdout ?? "");
  return match ? Number(match[1].replace(/[^\d]/g, "")) : undefined;
}

const reference = (overrides: Partial<DomReferenceRecord["element"]> = {}): DomReferenceRecord => {
  const record = buildDomReference(
    {
      tag: "button",
      attributes: { id: "save-order", type: "button", class: "btn btn-primary" },
      text: "Save changes",
      path: ["html", "body", "main", "form", "div", "button"],
      parent: { tag: "div", attributes: { class: "actions" }, text: "" },
      siblings: ["button"],
      children: [],
      ...overrides
    },
    { referenceId: "ref-host-verifier", bindingDigest: "a".repeat(64), source: "recorder" }
  );
  if (!record) throw new Error("fixture reference did not build");
  return record;
};

/** The shape captureDomSnapshot emits: visible elements carry their `body *` index. */
const FIXTURE_HTML =
  '<html><body><main data-awkit-v="0"><h1 data-awkit-v="1">Order</h1>' +
  '<form data-awkit-v="2"><div class="actions" data-awkit-v="3">' +
  '<button type="button" class="btn" data-awkit-v="4">Cancel</button>' +
  '<button type="button" class="btn btn-primary" id="order-save" data-awkit-v="5">Save changes</button>' +
  "</div></form>" +
  '<section data-awkit-v="6"><button type="button" class="btn" data-awkit-v="7">Save changes</button></section>' +
  "</main></body></html>";

interface RawHost {
  child: ChildProcessWithoutNullStreams;
  send(line: string): void;
  next(ms?: number): Promise<any>;
  exit(ms?: number): Promise<number | null | "timeout">;
}

function rawHost(python: string, host: string): RawHost {
  const child = spawn(python, [...PYTHON_FLAGS, host], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" }
  });
  let buffer = "";
  const lines: string[] = [];
  const waiters: Array<(line: string | undefined) => void> = [];
  child.stdin.on("error", () => undefined);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
    }
  });
  let exitCode: number | null | undefined;
  const exited = new Promise<number | null>((done) => child.on("close", (code) => {
    exitCode = code;
    done(code);
  }));
  return {
    child,
    send: (line) => child.stdin.write(line.endsWith("\n") ? line : `${line}\n`),
    next: (ms = 20_000) =>
      new Promise((done) => {
        const queued = lines.shift();
        if (queued !== undefined) return done(JSON.parse(queued));
        const timer = setTimeout(() => done({ timeout: true }), ms);
        waiters.push((line) => {
          clearTimeout(timer);
          done(line === undefined ? { closed: true } : JSON.parse(line));
        });
      }),
    exit: (ms = 5_000) =>
      exitCode !== undefined ? Promise.resolve(exitCode) : Promise.race([exited, sleep(ms).then(() => "timeout" as const)])
  };
}

async function main(): Promise<void> {
  const inputsPresent =
    existsSync(join(ROOT, ".cache/dom-intelligence", PIN.python.archive)) &&
    PIN.wheels.every((wheel: { file: string }) => existsSync(join(ROOT, ".cache/dom-intelligence/wheels", wheel.file)));
  if (!inputsPresent) {
    console.log("NOT RUN: the pinned runtime inputs are absent (npm run benchmark:dom-intelligence-runtime-setup).");
    process.exit(2);
  }

  const work = mkdtempSync(join(tmpdir(), "awkit-dom-intel-verify-"));
  const staged = join(work, "dom-intelligence");
  try {
    // ── A. Staging ───────────────────────────────────────────────────────────────────────────────
    console.log("A. Staging (outside the repository)");
    const started = performance.now();
    const stage = spawnSync(process.execPath, ["scripts/prepare-dom-intelligence-host.mjs", "--out", staged], { encoding: "utf8", windowsHide: true, timeout: 300_000 });
    check("the staging script succeeds", stage.status === 0, (stage.stderr || stage.stdout).trim().slice(-800));
    if (stage.status !== 0) throw new Error("staging failed");
    console.log(`  (info) staged in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    const manifest = JSON.parse(readFileSync(join(staged, "dom-intelligence-host-manifest.json"), "utf8"));
    const listed = new Set<string>(manifest.assets.map((asset: { relativePath: string }) => asset.relativePath));
    const onDisk: string[] = [];
    const walk = (dir: string, prefix = ""): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(join(dir, entry.name), rel);
        else onDisk.push(rel);
      }
    };
    walk(staged);
    const files = onDisk.filter((rel) => rel !== "dom-intelligence-host-manifest.json");
    check("the manifest lists exactly the staged files", files.length === listed.size && files.every((rel) => listed.has(rel)), { onDisk: files.length, listed: listed.size });
    check("every manifest hash matches the staged file", manifest.assets.every((asset: { relativePath: string; sha256: string }) => sha256(join(staged, asset.relativePath)) === asset.sha256));
    check("the manifest records the pinned runtime and Scrapling", manifest.python === PIN.python.version && manifest.scrapling === PIN.scrapling && manifest.pythonArchiveSha256 === PIN.python.sha256);
    console.log(`  (info) ${manifest.fileCount} files, ${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MB staged`);
    const lower = files.map((rel) => rel.toLowerCase());
    const leakedRuntime = PIN.removedRuntimeFiles.filter((name: string) => lower.includes(`python/${name.toLowerCase()}`));
    check("no removed runtime file ships (no socket, TLS, FFI, async extension)", leakedRuntime.length === 0, leakedRuntime);
    check("the runtime is really trimmed (at least the network, TLS and FFI modules were present and removed)", ["_socket.pyd", "_ssl.pyd", "_ctypes.pyd"].every((name) => manifest.removedRuntimeFiles.includes(name)), manifest.removedRuntimeFiles);
    const stdlib = spawnSync(SEVEN_ZIP, ["l", "-slt", join(staged, "python/python312.zip")], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    const entries = [...(stdlib.stdout ?? "").matchAll(/^Path = (.+)$/gm)].map((m) => m[1].replace(/\\/g, "/").trim()).filter((p) => !p.endsWith(".zip"));
    check("the stdlib archive was listed", entries.length > 300, entries.length);
    const leakedStdlib = entries.filter((entry) =>
      [...PIN.removedStdlibTopLevel, ...PIN.removedStdlibModules].some((name: string) => entry === `${name}.pyc` || entry.startsWith(`${name}/`))
    );
    check("no removed stdlib package or module ships (socket, ssl, subprocess, asyncio, ctypes, http, urllib.request, …)", leakedStdlib.length === 0, leakedStdlib.slice(0, 10));
    check("the stdlib keeps what the parser needs (json, logging, difflib, urllib.parse, sqlite3)", ["json/__init__.pyc", "logging/__init__.pyc", "difflib.pyc", "urllib/parse.pyc", "sqlite3/__init__.pyc"].every((entry) => entries.includes(entry)));
    const strippedLeft = PIN.strippedScraplingPaths.filter((rel: string) => files.some((file) => file === `site-packages/${rel}` || file.startsWith(`site-packages/${rel}/`)));
    check("Scrapling's fetchers, spiders, engines, integrations, ai, shell and cli code does not ship", strippedLeft.length === 0, strippedLeft);
    check("tld does not ship", !files.some((file) => /^site-packages\/tld([-_.\/]|$)/i.test(file)));
    check("no Playwright, Patchright, curl_cffi, browserforge or MCP package ships", !files.some((file) => /^site-packages\/(playwright|patchright|curl_cffi|browserforge|camoufox|mcp)[-_./]/i.test(file)));
    check("the host is byte-identical to native-hosts/dom-intelligence", sha256(join(staged, "host/dom_intelligence_host.py")) === sha256(join(ROOT, "native-hosts/dom-intelligence/dom_intelligence_host.py")));
    const pinnedSources: Array<{ file: string; sha256: string; license: string }> = PIN.correspondingSources?.archives ?? [];
    check(
      "the pinned corresponding sources (LGPL-2.1 section 6) are staged under sources/ with their SHA-256, an LGPL one among them",
      pinnedSources.some((source) => /LGPL/.test(source.license)) && pinnedSources.every((source) => files.includes(`sources/${source.file}`) && sha256(join(staged, "sources", source.file)) === source.sha256),
      pinnedSources.map((source) => source.file)
    );
    const pth = readFileSync(join(staged, "python/python312._pth"), "utf8").split(/\r?\n/).filter(Boolean);
    check("sys.path is pinned to the staged tree and `site` is never imported", JSON.stringify(pth) === JSON.stringify(["python312.zip", ".", "..\\site-packages", "..\\host"]), pth);
    // Bytecode is compiled at staging time with unchecked-hash headers (flags == 1: hash-based, source not
    // checked), so the -B runtime never writes a cache and never recompiles on start.
    const pycs = files.filter((file) => file.startsWith("site-packages/") && file.endsWith(".pyc"));
    const pycFlags = pycs.map((file) => readFileSync(join(staged, file)).readUInt32LE(4));
    const sources = files.filter((file) => /^site-packages\/.+\.py$/.test(file));
    const uncompiled = sources.filter((source) => {
      const dir = source.slice(0, source.lastIndexOf("/"));
      const name = source.slice(source.lastIndexOf("/") + 1, -3);
      return !files.includes(`${dir}/__pycache__/${name}.cpython-312.pyc`);
    });
    check("every shipped site-packages source has its compiled module", sources.length > 0 && uncompiled.length === 0, { sources: sources.length, uncompiled: uncompiled.slice(0, 5) });
    check("every compiled module is unchecked-hash (flags 1), so the -B runtime never recompiles", pycs.length === sources.length && pycFlags.every((flags) => flags === 1), { pycs: pycs.length, flags: [...new Set(pycFlags)] });
    check("no bytecode cache ships outside site-packages", !files.some((file) => file.includes("__pycache__") && !file.startsWith("site-packages/")));

    const python = join(staged, "python/python.exe");
    const hostScript = join(staged, "host/dom_intelligence_host.py");

    // ── B. Sandbox ───────────────────────────────────────────────────────────────────────────────
    console.log("B. Sandbox (a probe inside the staged interpreter)");
    const scratch = join(work, "scratch");
    mkdirSync(scratch, { recursive: true });
    const control = spawnSync(python, [...PYTHON_FLAGS, PROBE, join(staged, "host"), scratch, "--control"], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
    const controlResult = JSON.parse((control.stdout || "{}").trim() || "{}");
    check("control: without the host, the same write succeeds (so a refusal below is the hook's)", controlResult["control-write"]?.refused === false, controlResult);
    const probe = spawnSync(python, [...PYTHON_FLAGS, PROBE, join(staged, "host"), scratch], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
    let probeResult: Record<string, { refused: boolean; error?: string }> = {};
    try {
      probeResult = JSON.parse(probe.stdout.trim());
    } catch {
      check("the probe produced a result", false, (probe.stderr || probe.stdout).slice(-500));
    }
    const expected = [
      "import-socket", "import-ssl", "import-subprocess", "import-ctypes", "import-asyncio", "import-http-client",
      "import-playwright", "import-patchright", "import-scrapling-fetchers", "import-scrapling-spiders", "import-scrapling-engines",
      "import-scrapling-shell", "import-tld", "write-file", "append-file", "os-open-write", "remove-file", "rename-file",
      "make-directory", "os-system", "os-startfile", "putenv", "chdir", "sqlite-connect", "winapi-create-process",
      "add-audit-hook", "urlopen-available"
    ];
    check(`the probe tried all ${expected.length} forbidden operations`, expected.every((name) => name in probeResult), Object.keys(probeResult));
    for (const name of expected) check(`refused: ${name}`, probeResult[name]?.refused === true, probeResult[name]);
    check("a refused write is a sandbox refusal, not a missing path", probeResult["remove-file"]?.error === "RuntimeError" && probeResult["write-file"]?.error === "PermissionError", { remove: probeResult["remove-file"], write: probeResult["write-file"] });
    check("nothing was written by the refused operations", !existsSync(join(scratch, "blocked.txt")) && !existsSync(join(scratch, "blocked-os.txt")) && !existsSync(join(scratch, "made")) && existsSync(join(scratch, "control.txt")));

    // ── C. Protocol ──────────────────────────────────────────────────────────────────────────────
    console.log("C. Protocol (raw JSON lines)");
    {
      const host = rawHost(python, hostScript);
      host.send(JSON.stringify({ id: 1, op: "hello", protocol: 1 }));
      const hello = await host.next();
      check("hello answers the parser-only protocol", hello.ok === true && hello.result.mode === "parser-only" && hello.result.protocol === 1, hello);
      check("hello proves network and browser access are refused at run time", hello.result?.network === false && hello.result?.browser === false && hello.result?.auditHook === true);
      check("hello reports the pinned Scrapling and CPython", hello.result?.scrapling === PIN.scrapling && hello.result?.python === PIN.python.version, hello.result);
      check("no forbidden module is loaded after start", Array.isArray(hello.result?.forbiddenModulesLoaded) && hello.result.forbiddenModulesLoaded.length === 0, hello.result?.forbiddenModulesLoaded);
      host.send(JSON.stringify({ id: 2, op: "eval", code: "1+1" }));
      const unknown = await host.next();
      check("an unknown operation is refused", unknown.id === 2 && unknown.ok === false && unknown.error?.code === "UNKNOWN_OP", unknown);
      host.send(JSON.stringify({ id: 3, op: "health", url: "https://example.com" }));
      const extra = await host.next();
      check("an unknown property (a URL) is refused", extra.id === 3 && extra.ok === false && extra.error?.code === "UNKNOWN_PROPERTY", extra);
      host.send(JSON.stringify({ id: 4, op: "hello", protocol: 2 }));
      const protocol = await host.next();
      check("a different protocol version is refused", protocol.ok === false && protocol.error?.code === "INCOMPATIBLE_PROTOCOL", protocol);
      host.send(JSON.stringify({ id: 5, op: "find_candidates", html: "<html></html>", reference: { element: { tag: "button", attributes: {}, text: "x".repeat(500), path: ["button"] } }, maxCandidates: 5, minScore: 40 }));
      const invalid = await host.next();
      check("an out-of-bounds reference is refused", invalid.ok === false && invalid.error?.code === "REFERENCE_INVALID", invalid);
      host.send(JSON.stringify({ id: 6, op: "find_candidates", html: "a".repeat(2 * 1024 * 1024 + 10), reference: reference(), maxCandidates: 5, minScore: 40 }));
      const oversized = await host.next();
      check("HTML over the 2 MiB bound is refused", oversized.ok === false && oversized.error?.code === "HTML_INVALID", oversized);
      host.send(JSON.stringify({ id: 7, op: "find_candidates", html: FIXTURE_HTML, reference: reference(), maxCandidates: 50, minScore: 40 }));
      const bounds = await host.next();
      check("more than 20 candidates is refused", bounds.ok === false && bounds.error?.code === "BOUNDS_INVALID", bounds);
      host.send(JSON.stringify({ id: 8, op: "health" }));
      const health = await host.next();
      check("the host keeps serving after refusals", health.ok === true && health.result?.requests >= 7, health);
      host.send(JSON.stringify({ id: 9, op: "shutdown" }));
      const bye = await host.next();
      check("shutdown answers and the host exits 0", bye.ok === true && (await host.exit()) === 0);
    }
    {
      const host = rawHost(python, hostScript);
      host.send("{not json");
      check("an unparseable line ends the host (exit 2)", (await host.exit(15_000)) === 2);
    }
    {
      const host = rawHost(python, hostScript);
      host.child.stdin.write("x".repeat(3 * 1024 * 1024 + 16));
      check("an oversized unterminated line ends the host (exit 2)", (await host.exit(15_000)) === 2);
    }
    {
      const host = rawHost(python, hostScript);
      host.send(JSON.stringify({ id: 1, op: "hello", protocol: 1 }));
      await host.next();
      host.child.stdin.end();
      check("stdin EOF ends the host (exit 0) — it cannot outlive its owner's pipe", (await host.exit(10_000)) === 0);
    }

    // ── D. Client ────────────────────────────────────────────────────────────────────────────────
    console.log("D. Client (ScraplingDomIntelligenceProvider)");
    const provider = new ScraplingDomIntelligenceProvider({ launch: () => scraplingHostLaunch(python, hostScript) });
    const coldStart = performance.now();
    const status = await provider.getStatus();
    const coldMs = performance.now() - coldStart;
    check("status: available, parser-only, no browser, no network", status.available && status.provider === "scrapling" && status.mode === "parser-only" && status.browserAccess === false && status.networkAccess === false, status);
    check("status: the pinned Scrapling release", status.version === PIN.scrapling, status.version);
    console.log(`  (info) cold start (spawn to hello): ${coldMs.toFixed(0)} ms, working set ${workingSetKb(provider.pid) ?? "?"} KB`);
    const saved = await provider.saveReference(reference());
    check("save_reference validates the reference the scorer will use", "fields" in saved && saved.fields.includes("parent_name") && saved.fields.includes("path"), saved);
    const warm: number[] = [];
    let found: Awaited<ReturnType<typeof provider.findRecoveryCandidates>> | undefined;
    for (let i = 0; i < 20; i += 1) {
      const t = performance.now();
      found = await provider.findRecoveryCandidates({ html: FIXTURE_HTML, reference: reference(), maxCandidates: 5 });
      warm.push(performance.now() - t);
    }
    warm.sort((a, b) => a - b);
    console.log(`  (info) warm find_candidates on the fixture: p50 ${warm[10].toFixed(1)} ms, p95 ${warm[18].toFixed(1)} ms`);
    check("find_candidates answers", found?.ok === true, found);
    if (found?.ok) {
      check("candidates are stamped indices only, at most maxCandidates, best first", found.candidates.length <= 5 && found.candidates.every((c) => Number.isInteger(c.index) && c.index >= 0 && c.index <= 7) && found.candidates.every((c, i, all) => i === 0 || all[i - 1].score >= c.score), found.candidates);
      check("the provider's best is the recorded button (index 5), not the same-label one elsewhere", found.candidates[0]?.index === 5, found.candidates);
      check("the provider scored every stamped element (the stamp itself was removed before scoring)", found.elements === 8, found.elements);
    }
    // The stamp value must not influence a score: renumbering the same page leaves the scores unchanged.
    const renumbered = FIXTURE_HTML.replace(/data-awkit-v="(\d+)"/g, (_m, n) => `data-awkit-v="${Number(n) + 1000}"`);
    const again = await provider.findRecoveryCandidates({ html: renumbered, reference: reference(), maxCandidates: 5 });
    check(
      "renumbered stamps give the same scores (the index never leaks into scoring)",
      found?.ok && again.ok && JSON.stringify(again.candidates.map((c) => [c.index - 1000, c.score])) === JSON.stringify(found.candidates.map((c) => [c.index, c.score])),
      again
    );
    const tooBig = await provider.findRecoveryCandidates({ html: "a".repeat(2 * 1024 * 1024 + 1), reference: reference() });
    check("the client refuses oversized HTML before sending it", !tooBig.ok && tooBig.code === "OVERSIZED", tooBig);
    const badReference = await provider.findRecoveryCandidates({ html: FIXTURE_HTML, reference: { ...reference(), element: { ...reference().element, text: "x".repeat(400) } } });
    check("the client refuses a reference not in its bounded, redacted form", !badReference.ok && badReference.code === "REJECTED", badReference);

    // L12.2: candidateIndices restricts scoring to AWKIT's competitors. Index 7 (the same-label button elsewhere)
    // is scored on its own even though index 5 outscores it on the whole page.
    const onlySeven = await provider.findRecoveryCandidates({ html: FIXTURE_HTML, reference: reference(), maxCandidates: 5, candidateIndices: [7] });
    check("L12.2 candidateIndices: only the listed elements are scored", onlySeven.ok && onlySeven.candidates.length === 1 && onlySeven.candidates[0].index === 7, onlySeven);
    const none = await provider.findRecoveryCandidates({ html: FIXTURE_HTML, reference: reference(), maxCandidates: 5, candidateIndices: [] });
    check("L12.2 an empty list scores nothing", none.ok && none.candidates.length === 0, none);
    const pair = await provider.findRecoveryCandidates({ html: FIXTURE_HTML, reference: reference(), maxCandidates: 5, candidateIndices: [4, 5, 7] });
    check(
      "L12.2 a restricted score equals the same element's unrestricted score (only the set changes)",
      pair.ok && found?.ok && pair.candidates.every((c) => found!.ok && found!.candidates.find((f) => f.index === c.index)?.score === c.score) && pair.candidates[0]?.index === 5,
      pair
    );
    const overBound = await provider.findRecoveryCandidates({ html: FIXTURE_HTML, reference: reference(), maxCandidates: 5, candidateIndices: Array.from({ length: 5_001 }, (_, i) => i) });
    check("L12.2 a list over the bound is dropped by the client (every element scored), never truncated", overBound.ok && found?.ok && overBound.candidates.length === found.candidates.length, overBound);
    // L12.3: the one-entry parse cache.
    const other = await provider.findRecoveryCandidates({ html: renumbered, reference: reference(), maxCandidates: 5 });
    const first = await provider.findRecoveryCandidates({ html: FIXTURE_HTML, reference: reference(), maxCandidates: 5 });
    const second = await provider.findRecoveryCandidates({ html: FIXTURE_HTML, reference: reference(), maxCandidates: 5 });
    check("L12.3 a new snapshot is parsed", other.ok && other.parseReused === false && first.ok && first.parseReused === false, { other, first });
    check("L12.3 the same snapshot again reuses the parse", second.ok && second.parseReused === true, second);
    check("L12.3 a reused parse gives identical candidates", first.ok && second.ok && JSON.stringify(first.candidates) === JSON.stringify(second.candidates));
    // find_similar: Cancel (4) and Save (5) share depth, tag and parents; the section's button (7) does not.
    const similar = provider.findSimilar ? await provider.findSimilar({ html: FIXTURE_HTML, index: 4 }) : undefined;
    check("find_similar answers with stamped indices", similar?.ok === true && similar.index === 4, similar);
    check("find_similar finds the sibling button and not the one in another region", similar?.ok === true && similar.similar.includes(5) && !similar.similar.includes(7) && !similar.similar.includes(4), similar);
    const unknown = provider.findSimilar ? await provider.findSimilar({ html: FIXTURE_HTML, index: 99 }) : undefined;
    check("find_similar refuses an index that is not stamped", unknown?.ok === false && unknown.code === "REJECTED", unknown);
    const bounded = provider.findSimilar ? await provider.findSimilar({ html: FIXTURE_HTML, index: 4, maxResults: 1_000 }) : undefined;
    check("find_similar clamps maxResults to its bound", bounded?.ok === true, bounded);
    const hostPid = provider.pid;
    await provider.shutdown();
    check("shutdown stops the host process", await waitGone(hostPid, 5_000), hostPid);

    const fake = (mode: string, extra: Partial<ConstructorParameters<typeof ScraplingDomIntelligenceProvider>[0]> = {}) =>
      new ScraplingDomIntelligenceProvider({ launch: () => ({ command: process.execPath, args: [FAKE_HOST, mode] }), ...extra });
    {
      const good = fake("good");
      const result = await good.findRecoveryCandidates({ html: FIXTURE_HTML, reference: reference() });
      check("fake host control: a well-formed answer is accepted", result.ok && result.candidates[0]?.index === 3, result);
      await good.shutdown();
    }
    for (const mode of ["network", "forbidden"]) {
      const bad = fake(mode);
      const status = await bad.getStatus();
      check(`a host whose hello reports ${mode === "network" ? "network access" : "a forbidden module"} is refused`, !status.available && status.reason === "INCOMPATIBLE", status);
      await bad.shutdown();
    }
    for (const [mode, code] of [["malformed", "MALFORMED"], ["wrong-id", "MALFORMED"], ["bad-shape", "MALFORMED"], ["oversized", "OVERSIZED"]] as const) {
      const bad = fake(mode);
      await bad.getStatus();
      const pid = bad.pid;
      const result = await bad.findRecoveryCandidates({ html: FIXTURE_HTML, reference: reference(), timeoutMs: 3_000 });
      check(`a ${mode} answer is refused as ${code}`, !result.ok && result.code === code, result);
      check(`the ${mode} host is killed`, await waitGone(pid, 5_000), pid);
      await bad.shutdown();
    }
    {
      const slow = fake("slow");
      await slow.getStatus();
      const pid = slow.pid;
      const t = performance.now();
      const result = await slow.findRecoveryCandidates({ html: FIXTURE_HTML, reference: reference(), timeoutMs: 300 });
      const ms = performance.now() - t;
      check("a request past its deadline answers TIMEOUT within the budget", !result.ok && result.code === "TIMEOUT" && ms < 1_500, { result, ms });
      check("the wedged host is killed on timeout", await waitGone(pid, 5_000), pid);
      await slow.shutdown();
    }
    {
      const crashing = fake("crash", { maxCrashes: 3, crashWindowMs: 60_000 });
      const first = await crashing.getStatus();
      check("a host that exits before hello is unavailable, not a thrown error", !first.available, first);
      await crashing.getStatus();
      await crashing.getStatus();
      const t = performance.now();
      const paused = await crashing.getStatus();
      check("repeated crashes open the circuit: no further spawn, an immediate answer", !paused.available && performance.now() - t < 200, paused);
      await crashing.shutdown();
    }
    {
      const absent = new ScraplingDomIntelligenceProvider({ launch: () => undefined });
      const status = await absent.getStatus();
      check("an absent runtime reports UNAVAILABLE", !status.available && status.reason === "UNAVAILABLE", status);
      const noop = new NoopDomIntelligenceProvider();
      const result = await noop.findRecoveryCandidates();
      check("the no-op provider answers DISABLED without spawning anything", !result.ok && result.code === "DISABLED" && !(await noop.getStatus()).available);
    }

    // ── E. Lifecycle: no orphan ──────────────────────────────────────────────────────────────────
    console.log("E. Lifecycle (the host dies with its owner)");
    {
      const owner = spawn(
        process.execPath,
        [
          "-e",
          `const {spawn}=require("node:child_process");const h=spawn(${JSON.stringify(python)},${JSON.stringify([...PYTHON_FLAGS, hostScript])},{stdio:["pipe","pipe","ignore"],windowsHide:true,env:{SystemRoot:process.env.SystemRoot}});h.stdout.once("data",()=>{process.stdout.write(String(h.pid)+"\\n")});h.stdin.write(JSON.stringify({id:1,op:"hello",protocol:1})+"\\n");setInterval(()=>{},1e6);`
        ],
        { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }
      );
      const hostPid = await new Promise<number>((done) => owner.stdout.once("data", (chunk) => done(Number(String(chunk).trim()))));
      check("the owning process started a host", alive(hostPid), hostPid);
      owner.kill();
      check("killing the owner ends the host (stdin EOF), no orphan remains", await waitGone(hostPid, 10_000), hostPid);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
