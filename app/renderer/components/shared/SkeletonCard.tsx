interface SkeletonCardProps {
  /** Number of shimmer lines to render under the title block. */
  lines?: number;
  /** Show a taller block (for charts) instead of text lines. */
  variant?: "text" | "chart";
}

/**
 * Loading placeholder for report cards. Shimmer is CSS-driven and is neutralized to a static tint
 * by the global reduced-motion block.
 */
export function SkeletonCard({ lines = 3, variant = "text" }: SkeletonCardProps) {
  return (
    <div className="awkit-skeleton-card" aria-hidden="true">
      <span className="awkit-skeleton-line awkit-skeleton-title" />
      {variant === "chart" ? (
        <span className="awkit-skeleton-block" />
      ) : (
        Array.from({ length: Math.max(1, lines) }).map((_, index) => (
          <span className="awkit-skeleton-line" key={index} />
        ))
      )}
    </div>
  );
}
