import { CheckSquare, Circle, FileUp, ListChecks, TextCursorInput } from "lucide-react";
import { useState } from "react";
import { DesignerCanvasLayout } from "../layout/DesignerCanvasLayout";

const fieldTypes = [
  { label: "Text Input", icon: TextCursorInput },
  { label: "Dropdown", icon: ListChecks },
  { label: "Checkbox", icon: CheckSquare },
  { label: "Radio Group", icon: Circle },
  { label: "File Upload", icon: FileUp }
];

export function FormDesigner() {
  const [dataFile, setDataFile] = useState("customers.json");
  const [status, setStatus] = useState("");

  const browseDataFile = async () => {
    try {
      const result = (await window.playwrightFlowStudio.dataSources.browseJson()) as
        | { canceled: true }
        | { canceled: false; profile: { name: string; file: string } };
      if (result.canceled) return;
      setDataFile(result.profile.file);
      setStatus(`Loaded ${result.profile.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load file");
    }
  };

  return (
    <DesignerCanvasLayout propertiesTitle="Field Configuration">
      <div className="form-designer">
        <aside className="node-palette">
          <h2>Fields</h2>
          {fieldTypes.map((field) => {
            const Icon = field.icon;
            return (
              <button
                key={field.label}
                disabled
                title="Field builder is a preview. Configure inputs on the Runtime Inputs page."
                type="button"
              >
                <Icon size={15} />
                {field.label}
              </button>
            );
          })}
        </aside>
        <div className="form-canvas">
          <section className="form-section">
            <div className="form-section-title">
              <strong>Customer Onboarding Inputs</strong>
              <span>Section</span>
            </div>
            <label>
              Customer Data File
              <div className="file-input-row">
                <input value={dataFile} onChange={(event) => setDataFile(event.target.value)} />
                <button onClick={browseDataFile} type="button">
                  Browse
                </button>
              </div>
            </label>
            {status ? <span className="form-message">{status}</span> : null}
            <label>
              Account Type
              <select defaultValue="BUSINESS">
                <option value="BUSINESS">Business</option>
                <option value="PERSONAL">Personal</option>
                <option value="CORPORATE">Corporate</option>
              </select>
            </label>
            <div className="choice-row">
              <label className="inline-check">
                <input type="checkbox" defaultChecked />
                Retry failed rows
              </label>
              <label className="inline-check">
                <input type="radio" name="windowMode" defaultChecked />
                Headless
              </label>
              <label className="inline-check">
                <input type="radio" name="windowMode" />
                Headed
              </label>
            </div>
          </section>
          <section className="drop-zone">
            <strong>Field builder preview</strong>
            <span>Runtime fields are configured on the Runtime Inputs page.</span>
          </section>
        </div>
      </div>
    </DesignerCanvasLayout>
  );
}
