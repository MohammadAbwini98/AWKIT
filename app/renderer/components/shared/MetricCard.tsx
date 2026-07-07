import type { ReactNode } from "react";
import { SkeletonCard } from "./SkeletonCard";

type MetricTone = "default" | "success" | "warning" | "danger";

interface MetricCardProps {
  label: string;
  value: ReactNode;
  detail: string;
  icon?: ReactNode;
  /** Optional trend chip (e.g. <TrendDelta />) rendered next to the value. */
  trend?: ReactNode;
  /** Accent tone for the card; defaults to neutral. */
  tone?: MetricTone;
  /** Renders a skeleton placeholder instead of content. */
  loading?: boolean;
}

export function MetricCard({ label, value, detail, icon, trend, tone = "default", loading }: MetricCardProps) {
  if (loading) {
    return <SkeletonCard lines={2} />;
  }

  const className = tone === "default" ? "metric-card" : `metric-card metric-card-${tone}`;
  return (
    <article className={className}>
      <div>
        <span>{label}</span>
        <strong>
          {value}
          {trend ? <span className="metric-card-trend">{trend}</span> : null}
        </strong>
      </div>
      {icon}
      <p>{detail}</p>
    </article>
  );
}
