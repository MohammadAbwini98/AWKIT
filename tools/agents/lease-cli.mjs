#!/usr/bin/env node
/**
 * CLI for the write lease — `npm run agent:lease*`.
 *
 * Deliberately NOT an environment-variable bypass. `AWKIT_SKIP_LEASE=1` would be one keystroke,
 * invisible in the repository afterwards, and would leave no trace that scope had grown. Every
 * operation here writes to the lease file, so scope expansion is always recoverable from the
 * repository rather than from someone's shell history.
 *
 * Usage:
 *   npm run agent:lease
 *   npm run agent:lease-grant   -- --task awkit-xyz --holder frontend --paths "app/renderer/**"
 *   npm run agent:lease-amend   -- --add "src/storage/**" --reason "Persistence impact discovered"
 *   npm run agent:lease-release -- --reason "handing off to qa"
 */

import { amendLease, grantLease, readLease, releaseLease } from "./lease.mjs";
import { agent } from "./routing-matrix.mjs";

/**
 * @param {string[]} argv
 * @returns {Record<string, string[]>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string[]>} */
  const args = {};
  let key = null;
  for (const token of argv) {
    if (token.startsWith("--")) {
      key = token.slice(2);
      args[key] ??= [];
    } else if (key) {
      args[key].push(token);
    }
  }
  return args;
}

/** @param {Record<string, string[]>} args @param {string} name */
const one = (args, name) => (args[name] ?? []).join(" ").trim();
/** @param {Record<string, string[]>} args @param {string} name */
const many = (args, name) =>
  (args[name] ?? []).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);

function showStatus() {
  const lease = readLease();
  if (!lease) {
    console.log("No active write lease.");
    console.log("Edits are unrestricted, and the completion gate will require a contract for any");
    console.log("task that changed product code.");
    return;
  }
  console.log(`Task    : ${lease.task}`);
  console.log(`Holder  : ${lease.holder} (${agent(lease.holder).role})`);
  console.log(`Acquired: ${lease.acquired_at} at ${lease.acquired_at_commit}`);
  console.log("Scope   :");
  for (const path of lease.allowed_paths) console.log(`  - ${path}`);
  if (lease.amendments.length > 0) console.log(`Amendments: ${lease.amendments.length}`);
  if (lease.overrides.length > 0) console.log(`Overrides : ${lease.overrides.length} (QC required)`);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  try {
    switch (command) {
      case "status":
      case undefined:
        showStatus();
        break;

      case "grant": {
        const lease = grantLease({
          task: one(args, "task"),
          holder: one(args, "holder"),
          allowedPaths: many(args, "paths")
        });
        console.log(`Granted to ${lease.holder} for ${lease.task}:`);
        for (const path of lease.allowed_paths) console.log(`  - ${path}`);
        break;
      }

      case "amend": {
        const result = amendLease({ addPaths: many(args, "add"), reason: one(args, "reason") });

        if (result.outcome === "extended") {
          console.log(`Lease extended. ${result.lease.holder} may now also write:`);
          for (const path of many(args, "add")) console.log(`  + ${path}`);
          if (result.addedFlags.length > 0) {
            console.log(`Implied classification flags: ${result.addedFlags.join(", ")}`);
            console.log("Update the contract's declared classification to match.");
          }
          break;
        }

        console.log("REROUTED — the added paths are owned by another specialist.");
        console.log(`The ${result.lease.holder} lease has been RELEASED rather than widened.`);
        if (result.addedFlags.length > 0) {
          console.log(`Newly implied flags: ${result.addedFlags.join(", ")}`);
        }
        console.log(`Next writer(s), in lease order: ${result.requiredAgents.join(" -> ") || "(none)"}`);
        console.log("Commit the current work, then grant the next lease.");
        process.exitCode = 3;
        break;
      }

      case "release": {
        const lease = releaseLease(one(args, "reason") || "work complete");
        console.log(lease ? `Released ${lease.holder}'s lease on ${lease.task}.` : "No active lease.");
        break;
      }

      default:
        console.error(`Unknown command "${command}". Use: status | grant | amend | release`);
        process.exitCode = 1;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();
