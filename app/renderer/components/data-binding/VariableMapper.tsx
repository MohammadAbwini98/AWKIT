interface VariableMapperProps {
  mappings: Array<{ source: string; target: string }>;
}

export function VariableMapper({ mappings }: VariableMapperProps) {
  return (
    <div className="variable-mapper">
      {mappings.map((mapping) => (
        <article key={`${mapping.source}-${mapping.target}`}>
          <strong>{mapping.source}</strong>
          <span>{mapping.target}</span>
        </article>
      ))}
    </div>
  );
}
