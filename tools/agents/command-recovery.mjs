/** Prepare one authorized retry; never execute the rejected operation or manufacture a lease. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, readLease, resolveContractPath, toRepoRelative } from "./lease.mjs";
import { pathInScope } from "./routing-matrix.mjs";
import { validateContract } from "./validate-contract.mjs";
import { hasUnsafeShellSyntax, isPhysicallyWithinRepo, isRootPrimaryIdentity, targetPathOf, shellTokens } from "./lease-guard.mjs";

export function parseStructuredDenial(stderr) {
  const line = String(stderr ?? "").split("\n").find(value => value.startsWith("[write-lease] DENIAL "));
  if (!line) return null;
  try {
    const value = JSON.parse(line.slice("[write-lease] DENIAL ".length));
    return value?.version === 1 && typeof value.terminal === "boolean" && Number.isInteger(value.count) && value.count >= 1 && ["lease-scope", "unsupported-command"].includes(value.code) ? value : null;
  } catch { return null; }
}
const probeGuard = payload => spawnSync(process.execPath, [resolve(REPO_ROOT, "tools/agents/lease-guard.mjs")], { cwd: REPO_ROOT, input: JSON.stringify(payload), encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 65536 });
const acquireLease = (task, writer) => spawnSync(process.execPath, [resolve(REPO_ROOT, "tools/agents/lease-cli.mjs"), "grant", "--task", task, "--holder", writer.agent_id, "--paths", writer.allowed_paths.join(",")], { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 65536 });
const approved = (result, payload) => {
  let output; try { output = JSON.parse(result.stdout || "{}"); } catch { output = {}; }
  return { status: "AUTHORIZED", toolInput: output.hookSpecificOutput?.updatedInput ?? payload.tool_input, retryOperation: true };
};
export function recoverAuthorization(payload, { task, probe = probeGuard, acquire = acquireLease, load = id => JSON.parse(readFileSync(resolveContractPath(undefined, id), "utf8")), currentLease = readLease } = {}) {
  const blocked = reason => ({ status: "BLOCKED", reason, retryOperation: false });
  if (!isRootPrimaryIdentity(payload?.agent_type, payload?.agent_id)) return blocked("Only the root primary may acquire a routed lease.");
  const first = probe(payload);
  if (first.status === 0) return approved(first, payload);
  const denial = parseStructuredDenial(first.stderr);
  if (!denial || denial.terminal) return blocked("Terminal or unstructured authorization denial. Report the blocker without another command variant.");
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(task ?? "")) return blocked("Supply the existing task-contract ID; recovery cannot infer authorization.");
  let contract;
  try { contract = load(task); } catch { return blocked("Task contract is unavailable. Create and validate it before requesting a lease."); }
  if (contract?.task?.id !== task || !validateContract(contract).ok) return blocked("Task contract is invalid or does not match the requested task.");
  const writer = contract.routing.writer;
  if (!writer?.agent_id || !writer.allowed_paths?.length) return blocked("The contract has no authorized routed writer.");
  let targets;
  if (["Edit", "Write", "NotebookEdit"].includes(payload?.tool_name)) targets = [targetPathOf(payload)];
  else if (/^(?:Bash|PowerShell)$/i.test(payload?.tool_name ?? "")) {
    if (hasUnsafeShellSyntax(payload?.tool_input?.command)) return blocked("Shell composition and interpolation cannot be authorized by a lease.");
    const tokens = shellTokens(payload?.tool_input?.command?.trim() ?? "");
    if (tokens?.[0] === "git" && tokens[1] === "add" && tokens[2] === "--" && tokens.length > 3) targets = tokens.slice(3);
  }
  if (!targets?.length || targets.some(path => typeof path !== "string" || !isPhysicallyWithinRepo(path) || !toRepoRelative(path) || !pathInScope(toRepoRelative(path), writer.allowed_paths))) return blocked("The operation is unsupported or outside the contract writer scope. A lease cannot authorize arbitrary shell syntax.");
  let active;
  try { active = currentLease(); } catch { return blocked("The lease record is damaged; recovery fails closed."); }
  if (active) return blocked("An active lease already exists. Use the official amend or handoff CLI once within this task's routing; recovery never releases another writer.");
  const granted = acquire(task, writer);
  if (granted.status !== 0) return { ...blocked("Official lease acquisition failed; do not retry the operation."), detail: String(granted.stderr ?? "").trim().slice(0, 1000) };
  let actual;
  try { actual = currentLease(); } catch { return blocked("Cannot validate the newly granted lease."); }
  if (actual?.task !== task || actual?.holder !== writer.agent_id || JSON.stringify([...actual.allowed_paths].sort()) !== JSON.stringify([...writer.allowed_paths].sort())) return blocked("The active lease does not match the authorized contract. Do not retry.");
  const second = probe(payload);
  return second.status === 0 ? { ...approved(second, payload), leaseAcquired: true, recoveryActions: 1 } : blocked("Authorization still fails after one official lease grant. Report BLOCKED; no further retry.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), task = args[0] === "--task" ? args[1] : undefined;
  const mode = args[2], target = args[3];
  if (args.length !== 4 || !["--path", "--command"].includes(mode)) {
    console.error("Usage: node tools/agents/command-recovery.mjs --task <id> --path <path> | --command <one command>"); process.exitCode = 2;
  } else {
    const payload = { tool_name: mode === "--path" ? "Write" : "Bash", tool_input: mode === "--path" ? { file_path: target } : { command: target }, cwd: REPO_ROOT, session_id: `recovery-${task}` };
    const result = recoverAuthorization(payload, { task }); console.log(JSON.stringify(result)); if (result.status !== "AUTHORIZED") process.exitCode = 2;
  }
}
