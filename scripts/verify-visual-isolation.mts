/**
 * verify:visual-isolation — Phase N (awkit-vra.1 / awkit-vra.3.1): Visual Intelligence is a module, not a behaviour.
 *
 * N0/N1 ship `src/visual` as evidence-only code. Visual similarity must never cause a Playwright click, fill, selector
 * replacement or locator recovery, and nothing may send pixels anywhere. This verifier proves it statically:
 *
 *   1. Reachability: walking the full import closure (at any depth) from the execution tree — runner, recorder,
 *      orchestrator, instances, session, the main-process execution service and IPC, the preload bridge — and from
 *      the renderer never reaches `src/visual`. Cardinality floors prove the walk saw the tree.
 *   2. Mutation controls: a synthetic import of `src/visual` injected into a seed module, and into a module reached
 *      only transitively, must both be detected, with the chain that reaches it.
 *   3. The module itself: no network, filesystem, process or console API; only `node:crypto` and `node:zlib`
 *      builtins; no page interaction or navigation call. A planted offender must be caught by the same scan.
 *
 * Run: npm run verify:visual-isolation
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const REPO = resolve(".");

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const toRepo = (absolute: string): string => relative(REPO, absolute).replace(/\\/g, "/");

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (/\.(?:ts|tsx|mts|cts|js|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Resolve every import/require specifier in a file to a repo-relative target (aliases included). */
const targetCache = new Map<string, string[]>();
async function importTargets(file: string): Promise<string[]> {
  const cached = targetCache.get(file);
  if (cached) return cached;
  const text = await readFile(join(REPO, file), "utf8");
  const targets: string[] = [];
  for (const match of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)) {
    const specifier = match[1];
    let absolute: string | null = null;
    if (specifier.startsWith("@src/")) absolute = join(REPO, "src", specifier.slice(5));
    else if (specifier.startsWith(".")) absolute = resolve(dirname(join(REPO, file)), specifier);
    if (absolute) targets.push(toRepo(absolute));
  }
  targetCache.set(file, targets);
  return targets;
}

/** Resolve a repo-relative import target to the source file it actually names, if any. */
const moduleFileCache = new Map<string, string | null>();
async function resolveModule(target: string): Promise<string | null> {
  const cached = moduleFileCache.get(target);
  if (cached !== undefined) return cached;
  let found: string | null = null;
  for (const suffix of ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", "/index.ts", "/index.tsx"]) {
    const candidate = `${target}${suffix}`;
    if (suffix === "" && !/\.(?:ts|tsx|mts|cts|js|mjs)$/.test(candidate)) continue;
    try {
      await readFile(join(REPO, candidate), "utf8");
      found = candidate;
      break;
    } catch {
      // Not this extension.
    }
  }
  moduleFileCache.set(target, found);
  return found;
}

const isVisual = (target: string): boolean => target === "src/visual" || target.startsWith("src/visual/") || target.startsWith("src/visual.");

interface Walk {
  files: number;
  imports: number;
  seen: Set<string>;
  offenders: string[];
}

/**
 * Breadth-first over the import closure of `seeds`. `inject` adds synthetic import targets to named modules, so the
 * mutation controls exercise exactly this walk rather than a copy of it.
 */
async function walk(seeds: string[], inject: Map<string, string[]> = new Map()): Promise<Walk> {
  const start = [...new Set(seeds)];
  const seen = new Set<string>(start);
  const cameFrom = new Map<string, string>();
  const queue = [...start];
  const offenders: string[] = [];
  let imports = 0;
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const targets = [...(await importTargets(current)), ...(inject.get(current) ?? [])];
    if (start.includes(current)) imports += targets.length;
    for (const target of targets) {
      if (isVisual(target)) {
        const chain = [current];
        for (let at = current; cameFrom.has(at); ) {
          at = cameFrom.get(at) as string;
          chain.unshift(at);
        }
        offenders.push(`${chain.join(" -> ")} -> ${target}`);
        continue;
      }
      const resolved = await resolveModule(target);
      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      cameFrom.set(resolved, current);
      queue.push(resolved);
    }
  }
  return { files: start.length, imports, seen, offenders };
}

const EXECUTION_TREES = ["src/runner", "src/recorder", "src/orchestrator", "src/instances", "src/session", "app/main/execution"];
const EXECUTION_FILES = ["app/main/preload.ts", "app/main/ipc/execution.ipc.ts", "app/main/ipc/recorder.ipc.ts"];

console.log("\nThe execution tree cannot reach src/visual:\n");
const executionSeeds = [
  ...(await Promise.all(EXECUTION_TREES.map((tree) => sourceFiles(join(REPO, tree))))).flat().map(toRepo),
  ...EXECUTION_FILES
];
const execution = await walk(executionSeeds);
check("every named entry file exists", (await Promise.all(EXECUTION_FILES.map(resolveModule))).every((f) => f !== null));
check("the execution tree was actually scanned", execution.files >= 100, String(execution.files));
check("its imports were resolved", execution.imports >= 300, String(execution.imports));
check(
  "the closure was actually walked, wider than its seeds",
  execution.seen.size >= 150 && execution.seen.size > execution.files,
  `${execution.seen.size} modules from ${execution.files} files`
);
check("no module the execution tree can reach, at any depth, imports src/visual", execution.offenders.length === 0, execution.offenders.join("; "));

