/** Convert module responses before middleware; metadata and native transport stay separate. */
function normalizeModuleResponseRoutes(routes: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(routes)) {
    if (value instanceof Response) {
      const methods: Record<string, () => ReturnType<Response["clone"]>> = {};
      for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
        methods[method] = () => value.clone();
      }
      normalized[path] = methods;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      normalized[path] = Object.fromEntries(
        Object.entries(value).map(([method, handler]) => [
          method,
          handler instanceof Response ? () => handler.clone() : handler,
        ]),
      );
      continue;
    }
    normalized[path] = value;
  }
  return normalized;
}

export { normalizeModuleResponseRoutes };
