import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Gauge, RotateCcw } from "lucide-react";

import type { AiLoadStage } from "@src/ai/AiExecutionProfile";
import type { AiDiagnosticsView, AiExecutionView, AiSettingsView } from "@src/ai/contracts/AiApi";

import { ReauthDialog } from "./admin/ReauthDialog";
import { formatBytes } from "./LocalAiBackendPack";
import { useSensitiveSemanticAction, type SensitiveAdminResponse } from "../semantic/useSensitiveSemanticAction";

const api = () => window.playwrightFlowStudio.ai;

type Mode = AiSettingsView["executionMode"];

export const MODE_LABELS: Record<Mode, string> = { auto: "Automatic", cpu: "CPU & RAM only", "gpu-offload": "GPU-Offload", "gpu-only": "GPU-Only" };

const MODE_HELP: Record<Mode, string> = {
  auto:
    "The default. When the GPU backend pack is installed and every display adapter is NVIDIA, the model runs as " +
    "GPU-Offload. Otherwise it runs on CPU & RAM only. This is checked each time the model loads.",
  cpu:
    "The model runs on this machine's processor and memory, and the GPU runtime is never started. The most " +
    "compatible mode: it needs nothing beyond this installation.",
  "gpu-offload":
    "SpecterStudio tries a compatible NVIDIA GPU and places as many model layers on it as safely fit in its memory; " +
    "the other layers stay on CPU & RAM. If the GPU cannot be used, the model runs on CPU & RAM and the reason is shown.",
  "gpu-only":
    "Every model layer must fit and load on a compatible NVIDIA GPU. If that is not possible, local AI stays " +
    "unavailable and says why. It never switches to CPU & RAM on its own. Sampling still uses the processor."
};

const STAGE_LABELS: Record<AiLoadStage, string> = {
  unloading: "Unloading the previous model",
  "verifying-model": "Verifying the model pack",
  "checking-gpu": "Checking the GPU backend pack and display adapters",
  "starting-gpu-host": "Starting the GPU runtime and verifying its backend pack",
  "planning-gpu": "Measuring how many layers fit in GPU memory",
  "loading-gpu": "Loading the model with layers on the GPU",
  "retrying-gpu": "Retrying with fewer layers on the GPU",
  "loading-cpu": "Loading the model on CPU & RAM",
  "falling-back": "Falling back to CPU & RAM"
};

function describe(response: SensitiveAdminResponse): string {
  if (response.message) return response.message;
  return response.code === "NOT_AUTHORIZED" ? "You don't have permission to do that." : "That action could not be completed.";
}

function shortfall(refusal: NonNullable<AiExecutionView["refusal"]>): string {
  return refusal.requiredBytes !== null && refusal.availableBytes !== null
    ? ` Needs ${formatBytes(refusal.requiredBytes)} including the reserve; ${formatBytes(refusal.availableBytes)} is free.`
    : "";
}

function placement(e: AiExecutionView): string {
  if (e.backend === "vulkan") {
    return e.totalLayers !== null && e.gpuLayers >= e.totalLayers
      ? `${MODE_LABELS[e.mode]}: all ${e.gpuLayers} layers on the GPU`
      : `${MODE_LABELS[e.mode]}: ${e.gpuLayers} of ${e.totalLayers ?? "?"} layers on the GPU, the rest on CPU & RAM`;
  }
  return e.fallbackReason ? `CPU & RAM (GPU-Offload fell back: ${e.message})` : "CPU & RAM";
}

/** Where the model runs right now, in one sentence. Only what the runtime reported; nothing inferred. */
export function effectiveLabel(e: AiExecutionView): string {
  if (e.stage) return `${STAGE_LABELS[e.stage]}…`;
  if (e.applied && e.refusal) return `Not running: GPU-Only refused. ${e.message ?? ""}${shortfall(e.refusal)}`;
  if (e.applied) return e.modelLoaded ? placement(e) : `Not loaded. Last load: ${placement(e)}`;
  return e.modelLoaded
    ? `Still loaded with the previous setting; ${MODE_LABELS[e.mode]} takes effect at the next model load`
    : `Not loaded; ${MODE_LABELS[e.mode]} is used the next time the model loads`;
}

/** The backend pack panel's "GPU use" row. */
export function gpuUseLabel(mode: Mode, e: AiExecutionView | null): string {
  if (e?.applied && e.modelLoaded && e.backend === "vulkan") return `In use: ${placement(e)}`;
  return mode === "cpu" ? "Not active — the model runs on CPU & RAM" : `Not active yet — ${MODE_LABELS[mode]} is selected (see Where the model runs)`;
}

/**
 * Settings → Local AI → Where the model runs (Phase L, L8a.4).
 *
 * Automatic (the default) plus the three E4 modes, and the VRAM reserve, written through
 * `ai:updateSettings` (`ai.manage`, re-auth).
 * The main process owns every rule: the renderer sends what was typed and shows the refusal, and a
 * change unloads an idle model so it takes effect at the next load. The GPU check line is the same
 * readiness answer the next GPU load uses.
 */
