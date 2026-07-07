import { Info } from "lucide-react";

interface AvailabilityNoticeProps {
  availability: "full" | "partial" | "unavailable" | undefined;
  reason?: string;
}

/**
 * Non-alarming notice shown when process-level metrics are partial/unavailable. Deliberately only
 * mentions administrator access when the failure looks access-related; otherwise it states the
 * generic reason. Core (non-process) metrics stay live regardless.
 */
export function AvailabilityNotice({ availability, reason }: AvailabilityNoticeProps) {
  if (!availability || availability === "full") return null;
  const accessRelated = /(access|denied|permission|privilege|elevat)/i.test(reason ?? "");
  const message = accessRelated
    ? "Some process-level metrics require additional access. Core runtime metrics remain live."
    : "Some process-level metrics are currently unavailable. Core runtime metrics remain live.";
  return (
    <div className="awkit-availability-notice" role="status">
      <Info size={15} />
      <div>
        <strong>{message}</strong>
        {reason ? <span className="awkit-muted">{reason}</span> : null}
      </div>
    </div>
  );
}
