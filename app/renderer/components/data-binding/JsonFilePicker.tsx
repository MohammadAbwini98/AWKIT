import { FileJson } from "lucide-react";
import { useState } from "react";
import { SysButton, SysField } from "../system/SystemUI";

interface JsonFilePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  wide?: boolean;
  invalid?: boolean;
}

export function JsonFilePicker({ value, onChange, label = "JSON file", hint, wide, invalid }: JsonFilePickerProps) {
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
    <SysField label={label} hint={error || hint} invalid={Boolean(error) || invalid} wide={wide}>
      <span className="sys-file-row">
        <input className="sys-control is-mono" value={value} onChange={(event) => onChange(event.target.value)} />
        <SysButton kind="small" icon={FileJson} onClick={() => void browse()}>
          Browse
        </SysButton>
      </span>
    </SysField>
  );
}