export function LocalAiExecution({
  settings,
  execution,
  sessionRef,
  onChanged
}: {
  settings: AiSettingsView;
  execution: AiExecutionView | null;
  sessionRef: string;
  onChanged: () => Promise<void>;
}) {
  const action = useSensitiveSemanticAction(describe);
  const [reserveError, setReserveError] = useState<string | null>(null);
  const mode = settings.executionMode;
  const gpuMode = mode !== "cpu";
  const savedReserve = settings.vramReserveMb === null ? "" : String(settings.vramReserveMb);
  const [reserveDraft, setReserveDraft] = useState(savedReserve);
  // A refused entry stays visible beside its error; a saved value or a mode change replaces it.
  useEffect(() => setReserveDraft(savedReserve), [savedReserve, mode]);

  const save = (patch: Parameters<ReturnType<typeof api>["updateSettings"]>[0], notice: string, onResponse?: (r: SensitiveAdminResponse) => void) =>
    void action
      .run(async () => {
        const response = await api().updateSettings(patch);
        onResponse?.(response);
        return response;
      }, notice)
      .then(onChanged);

  // The controls stay enabled while a save runs (disabling a focused control drops keyboard focus to
  // the page); a change made meanwhile is ignored, and the controlled value snaps back.
  const saveMode = (next: Mode): void => {
    if (action.busy) return;
    setReserveError(null);
    save({ executionMode: next }, `Execution mode set to ${MODE_LABELS[next]}. It takes effect the next time the model loads.`);
  };

  const saveReserve = (value: number | null): void =>
    save(
      { vramReserveMb: value },
      value === null
        ? "GPU memory reserve set to the system default. It takes effect the next time the model loads."
        : `GPU memory reserve set to ${value} MB. It takes effect the next time the model loads.`,
      (response) => setReserveError(response.ok || response.code === "REAUTH_REQUIRED" ? null : describe(response))
    );

  const commitReserve = (input: HTMLInputElement): void => {
    if (action.busy) return;
    const text = input.value.trim();
    // Only an unparseable entry is decided here; the range is main's rule, and its refusal is shown as is.
    const value = input.validity.badInput ? Number.NaN : text === "" ? null : Number(text);
    if (value === settings.vramReserveMb) {
      setReserveError(null);
      return;
    }
    saveReserve(value);
  };

  const readiness = execution?.gpuReadiness ?? null;
  const refused = execution?.applied && execution.refusal ? execution : null;

  return (
    <section className="settings-subsection" aria-labelledby="ai-execution-title">
      <div className="settings-card-head">
        <Gauge size={16} aria-hidden="true" />
        <h3 id="ai-execution-title">Where the model runs</h3>
      </div>

      {action.error && !reserveError ? (
        <p className="form-message error" role="alert">
          <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {action.error}
        </p>
      ) : null}
      {action.notice ? (
        <p className="form-message" role="status">
          <CheckCircle2 size={13} style={{ verticalAlign: "-2px" }} /> {action.notice}
        </p>
      ) : null}

      <fieldset className="ai-mode-group" aria-describedby="ai-execution-apply-hint">
        <legend>Execution mode</legend>
        {(Object.keys(MODE_LABELS) as Mode[]).map((id) => (
          <div className={`ai-mode-option${mode === id ? " is-selected" : ""}`} key={id}>
            <input
              aria-describedby={`ai-mode-${id}-help`}
              checked={mode === id}
              id={`ai-mode-${id}`}
              name="ai-execution-mode"
              type="radio"
              value={id}
              onChange={() => saveMode(id)}
            />
            <div>
              <label htmlFor={`ai-mode-${id}`}>{MODE_LABELS[id]}</label>
              <p id={`ai-mode-${id}-help`}>{MODE_HELP[id]}</p>
            </div>
          </div>
        ))}
      </fieldset>
      <p className="settings-card-hint" id="ai-execution-apply-hint">
        A change takes effect the next time the model loads, never in the middle of a job. An idle model is unloaded
        at once; the next AI request loads it again.
      </p>

      {gpuMode && readiness ? (
        // Automatic without a proven GPU is the expected default on most machines, so it is information, not a warning.
        <p className={readiness.ok || mode === "auto" ? "form-message" : "form-message warn"} id="ai-execution-gpu-check">
          {readiness.ok
            ? `GPU check: ${readiness.nvidiaAdapters} NVIDIA display adapter${readiness.nvidiaAdapters === 1 ? "" : "s"} detected by PCI vendor ID and the backend pack is installed (compatible but unqualified). How many layers fit is measured when the model loads.`
            : `GPU check: ${readiness.message} ${
                mode === "gpu-only"
                  ? "GPU-Only will refuse to load the model until this is resolved."
                  : mode === "auto"
                    ? "Automatic runs the model on CPU & RAM only."
                    : "GPU-Offload will run the model on CPU & RAM until this is resolved."
              }`}
        </p>
      ) : null}

      {refused ? (
        <div className="form-message warn" role="alert">
          <p>
            <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> GPU-Only refused to load the model: {refused.message}
            {refused.refusal ? shortfall(refused.refusal) : ""} Local AI is unavailable until the mode changes or the cause is
            fixed.
          </p>
          <button className="toolbar-button" disabled={action.busy} type="button" onClick={() => saveMode("gpu-offload")}>
            Switch to GPU-Offload
          </button>
        </div>
      ) : null}

      <div className="ai-reserve-field">
        <label htmlFor="ai-vram-reserve">GPU memory reserve (MB)</label>
        <input
          aria-describedby={`ai-vram-reserve-hint${reserveError ? " ai-vram-reserve-error" : ""}`}
          aria-invalid={reserveError ? true : undefined}
          disabled={!gpuMode}
          id="ai-vram-reserve"
          inputMode="numeric"
          max={settings.maxVramReserveMb}
          min={settings.minVramReserveMb}
          placeholder="System default"
          step={1}
          type="number"
          value={reserveDraft}
          onBlur={(ev) => commitReserve(ev.currentTarget)}
          onChange={(ev) => setReserveDraft(ev.currentTarget.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") commitReserve(ev.currentTarget);
          }}
        />
        <p className="settings-card-hint" id="ai-vram-reserve-hint">
          GPU memory kept free for Windows, SpecterStudio&apos;s own windows, the display and other applications:{" "}
          {settings.minVramReserveMb}–{settings.maxVramReserveMb} MB, or empty for the system default (the runtime&apos;s own
          padding, sized from the GPU&apos;s memory). {gpuMode ? "" : "Used only by Automatic, GPU-Offload and GPU-Only."}
        </p>
        {reserveError ? (
          <p className="form-message error" id="ai-vram-reserve-error" role="alert">
            <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {reserveError}
          </p>
        ) : null}
        {settings.vramReserveMb !== null ? (
          <div className="settings-actions">
            <button className="toolbar-button" disabled={action.busy || !gpuMode} type="button" onClick={() => saveReserve(null)}>
              <RotateCcw size={15} aria-hidden="true" />
              Use System Default
            </button>
          </div>
        ) : null}
      </div>

      {action.needsReauth ? (
        <ReauthDialog sessionRef={sessionRef} onCancel={action.onReauthCancelled} onConfirmed={action.onReauthConfirmed} />
      ) : null}
    </section>
  );
}

