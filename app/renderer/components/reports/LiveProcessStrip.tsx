import type { RuntimeStatusSnapshot } from "@src/runner/concurrency/RuntimeStatus";

interface LiveProcessStripProps {
  status: RuntimeStatusSnapshot;
}

function mb(value: number | undefined): string {
  return value === undefined ? "—" : `${value.toLocaleString()} MB`;
}

/** Compact live strip of Chrome/host process stats + per-slot browser detail. */
export function LiveProcessStrip({ status }: LiveProcessStripProps) {
  const proc = status.processes;
  const cap = status.capacity;
  const slots = status.browserPool.slots ?? [];

  const stats: Array<{ label: string; value: string }> = [
    { label: "Chromium processes", value: proc?.chromiumProcessCount?.toLocaleString() ?? "—" },
    { label: "Chromium memory", value: mb(proc?.chromiumMemoryMb) },
    { label: "Electron main", value: mb(proc?.electronMainMemoryMb ?? cap.processRssMb) },
    { label: "Browser contexts", value: cap.activeContexts.toLocaleString() },
    { label: "Pages / tabs", value: cap.activePages.toLocaleString() },
    { label: "Recent crashes", value: cap.recentCrashes.toLocaleString() }
  ];

  return (
    <div className="awkit-process-strip">
      <div className="awkit-process-stats">
        {stats.map((stat) => (
          <div key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>
      {slots.length > 0 ? (
        <div className="awkit-table-wrap">
          <table className="awkit-table">
            <thead>
              <tr>
                <th>Browser slot</th>
                <th>Instance</th>
                <th className="awkit-th-numeric">Contexts</th>
                <th className="awkit-th-numeric">Pages</th>
                <th>Health</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.workerId}>
                  <td title={slot.workerId}>{slot.workerId}</td>
                  <td className="awkit-muted" title={slot.instanceId}>{slot.instanceId}</td>
                  <td className="awkit-td-numeric">{slot.activeContexts}</td>
                  <td className="awkit-td-numeric">{slot.activePages}</td>
                  <td>{slot.unhealthy ? <span className="awkit-muted">{slot.unhealthyReason ?? "unhealthy"}</span> : "healthy"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="awkit-muted">No active browser slots. Start a workflow to see per-browser detail.</p>
      )}
    </div>
  );
}
