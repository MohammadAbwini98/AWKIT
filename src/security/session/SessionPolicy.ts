export const DEFAULT_SESSION_INACTIVITY_MINUTES = 30;
export const MIN_SESSION_INACTIVITY_MINUTES = 1;
export const MAX_SESSION_INACTIVITY_MINUTES = 24 * 60;

export function isValidSessionInactivityMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_SESSION_INACTIVITY_MINUTES &&
    value <= MAX_SESSION_INACTIVITY_MINUTES
  );
}

export function sessionInactivityMinutesToMs(minutes: number): number {
  return minutes * 60_000;
}