console.log("\nThe renderer cannot reach src/visual:\n");
const rendererSeeds = (await sourceFiles(join(REPO, "app/renderer"))).map(toRepo);
const renderer = await walk(rendererSeeds);
check("the renderer was actually scanned", renderer.files >= 50, String(renderer.files));
check("no module the renderer can reach imports src/visual", renderer.offenders.length === 0, renderer.offenders.join("; "));

console.log("\nMutation controls (each injected import must be caught):\n");
{
  const seed = "src/runner/PlaywrightRunner.ts";
  const seedExists = executionSeeds.includes(seed);
  const atSeed = await walk(executionSeeds, new Map([[seed, ["src/visual/capture"]]]));
  check("MUTATION: an import of src/visual in a seed module is caught", seedExists && atSeed.offenders.some((o) => o.endsWith(`${seed} -> src/visual/capture`)), atSeed.offenders.join("; ") || "not caught");

  const seedSet = new Set(executionSeeds);
  const transitive = [...execution.seen].find((m) => !seedSet.has(m) && m.startsWith("src/"));
  const deep = transitive ? await walk(executionSeeds, new Map([[transitive, ["src/visual"]]])) : null;
  check(
    "MUTATION: an import of src/visual in a module reached only transitively is caught, with its chain",
    !!transitive && !!deep && deep.offenders.some((o) => o.endsWith(`${transitive} -> src/visual`) && o.split(" -> ").length >= 3),
    deep ? deep.offenders.join("; ") || `not caught (${transitive})` : "no transitive module found"
  );
}

console.log("\nsrc/visual is pure evidence code:\n");
const FORBIDDEN: Array<[string, RegExp]> = [
  ["a network module", /["']node:(?:http|https|http2|net|tls|dgram|dns)["']|["'](?:http|https|net|tls|dgram|dns|undici|axios|node-fetch|ws)["']/],
  ["a filesystem or process module", /["']node:(?:fs|fs\/promises|child_process|worker_threads)["']|["'](?:fs|fs\/promises|child_process)["']/],
  ["a network API", /\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b|\bEventSource\b|\bsendBeacon\b/],
  ["a file write", /\bwriteFile(?:Sync)?\b|\bcreateWriteStream\b|\bappendFile(?:Sync)?\b/],
  ["console logging", /\bconsole\s*\./],
  ["a page interaction", /\.(?:click|dblclick|fill|press|pressSequentially|type|tap|hover|focus|blur|dispatchEvent|selectOption|selectText|setInputFiles|setChecked|uncheck|dragTo|scrollIntoViewIfNeeded)\s*\(/],
  ["an input device", /\b(?:keyboard|mouse|touchscreen)\s*\./],
  ["navigation or scrolling", /\.(?:goto|reload|goBack|goForward|setContent)\s*\(|\bscroll(?:To|By|IntoView)\b/]
];
const ALLOWED_BUILTINS = new Set(["node:crypto", "node:zlib"]);

function violations(text: string): string[] {
  const found = FORBIDDEN.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  for (const match of text.matchAll(/["'](node:[a-z_/]+)["']/g)) if (!ALLOWED_BUILTINS.has(match[1])) found.push(`builtin ${match[1]}`);
  return found;
}

{
  const files = (await sourceFiles(join(REPO, "src/visual"))).map(toRepo);
  check("src/visual was actually scanned", files.length >= 8, String(files.length));
  const problems: string[] = [];
  let builtins = 0;
  for (const file of files) {
    const text = await readFile(join(REPO, file), "utf8");
    builtins += [...text.matchAll(/["'](node:[a-z_/]+)["']/g)].length;
    for (const v of violations(text)) problems.push(`${file}: ${v}`);
  }
  check("no network, filesystem, process, console, interaction or navigation API in src/visual", problems.length === 0, problems.join("; "));
  check("the builtin scan saw the module's own builtins (crypto, zlib)", builtins >= 2, String(builtins));

  const planted: Array<[string, string]> = [
    ["a click", "await locator.click();"],
    ["a fill", "await page.getByLabel('x').fill('y');"],
    ["a fetch", "await fetch('http://127.0.0.1/upload', { body });"],
    ["an http import", 'import { request } from "node:https";'],
    ["a file write", "writeFileSync(path, png);"],
    ["a console log", "console.log(image);"],
    ["mouse input", "await page.mouse.click(1, 2);"],
    ["a scroll", "window.scrollTo(0, 500);"]
  ];
  const missed = planted.filter(([, code]) => violations(code).length === 0).map(([name]) => name);
  check(`MUTATION: every planted offender is caught by the same scan (${planted.length})`, missed.length === 0, `missed: ${missed.join(", ")}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
