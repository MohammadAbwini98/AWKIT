import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, CDPSession, Page } from "playwright";

export const OBSERVATION_CDP_COMMANDS = Object.freeze([
  "Network.enable",
  "Console.enable",
  "Runtime.enable",
  "Log.enable",
  "Page.enable",
  "DOM.enable",
  "Page.captureScreenshot",
  "Runtime.evaluate"
] as const);

const OBSERVATION_COMMAND_SET = new Set<string>(OBSERVATION_CDP_COMMANDS);

const OBSERVATION_EVENTS = [
  "Network.requestWillBeSent",
  "Network.responseReceived",
  "Network.loadingFinished",
  "Network.loadingFailed",
  "Network.webSocketCreated",
  "Network.webSocketClosed",
  "Network.webSocketFrameReceived",
  "Network.webSocketFrameSent",
  "Console.messageAdded",
  "Runtime.consoleAPICalled",
  "Runtime.exceptionThrown",
  "Log.entryAdded",
  "Page.frameNavigated",
  "Page.frameAttached",
  "Page.frameDetached",
  "Page.lifecycleEvent",
  "Page.loadEventFired",
  "Page.domContentEventFired",
  "Page.javascriptDialogOpening",
  "Page.javascriptDialogClosed",
  "DOM.documentUpdated"
] as const;

const BUCKETS = [
  ["network/requests", (method: string) => method === "Network.requestWillBeSent"],
  ["network/responses", (method: string) => method === "Network.responseReceived"],
  ["network/finished", (method: string) => method === "Network.loadingFinished"],
  ["network/failed", (method: string) => method === "Network.loadingFailed"],
  ["network/websocket", (method: string) => method.startsWith("Network.webSocket")],
  ["console/logs", (method: string) => method === "Console.messageAdded" || method === "Runtime.consoleAPICalled"],
  ["console/exceptions", (method: string) => method === "Runtime.exceptionThrown"],
  ["runtime/all", (method: string) => method.startsWith("Runtime.")],
  ["log/entries", (method: string) => method === "Log.entryAdded"],
  ["page/navigations", (method: string) => method === "Page.frameNavigated"],
  [
    "page/lifecycle",
    (method: string) =>
      method === "Page.lifecycleEvent" || method === "Page.loadEventFired" || method === "Page.domContentEventFired"
  ],
  ["page/dialogs", (method: string) => method.startsWith("Page.javascriptDialog")],
  ["page/frames", (method: string) => method.startsWith("Page.frame")],
  ["page/all", (method: string) => method.startsWith("Page.")],
  ["dom/all", (method: string) => method.startsWith("DOM.")],
  ["target/attached", (method: string) => method === "Target.attachedToTarget"],
  ["target/detached", (method: string) => method === "Target.detachedFromTarget"]
] as const;

export interface CdpTraceRecord {
  receivedAt: string;
  wallTimeMs: number;
  protocolTimestamp?: number;
  method: string;
  params: Record<string, unknown>;
  generation: number;
  pageId: string;
}

export interface CdpObservationSnapshot {
  instanceId: string;
  status: "waiting" | "live" | "complete" | "degraded" | "unavailable";
  updatedAt?: string;
  url?: string;
  screenshotDataUrl?: string;
  traceRoot: string;
  eventCount: number;
  sampleCount: number;
  truncated: boolean;
  message?: string;
}

export interface PassiveCdpTraceOptions {
  root: string;
  executionId: string;
  instanceId: string;
  scenarioId: string;
  sampleIntervalMs?: number;
  captureDom?: boolean;
  maxRawBytes?: number;
  maxSamples?: number;
}

interface ActiveSession {
  key: string;
  pageId: string;
  generation: number;
  page: Page;
  session: CDPSession;
}

interface GenerationBinding {
  context: BrowserContext;
  onPage: (page: Page) => void;
}

interface TraceManifest {
  version: 1;
  executionId: string;
  instanceId: string;
  scenarioId: string;
  startedAt: string;
  stoppedAt?: string;
  status: CdpObservationSnapshot["status"];
  domains: string[];
  captureDom: boolean;
  sampleIntervalMs: number;
  maxRawBytes: number;
  maxSamples: number;
  eventCount: number;
  sampleCount: number;
  rawBytes: number;
  truncated: boolean;
  errors: string[];
}

