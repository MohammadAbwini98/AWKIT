import type { LocatorQuality, LocatorCandidate, LocatorContext, WaitCondition } from "../profiles/FlowProfile";

export type { LocatorQuality } from "../profiles/FlowProfile";

export interface RecordedActionLocator {
  strategy: string;
  value: string;
  name?: string;
  /** For role/text strategies: match the accessible name/text exactly. */
  exact?: boolean;
  /** Uniqueness/quality metadata computed at record time. */
  quality?: LocatorQuality;
  /** Ranked fallback candidates the runner can try when the primary is ambiguous. */
  alternatives?: LocatorCandidate[];
  /** Container/frame scoping (visible dialog, table row, card, iframe) detected at record time. */
  context?: LocatorContext;
}

export interface RecordedAction {
  id: string;
  type: string;
  name: string;
  locator?: RecordedActionLocator;
  valueSource?: {
    type: string;
    value: string;
  };
  /**
   * For synthetic `wait` actions inserted when "capture waiting time" is enabled: the measured
   * think-time (ms) the user paused before the following action. Saved as a fixed-time wait step.
   */
  waitMs?: number;
  /** Smart Wait conditions to satisfy BEFORE this action runs (recorder observation, Phase 2). */
  beforeWaits?: WaitCondition[];
  /** Smart Wait conditions observed AFTER this action (what the user waited for next). */
  afterWaits?: WaitCondition[];
}

/** A URL captured during a recording session. Sensitive query values are masked before storage. */
export interface RecordedUrl {
  id: string;
  /** Full URL with sensitive query values masked (e.g. `?token=***`). */
  url: string;
  title?: string;
  /** ISO timestamp when the URL was recorded. */
  timestamp: string;
  /** Event/source type: manual_url_entry | navigation | new_tab | redirect. */
  source: string;
  /** Recording session id (stable for one start→stop session). */
  sessionId?: string;
}
