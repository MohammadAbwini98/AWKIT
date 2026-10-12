/**
 * verify:visual-isolation — Phase N (awkit-vra.1 / awkit-vra.3.1): Visual Intelligence is a module, not a behaviour.
 *
 * N0/N1 ship `src/visual` as evidence-only code. Visual similarity must never cause a Playwright click, fill, selector
 * replacement or locator recovery, and nothing may send pixels anywhere. This verifier proves it statically:
 *
 *   1. Reachability: walking the full import closure (at any depth, following the @src/, @main/ and @renderer/
 *      aliases) from the execution tree — runner, recorder, orchestrator, instances, session — from EVERY module of
 *      the Electron main process (main.ts, preload, every IPC handler, every service), and from the renderer never
 *      reaches `src/visual`. Cardinality floors prove the walk saw the tree.
 *   2. Mutation controls: a synthetic import of `src/visual` injected into a seed module, into a module reached only
 *      transitively, into main.ts, into an IPC handler and behind an aliased import must all be detected.
 *   3. The module itself: no network, filesystem, process or console API; only `node:crypto` and `node:zlib`
 *      builtins; no page interaction or navigation call. A planted offender must be caught by the same scan.
 *   4. The capture verification seams (N2.1, awkit-vra.12.1): across src, app, scripts, tools, mock-site and tests,
 *      only `src/visual/capture.ts` and `scripts/verify-visual-capture.mts` import `src/visual/internal`; the public
 *      `captureViewport` / `captureElement` take no seam parameter and nothing seam-shaped is re-exported. Planted
 *      importers (aliased, relative, index re-export) and planted surface leaks must each be caught.
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

/** Resolve one specifier to a repo-relative target: the tsconfig aliases and relative paths; packages are null. */
function resolveSpecifier(file: string, specifier: string): string | null {
  let absolute: string | null = null;
  if (specifier.startsWith("@src/")) absolute = join(REPO, "src", specifier.slice(5));
  else if (specifier.startsWith("@main/")) absolute = join(REPO, "app/main", specifier.slice(6));
  else if (specifier.startsWith("@renderer/")) absolute = join(REPO, "app/renderer", specifier.slice(10));
  else if (specifier.startsWith(".")) absolute = resolve(dirname(join(REPO, file)), specifier);
  return absolute ? toRepo(absolute) : null;
}