const DEFAULT_SAMPLE_INTERVAL_MS = 2_000;
const DEFAULT_MAX_RAW_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_SAMPLES = 300;

export function isObservationCommand(method: string): boolean {
  return OBSERVATION_COMMAND_SET.has(method);
}

export async function sendObservationCommand(
  session: CDPSession,
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  if (!isObservationCommand(method)) {
    throw new Error(`CDP command "${method}" is not allowed for the observation-only client.`);
  }
  return (session.send as unknown as (name: string, input?: Record<string, unknown>) => Promise<unknown>)(
    method,
    params
  );
}

export class PassiveCdpTrace {
  private readonly rawPath: string;
  private readonly indexPath: string;
  private readonly cdpRoot: string;
  private readonly screenshotsRoot: string;
  private readonly domRoot: string;
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly generations = new Map<number, GenerationBinding>();
  private readonly errors: string[] = [];
  private readonly retainedSamples: Array<{ record: Record<string, unknown>; artifacts: string[] }> = [];
  private readonly monotonicAnchors = new Map<string, { protocol: number; wall: number }>();
  private readonly sampleIntervalMs: number;
  private readonly maxRawBytes: number;
  private readonly maxSamples: number;
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;
  private stopped = false;
  private sampling = false;
  private timer?: NodeJS.Timeout;
  private rawBytes = 0;
  private eventCount = 0;
  private sampleCount = 0;
  private truncated = false;
  private pageSequence = 0;
  private status: CdpObservationSnapshot["status"] = "waiting";
  private updatedAt?: string;
  private latestUrl?: string;
  private latestScreenshotDataUrl?: string;
  private readonly startedAt = new Date().toISOString();

  constructor(private readonly options: PassiveCdpTraceOptions) {
    this.rawPath = join(options.root, "cdp", "raw.ndjson");
    this.indexPath = join(options.root, "index.jsonl");
    this.cdpRoot = join(options.root, "cdp");
    this.screenshotsRoot = join(options.root, "screenshots");
    this.domRoot = join(options.root, "dom");
    this.sampleIntervalMs = Math.max(1_000, options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS);
    this.maxRawBytes = Math.max(1_024, options.maxRawBytes ?? DEFAULT_MAX_RAW_BYTES);
    this.maxSamples = Math.max(1, options.maxSamples ?? DEFAULT_MAX_SAMPLES);
  }

  async startGeneration(runtime: { context: BrowserContext }, generation: number): Promise<void> {
    if (this.stopped) return;
    try {
      await this.ensureLayout();
      await Promise.all(runtime.context.pages().map((page) => this.attachPage(page, generation)));
      const onPage = (page: Page) => {
        void this.attachPage(page, generation);
      };
      runtime.context.on("page", onPage);
      this.generations.set(generation, { context: runtime.context, onPage });
      this.status = this.errors.length ? "degraded" : "live";
      if (!this.timer) {
        this.timer = setInterval(() => void this.sampleNow(), this.sampleIntervalMs);
        this.timer.unref?.();
      }
      await this.sampleNow();
      await this.writeManifest();
    } catch (error) {
      this.degrade(`CDP observation attach failed: ${messageOf(error)}`);
    }
  }

