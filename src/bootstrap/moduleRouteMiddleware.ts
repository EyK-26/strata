import { applyMiddlewareToRoutes, type Middleware } from "@getstrata/core/http/middleware";

function wrapCallback(path: string, callback: unknown, middleware: Middleware[]): unknown {
  return applyMiddlewareToRoutes({ [path]: callback }, middleware)[path];
}

/** Module callbacks must receive middleware even when inert fields share their method map. */
function applyModuleRouteMiddleware(
  routes: Record<string, unknown>,
  middleware: Middleware[],
): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(routes)) {
    if (value instanceof Response) {
      const methods: Record<string, unknown> = {};
      for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
        methods[method] = wrapCallback(path, () => value.clone(), middleware);
      }
      wrapped[path] = methods;
      continue;
    }
    if (typeof value === "function") {
      wrapped[path] = wrapCallback(path, value, middleware);
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
              typeof callback === "function" ? wrapCallback(path, callback, middleware) : callback,
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

export { applyModuleRouteMiddleware };
