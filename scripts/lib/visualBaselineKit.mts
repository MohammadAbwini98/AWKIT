/**
 * Shared fixtures for the N6.3 visual-baseline verifiers (store, integrity, lifecycle, cross-process).
 *
 * The key protector here is VERIFIER-ONLY: AES-256-GCM under a fixed, labelled test key, so tampering
 * is detected like DPAPI would and two processes can share it. Production uses Electron `safeStorage`
 * (`app/main/visualAssertion/visualBaselineKeyProtector.ts`); there is no plaintext implementation.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import { FlowBaselineLifecycle } from "@src/runner/visualAssertion/flowBaselineLifecycle";
import {
  VisualBaselineStore,
  type VisualBaselineApprovalRequest,
  type VisualBaselineConditions,
  type VisualBaselineGeometry,
  type VisualKeyProtector
} from "@src/runner/visualAssertion/VisualBaselineStore";
import { VisualBaselineLayout, type VisualBaselineAppMode, type VisualBaselineLayoutOptions } from "@src/runner/visualAssertion/visualBaselineLayout";
import { visualStepContentDigest } from "@src/runner/visualAssertion/stepContentDigest";
import { JsonProfileStore } from "@src/storage/ProfileStore";
import { VISUAL_FINGERPRINT_VERSION, fingerprintVisualImage } from "@src/visual/fingerprint";
import { VisualImage } from "@src/visual/png";

const TEST_KEY = Buffer.from("verify-visual-baseline test key!", "utf8"); // 32 bytes, verifier-only

export function testProtector(state: { available: boolean } = { available: true }): VisualKeyProtector & { state: { available: boolean } } {
  return {
    state,
    isAvailable: () => state.available,
    protect(plain: Buffer): Buffer {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", TEST_KEY, iv);
      const body = Buffer.concat([cipher.update(plain), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    unprotect(sealed: Buffer): Buffer {
      const decipher = createDecipheriv("aes-256-gcm", TEST_KEY, sealed.subarray(0, 12));
      decipher.setAuthTag(sealed.subarray(12, 28));
      return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
    }
  };
}

export function tempRoot(label: string): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), `awkit-n6-${label}-`)));
}

export function conditions(overrides: Partial<VisualBaselineConditions> = {}): VisualBaselineConditions {
  return {
    renderMode: "headless",
    browserVersion: "Chromium 140.0.7339.16",
    appVersion: "0.1.53",
    osBuild: "10.0.26300",
    devicePixelRatio: 1,
    cssWidth: 1280,
    cssHeight: 720,
    colorScheme: "light",
    forcedColors: "none",
    reducedMotion: "no-preference",
    locale: "en-US",
    timeZone: "UTC",
    frameDepth: 0,
    isMainFrame: true,
    capturePolicy: "awkit-va15-v1",
    fingerprintVersion: VISUAL_FINGERPRINT_VERSION,
    assertionPolicyVersion: 1,
    ...overrides
  };
}

export function geometry(overrides: Partial<VisualBaselineGeometry> = {}): VisualBaselineGeometry {
  return { x: 40, y: 64, width: 48, height: 40, clipped: false, hover: false, focus: false, ...overrides };
}

function paint(fn: (x: number, y: number) => number, w = 48, h = 40): VisualImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(255, Math.round(fn(x, y))));
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return new VisualImage(w, h, data);
}

function digestOf(image: VisualImage): string {
  const result = fingerprintVisualImage(image);
  if (!result.ok) throw new Error(`synthetic fingerprint failed: ${result.code}`);
  return result.value.contentDigest;
}

const button = (x: number, y: number): number => (x >= 8 && x < 40 && y >= 10 && y < 30 ? 30 : 200 - x);
/** Real N1 content digests of synthetic images: `same` paints the baseline's pixels again. */
export const PIXELS = {
  baseline: digestOf(paint(button)),
  same: digestOf(paint(button)),
  onePixel: digestOf(paint((x, y) => (x === 20 && y === 20 ? 31 : button(x, y))))
};

export function step(id: string, overrides: Partial<FlowStep> & Record<string, unknown> = {}): FlowStep {
  return { id, type: "click", name: `Step ${id}`, locator: { strategy: "css", value: `#${id}` }, ...overrides } as unknown as FlowStep;
}

