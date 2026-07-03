import { FileJson } from "lucide-react";
import { useState } from "react";

interface JsonFilePickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function JsonFilePicker({ value, onChange }: JsonFilePickerProps) {
  const [error, setError] = useState("");

  const browse = async () => {
    setError("");
    try {
      const result = (await window.playwrightFlowStudio.dataSources.browseJson()) as
        | { canceled: true }
        | { canceled: false; profile: { file: string } };
      if (!result.canceled) onChange(result.profile.file);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid JSON file");
    }
  };

  return (
    <label>
      JSON File
      <div className="file-input-row">
        <FileJson size={16} />
        <input value={value} onChange={(event) => onChange(event.target.value)} />
        <button onClick={browse} type="button">
          Browse
        </button>
      </div>
      {error ? <span className="form-message error">{error}</span> : null}
    </label>
  );
}
