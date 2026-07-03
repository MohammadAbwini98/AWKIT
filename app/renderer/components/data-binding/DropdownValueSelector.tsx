interface DropdownValueSelectorProps {
  mode: "value" | "label" | "index";
  onModeChange: (mode: "value" | "label" | "index") => void;
}

export function DropdownValueSelector({ mode, onModeChange }: DropdownValueSelectorProps) {
  return (
    <label>
      Dropdown Selection Mode
      <select value={mode} onChange={(event) => onModeChange(event.target.value as "value" | "label" | "index")}>
        <option value="value">By value</option>
        <option value="label">By label</option>
        <option value="index">By index</option>
      </select>
    </label>
  );
}
