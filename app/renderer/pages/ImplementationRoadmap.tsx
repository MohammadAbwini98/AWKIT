import { CheckCircle2, Circle, Clock3, ListChecks, TriangleAlert } from "lucide-react";
import {
  formatRoadmapStatus,
  getNextRoadmapPhase,
  getRoadmapSummary,
  implementationRoadmap,
  type RoadmapStatus
} from "@src/roadmap/ImplementationRoadmap";

const statusIcons: Record<RoadmapStatus, typeof CheckCircle2> = {
  complete: CheckCircle2,
  "in-progress": Clock3,
  pending: Circle,
  blocked: TriangleAlert
};

export function ImplementationRoadmap() {
  const summary = getRoadmapSummary();
  const nextPhase = getNextRoadmapPhase();

  return (
    <section className="page roadmap-page">
      <section className="work-panel">
        <div className="section-heading">
          <h1>Implementation Roadmap</h1>
          <span>Phase 10 project tracker</span>
        </div>

        <div className="roadmap-summary-grid">
          <article>
            <ListChecks size={18} />
            <span>Completed phases</span>
            <strong>
              {summary.complete}/{summary.total}
            </strong>
          </article>
          <article>
            <Clock3 size={18} />
            <span>In progress</span>
            <strong>{summary.inProgress}</strong>
          </article>
          <article>
            <Circle size={18} />
            <span>Pending</span>
            <strong>{summary.pending}</strong>
          </article>
          <article>
            <CheckCircle2 size={18} />
            <span>Completion</span>
            <strong>{summary.completionPercent}%</strong>
          </article>
        </div>

        <section className="roadmap-next-panel">
          <div>
            <span>Current focus</span>
            <strong>{nextPhase ? `Phase ${nextPhase.id}: ${nextPhase.title}` : "Roadmap complete"}</strong>
          </div>
          <p>{nextPhase?.implementationNote ?? "All planned phases are currently complete."}</p>
        </section>

        <div className="roadmap-grid">
          {implementationRoadmap.map((phase) => {
            const Icon = statusIcons[phase.status];
            return (
              <article className={`roadmap-card ${phase.status}`} key={phase.id}>
                <div className="roadmap-card-header">
                  <span className="roadmap-phase-id">Phase {phase.id}</span>
                  <span className={`roadmap-status ${phase.status}`}>
                    <Icon size={15} />
                    {formatRoadmapStatus(phase.status)}
                  </span>
                </div>
                <h2>{phase.title}</h2>
                <p>{phase.implementationNote}</p>
                <div className="roadmap-deliverables">
                  {phase.deliverables.map((deliverable) => (
                    <span key={deliverable}>{deliverable}</span>
                  ))}
                </div>
                <div className="roadmap-acceptance">
                  <span>Acceptance</span>
                  <strong>{phase.acceptance}</strong>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}
