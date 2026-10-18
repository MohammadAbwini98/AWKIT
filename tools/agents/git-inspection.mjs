/** Bounded Git reads: argv only, no pager, external diff, textconv, fsmonitor or lazy fetch. */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const INSPECTION_PREFIX = "node tools/agents/git-inspection.mjs";
export const MAX_INSPECTION_BYTES = 128 * 1024;

export function inspectionTokens(command) {
  if (typeof command !== "string" || /[;&|><`$%!^\r\n]/.test(command)) return null;
  const tokens = [], text = command.trim(), pattern = /(?:"([^"\\]*(?:\\[A-Za-z0-9_. /-]+)*)"|'([^']*)'|([^\s"']+))/gy;
  let offset = 0;
  while (offset < text.length) {
    pattern.lastIndex = offset; const match = pattern.exec(text);
    if (!match || match.index !== offset) return null;
    tokens.push(match[1] ?? match[2] ?? match[3]); offset = pattern.lastIndex;
    if (offset < text.length && !/\s/.test(text[offset])) return null;
    while (/\s/.test(text[offset] ?? "") && offset < text.length) offset++;
  }
  return tokens.length ? tokens : null;
}
const pathSafe = value => /^[A-Za-z0-9_. /\\-]+$/.test(value) && !/^(?:[\\/]|[A-Za-z]:)/.test(value) && !value.replace(/\\/g, "/").split("/").includes("..");
const refSafe = value => /^[A-Za-z0-9_./~-]+(?::[A-Za-z0-9_. /\\-]+)?$/.test(value) && !value.includes("..") && (!value.includes(":") || pathSafe(value.split(":")[1]));
const countSafe = value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 200;
export function validInspectionArgs(args) {
  if (!Array.isArray(args) || args.some(a => typeof a !== "string" || /[;&|><`$%!^\r\n]/.test(a))) return false;
  const [verb, ...rest] = args;
  const options = {
    status: ["--short", "-s", "--porcelain", "--porcelain=v1", "--porcelain=v2", "--branch", "-b", "--untracked-files=no", "--untracked-files=normal", "--untracked-files=all"],
    diff: ["--stat", "--name-only", "--name-status", "--numstat", "--shortstat", "--summary", "--check", "--cached", "--staged", "--no-ext-diff", "--no-textconv"],
    log: ["--all", "--oneline", "--decorate", "--no-decorate", "--stat", "--name-only", "--no-patch"],
    show: ["--stat", "--name-only", "--name-status", "--oneline", "--summary", "--no-patch", "--no-ext-diff", "--no-textconv"],
    branch: ["--list", "--show-current", "--all", "--remotes", "--no-color"],
    "rev-parse": ["--verify", "--short", "--abbrev-ref", "--show-toplevel", "--show-prefix", "--git-dir", "--is-inside-work-tree"],
    "ls-files": ["--stage", "--cached", "--modified", "--deleted", "--others", "--exclude-standard"]
  };
  if (!options[verb]) return false;
  let paths = false, bounded = false, refs = 0;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (paths) { if (!pathSafe(arg)) return false; continue; }
    if (arg === "--" && verb !== "branch") { paths = true; continue; }
    if (options[verb].includes(arg)) continue;
    if (verb === "log" && /^-\d+$/.test(arg) && countSafe(arg.slice(1))) { bounded = true; continue; }
    if (verb === "log" && (arg === "-n" || arg === "--max-count") && countSafe(rest[i + 1] ?? "")) { bounded = true; i++; continue; }
    if (verb === "log" && arg.startsWith("--max-count=") && countSafe(arg.slice(12))) { bounded = true; continue; }
    if (verb === "rev-parse" && /^--short=\d+$/.test(arg) && Number(arg.slice(8)) >= 4 && Number(arg.slice(8)) <= 40) continue;
    if (arg.startsWith("-")) return false;
    if ((verb === "show" || verb === "rev-parse" || verb === "log") && refSafe(arg) && ++refs <= (verb === "show" ? 1 : 2)) continue;
    if ((verb === "diff" || verb === "ls-files" || verb === "status") && pathSafe(arg)) continue;
    return false;
  }
  if (verb === "log" && !bounded) return false;
  if (verb === "branch" && !rest.includes("--list") && !(rest.length === 1 && rest[0] === "--show-current")) return false;
  return true;
}
export function inspectionArgs(command) {
  const tokens = inspectionTokens(command);
  if (!tokens) return null;
  const args = tokens[0] === "git" ? tokens.slice(1) : tokens[0] === "node" && tokens[1]?.replace(/\\/g, "/") === "tools/agents/git-inspection.mjs" ? tokens.slice(2) : null;
  return args && validInspectionArgs(args) ? args : null;
}
export function boundedLogAlternative(command) {
  if (typeof command !== "string") return null;
  const match = command.trim().match(/^git\s+log\s+(--all\s+)?--oneline\s*\|\s*head\s+(?:-n\s+(\d+)|-(\d+))$/);
  const count = match?.[2] ?? match?.[3];
  return count && countSafe(count) ? `git log ${match[1] ? "--all " : ""}-${Number(count)} --oneline` : null;
}
export function inspectionCommand(args) {
  if (!validInspectionArgs(args)) throw new Error("Unsupported inspection arguments");
  return INSPECTION_PREFIX + " " + args.map(a => `'${a.replace(/\\/g, "/")}'`).join(" ");
}
/**
 * Fixed Git flags for one verified root. Global/system config is off, so a share-hosted checkout (no local owner SID)
 * would hit "dubious ownership"; command-line config is protected config, so trust exactly this root and nothing else.
 */
export function inspectionGitFlags(repoRoot) {
  return ["--no-pager", "--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "log.showSignature=false", "-c", `safe.directory=${realpathSync(repoRoot).replace(/\\/g, "/")}`];
}
export function runInspection(args, { cwd = ROOT, repoRoot = ROOT, env = process.env } = {}) {
  if (!validInspectionArgs(args) || relative(realpathSync(repoRoot), realpathSync(cwd)) !== "") throw new Error("Inspection requires approved argv at the repository root");
  // Global config is "/dev/null" on every platform; Git for Windows 2.55 rejects "NUL" ("unable to access 'NUL'").
  const cleanEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !/^GIT_/i.test(key) && !/^PAGER$/i.test(key)));
  Object.assign(cleanEnv, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" });
  const flags = inspectionGitFlags(repoRoot);
  const git = argv => execFileSync("git", [...flags, ...argv], { cwd, env: cleanEnv, encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: MAX_INSPECTION_BYTES, stdio: ["ignore", "pipe", "pipe"] });
  // Native realpath: Git reports a mapped drive by its UNC path, which only the native form resolves to the same root.
  if (relative(realpathSync.native(repoRoot), realpathSync.native(git(["rev-parse", "--show-toplevel"]).trim())) !== "") throw new Error("Inspection context is a different repository");
  const [verb, ...rest] = args;
  const hardened = ["diff", "show", "log"].includes(verb) ? ["--no-ext-diff", "--no-textconv", ...(verb !== "diff" ? ["--no-show-signature"] : [])] : [];
  return git([verb, ...hardened, ...rest]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(runInspection(process.argv.slice(2))); }
  catch { process.stderr.write("[inspection] BLOCKED: unsupported arguments, repository context, or read exceeded the 10-second/128-KiB limit. Use a focused path or --stat.\n"); process.exitCode = 2; }
}
