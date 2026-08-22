import type { RouteHandler } from "@getstrata/core/http/middleware";
import { withErrorHandling } from "@getstrata/core/http/response";
import type { RouteRequest } from "@getstrata/core/http/route";
import type { AppDependencies } from "../contracts.ts";
import { securedBindRouteModelByKey } from "../http/securedRouteModelBinding.ts";
import type { HttpKernel } from "../httpKernel.ts";
import { createHttpKernel } from "../httpKernel.ts";

/** Read Bun native `:param` values from a route handler request. */
export function routeParams(request: Request): Record<string, string> {
  const normalized: Record<string, string> = {};
  const raw = (request as Request & { params?: Record<string, string> }).params;

  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      normalized[key] = decodeURIComponent(String(value));
    }
  }

  return normalized;
}

/**
 * Attach decoded route params to Bun's native Request for RouteRequest handlers.
 * Mutates the request in place so instanceof Request and Bun internals stay valid.
 */
export function toRouteRequest<TParams extends Record<string, string>>(
  request: Request,
): RouteRequest<TParams> {
  const params = routeParams(request) as TParams;
  Object.defineProperty(request, "params", {
    value: params,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return request as RouteRequest<TParams>;
}

/** Laravel-style secured route-model binding for string keys (slugs, UUIDs). */
export function wrapSecuredRouteModelByKey<
  TParams extends Record<string, string>,
  TModel,
  TParam extends keyof TParams & string,
>(
  param: TParam,
  resolver: (key: string, request: RouteRequest<TParams>) => Promise<TModel>,
  authorization: { resource: string; action: "view" | "create" | "update" | "delete" },
  handler: (request: RouteRequest<TParams>, model: TModel) => Response | Promise<Response>,
): RouteHandler {
  const bound = withErrorHandling(
    securedBindRouteModelByKey(param, resolver, authorization, handler),
  );

  return async (request) => bound(toRouteRequest<TParams>(request));
}

/** Web group (CSRF + flash + HTML errors) plus login throttle. Do not wrap with wrapWeb again. */
export function wrapWebLogin(
  kernel: HttpKernel,
  handler: RouteHandler,
  onThrottled: (request: Request) => Response | Promise<Response>,
): RouteHandler {
  return kernel.wrapWeb(wrapWebThrottle(kernel, "login", handler, onThrottled));
}

/** Web group (CSRF + flash + HTML errors) plus register throttle. Do not wrap with wrapWeb again. */
export function wrapWebRegister(
  kernel: HttpKernel,
  handler: RouteHandler,
  onThrottled: (request: Request) => Response | Promise<Response>,
): RouteHandler {
  return kernel.wrapWeb(wrapWebThrottle(kernel, "register", handler, onThrottled));
}

function wrapWebThrottle(
  kernel: HttpKernel,
  scope: "login" | "register",
  handler: RouteHandler,
  onThrottled: (request: Request) => Response | Promise<Response>,
): RouteHandler {
  const throttled = scope === "login" ? kernel.wrapLogin(handler) : kernel.wrapRegister(handler);

  return async (request) => {
    const response = await throttled(request);
    if (response.status === 429) {
      return onThrottled(request);
    }
    return response;
  };
}

/** Convenience alias: HttpKernel is the Laravel-style router middleware wrapper. */
export function createRouteKernel(dependencies: AppDependencies): HttpKernel {
  return createHttpKernel(dependencies);
}
