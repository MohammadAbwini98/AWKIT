import type { CDPSession, Page, Request, Response, WebSocket } from "playwright";
import type { WaitCondition } from "@src/profiles/FlowProfile";
import { SecretMasker } from "@src/reports/SecretMasker";

export type StreamObservationWait = Extract<WaitCondition, { type: "streamActivity" }>;
export type NetworkDiagnosticsMode = "cdp" | "playwright";

interface NetworkSample {
  requestId?: string;
  method: string;
  path: string;
  durationMs?: number;
  redirects?: string[];
}

export interface NetworkObservationSummary {
  mode: NetworkDiagnosticsMode;
  transport: StreamObservationWait["transport"];
  observedEvents: Array<"open" | "message" | "close">;
  requestCount: number;
  redirectCount: number;
  samples: NetworkSample[];
}

export interface ArmedNetworkObservation {
  summary: () => NetworkObservationSummary;
  dispose: () => Promise<void>;
}

interface ArmNetworkObservationOptions {
  /** Test/capability hook: false proves the Playwright-only fallback without requiring Firefox/WebKit. */
  enableCdp?: boolean;
  /** False retains stream lifecycle observation without collecting request-level diagnostics. */
  captureDiagnostics?: boolean;
}

interface PendingRequest {
  method: string;
  path: string;
  startedAt: number;
  redirects: string[];
}

const MAX_SAMPLES = 12;
const MAX_PENDING_REQUESTS = 256;
const MAX_MATCHED_SOCKETS = 64;
const masker = new SecretMasker();

function safePath(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
      return `${parsed.protocol}//redacted`;
    }
    const segments = parsed.pathname.split("/");
    const sanitized = segments.map((segment, index) => {
      const prior = segments[index - 1] ?? "";
      if (/(?:token|secret|api-?key|auth|session|credential|password)/i.test(prior)) return "[masked]";
      if (segment.length > 64 || /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(segment)) return "[masked]";
      return segment;
    });
    return masker.maskText(`${parsed.origin}${sanitized.join("/")}`);
  } catch {
    return "unknown";
  }
}

function matches(wait: StreamObservationWait, rawUrl: string): boolean {
  return !wait.urlContains || rawUrl.includes(wait.urlContains);
}

function wants(wait: StreamObservationWait, transport: "websocket" | "sse"): boolean {
  return wait.transport === "either" || wait.transport === transport;
}

/**
 * Arms cross-browser stream lifecycle observation before an action and collects redacted network
 * diagnostics. Stream activity is evidence only: the caller must keep a UI outcome as the primary
 * completion gate. URLs are reduced to origin + sanitized path and bodies/headers/queries are never
 * kept.
 *
 * Chromium gets request ids, timing, and redirect metadata from CDP when available. Any CDP attach
 * or protocol failure falls back to Playwright request events, which keeps Firefox/WebKit usable.
 */
