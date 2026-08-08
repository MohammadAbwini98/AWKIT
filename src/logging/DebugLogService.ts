import { appendFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

export type DebugLogLevel = "info" | "warn" | "error" | "fatal";
export interface DebugLogEntry {
  at: string;
  level: DebugLogLevel;
  source: string;
  message: string;
  detail?: unknown;
}

export const DEBUG_LOG_MAX_BYTES = 1024 * 1024;
export const DEBUG_LOG_MAX_FILES = 5;
export const DEBUG_LOG_READ_LIMIT = 500;
export const DEBUG_LOG_MAX_ENTRY_BYTES = 64 * 1024;

const SECRET_KEY = /(?:password|passcode|otp|mfa|authorization|cookie|token|secret|credential|valueSource|session(?:Ref|Id|Secret|Token|Cookie))/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_ASSIGNMENT = /\b(password|passcode|otp|mfa|authorization|cookie|token|secret|session)\s*[:=]\s*([^\s,;]+)/gi;

export function redactDebugValue(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    let next = value.replace(BEARER, "Bearer [REDACTED]").replace(SECRET_ASSIGNMENT, "$1=[REDACTED]");
    try {
      const url = new URL(next);
      if (url.search || url.hash) {
        url.search = url.search ? "?redacted" : "";
        url.hash = "";
        next = url.toString();
      }
    } catch {
      // Not a standalone URL. Assignment/bearer canaries still apply.
    }
    return next;
  }
  if (Array.isArray(value)) return value.map((item) => redactDebugValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactDebugValue(entryValue, entryKey)
      ])
    );
  }
  return value;
}

export class DebugLogService {
  private enabled = false;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly directory: () => string,
    private readonly now: () => Date = () => new Date()
  ) {}

  setEnabled(enabled: boolean): void {
    const changed = this.enabled !== enabled;
    this.enabled = enabled;
    if (changed && enabled) void this.log("info", "settings", "Debug mode enabled.");
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async log(level: DebugLogLevel, source: string, message: string, detail?: unknown): Promise<void> {
    if (!this.enabled) return;
    let entry: DebugLogEntry = {
      at: this.now().toISOString(),
      level,
      source: String(redactDebugValue(source)),
      message: String(redactDebugValue(message)),
      ...(detail === undefined ? {} : { detail: redactDebugValue(detail) })
    };
    let line = `${JSON.stringify(entry)}\n`;
    if (Buffer.byteLength(line, "utf8") > DEBUG_LOG_MAX_ENTRY_BYTES) {
      entry = {
        at: entry.at,
        level: entry.level,
        source: entry.source.slice(0, 256),
        message: entry.message.slice(0, 8_192),
        detail: { truncated: true }
      };
      line = `${JSON.stringify(entry)}\n`;
    }
    await this.enqueue(async () => {
      const dir = this.directory();
      await mkdir(dir, { recursive: true });
      const active = join(dir, "debug.jsonl");
      const size = await stat(active).then((value) => value.size).catch(() => 0);
      if (size + Buffer.byteLength(line, "utf8") > DEBUG_LOG_MAX_BYTES) await this.rotate(dir);
      await appendFile(active, line, "utf8");
    });
  }

  async readEntries(limit = DEBUG_LOG_READ_LIMIT): Promise<DebugLogEntry[]> {
    const bounded = Math.max(1, Math.min(DEBUG_LOG_READ_LIMIT, Math.trunc(limit)));
    await this.flush();
    const dir = this.directory();
    const paths = [
      ...Array.from({ length: DEBUG_LOG_MAX_FILES - 1 }, (_, index) => join(dir, `debug.${DEBUG_LOG_MAX_FILES - 1 - index}.jsonl`)),
      join(dir, "debug.jsonl")
    ];
    const entries: DebugLogEntry[] = [];
    for (const path of paths) {
      const text = await readFile(path, "utf8").catch(() => "");
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        try {
          entries.push(JSON.parse(line) as DebugLogEntry);
        } catch {
          // Omit corrupt/partial diagnostic lines.
        }
      }
    }
    return entries.slice(-bounded).reverse();
  }

  flush(): Promise<void> {
    return this.tail.then(() => undefined, () => undefined);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async rotate(dir: string): Promise<void> {
    await rm(join(dir, `debug.${DEBUG_LOG_MAX_FILES - 1}.jsonl`), { force: true });
    for (let index = DEBUG_LOG_MAX_FILES - 2; index >= 1; index -= 1) {
      await rename(join(dir, `debug.${index}.jsonl`), join(dir, `debug.${index + 1}.jsonl`)).catch(() => undefined);
    }
    await rename(join(dir, "debug.jsonl"), join(dir, "debug.1.jsonl")).catch(() => undefined);
  }
}
