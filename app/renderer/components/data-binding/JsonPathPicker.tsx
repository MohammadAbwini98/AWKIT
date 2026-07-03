interface JsonPathPickerProps {
  value: string;
  paths: string[];
  onChange: (value: string) => void;
}

export function JsonPathPicker({ value, paths, onChange }: JsonPathPickerProps) {
  return (
    <label>
      JSON Path
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {paths.map((path) => (
          <option key={path} value={path}>
            {path}
          </option>
        ))}
      </select>
    </label>
  );
}
