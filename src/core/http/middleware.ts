type Middleware = (
  request: Request,
  next: () => Promise<Response>,
) => Promise<Response>;

type RouteHandler = (request: Request) => Response | Promise<Response>;

function isRouteHandler(value: unknown): value is RouteHandler {
  return typeof value === "function";
}

function isMethodRouteMap(
  value: unknown,
): value is Record<string, RouteHandler> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);

  return (
    entries.length > 0 &&
    entries.every(([, handler]) => isRouteHandler(handler))
  );
}

function composeMiddleware(...middleware: Middleware[]) {
  return (handler: RouteHandler): RouteHandler => {
    return async (request: Request) => {
      let index = 0;

      const dispatch = async (): Promise<Response> => {
        if (index >= middleware.length) {
          return await handler(request);
        }

        const current = middleware[index];
        index += 1;

        if (!current) {
          return await handler(request);
        }

        return await current(request, dispatch);
      };

      return await dispatch();
    };
  };
}

async function requestIdMiddleware(
  request: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function wrapRouteHandler<T>(handler: T, middleware: Middleware[]): T {
  if (isMethodRouteMap(handler)) {
    const wrapped: Record<string, RouteHandler> = {};

    for (const [method, routeHandler] of Object.entries(handler)) {
      wrapped[method] = composeMiddleware(...middleware)(routeHandler);
    }

    return wrapped as T;
  }

  if (isRouteHandler(handler)) {
    return composeMiddleware(...middleware)(handler) as T;
  }

  return handler;
}

function applyMiddlewareToRoutes<T extends Record<string, unknown>>(
  routes: T,
  middleware: Middleware[],
): T {
  const wrapped: Record<string, unknown> = {};

  for (const [path, routeHandler] of Object.entries(routes)) {
    wrapped[path] = wrapRouteHandler(routeHandler, middleware);
  }

  return wrapped as T;
}

export {
  applyMiddlewareToRoutes,
  composeMiddleware,
  requestIdMiddleware,
  wrapRouteHandler,
};
export type { Middleware, RouteHandler };
