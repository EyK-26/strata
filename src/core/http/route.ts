import type { RouteHandler } from "./middleware";

type ResourceMemberHandler = RouteHandler<RouteRequest<{ id: string }>>;
interface ResourceActions {
  index?: RouteHandler;
  create?: RouteHandler;
  store?: RouteHandler;
  show?: ResourceMemberHandler;
  edit?: ResourceMemberHandler;
  update?: ResourceMemberHandler;
  destroy?: ResourceMemberHandler;
}
type ResourceRouteMap<P extends string, A extends ResourceActions> = (A extends { index: infer H }
  ? { [K in P]: { GET: H } }
  : Record<never, never>) &
  (A extends { store: infer H } ? { [K in P]: { POST: H } } : Record<never, never>) &
  (A extends { create: infer H } ? { [K in `${P}/create`]: { GET: H } } : Record<never, never>) &
  (A extends { show: infer H } ? { [K in `${P}/:id`]: { GET: H } } : Record<never, never>) &
  (A extends { edit: infer H } ? { [K in `${P}/:id/edit`]: { GET: H } } : Record<never, never>) &
  (A extends { update: infer H }
    ? { [K in `${P}/:id`]: { PUT: H; PATCH: H } }
    : Record<never, never>) &
  (A extends { destroy: infer H } ? { [K in `${P}/:id`]: { DELETE: H } } : Record<never, never>);

/** Expand only explicitly supplied actions into native Bun routes. */
function resourceRoutes<const P extends string, const A extends ResourceActions>(
  path: P,
  actions: A & Record<Exclude<keyof A, keyof ResourceActions>, never>,
): ResourceRouteMap<P, A> {
  if (
    !/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new TypeError("Resource path must be a static absolute path without a trailing slash.");
  }
  const routes: Record<string, Record<string, RouteHandler | ResourceMemberHandler>> = {};
  const definitions = {
    index: [path, ["GET"]],
    create: [`${path}/create`, ["GET"]],
    store: [path, ["POST"]],
    show: [`${path}/:id`, ["GET"]],
    edit: [`${path}/:id/edit`, ["GET"]],
    update: [`${path}/:id`, ["PUT", "PATCH"]],
    destroy: [`${path}/:id`, ["DELETE"]],
  } as const;
  for (const [action, handler] of Object.entries(actions)) {
    if (!Object.hasOwn(definitions, action) || typeof handler !== "function") {
      throw new TypeError(`Invalid resource action: ${action}`);
    }
    const [route, methods] = definitions[action as keyof ResourceActions];
    const methodMap = routes[route] ?? {};
    routes[route] = methodMap;
    for (const method of methods)
      methodMap[method] = handler as RouteHandler | ResourceMemberHandler;
  }
  return routes as ResourceRouteMap<P, A>;
}

type Intersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;
/** Strict composition: duplicate paths fail rather than silently replacing handlers. */
function mergeRouteMaps<const T extends readonly Record<string, unknown>[]>(
  ...maps: T
): Intersection<T[number]> {
  const routes: Record<string, unknown> = {};
  for (const map of maps) {
    for (const [path, handler] of Object.entries(map)) {
      if (Object.hasOwn(routes, path)) throw new Error(`Duplicate route path: ${path}`);
      Object.defineProperty(routes, path, {
        value: handler,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return routes as Intersection<T[number]>;
}

export type { ResourceActions, ResourceMemberHandler, ResourceRouteMap };
export { mergeRouteMaps, resourceRoutes };

type RouteRequest<TParams extends Record<string, string>> = Request & {
  params: TParams;
};

function getRouteParams<TParams extends Record<string, string>>(
  request: RouteRequest<TParams>,
): TParams {
  return request.params;
}

export type { RouteRequest };
export { getRouteParams };