/** Rows for the diagnostics list: the technical detail behind the one-line status. */
export function ExecutionDiagnostics({ diagnostics }: { diagnostics: AiDiagnosticsView }) {
  const e = diagnostics.execution;
  const described = e.applied || e.modelLoaded;
  const adapters = diagnostics.adapters;
  return (
    <>
      <span>Execution mode</span>
      <strong>{MODE_LABELS[e.mode]}</strong>
      <span>Running as</span>
      <strong>{effectiveLabel(e)}</strong>
      {described ? (
        <>
          <span>Backend{e.modelLoaded ? "" : " (last load)"}</span>
          <strong>{e.backend === "vulkan" ? "Vulkan, from the GPU backend pack" : "CPU"}</strong>
        </>
      ) : null}
      {described && e.totalLayers !== null ? (
        <>
          <span>GPU layers</span>
          <strong>
            {e.gpuLayers} of {e.totalLayers}
            {e.requestedLayers !== null && e.requestedLayers !== e.gpuLayers ? ` (planned ${e.requestedLayers}, fewer after a failed load)` : ""}
          </strong>
        </>
      ) : null}
      {described && e.vram ? (
        <>
          <span>GPU memory at the last plan</span>
          <strong>
            {formatBytes(e.vram.freeBytes)} free of {formatBytes(e.vram.totalBytes)}; every layer needs{" "}
            {formatBytes(e.vram.fullRequiredBytes)} plus a {formatBytes(e.vram.reserveBytes)} reserve
          </strong>
        </>
      ) : null}
      <span>GPU readiness now</span>
      <strong>
        {e.gpuReadiness.ok
          ? `Ready: ${e.gpuReadiness.nvidiaAdapters} NVIDIA adapter${e.gpuReadiness.nvidiaAdapters === 1 ? "" : "s"} by PCI vendor ID, backend pack installed (compatible but unqualified)`
          : `Not ready: ${e.gpuReadiness.message}`}
      </strong>
      {e.gpuReadiness.nvidiaAdapters > 1 ? (
        <>
          <span>Adapter used</span>
          <strong>The runtime&apos;s default device; choosing one adapter is not available</strong>
        </>
      ) : null}
      <span>Display adapters (PCI vendor)</span>
      <strong>
        {adapters === null
          ? "Could not be read"
          : adapters.length === 0
            ? "None reported"
            : adapters.map((a) => `${a.vendorId}${a.nvidia ? " (NVIDIA)" : a.software ? " (software)" : ""}`).join(", ")}
      </strong>
      <span>GPU runtime process</span>
      <strong>
        {diagnostics.gpuHost.circuitOpen ? "Stopped after repeated crashes" : diagnostics.gpuHost.state}
        {diagnostics.gpuHost.lastReason ? ` — ${diagnostics.gpuHost.lastReason}` : ""}
      </strong>
    </>
  );
}