export async function armNetworkObservation(
  page: Page,
  wait: StreamObservationWait,
  options: ArmNetworkObservationOptions = {}
): Promise<ArmedNetworkObservation> {
  const observed = new Set<"open" | "message" | "close">();
  const samples: NetworkSample[] = [];
  const pending = new Map<string, PendingRequest>();
  const matchedCdpSockets = new Set<string>();
  const fallbackStarted = new WeakMap<Request, number>();
  const sockets = new Map<WebSocket, Array<() => void>>();
  const disposers: Array<() => void> = [];
  let mode: NetworkDiagnosticsMode = "playwright";
  let cdp: CDPSession | undefined;

  const record = (sample: NetworkSample) => {
    if (samples.length < MAX_SAMPLES) samples.push(sample);
  };

  const onSocket = (socket: WebSocket) => {
    if (!wants(wait, "websocket") || !matches(wait, socket.url())) return;
    observed.add("open");
    const onFrame = () => observed.add("message");
    const onClose = () => observed.add("close");
    socket.on("framereceived", onFrame);
    socket.on("framesent", onFrame);
    socket.on("close", onClose);
    sockets.set(socket, [
      () => socket.off("framereceived", onFrame),
      () => socket.off("framesent", onFrame),
      () => socket.off("close", onClose)
    ]);
  };
  page.on("websocket", onSocket);
  disposers.push(() => page.off("websocket", onSocket));

  const onResponse = (response: Response) => {
    if (!wants(wait, "sse") || !matches(wait, response.url())) return;
    void response
      .headerValue("content-type")
      .then((contentType) => {
        if (contentType?.toLowerCase().includes("text/event-stream")) observed.add("open");
      })
      .catch(() => undefined);
  };
  page.on("response", onResponse);
  disposers.push(() => page.off("response", onResponse));

  const captureDiagnostics = options.captureDiagnostics !== false;
  if (captureDiagnostics && options.enableCdp !== false) {
    try {
      cdp = await page.context().newCDPSession(page);
      await cdp.send("Network.enable");
      mode = "cdp";

      const onRequestWillBeSent = (event: {
        requestId: string;
        timestamp: number;
        request: { method: string; url: string };
        redirectResponse?: { url: string };
      }) => {
        const previous = pending.get(event.requestId);
        if (!previous && pending.size >= MAX_PENDING_REQUESTS) return;
        const redirects = previous?.redirects ?? [];
        if (event.redirectResponse?.url) redirects.push(safePath(event.redirectResponse.url));
        pending.set(event.requestId, {
          method: event.request.method,
          path: safePath(event.request.url),
          startedAt: event.timestamp,
          redirects
        });
      };
      const onLoadingFinished = (event: { requestId: string; timestamp: number }) => {
        const request = pending.get(event.requestId);
        if (!request) return;
        record({
          requestId: event.requestId,
          method: request.method,
          path: request.path,
          durationMs: Math.max(0, Math.round((event.timestamp - request.startedAt) * 1000)),
          redirects: request.redirects.length ? [...request.redirects] : undefined
        });
        pending.delete(event.requestId);
      };
      const onLoadingFailed = (event: { requestId: string; timestamp: number }) => onLoadingFinished(event);
      const onWebSocketCreated = (event: { requestId: string; url: string }) => {
        if (!wants(wait, "websocket") || !matches(wait, event.url)) return;
        if (matchedCdpSockets.size >= MAX_MATCHED_SOCKETS) return;
        matchedCdpSockets.add(event.requestId);
        observed.add("open");
      };
      const onWebSocketFrame = (event: { requestId: string }) => {
        if (matchedCdpSockets.has(event.requestId)) observed.add("message");
      };
      const onWebSocketClosed = (event: { requestId: string }) => {
        if (matchedCdpSockets.delete(event.requestId)) observed.add("close");
      };
      cdp.on("Network.requestWillBeSent", onRequestWillBeSent);
      cdp.on("Network.loadingFinished", onLoadingFinished);
      cdp.on("Network.loadingFailed", onLoadingFailed);
      cdp.on("Network.webSocketCreated", onWebSocketCreated);
      cdp.on("Network.webSocketFrameReceived", onWebSocketFrame);
      cdp.on("Network.webSocketFrameSent", onWebSocketFrame);
      cdp.on("Network.webSocketClosed", onWebSocketClosed);
      disposers.push(
        () => cdp?.off("Network.requestWillBeSent", onRequestWillBeSent),
        () => cdp?.off("Network.loadingFinished", onLoadingFinished),
        () => cdp?.off("Network.loadingFailed", onLoadingFailed),
        () => cdp?.off("Network.webSocketCreated", onWebSocketCreated),
        () => cdp?.off("Network.webSocketFrameReceived", onWebSocketFrame),
        () => cdp?.off("Network.webSocketFrameSent", onWebSocketFrame),
        () => cdp?.off("Network.webSocketClosed", onWebSocketClosed)
      );
    } catch {
      if (cdp) await cdp.detach().catch(() => undefined);
      cdp = undefined;
      mode = "playwright";
    }
  }

  if (captureDiagnostics && mode === "playwright") {
    const onRequest = (request: Request) => fallbackStarted.set(request, Date.now());
    const onRequestFinished = (request: Request) => {
      const redirects: string[] = [];
      let redirected = request.redirectedFrom();
      while (redirected) {
        redirects.unshift(safePath(redirected.url()));
        redirected = redirected.redirectedFrom();
      }
      record({
        method: request.method(),
        path: safePath(request.url()),
        durationMs: Math.max(0, Date.now() - (fallbackStarted.get(request) ?? Date.now())),
        redirects: redirects.length ? redirects : undefined
      });
    };
    page.on("request", onRequest);
    page.on("requestfinished", onRequestFinished);
    page.on("requestfailed", onRequestFinished);
    disposers.push(
      () => page.off("request", onRequest),
      () => page.off("requestfinished", onRequestFinished),
      () => page.off("requestfailed", onRequestFinished)
    );
  }

  return {
    summary: () => ({
      mode,
      transport: wait.transport,
      observedEvents: [...observed],
      requestCount: samples.length,
      redirectCount: samples.reduce((total, sample) => total + (sample.redirects?.length ?? 0), 0),
      samples: samples.map((sample) => ({
        ...sample,
        redirects: sample.redirects ? [...sample.redirects] : undefined
      }))
    }),
    dispose: async () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          // Page/socket may already be closed.
        }
      }
      for (const socketDisposers of sockets.values()) {
        for (const dispose of socketDisposers) dispose();
      }
      sockets.clear();
      if (cdp) await cdp.detach().catch(() => undefined);
    }
  };
}
