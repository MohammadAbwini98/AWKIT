import { SysField, SysSelect } from "../system/SystemUI";

interface JsonPathPickerProps {
  value: string;
  paths: string[];
  onChange: (value: string) => void;
}

export function JsonPathPicker({ value, paths, onChange }: JsonPathPickerProps) {
  return (
    <SysField label="JSON path" hint="JSON path selecting the bound value">
      <SysSelect className="is-mono" value={value} onChange={(event) => onChange(event.target.value)}>
        {paths.map((path) => (
          <option key={path} value={path}>
            {path}
          </option>
        ))}
      </SysSelect>
    </SysField>
  );
}
