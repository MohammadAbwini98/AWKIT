import { SysField, SysSelect } from "../system/SystemUI";

interface DropdownValueSelectorProps {
  mode: "value" | "label" | "index";
  onModeChange: (mode: "value" | "label" | "index") => void;
}

export function DropdownValueSelector({ mode, onModeChange }: DropdownValueSelectorProps) {
  return (
    <SysField label="Dropdown selection mode" hint="How a dropdown value resolves at run time">
      <SysSelect value={mode} onChange={(event) => onModeChange(event.target.value as "value" | "label" | "index")}>
        <option value="value">By value</option>
        <option value="label">By label</option>
        <option value="index">By index</option>
      </SysSelect>
    </SysField>
  );
}
