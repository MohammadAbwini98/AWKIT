import { useCallback, useEffect, useState } from "react";

export interface TelemetryQueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  /** Manual re-fetch (also used by a page-level refresh button). */
  refetch: () => void;
}

/**
 * Generic loader for a `window.playwrightFlowStudio.telemetry.*` call. Handles loading/error/data,
 * re-fetches when `deps` change (e.g. the selected time range), and ignores results from a stale
 * in-flight request so rapid range switches don't flicker old data. Historical pages do NOT poll —
 * refetch is manual.
 */
export function useTelemetryQuery<T>(fetcher: () => Promise<T>, deps: unknown[]): TelemetryQueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetcher()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, refetch };
}
