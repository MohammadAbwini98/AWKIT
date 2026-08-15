import { spawnSync } from "node:child_process";
import path from "node:path";

const CHECK_PATTERN = /^\s*[✗✓]\s+(.+?)(?:\s+—\s+.*)?$/gm;
const FAILED_CHECK_PATTERN = /^\s*✗\s+(.+?)(?:\s+—\s+.*)?$/gm;

function namesMatching(output, pattern) {
  return [...output.matchAll(pattern)].map((match) => match[1].trim());
}

/**
 * Run the preserved pre-capsule walkthrough and keep every unaffected assertion binding.
 * Only the explicitly named visual assertions whose oracle encoded the rejected U-route are retired.
 * The exact check total and allow-list coverage prevent a killed, truncated, or early-exit child from
 * looking green merely because it failed only checks that happened to be retired.
 */
export function runLegacyGuiCoverage({ root, script, supersededChecks, expectedChecks }) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script)], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const allChecks = namesMatching(output, CHECK_PATTERN);
  const failedChecks = namesMatching(output, FAILED_CHECK_PATTERN);
  const superseded = new Set(supersededChecks);
  const unexpectedFailures = failedChecks.filter((name) => !superseded.has(name));
  const retiredFailures = failedChecks.filter((name) => superseded.has(name));
  const missingSupersededChecks = supersededChecks.filter((name) => !allChecks.includes(name));
  const checkTotalMatches = Number.isInteger(expectedChecks) && allChecks.length === expectedChecks;
  const harnessFailed = result.error || result.signal || ![0, 1].includes(result.status) ||
    !checkTotalMatches || missingSupersededChecks.length > 0;
  const pass = !harnessFailed && unexpectedFailures.length === 0 && retiredFailures.length === failedChecks.length;

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (retiredFailures.length > 0) {
    console.log(`\nRetired ${retiredFailures.length} superseded U-route assertion(s); capsule assertions run next.`);
  }
  if (unexpectedFailures.length > 0) {
    console.error(`Unexpected legacy GUI failures: ${unexpectedFailures.join(" | ")}`);
  }
  if (harnessFailed) {
    console.error(
      `Legacy GUI harness failed with status ${String(result.status)}, signal ${String(result.signal)}, ` +
      `checks ${allChecks.length}/${String(expectedChecks)}${result.error ? `: ${result.error.message}` : ""}`
    );
  }
  if (missingSupersededChecks.length > 0) {
    console.error(`Legacy GUI did not reach retired check(s): ${missingSupersededChecks.join(" | ")}`);
  }

  return {
    pass,
    status: result.status,
    totalChecks: allChecks.length,
    failedChecks,
    retiredFailures,
    unexpectedFailures,
    missingSupersededChecks,
    checkTotalMatches
  };
}
