/** Heartbeat emitted by active runs so the watchdog can tell "slow" from "stuck/dead". */
export interface InstanceHeartbeat {
  runId: string;
  instanceId: string;
  nodeId?: string;
  workerId: string;
  browserWorkerId?: string;
  /** Origin + path only — never query strings or fragments (may carry tokens). */
  currentUrl?: string;
  status: string;
  timestamp: string;
}

/** Sanitize a page URL for heartbeat/log use: origin + pathname only. */
export function sanitizeHeartbeatUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}
