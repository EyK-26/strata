import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import { createHttpKernel, type HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { CookieSessionAuthManager } from "@getstrata/bootstrap/web/session";
import { createScimAuthMiddleware } from "@getstrata/core/auth/scimAuthMiddleware";
import { createTokenAbilityChecker } from "@getstrata/core/auth/tokenAbilityChecker";
import { CORE_AUTH_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { ValidationError } from "@getstrata/core/errors/http";
import { createAuthMiddleware } from "@getstrata/core/http/authMiddleware";
import { createCsrfMiddleware } from "@getstrata/core/http/csrfMiddleware";
import { createLoginThrottleMiddleware } from "@getstrata/core/http/loginThrottleMiddleware";
import type { Middleware, RouteHandler } from "@getstrata/core/http/middleware";
import { createRequireAbilityMiddleware } from "@getstrata/core/http/requireAbilityMiddleware";
import { createRequireAuthMiddleware } from "@getstrata/core/http/requireAuthMiddleware";
import { createRequirePasswordConfirmMiddleware } from "@getstrata/core/http/requirePasswordConfirmMiddleware";
import { createRequireVerifiedMiddleware } from "@getstrata/core/http/requireVerifiedMiddleware";
import { createRequireWebAuthMiddleware } from "@getstrata/core/http/requireWebAuthMiddleware";
import { jsonResponse, withErrorHandling } from "@getstrata/core/http/response";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import { createScimThrottleMiddleware } from "@getstrata/core/http/scimThrottleMiddleware";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import { createTenantMiddleware } from "@getstrata/core/tenant/tenantMiddleware";
import { authManager } from "./currentUser.ts";

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

function loginThrottle(): ReturnType<typeof createLoginThrottleMiddleware>[] {
  const production = process.env.APP_ENV === "production";
  const maxAttempts = Number(process.env.LOGIN_RATE_LIMIT_PER_WINDOW ?? (production ? "5" : "100"));
  const decaySeconds = Number(
    process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS ?? (production ? "900" : "60"),
  );
  return [
    createLoginThrottleMiddleware({
      redisUrl: process.env.REDIS_URL?.trim() || undefined,
      maxAttempts: Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 100,
      decaySeconds: Number.isInteger(decaySeconds) && decaySeconds > 0 ? decaySeconds : 60,
    }),
  ];
}

function touchCookieSession(): Middleware {
  return async (request, next) => {
    try {
      const auth = authManager() as CookieSessionAuthManager;
      const sessionId = auth.store.sessionIdFromRequest(request);
      if (sessionId) {
        await auth.store.touch(sessionId);
      }
    } catch {
      // Guest paths and boot can run before the HTTP container is bound.
    }
    return next();
  };
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
    touchCookieSession(),
    ...kernel.group("authenticated"),
    createTenantMiddleware(),
    ...kernel.group("api"),
  )(wrapJson(handler));
}

export function wrapGuestApi(dependencies: AppDependencies, handler: RouteHandler): RouteHandler {
  const kernel = createKernel(dependencies);
  const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);
  return withMiddleware(
    ...csrfWhenNeeded(),
    createAuthMiddleware(auth),
    createTenantMiddleware(),
    ...kernel.group("api"),
  )(wrapJson(handler));
}

export function wrapLoginApi(dependencies: AppDependencies, handler: RouteHandler): RouteHandler {
  return withMiddleware(...loginThrottle())(wrapGuestApi(dependencies, handler));
}

export function wrapTokenApi(dependencies: AppDependencies, handler: RouteHandler): RouteHandler {
  const kernel = createKernel(dependencies);
  const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);
  return withMiddleware(
    ...loginThrottle(),
    createAuthMiddleware(auth),
    createTenantMiddleware(),
    ...kernel.group("api"),
  )(wrapJson(handler));
}

export function wrapWeb(dependencies: AppDependencies, handler: RouteHandler): RouteHandler {
  const kernel = createKernel(dependencies);
  const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);
  return withMiddleware(
    createAuthMiddleware(auth),
    createTenantMiddleware(),
  )(kernel.wrapWeb(handler));
}

export function wrapWebGuest(dependencies: AppDependencies, handler: RouteHandler): RouteHandler {
  const kernel = createKernel(dependencies);
  const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);
  return withMiddleware(
    createAuthMiddleware(auth),
    createTenantMiddleware(),
  )(kernel.wrapWebGuest(handler));
}

export function wrapLoginWeb(dependencies: AppDependencies, handler: RouteHandler): RouteHandler {
  return withMiddleware(...loginThrottle())(wrapWebGuest(dependencies, handler));
}

export function wrapWebAuthenticated(
  dependencies: AppDependencies,
  handler: RouteHandler,
): RouteHandler {
  const kernel = createKernel(dependencies);
  const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);
  return withMiddleware(
    createAuthMiddleware(auth),
    touchCookieSession(),
    createRequireWebAuthMiddleware(auth),
    createRequireVerifiedMiddleware(auth),
    createTenantMiddleware(),
  )(kernel.wrapWeb(handler));
}

export function wrapWebUnverified(
  dependencies: AppDependencies,
  handler: RouteHandler,
): RouteHandler {
  const kernel = createKernel(dependencies);
  const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);
  return withMiddleware(
    createAuthMiddleware(auth),
    touchCookieSession(),
    createRequireWebAuthMiddleware(auth),
    createTenantMiddleware(),
  )(kernel.wrapWeb(handler));
}

export function wrapPartnerApi(
  dependencies: AppDependencies,
  ability: string,
  handler: RouteHandler,
): RouteHandler {
  const kernel = createKernel(dependencies);
  const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);
  return withMiddleware(
    createAuthMiddleware(auth),
    createRequireAuthMiddleware(auth),
    createRequireAbilityMiddleware(createTokenAbilityChecker())(ability),
    createTenantMiddleware(),
    ...kernel.group("api"),
  )(wrapJson(handler));
}

export function wrapWebPasswordConfirm(
  dependencies: AppDependencies,
  handler: RouteHandler,
): RouteHandler {
  const kernel = createKernel(dependencies);
  const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);
  return withMiddleware(
    createAuthMiddleware(auth),
    touchCookieSession(),
    createRequireWebAuthMiddleware(auth),
    createRequireVerifiedMiddleware(auth),
    createRequirePasswordConfirmMiddleware(),
    createTenantMiddleware(),
  )(kernel.wrapWeb(handler));
}

export function wrapSpaDocument(handler: RouteHandler): RouteHandler {
  if (isViewsEnabled()) {
    return handler;
  }
  return withMiddleware(...csrfWhenNeeded())(handler);
}

export function wrapScim(handler: RouteHandler): RouteHandler {
  const redisUrl = process.env.REDIS_URL?.trim() ?? "";
  return withMiddleware(
    createScimThrottleMiddleware({
      redisUrl: redisUrl || undefined,
      maxAttempts: Number(process.env.SCIM_RATE_LIMIT_PER_MINUTE ?? "60"),
      decaySeconds: 60,
    }),
    createScimAuthMiddleware(),
  )(wrapJson(handler));
}

export function wrapPublic(handler: RouteHandler): RouteHandler {
  return wrapJson(handler);
}
