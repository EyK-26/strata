import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import { createHttpKernel, type HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { CORE_AUTH_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { ValidationError } from "@getstrata/core/errors/http";
import { createAuthMiddleware } from "@getstrata/core/http/authMiddleware";
import { createCsrfMiddleware } from "@getstrata/core/http/csrfMiddleware";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { jsonResponse, withErrorHandling } from "@getstrata/core/http/response";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";

function formatJsonError(error: unknown) {
  if (error instanceof ValidationError) {
    return jsonResponse(
      {
        message: error.message,
        errors: error.details ?? {},
      },
      { status: 422 },
    );
  }

  return null;
}

export function wrapJson(handler: RouteHandler): RouteHandler {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      const formatted = formatJsonError(error);
      if (formatted) {
        return formatted;
      }
      return withErrorHandling(async () => {
        throw error;
      })(request);
    }
  };
}

function csrfWhenNeeded(): ReturnType<typeof createCsrfMiddleware>[] {
  return [createCsrfMiddleware()];
}

export function createKernel(dependencies: AppDependencies): HttpKernel {
  return createHttpKernel(dependencies);
}

export function wrapApi(dependencies: AppDependencies, handler: RouteHandler): RouteHandler {
  const kernel = createKernel(dependencies);
  const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);
  return withMiddleware(
    ...csrfWhenNeeded(),
    createAuthMiddleware(auth),
    ...kernel.group("api"),
    ...kernel.group("authenticated"),
  )(wrapJson(handler));
}

export function wrapGuestApi(dependencies: AppDependencies, handler: RouteHandler): RouteHandler {
  const kernel = createKernel(dependencies);
  const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);
  return withMiddleware(
    ...csrfWhenNeeded(),
    createAuthMiddleware(auth),
    ...kernel.group("api"),
  )(wrapJson(handler));
}

export function wrapWeb(dependencies: AppDependencies, handler: RouteHandler): RouteHandler {
  const kernel = createKernel(dependencies);
  const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);
  return withMiddleware(createAuthMiddleware(auth))(kernel.wrapWeb(handler));
}

export function wrapWebGuest(dependencies: AppDependencies, handler: RouteHandler): RouteHandler {
  const kernel = createKernel(dependencies);
  return kernel.wrapWebGuest(handler);
}

export function wrapWebAuthenticated(
  dependencies: AppDependencies,
  handler: RouteHandler,
): RouteHandler {
  const kernel = createKernel(dependencies);
  const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);
  return withMiddleware(createAuthMiddleware(auth))(kernel.wrapWebAuthenticated(handler));
}

export function wrapSpaDocument(handler: RouteHandler): RouteHandler {
  if (isViewsEnabled()) {
    return handler;
  }
  return withMiddleware(...csrfWhenNeeded())(handler);
}
