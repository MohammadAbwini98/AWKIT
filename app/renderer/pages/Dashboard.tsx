import { Boxes, Database, FileBarChart, ListChecks, MonitorDot } from "lucide-react";
import { getNextRoadmapPhase, getRoadmapSummary } from "@src/roadmap/ImplementationRoadmap";
import { MetricCard } from "../components/shared/MetricCard";

export function Dashboard() {
  const roadmapSummary = getRoadmapSummary();
  const nextRoadmapPhase = getNextRoadmapPhase();

  return (
    <section className="page">
      <div className="page-grid metrics-grid">
        <MetricCard label="Flows" value="3" detail="Reusable automation profile templates" icon={<Boxes size={22} />} />
        <MetricCard label="Data Sources" value="2" detail="JSON and runtime input binding modes" icon={<Database size={22} />} />
        <MetricCard label="Instances" value="5" detail="Target isolated browser contexts" icon={<MonitorDot size={22} />} />
        <MetricCard label="Reports" value="1" detail="Concurrent run report model" icon={<FileBarChart size={22} />} />
      </div>
      <div className="dashboard-panels">
        <section className="work-panel">
          <div className="section-heading">
            <h1>Run Readiness</h1>
            <span>Desktop foundation</span>
          </div>
          <div className="readiness-list">
            <span>Electron shell</span>
            <strong>Online</strong>
            <span>Runtime folders</span>
            <strong>Created under user profile</strong>
            <span>IPC bridge</span>
            <strong>Connected</strong>
            <span>Offline validator</span>
            <strong>Available</strong>
          </div>
        </section>

        <section className="work-panel dashboard-roadmap-panel">
          <div className="section-heading">
            <h1>Roadmap</h1>
            <span>Phase 10 tracker</span>
          </div>
          <div className="dashboard-roadmap-summary">
            <ListChecks size={20} />
            <div>
              <span>Completed phases</span>
              <strong>
                {roadmapSummary.complete}/{roadmapSummary.total}
              </strong>
            </div>
            <div>
              <span>Completion</span>
              <strong>{roadmapSummary.completionPercent}%</strong>
            </div>
          </div>
          <div className="readiness-list dashboard-roadmap-next">
            <span>Current focus</span>
            <strong>{nextRoadmapPhase ? `Phase ${nextRoadmapPhase.id}: ${nextRoadmapPhase.title}` : "Roadmap complete"}</strong>
            <span>Remaining state</span>
            <strong>
              {roadmapSummary.inProgress} in progress, {roadmapSummary.pending} pending
            </strong>
          </div>
        </section>
      </div>
    </section>
  );
}
