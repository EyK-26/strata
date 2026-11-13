type ModuleCallback = (...args: never[]) => unknown;

/** All three internal issuers provide the owned entry adapter; inert/native values stay intact. */
function enterModuleRoutes(
  routes: Record<string, unknown>,
  enter: (callback: ModuleCallback) => unknown,
): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(routes)) {
    if (value instanceof Response) {
      const methods: Record<string, unknown> = {};
      for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
        methods[method] = enter(() => value.clone());
      }
      wrapped[path] = methods;
      continue;
    }
    if (typeof value === "function") {
      wrapped[path] = enter(value as ModuleCallback);
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value);
      if (
        entries.some(([, handler]) => typeof handler === "function" || handler instanceof Response)
      ) {
        wrapped[path] = Object.fromEntries(
          entries.map(([method, handler]) => {
            const callback = handler instanceof Response ? () => handler.clone() : handler;
            return [
              method,
              typeof callback === "function" ? enter(callback as ModuleCallback) : callback,
            ];
          }),
        );
        continue;
      }
    }
    // Opaque native SDK values (files, HTML bundles and directory options) retain identity.
    wrapped[path] = value;
  }
  return wrapped;
}

export { enterModuleRoutes };