  async stopGeneration(generation: number): Promise<void> {
    const binding = this.generations.get(generation);
    if (binding) {
      binding.context.off("page", binding.onPage);
      this.generations.delete(generation);
    }
    const active = [...this.sessions.values()].filter((entry) => entry.generation === generation);
    for (const entry of active) {
      await this.record("Target.detachedFromTarget", { reason: "runtime closing" }, entry);
      await entry.session.detach().catch(() => undefined);
      this.sessions.delete(entry.key);
    }
    await this.flush();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!this.initialized) {
      this.status = "unavailable";
      return;
    }
    for (const generation of [...this.generations.keys()]) {
      await this.stopGeneration(generation);
    }
    await this.flush();
    try {
      await bisectCdpTrace(this.options.root);
      if (this.status !== "degraded") this.status = "complete";
    } catch (error) {
      this.degrade(`CDP trace bisection failed: ${messageOf(error)}`);
    }
    await this.writeManifest(new Date().toISOString()).catch((error) => {
      this.degrade(`CDP manifest finalization failed: ${messageOf(error)}`);
    });
  }

  snapshot(): CdpObservationSnapshot {
    return {
      instanceId: this.options.instanceId,
      status: this.status,
      updatedAt: this.updatedAt,
      url: this.latestUrl,
      screenshotDataUrl: this.latestScreenshotDataUrl,
      traceRoot: this.options.root,
      eventCount: this.eventCount,
      sampleCount: this.sampleCount,
      truncated: this.truncated,
      message: this.errors.at(-1)
    };
  }

  hasArtifacts(): boolean {
    return this.initialized;
  }

  async sampleNow(): Promise<void> {
    if (this.stopped || this.sampling || !this.sessions.size) return;
    this.sampling = true;
    try {
      for (const entry of this.sessions.values()) {
        if (entry.page.isClosed()) continue;
        const timestamp = Date.now();
        const stamp = `${timestamp}-${safeName(entry.pageId)}`;
        const screenshotRelative = `screenshots/${stamp}.png`;
        const screenshotPath = join(this.options.root, screenshotRelative);
        try {
          const result = (await sendObservationCommand(entry.session, "Page.captureScreenshot", {
            format: "png",
            fromSurface: true,
            captureBeyondViewport: false
          })) as { data?: string };
          if (!result.data) continue;
          await writeFile(screenshotPath, Buffer.from(result.data, "base64"));
          this.latestScreenshotDataUrl = `data:image/png;base64,${result.data}`;
          this.latestUrl = stripUrlSecrets(entry.page.url());
          this.updatedAt = new Date(timestamp).toISOString();
          const indexRecord: Record<string, unknown> = {
            ts: this.updatedAt,
            screenshot: screenshotRelative,
            url: this.latestUrl,
            pageId: entry.pageId,
            generation: entry.generation
          };
          const sampleArtifacts = [screenshotPath];
          if (this.options.captureDom) {
            const domResult = (await sendObservationCommand(entry.session, "Runtime.evaluate", {
              expression:
                "(() => { const root = document.documentElement.cloneNode(true); root.querySelectorAll('input,textarea').forEach((el) => { el.removeAttribute('value'); if (el.tagName === 'TEXTAREA') el.textContent = ''; }); return root.outerHTML; })()",
              returnByValue: true
            })) as { result?: { value?: string } };
            if (typeof domResult.result?.value === "string") {
              const domRelative = `dom/${stamp}.html`;
              const domPath = join(this.options.root, domRelative);
              await writeFile(domPath, domResult.result.value, "utf8");
              indexRecord.dom = domRelative;
              sampleArtifacts.push(domPath);
            }
          }
          this.retainedSamples.push({ record: indexRecord, artifacts: sampleArtifacts });
          this.sampleCount += 1;
          await this.enforceSampleRetention();
        } catch (error) {
          this.degrade(`CDP sample failed for ${entry.pageId}: ${messageOf(error)}`);
        }
      }
    } finally {
      this.sampling = false;
    }
  }

  private async ensureLayout(): Promise<void> {
    if (this.initialized) return;
    await Promise.all([
      mkdir(this.cdpRoot, { recursive: true }),
      mkdir(this.screenshotsRoot, { recursive: true }),
      mkdir(this.domRoot, { recursive: true })
    ]);
    await Promise.all([writeFile(this.rawPath, "", "utf8"), writeFile(this.indexPath, "", "utf8")]);
    this.initialized = true;
    await this.writeManifest();
  }

  private async attachPage(page: Page, generation: number): Promise<void> {
    if (this.stopped || page.isClosed()) return;
    if ([...this.sessions.values()].some((entry) => entry.page === page && entry.generation === generation)) return;
    const pageId = `g${generation}-p${++this.pageSequence}`;
    const key = `${generation}:${pageId}`;
    try {
      const session = await page.context().newCDPSession(page);
      const entry: ActiveSession = { key, pageId, generation, page, session };
      this.sessions.set(key, entry);
      for (const eventName of OBSERVATION_EVENTS) {
        session.on(eventName as never, (params: Record<string, unknown>) => {
          void this.record(eventName, params, entry);
        });
      }
      for (const command of ["Network.enable", "Console.enable", "Runtime.enable", "Log.enable", "Page.enable"]) {
        await sendObservationCommand(session, command);
      }
      if (this.options.captureDom) await sendObservationCommand(session, "DOM.enable");
      await this.record("Target.attachedToTarget", { targetType: "page" }, entry);
    } catch (error) {
      this.degrade(`CDP page attach failed: ${messageOf(error)}`);
    }
  }

  private async record(method: string, params: Record<string, unknown>, entry: ActiveSession): Promise<void> {
    if (this.stopped && method !== "Target.detachedFromTarget") return;
    const protocolTimestamp = numericTimestamp(params);
    const wallTimeMs = this.toWallTime(entry.key, protocolTimestamp);
    const record: CdpTraceRecord = {
      receivedAt: new Date().toISOString(),
      wallTimeMs,
      protocolTimestamp,
      method,
      params: sanitizeCdpValue(params) as Record<string, unknown>,
      generation: entry.generation,
      pageId: entry.pageId
    };
    const line = `${JSON.stringify(record)}\n`;
    const bytes = Buffer.byteLength(line);
    if (this.rawBytes + bytes > this.maxRawBytes) {
      this.truncated = true;
      this.status = "degraded";
      if (!this.errors.includes("CDP raw trace reached its configured size limit.")) {
        this.errors.push("CDP raw trace reached its configured size limit.");
      }
      return;
    }
    this.rawBytes += bytes;
    this.eventCount += 1;
    this.queue = this.queue
      .then(() => appendFile(this.rawPath, line, "utf8"))
      .catch((error) => this.degrade(`CDP raw trace write failed: ${messageOf(error)}`));
  }

  private toWallTime(sessionKey: string, timestamp?: number): number {
    if (timestamp === undefined) return Date.now();
    if (timestamp >= 1e9) return timestamp >= 1e12 ? timestamp : timestamp * 1_000;
    let anchor = this.monotonicAnchors.get(sessionKey);
    if (!anchor) {
      anchor = { protocol: timestamp, wall: Date.now() };
      this.monotonicAnchors.set(sessionKey, anchor);
    }
    return anchor.wall + (timestamp - anchor.protocol) * 1_000;
  }

  private async enforceSampleRetention(): Promise<void> {
    while (this.retainedSamples.length > this.maxSamples) {
      const oldest = this.retainedSamples.shift();
      for (const artifact of oldest?.artifacts ?? []) {
        await rm(artifact, { force: true }).catch(() => undefined);
      }
    }
    await writeFile(
      this.indexPath,
      this.retainedSamples.length
        ? `${this.retainedSamples.map(({ record }) => JSON.stringify(record)).join("\n")}\n`
        : "",
      "utf8"
    );
  }

  private async flush(): Promise<void> {
    await this.queue;
  }

  private degrade(message: string): void {
    this.status = "degraded";
    if (!this.errors.includes(message)) this.errors.push(message);
  }

  private async writeManifest(stoppedAt?: string): Promise<void> {
    if (!this.initialized) return;
    const manifest: TraceManifest = {
      version: 1,
      executionId: this.options.executionId,
      instanceId: this.options.instanceId,
      scenarioId: this.options.scenarioId,
      startedAt: this.startedAt,
      stoppedAt,
      status: this.status,
      domains: ["Network", "Console", "Runtime", "Log", "Page", ...(this.options.captureDom ? ["DOM"] : [])],
      captureDom: this.options.captureDom ?? false,
      sampleIntervalMs: this.sampleIntervalMs,
      maxRawBytes: this.maxRawBytes,
      maxSamples: this.maxSamples,
      eventCount: this.eventCount,
      sampleCount: this.sampleCount,
      rawBytes: this.rawBytes,
      truncated: this.truncated,
      errors: [...this.errors]
    };
    await atomicWriteJson(join(this.options.root, "manifest.json"), manifest);
  }
}

