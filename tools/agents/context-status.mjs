#!/usr/bin/env node
/** Compact, null-safe Claude Code status line for AWKIT context policy. */

import { contextZoneFor } from "./context-policy.mjs";

/** @param {unknown} value */
function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** @param {number} value */
function compactNumber(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(Math.round(value));
}

/**
 * @param {Record<string, any>|null|undefined} input Claude's statusLine JSON payload
 * @returns {string}
 */
export function renderStatusLine(input) {
  const payload = input && typeof input === "object" ? input : {};
  const context = payload.context_window && typeof payload.context_window === "object"
    ? payload.context_window
    : {};
  const usage = context.current_usage && typeof context.current_usage === "object"
    ? context.current_usage
    : {};

  const componentTokens = [
    usage.input_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens
  ].map(finite);
  const componentTotal = componentTokens.every((value) => value !== null)
    ? componentTokens.reduce((sum, value) => sum + value, 0)
    : null;
  const size = finite(context.context_window_size);
  const percentage = finite(context.used_percentage);
  const inferred = size !== null && percentage !== null ? Math.round(size * percentage / 100) : null;
  const tokens = finite(context.total_input_tokens) ?? componentTotal ?? inferred ?? 0;
  const zone = contextZoneFor(tokens);

  const agentName =
    payload.agent?.name ?? payload.agent_name ?? payload.agent_type ?? payload.current_agent ?? "main";
  const model = payload.model?.display_name ?? payload.model?.id ?? payload.model ?? "Claude";
  const version = payload.claude_code_version ?? payload.version ?? "client";
  const denominator = size === null ? "?" : compactNumber(size);
  const percentLabel = percentage === null
    ? size && size > 0 ? `${Math.round(tokens / size * 100)}%` : "--%"
    : `${Math.round(percentage)}%`;

  return `AWKIT ${agentName} | ${model} ${version} | ${compactNumber(tokens)}/${denominator} ${percentLabel} | ${zone.zone}`;
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

if (process.argv[1]?.endsWith("context-status.mjs")) {
  try {
    const text = await readStdin();
    const payload = text.trim() ? JSON.parse(text) : null;
    process.stdout.write(`${renderStatusLine(payload)}\n`);
  } catch {
    // A status line must never destabilize the interactive session because a partial payload landed.
    process.stdout.write(`${renderStatusLine(null)}\n`);
  }
}
