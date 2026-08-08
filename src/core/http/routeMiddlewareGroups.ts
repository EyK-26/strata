import type { Policy } from "../auth/policy";
import { withMiddleware } from "./routeMiddleware";
import type { Middleware, RouteHandler } from "./middleware";

interface RouteMiddlewareGroup {
  auth: Middleware;
  can(resource: string, action: keyof Policy): Middleware;
}

function parseRouteMiddlewareName(
  middleware: RouteMiddlewareGroup,
  name: string,
): Middleware {
  if (name === "auth") {
    return middleware.auth;
  }

  const policyMatch = /^can:([^,]+),(.+)$/.exec(name);

  if (policyMatch) {
    const action = policyMatch[1];
    const resource = policyMatch[2];

    if (!action || !resource) {
      throw new Error(`Invalid policy middleware "${name}".`);
    }

    return middleware.can(resource.trim(), action.trim() as keyof Policy);
  }

  throw new Error(`Unknown route middleware "${name}".`);
}

function resolveRouteMiddleware(
  middleware: RouteMiddlewareGroup,
  names: readonly string[],
): Middleware[] {
  return names.map((name) => parseRouteMiddlewareName(middleware, name));
}

function applyRouteMiddleware(
  middleware: RouteMiddlewareGroup,
  names: readonly string[],
  handler: RouteHandler,
): RouteHandler {
  return withMiddleware(...resolveRouteMiddleware(middleware, names))(handler);
}

export {
  applyRouteMiddleware,
  parseRouteMiddlewareName,
  resolveRouteMiddleware,
};
export type { RouteMiddlewareGroup };