export async function bisectCdpTrace(root: string): Promise<{
  eventCount: number;
  pages: Array<Record<string, unknown>>;
  buckets: Record<string, number>;
}> {
  const cdpRoot = join(root, "cdp");
  const rawPath = join(cdpRoot, "raw.ndjson");
  const raw = await readFile(rawPath, "utf8").catch(() => "");
  const records = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CdpTraceRecord);
  const bucketCounts: Record<string, number> = {};

  for (const [bucket, predicate] of BUCKETS) {
    const selected = records.filter((record) => predicate(record.method));
    bucketCounts[bucket] = selected.length;
    await writeJsonl(join(cdpRoot, `${bucket}.jsonl`), selected);
  }

  const pagesRoot = join(cdpRoot, "pages");
  await rm(pagesRoot, { recursive: true, force: true });
  await mkdir(pagesRoot, { recursive: true });

  const pageState = new Map<string, { segment: number; sawNavigation: boolean }>();
  const groups = new Map<string, CdpTraceRecord[]>();
  for (const record of records) {
    const state = pageState.get(record.pageId) ?? { segment: 0, sawNavigation: false };
    if (isTopFrameNavigation(record)) {
      if (state.sawNavigation) state.segment += 1;
      state.sawNavigation = true;
    }
    pageState.set(record.pageId, state);
    const key = `${record.pageId}:${state.segment}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  const pages: Array<Record<string, unknown>> = [];
  let pageIndex = 0;
  for (const [groupKey, pageRecords] of groups) {
    const pageName = `p${pageIndex}`;
    const pageRoot = join(pagesRoot, pageName);
    await mkdir(pageRoot, { recursive: true });
    const domainCounts: Record<string, number> = {};
    for (const record of pageRecords) {
      const domain = record.method.split(".")[0].toLocaleLowerCase();
      domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;
    }
    for (const [bucket, predicate] of BUCKETS) {
      const selected = pageRecords.filter((record) => predicate(record.method));
      const target = join(pageRoot, `${bucket}.jsonl`);
      if (selected.length) await writeJsonl(target, selected);
      else await rm(target, { force: true }).catch(() => undefined);
    }
    const networkByType: Record<string, number> = {};
    for (const record of pageRecords.filter((item) => item.method === "Network.responseReceived")) {
      const type = typeof record.params.type === "string" ? record.params.type : "Other";
      networkByType[type] = (networkByType[type] ?? 0) + 1;
    }
    pages.push({
      id: pageName,
      source: groupKey,
      eventCount: pageRecords.length,
      firstWallTimeMs: pageRecords[0]?.wallTimeMs,
      lastWallTimeMs: pageRecords.at(-1)?.wallTimeMs,
      domains: domainCounts,
      network: { byType: networkByType }
    });
    pageIndex += 1;
  }

  const summary = { version: 1, eventCount: records.length, buckets: bucketCounts, pages };
  await Promise.all([
    atomicWriteJson(join(cdpRoot, "summary.json"), summary),
    atomicWriteJson(join(root, "summary.json"), summary)
  ]);
  return summary;
}

function isTopFrameNavigation(record: CdpTraceRecord): boolean {
  if (record.method !== "Page.frameNavigated") return false;
  const frame = record.params.frame as { parentId?: string | null } | undefined;
  return !!frame && (frame.parentId === null || frame.parentId === undefined || frame.parentId === "");
}

function numericTimestamp(params: Record<string, unknown>): number | undefined {
  return typeof params.timestamp === "number" ? params.timestamp : undefined;
}

function sanitizeCdpValue(value: unknown, key = ""): unknown {
  if (value === null || value === undefined) return value;
  const lowerKey = key.toLocaleLowerCase();
  if (
    /authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|unserializablevalue|postdata|payloaddata|headerstext|rawheaders/.test(
      lowerKey
    )
  ) {
    return "[REDACTED]";
  }
  if (lowerKey.endsWith("url") && typeof value === "string") return stripUrlSecrets(value);
  if (
    lowerKey === "value" ||
    lowerKey === "description" ||
    lowerKey === "text" ||
    lowerKey === "message"
  ) {
    return "[OMITTED]";
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeCdpValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        sanitizeCdpValue(childValue, childKey)
      ])
    );
  }
  return typeof value === "string" ? value.slice(0, 2_000) : value;
}

function stripUrlSecrets(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeJsonl(path: string, records: CdpTraceRecord[]): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "", "utf8");
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Helper used by artifact verification: total bytes currently retained beneath a trace root. */
export async function observationTraceSize(root: string): Promise<number> {
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else total += (await stat(path)).size;
    }
  }
  return total;
}