/** Resolve every import/require specifier in a file to a repo-relative target (aliases included). */
const targetCache = new Map<string, string[]>();
async function importTargets(file: string): Promise<string[]> {
  const cached = targetCache.get(file);
  if (cached) return cached;
  const text = await readFile(join(REPO, file), "utf8");
  const targets: string[] = [];
  for (const match of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)) {
    const target = resolveSpecifier(file, match[1]);
    if (target) targets.push(target);
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

// The whole Electron main process is seeded, not a hand-picked list of IPC handlers: N0/N1 expose no IPC surface, so
// no main-process module (main.ts, preload, any *.ipc.ts handler, any service) may reach src/visual at all.
const EXECUTION_TREES = ["src/runner", "src/recorder", "src/orchestrator", "src/instances", "src/session", "app/main"];
const EXECUTION_FILES = [
  "app/main/main.ts",
  "app/main/preload.ts",
  "app/main/ipc/index.ts",
  "app/main/ipc/execution.ipc.ts",
  "app/main/ipc/recorder.ipc.ts",
  "app/main/ipc/domIntelligence.ipc.ts"
];

console.log("\nThe execution tree and the main process cannot reach src/visual:\n");
const executionSeeds = [
  ...new Set([...(await Promise.all(EXECUTION_TREES.map((tree) => sourceFiles(join(REPO, tree))))).flat().map(toRepo), ...EXECUTION_FILES])
];
const execution = await walk(executionSeeds);
check("every named entry file exists", (await Promise.all(EXECUTION_FILES.map(resolveModule))).every((f) => f !== null));
const mainFiles = (await sourceFiles(join(REPO, "app/main"))).map(toRepo);
const ipcHandlers = mainFiles.filter((f) => /^app\/main\/ipc\/[^/]+\.ipc\.ts$/.test(f));
check(
  "every app/main module, including every IPC handler, is a seed",
  mainFiles.length >= 60 && ipcHandlers.length >= 25 && mainFiles.every((f) => executionSeeds.includes(f)),
  `${mainFiles.length} main modules, ${ipcHandlers.length} IPC handlers`
);
check("the execution tree was actually scanned", execution.files >= 160, String(execution.files));
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

  for (const [mainSeed, specifier] of [
    ["app/main/ipc/domIntelligence.ipc.ts", "src/visual/fingerprint"],
    ["app/main/main.ts", "src/visual"]
  ] as const) {
    const mutated = await walk(executionSeeds, new Map([[mainSeed, [specifier]]]));
    check(
      `MUTATION: an import of src/visual in ${mainSeed} is caught`,
      executionSeeds.includes(mainSeed) && mutated.offenders.some((o) => o.endsWith(`${mainSeed} -> ${specifier}`)),
      mutated.offenders.join("; ") || "not caught"
    );
  }

  // Aliased imports must resolve like relative ones: @src/, @main/ and @renderer/ specifiers are followed, not dropped.
  const aliases: Array<[string, string]> = [
    ["@src/visual/capture", "src/visual/capture"],
    ["@main/ipc/domIntelligence.ipc", "app/main/ipc/domIntelligence.ipc"],
    ["@renderer/App", "app/renderer/App"]
  ];
  const unresolved = aliases.filter(([specifier, want]) => resolveSpecifier("app/renderer/pages/x.tsx", specifier) !== want).map(([s]) => s);
  const licensing = await importTargets("app/renderer/pages/admin/LicensingPage.tsx");
  const viaMainAlias = licensing.find((t) => t.startsWith("app/main/licensing/"));
  const aliasWalk = viaMainAlias ? await walk(rendererSeeds, new Map([[(await resolveModule(viaMainAlias)) ?? "", ["src/visual"]]])) : null;
  check(
    "MUTATION: aliased imports resolve, and an src/visual import behind a renderer @main/ import is caught",
    unresolved.length === 0 && !!aliasWalk && aliasWalk.offenders.some((o) => o.includes("LicensingPage.tsx -> app/main/licensing/")),
    unresolved.length ? `unresolved: ${unresolved.join(", ")}` : aliasWalk?.offenders.join("; ") || "not caught"
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

console.log("\nThe capture verification seams are verifier-only (N2.1):\n");
{
  // The seams can replace the protected-surface guard, so the seam-taking entry may be imported by the public capture
  // module and the capture verifier only — never by product code, another script, or a re-export.
  const SEAM_ENTRY = "src/visual/internal";
  const SEAM_IMPORTERS = ["scripts/verify-visual-capture.mts", "src/visual/capture.ts"];
  const SCAN_ROOTS = ["src", "app", "scripts", "tools", "mock-site", "tests"];
  const isSeamEntry = (target: string): boolean => target === SEAM_ENTRY || target.startsWith(`${SEAM_ENTRY}/`);

  async function repoSources(dir: string): Promise<string[]> {
    const out: string[] = [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && ["node_modules", "dist", "out", ".git"].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await repoSources(path)));
      else if (/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) out.push(path);
    }
    return out;
  }

  const scanned = (await Promise.all(SCAN_ROOTS.map((root) => repoSources(join(REPO, root))))).flat().map(toRepo);
  // Files inside the seam entry itself are its implementation, not importers of it.
  const candidates = scanned.filter((file) => !isSeamEntry(file.replace(/\.[^.]+$/, "")) && !file.startsWith(`${SEAM_ENTRY}/`));

  /** Every file importing the seam entry. `inject` adds raw specifiers, resolved exactly like real ones. */
  async function seamImporters(inject: Map<string, string[]> = new Map()): Promise<string[]> {
    const found: string[] = [];
    for (const file of candidates) {
      const injected = (inject.get(file) ?? []).map((specifier) => resolveSpecifier(file, specifier)).filter((t): t is string => t !== null);
      if ([...(await importTargets(file)), ...injected].some(isSeamEntry)) found.push(file);
    }
    return found.sort();
  }

  const exactlyAllowed = (importers: string[]): boolean => JSON.stringify(importers) === JSON.stringify([...SEAM_IMPORTERS].sort());

  check("the repository was actually scanned", scanned.length >= 500 && candidates.includes("src/runner/PlaywrightRunner.ts"), String(scanned.length));
  const seamFiles = (await sourceFiles(join(REPO, SEAM_ENTRY))).map(toRepo);
  check("the seam entry exists", seamFiles.includes(`${SEAM_ENTRY}/captureCore.ts`), seamFiles.join(", ") || "missing");
  const importers = await seamImporters();
  check(
    "only src/visual/capture.ts and scripts/verify-visual-capture.mts import the seam entry (both do)",
    exactlyAllowed(importers),
    importers.join(", ") || "no importer found"
  );

  // The public surface: the exported functions take no seam parameter, and nothing seam-shaped is re-exported.
  const PUBLIC_PARAMS: Record<string, string[]> = { captureViewport: ["page", "options"], captureElement: ["page", "target", "options"] };
  function surfaceProblems(text: string): string[] {
    const problems: string[] = [];
    for (const [name, want] of Object.entries(PUBLIC_PARAMS)) {
      const match = new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\s*\\(([^)]*)\\)`).exec(text);
      if (!match) {
        problems.push(`${name} is not exported`);
        continue;
      }
      const params = match[1].split(",").map((p) => p.trim().replace(/[?:=\s].*$/s, "")).filter(Boolean);
      if (JSON.stringify(params) !== JSON.stringify(want)) problems.push(`${name}(${params.join(", ")})`);
    }
    const exported = [
      ...[...text.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap((m) => m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop() ?? "")),
      ...[...text.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type)\s+(\w+)/g)].map((m) => m[1])
    ].filter(Boolean);
    for (const name of exported) if (/WithSeams|Seams$|Internals$/.test(name)) problems.push(`exports ${name}`);
    if (/\bexport\s*\*\s*(?:as\s+\w+\s+)?from\s*["'][^"']*internal/.test(text)) problems.push("export * from the seam entry");
    return problems;
  }
  const captureText = await readFile(join(REPO, "src/visual/capture.ts"), "utf8");
  const surface = surfaceProblems(captureText);
  check("the public captureViewport / captureElement take no seam and nothing seam-shaped is re-exported", surface.length === 0, surface.join("; "));

  console.log("\nMutation controls (each planted seam leak must be caught):\n");
  for (const [file, specifier, label] of [
    ["src/runner/PlaywrightRunner.ts", "@src/visual/internal/captureCore", "a runner import through the @src/ alias"],
    ["src/visual/index.ts", "./internal/captureCore", "a re-export from the visual index"],
    ["scripts/benchmark-visual-capture.mts", "../src/visual/internal/captureCore", "another script's relative import"]
  ] as const) {
    const mutated = await seamImporters(new Map([[file, [specifier]]]));
    check(`MUTATION: ${label} is caught`, candidates.includes(file) && !exactlyAllowed(mutated) && mutated.includes(file), mutated.join(", "));
  }

  const plants: Array<[string, string]> = [
    [
      "a seam parameter on the public captureViewport",
      captureText.replace("captureViewport(page: Page, options: VisualCaptureOptions = {})", "captureViewport(page: Page, options: VisualCaptureOptions = {}, seams?: VisualCaptureSeams)")
    ],
    [
      "a seam parameter on the public captureElement",
      captureText.replace("captureElement(page: Page, target: Locator, options: VisualCaptureOptions = {})", "captureElement(page: Page, target: Locator, options: VisualCaptureOptions = {}, seams?: VisualCaptureSeams)")
    ],
    ["a re-export of the seam-taking function", `${captureText}\nexport { captureViewportWithSeams } from "./internal/captureCore";\n`],
    ["a star re-export of the seam entry", `${captureText}\nexport * from "./internal/captureCore";\n`]
  ];
  for (const [label, text] of plants) {
    check(`MUTATION: ${label} is caught`, text !== captureText && surfaceProblems(text).length > 0, "not caught or not planted");
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
