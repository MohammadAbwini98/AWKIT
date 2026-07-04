export function resolveJsonPath(source: unknown, path: string): unknown {
  if (!path || path === "$") return source;
  if (!path.startsWith("$.")) {
    throw new Error(`JSON path must start with $. Received: ${path}`);
  }

  const segments = tokenizePath(path);
  return segments.reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;

    if (typeof segment === "number") {
      return Array.isArray(current) ? current[segment] : undefined;
    }

    if (typeof current === "object") {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, source);
}

export function tokenizePath(path: string): Array<string | number> {
  const withoutRoot = path.replace(/^\$\./, "");
  const tokens: Array<string | number> = [];

  withoutRoot.split(".").forEach((part) => {
    const matches = [...part.matchAll(/([^\[\]]+)|\[(\d+)\]/g)];
    matches.forEach((match) => {
      if (match[1]) tokens.push(match[1]);
      if (match[2]) tokens.push(Number(match[2]));
    });
  });

  return tokens;
}

export function stringifyResolvedValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
