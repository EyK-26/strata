/** Conservative install equivalence: only the generated root package name may differ. */
export function starterInstallIdentity(manifest: Readonly<Record<string, unknown>>): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  }
  const { name: _name, ...requirements } = manifest;
  return JSON.stringify(canonical(requirements));
}
