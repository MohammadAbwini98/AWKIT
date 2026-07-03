import { Activity, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { InstanceRuntimeState } from "@src/instances/InstanceRuntimeState";

/**
 * Live execution monitor. Shows real instance state from the execution engine.
 * No demo/sample data — when nothing is running, honest empty states are shown.
 */
export function ExecutionMonitor() {
  const [instances, setInstances] = useState<InstanceRuntimeState[]>([]);

  useEffect(() => {
    let active = true;
    const poll = () => {
      window.playwrightFlowStudio.executions
        .list()
        .then((list) => {
          if (active) setInstances(list as InstanceRuntimeState[]);
        })
        .catch(() => undefined);
    };
    poll();
    const timer = window.setInterval(poll, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="page">
      <section className="work-panel">
        <div className="section-heading">
          <h1>Execution Monitor</h1>
          <span>{instances.length ? `${instances.length} instance(s)` : "No active runs"}</span>
        </div>

        <div className="monitor-grid">
          <section>
            <h2>Run Readiness</h2>
            <div className="empty-state">
              <ShieldCheck size={28} style={{ color: "#9fafc4" }} />
              <strong>No run in progress.</strong>
              <span>Start a workflow from the Workflow Builder or Run screen to see live validation here.</span>
            </div>
          </section>

          <section>
            <h2>Live Timeline</h2>
            {instances.length ? (
              <div className="timeline structured">
                {instances.map((instance) => (
                  <article className={instance.status} key={instance.instanceId}>
                    <Activity size={16} />
                    <div>
                      <strong>{instance.currentStep ?? instance.currentFlow ?? instance.instanceId}</strong>
                      <span>
                        {instance.executionId} / {instance.instanceId} / {instance.currentFlow ?? "—"}
                      </span>
                    </div>
                    <em>{instance.status}</em>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Activity size={28} style={{ color: "#9fafc4" }} />
                <strong>No execution activity yet.</strong>
                <span>Live instance status and step timeline will appear here during a run.</span>
              </div>
            )}
          </section>
        </div>
      </section>
    </section>
  );
}
