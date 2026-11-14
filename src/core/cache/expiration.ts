/** null explicitly means forever; undefined selects the configured default. */
export function resolveCacheTtl(ttlMs: unknown, defaultTtlMs: number | null): number | null {
  const resolved = ttlMs === undefined ? defaultTtlMs : ttlMs;
  if (resolved !== null && (typeof resolved !== "number" || !Number.isSafeInteger(resolved))) {
    throw new RangeError(
      "ttlMs must be a safe integer number of milliseconds, or null for forever.",
    );
  }
  return resolved;
}