export function flow(id: string, nodes: FlowStep[] = [step("s1"), step("s2")]): FlowProfile {
  return { id, name: `Flow ${id}`, version: 1, nodes, edges: [] };
}

export interface Env {
  root: string;
  flowsFolder: string;
  layout: VisualBaselineLayout;
  lifecycle: FlowBaselineLifecycle;
  flows: JsonProfileStore<FlowProfile>;
  store: VisualBaselineStore;
  protector: ReturnType<typeof testProtector>;
}

export interface EnvOptions {
  root?: string;
  flowsFolder?: string;
  mode?: VisualBaselineAppMode;
  protector?: ReturnType<typeof testProtector>;
  layoutOptions?: Partial<VisualBaselineLayoutOptions>;
  Layout?: typeof VisualBaselineLayout;
  Lifecycle?: typeof FlowBaselineLifecycle;
  Store?: typeof VisualBaselineStore;
}

/** A flow store wired exactly like `createFlowProfileStore` (same hooks), plus a store for one app mode. */
export function makeEnv(options: EnvOptions = {}): Env {
  const root = options.root ?? tempRoot("env");
  const flowsFolder = options.flowsFolder ?? join(root, "flows");
  const LayoutClass = options.Layout ?? VisualBaselineLayout;
  const layout = new LayoutClass({ flowsFolder, runtimeRoot: join(root, "runtime"), lockTimeoutMs: 4000, ...options.layoutOptions });
  const LifecycleClass = options.Lifecycle ?? FlowBaselineLifecycle;
  const lifecycle = new LifecycleClass(layout);
  const flows = new JsonProfileStore<FlowProfile>({
    folder: flowsFolder,
    createClone: (profile, nextId) => ({ ...profile, id: nextId, name: `${profile.name} Copy` }),
    hooks: lifecycle.hooks()
  });
  const protector = options.protector ?? testProtector();
  const StoreClass = options.Store ?? VisualBaselineStore;
  const store = new StoreClass({ layout, appMode: options.mode ?? "dev", protector, readFlow: (id) => flows.get(id) });
  return { root, flowsFolder, layout, lifecycle, flows, store, protector };
}

/** An approval request bound to the flow's current token, key generation and step content. */
export async function approvalFor(
  env: Env,
  flowId: string,
  stepId: string,
  extra: Partial<VisualBaselineApprovalRequest> = {}
): Promise<VisualBaselineApprovalRequest> {
  const current = await env.flows.get(flowId);
  const target = current?.nodes.find((n) => n.id === stepId);
  const stepContentDigest = target ? visualStepContentDigest(target as unknown as { id: string } & Record<string, unknown>) : "0".repeat(64);
  const boundEpoch = await env.store.ensureToken(flowId);
  const boundKeyGeneration = (await env.store.keyGeneration()) ?? -1;
  return {
    flowId,
    stepId,
    stepContentDigest,
    conditions: conditions(),
    epoch: boundEpoch,
    width: 48,
    height: 40,
    contentDigest: PIXELS.baseline,
    geometry: geometry(),
    boundEpoch,
    boundKeyGeneration,
    approver: "author-1",
    runUser: "runner-1",
    runId: "run-1",
    appVersion: "0.1.53",
    ...extra
  };
}

export function lookupRequest(env: Env, flowId: string, stepId: string, stepContentDigest: string, overrides: Partial<VisualBaselineConditions> = {}) {
  void env;
  return { flowId, stepId, stepContentDigest, conditions: conditions(overrides) };
}

export async function stepDigest(env: Env, flowId: string, stepId: string): Promise<string> {
  const current = await env.flows.get(flowId);
  const target = current?.nodes.find((n) => n.id === stepId);
  if (!target) throw new Error(`no step ${stepId} in ${flowId}`);
  return visualStepContentDigest(target as unknown as { id: string } & Record<string, unknown>);
}

/** Check bookkeeping shared by every verifier. */
export function makeChecker(): { check(label: string, ok: unknown, detail?: string): void; results(): { passed: number; failed: number; failures: string[] } } {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  return {
    check(label, ok, detail) {
      if (ok) passed += 1;
      else {
        failed += 1;
        failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
      }
    },
    results: () => ({ passed, failed, failures })
  };
}

/** Bound an async step so a hang is a failure, never a stuck verifier. */
export async function within<T>(ms: number, promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
