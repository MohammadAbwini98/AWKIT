/**
 * Source-hygiene guard: no literal control characters in TypeScript sources.
 *
 * A raw control byte in source is invisible in diffs and code review, and is silently destroyed by
 * an editor or a copy/paste round trip — so a delimiter written that way can change meaning with no
 * visible edit. This has now bitten three times: a U+001F tag separator and a U+0000 hash separator
 * in the semantic subsystem, and U+0001/U+0002 delimiters in `sharedCompatibilityKey`.
 *
 * The rule is not "never use these characters". It is "always write them as escape sequences", which
 * is byte-identical at runtime and visible on the page.
 *
 * Note this file practises what it enforces: the pattern below is written with escapes. An earlier
 * draft spelled the range with literal control characters and a cleanup pass silently ate them,
 * turning the guard into one that matched a plain hyphen — a guard that cannot be read is a guard
 * that cannot be trusted.
 *
 * Tab (U+0009), LF (U+000A) and CR (U+000D) are legitimate whitespace and are exempt.
 *
 * Run: npx tsx scripts/verify-source-hygiene.mts
 */

import fs from "node:fs";
import path from "node:path";

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

const ROOTS = ["src", "app", "scripts"];
/** Markdown roots. `docs/ai/` is parsed by the roadmap dashboard, so a stray control char there is
 *  not cosmetic — it silently changes what a source document says. */
const DOC_ROOTS = ["docs"];
const SKIP_DIRS = new Set(["node_modules", "dist", "out", ".git"]);

/** Control characters except tab (0009), LF (000A) and CR (000D). */
const CONTROL_SOURCE = "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]";
const controlPattern = (): RegExp => new RegExp(CONTROL_SOURCE, "g");

function collect(dir: string, into: string[], match: RegExp): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, into, match);
    else if (match.test(entry.name)) into.push(full);
  }
}

/** Reads a file and returns "path:line (U+xxxx,…)" for the first offender, or null if clean. */
function scan(file: string): string | null {
  const text = fs.readFileSync(file, "utf8");
  const matches = text.match(controlPattern());
  if (!matches) return null;
  const index = text.search(controlPattern());
  const line = text.slice(0, index).split("\n").length;
  const codes = [...new Set(matches.map((c) => `U+${c.charCodeAt(0).toString(16).padStart(4, "0")}`))];
  return `${file}:${line} (${codes.join(",")})`;
}

const files: string[] = [];
for (const root of ROOTS) collect(root, files, /\.(ts|mts|tsx)$/);

console.log(`Source hygiene — scanning ${files.length} TypeScript files:\n`);

const offenders = files.map(scan).filter((o): o is string => o !== null);

check(
  "no TypeScript source contains a literal control character",
  offenders.length === 0,
  offenders.slice(0, 10).join("; ")
);

// Markdown is scanned too, and for a sharper reason than tidiness. `docs/ai/TASK_LOG.md` carried a
// literal NUL for many commits while this suite reported green, because the roadmap dashboard's
// reader strips NULs before parsing and only emits a warning — and `grep` reports the file as
// "binary" rather than matching it, so the usual way of finding text never sees it. The write is
// accidental every time: an editing tool expanding a `\uXXXX` escape in prose that is *about*
// control characters. Write those as `String.fromCharCode(0)` or the token U+0000.
const docFiles: string[] = [];
for (const root of DOC_ROOTS) collect(root, docFiles, /\.md$/);

console.log(`\nScanning ${docFiles.length} Markdown files under ${DOC_ROOTS.join(", ")}:\n`);

const docOffenders = docFiles.map(scan).filter((o): o is string => o !== null);

check(
  "no Markdown document contains a literal control character",
  docOffenders.length === 0,
  docOffenders.slice(0, 10).join("; ")
);
check("the Markdown scan actually found files to scan", docFiles.length > 0, `got ${docFiles.length}`);

// The guard must be able to fail, or it is decoration. Proven against synthetic strings rather than
// by writing a bad file into the repository.
check("the pattern detects a literal U+001F", controlPattern().test(`const sep = "${String.fromCharCode(31)}";`));
check("the pattern detects a literal U+0000", controlPattern().test(`const sep = "${String.fromCharCode(0)}";`));
check("the pattern detects a literal U+0001", controlPattern().test(`const sep = "${String.fromCharCode(1)}";`));
check("an escape sequence is NOT flagged", !controlPattern().test('const sep = "\\u001F";'));
check("tab, newline and CR are not violations", !controlPattern().test("a\tb\nc\r"));
check("ordinary prose is not flagged", !controlPattern().test("const name = 'hello-world';"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
