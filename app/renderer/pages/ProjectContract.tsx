import { Boxes, FileCheck2, Layers3, ShieldCheck } from "lucide-react";
import { projectContract } from "@src/project/ProjectContract";

export function ProjectContract() {
  return (
    <section className="page contract-page">
      <section className="work-panel">
        <div className="section-heading">
          <h1>Project Contract</h1>
          <span>{projectContract.source}</span>
        </div>

        <section className="contract-overview">
          <article>
            <FileCheck2 size={20} />
            <div>
              <span>Application</span>
              <strong>{projectContract.appName}</strong>
            </div>
          </article>
          <article>
            <ShieldCheck size={20} />
            <div>
              <span>Production mode</span>
              <strong>Offline Windows desktop</strong>
            </div>
          </article>
          <article>
            <Layers3 size={20} />
            <div>
              <span>Architecture modules</span>
              <strong>{projectContract.architectureModules.length}</strong>
            </div>
          </article>
          <article>
            <Boxes size={20} />
            <div>
              <span>Implementation phases</span>
              <strong>{projectContract.phases.length}</strong>
            </div>
          </article>
        </section>

        <section className="contract-goal">
          <span>Main Goal</span>
          <strong>{projectContract.goal}</strong>
        </section>

        <div className="contract-grid">
          <section className="contract-card">
            <h2>Technology Stack</h2>
            <div className="contract-chip-grid">
              {projectContract.stack.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>

          <section className="contract-card">
            <h2>Production Requirements</h2>
            <ul className="contract-list">
              {projectContract.productionRequirements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="contract-card">
            <h2>Safety Rules</h2>
            <ul className="contract-list">
              {projectContract.safetyRules.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="contract-card">
            <h2>Architecture Modules</h2>
            <div className="contract-chip-grid compact">
              {projectContract.architectureModules.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>
        </div>

        <section className="contract-capabilities">
          {projectContract.capabilitySections.map((section) => (
            <article className="contract-card" key={section.title}>
              <h2>{section.title}</h2>
              <div className="contract-items">
                {section.items.map((item) => (
                  <div key={item.title}>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>

        <section className="contract-card contract-phases">
          <h2>Implementation Phases</h2>
          <div className="contract-phase-list">
            {projectContract.phases.map((phase) => (
              <article key={phase.order}>
                <span>{phase.order}</span>
                <div>
                  <strong>{phase.title}</strong>
                  <small>{phase.target}</small>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </section>
  );
}
