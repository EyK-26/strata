import type { AuthUser } from "@getstrata/core/auth/authContext";
import {
  hasVerifiedEmail,
  isEmailVerificationRequired,
} from "@getstrata/core/auth/emailVerification";
import type { AuthManager } from "@getstrata/core/auth/guard";
import { createMembershipMiddleware } from "@getstrata/core/auth/membershipMiddleware";
import type { Policy, PolicyGate } from "@getstrata/core/auth/policy";
import { resolveAbilityChecker } from "@getstrata/core/contracts/serviceTokens";
import { createAuthMiddleware } from "@getstrata/core/http/authMiddleware";
import { createAuthorizeMiddleware } from "@getstrata/core/http/authorizeMiddleware";
import { createBodySizeLimitMiddleware } from "@getstrata/core/http/bodySizeLimitMiddleware";
import { createCorsMiddleware } from "@getstrata/core/http/corsMiddleware";
import { createCsrfMiddleware } from "@getstrata/core/http/csrfMiddleware";
import { createFlashMiddleware } from "@getstrata/core/http/flashMiddleware";
import { createLoginThrottleMiddleware } from "@getstrata/core/http/loginThrottleMiddleware";
import { createMemoryThrottleMiddleware } from "@getstrata/core/http/memoryThrottleMiddleware";
import { createMetricsMiddleware } from "@getstrata/core/http/metricsMiddleware";
import type { Middleware, RouteHandler } from "@getstrata/core/http/middleware";
import { requestIdMiddleware } from "@getstrata/core/http/middleware";
import { createRequireAbilityMiddleware } from "@getstrata/core/http/requireAbilityMiddleware";
import { createRequireAuthMiddleware } from "@getstrata/core/http/requireAuthMiddleware";
import { createRequireGlobalAdminMiddleware } from "@getstrata/core/http/requireGlobalAdminMiddleware";
import { createRequirePasswordConfirmMiddleware } from "@getstrata/core/http/requirePasswordConfirmMiddleware";
import { createRequireVerifiedMiddleware } from "@getstrata/core/http/requireVerifiedMiddleware";
import { createRequireWebAuthMiddleware } from "@getstrata/core/http/requireWebAuthMiddleware";
import {
  createJsonErrorMiddleware,
  createWebErrorMiddleware,
  withErrorHandling,
  withJsonErrorHandling,
} from "@getstrata/core/http/response";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import { createSecurityHeadersMiddleware } from "@getstrata/core/http/securityHeadersMiddleware";
import { createValidateSignatureMiddleware } from "@getstrata/core/http/signedUrl";
import { createThrottleMiddleware } from "@getstrata/core/http/throttleMiddleware";
import { createRequestLoggingMiddleware } from "@getstrata/core/logging/requestLoggingMiddleware";
import { isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import { isPublicReadsEnabled } from "@getstrata/core/security/publicReads";
import { createTenantMiddleware } from "@getstrata/core/tenant/tenantMiddleware";
import { createTracingMiddleware } from "@getstrata/core/tracing/tracingMiddleware";
import {
  CORE_AUTH_TOKEN,
  CORE_CONFIG_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  REDIS_URL_CONFIG_KEY,
} from "./config";
import type { AppDependencies, ConfigStore } from "./contracts";
import { resolveLoginRateLimit, resolveRegisterRateLimit } from "./rateLimit";

type MiddlewareGroupName = "api" | "authenticated" | "web";
type WebGuestHome = string | ((user: AuthUser) => string | Promise<string>);

class HttpKernel {
  constructor(private readonly dependencies: AppDependencies) {}

  globalMiddleware(errorFormat: "json" | "web" = "json"): Middleware[] {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);

    return [
      createCorsMiddleware(),
      createSecurityHeadersMiddleware(),
      createBodySizeLimitMiddleware(),
      createTracingMiddleware(),
      createMetricsMiddleware(),
      createRequestLoggingMiddleware(),
      requestIdMiddleware,
      // Commit and deferred listeners finish inside this boundary, before telemetry records the result.
      errorFormat === "json" ? createJsonErrorMiddleware() : createWebErrorMiddleware(),
      createAuthMiddleware(auth),
      createMembershipMiddleware(),
      createTenantMiddleware(),
    ];
  }

  group(name: MiddlewareGroupName): Middleware[] {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);

    switch (name) {
      case "authenticated":
        return [createRequireAuthMiddleware(auth)];
      case "web":
        return isViewsEnabled() ? [createFlashMiddleware(), createCsrfMiddleware()] : [];
      case "api": {
        const csrf = createCsrfMiddleware();

        if (!this.dependencies.container.has(CORE_CONFIG_TOKEN)) {
          return [csrf];
        }

        const config = this.dependencies.container.resolve<ConfigStore>(CORE_CONFIG_TOKEN);
        const redisUrl = config.get<string>(REDIS_URL_CONFIG_KEY)?.trim() ?? "";

        if (!redisUrl) {
          const maxAttempts = Number(process.env.RATE_LIMIT_PER_MINUTE ?? "120");

          return [
            createMemoryThrottleMiddleware({
              maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : 120,
              decaySeconds: 60,
            }),
            csrf,
          ];
        }

        const maxAttempts = Number(process.env.RATE_LIMIT_PER_MINUTE ?? "120");

        return [
          createThrottleMiddleware({
            redisUrl,
            maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : 120,
            decaySeconds: 60,
          }),
          csrf,
        ];
      }
      default:
        throw new Error(`Unknown middleware group "${name}".`);
    }
  }

  wrap<TRequest extends Request = Request>(
    groups: MiddlewareGroupName | MiddlewareGroupName[],
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    const names = Array.isArray(groups) ? groups : [groups];
    const middleware = names.flatMap((name) => this.group(name));
    const wrapped = middleware.length === 0 ? handler : withMiddleware(...middleware)(handler);

    if (names.includes("api")) {
      return withJsonErrorHandling(wrapped);
    }

    return wrapped;
  }

  wrapApi<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    return this.wrap(["api", "authenticated"], handler);
  }

  wrapWeb<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    return withErrorHandling(this.wrap("web", handler));
  }

  /** Signed-in HTML users redirect to `home` instead of seeing guest pages. */
  wrapWebGuest<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
    home: WebGuestHome = "/",
  ): RouteHandler<TRequest> {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);

    return this.wrapWeb<TRequest>(async (request) => {
      const user = await auth.resolve(request);

      if (user) {
        if (isEmailVerificationRequired() && !hasVerifiedEmail(user)) {
          return Response.redirect("/email/verify", 302);
        }

        const location = typeof home === "function" ? await home(user) : home;
        return Response.redirect(location, 302);
      }

      return handler(request);
    });
  }

  wrapWebPublicRead<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    if (isPublicReadsEnabled()) {
      return this.wrapWeb(handler);
    }

    return this.wrapWebAuthenticated(handler);
  }

  wrapWebAuthenticated<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    return this.wrapWebAuth(handler, { verified: true });
  }

  /** Signed-in HTML without the email-verified gate (logout, verification notice). */
  wrapWebAuthenticatedAllowUnverified<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    return this.wrapWebAuth(handler, { verified: false });
  }

  wrapWebVerified<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    return this.wrapWebAuth(handler, { verified: true });
  }

  /** Requires a fresh signed password-confirmation cookie. */
  wrapWebPasswordConfirm<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    return this.wrapWebAuth(withMiddleware(createRequirePasswordConfirmMiddleware())(handler), {
      verified: true,
    });
  }

  wrapWebAbility<TRequest extends Request = Request>(
    ability: string,
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);
    const abilityChecker = resolveAbilityChecker(this.dependencies.container);
    const requireAbility = createRequireAbilityMiddleware(abilityChecker);
    const middleware = [
      createRequireWebAuthMiddleware(auth),
      ...this.verifiedMiddleware(),
      requireAbility(ability),
    ];

    return this.wrapWeb(withMiddleware(...middleware)(handler));
  }

  wrapWebGlobalAdmin<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);
    const middleware = [
      createRequireWebAuthMiddleware(auth),
      ...this.verifiedMiddleware(),
      createRequireGlobalAdminMiddleware(),
    ];

    return this.wrapWeb(withMiddleware(...middleware)(handler));
  }

  wrapAuthenticated<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    return this.wrap("authenticated", handler);
  }

  /** JSON routes that require a verified email. No-op when `FEATURE_EMAIL_VERIFICATION` is off. */
  wrapVerified<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    const middleware = [...this.group("authenticated"), ...this.verifiedMiddleware()];

    return withMiddleware(...middleware)(handler);
  }

  wrapPublicRead<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    if (isPublicReadsEnabled()) {
      return handler;
    }

    return this.wrapAuthenticated(handler);
  }

  wrapGlobalAdmin<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    const middleware = [...this.group("authenticated"), createRequireGlobalAdminMiddleware()];

    return withMiddleware(...middleware)(handler);
  }

  wrapAbility<TRequest extends Request = Request>(
    ability: string,
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    const abilityChecker = resolveAbilityChecker(this.dependencies.container);
    const requireAbility = createRequireAbilityMiddleware(abilityChecker);
    const middleware = [...this.group("authenticated"), requireAbility(ability)];

    return withMiddleware(...middleware)(handler);
  }

  wrapPolicy<TRequest extends Request = Request>(
    resource: string,
    action: keyof Policy,
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);
    const gate = this.dependencies.container.resolve<PolicyGate>(CORE_POLICY_GATE_TOKEN);

    return withMiddleware(createAuthorizeMiddleware(gate, auth, resource, action))(handler);
  }

  wrapLogin<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    return this.wrapThrottle("login", resolveLoginRateLimit(), handler);
  }

  wrapSigned<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    return withMiddleware(createValidateSignatureMiddleware())(handler);
  }

  wrapRegister<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    return this.wrapThrottle("register", resolveRegisterRateLimit(), handler);
  }

  private wrapWebAuth<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
    options: { verified: boolean },
  ): RouteHandler<TRequest> {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);
    const middleware = [
      createRequireWebAuthMiddleware(auth),
      ...(options.verified ? this.verifiedMiddleware() : []),
    ];

    return this.wrapWeb(withMiddleware(...middleware)(handler));
  }

  private verifiedMiddleware(): Middleware[] {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);
    return [createRequireVerifiedMiddleware(auth)];
  }

  private wrapThrottle<TRequest extends Request = Request>(
    scope: "login" | "register",
    rateLimit: { maxAttempts: number; decaySeconds: number },
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    const memoryKeyPrefix = scope === "login" ? "login-throttle:" : "register-throttle:";
    const redisUrl = this.dependencies.container.has(CORE_CONFIG_TOKEN)
      ? (this.dependencies.container
          .resolve<ConfigStore>(CORE_CONFIG_TOKEN)
          .get<string>(REDIS_URL_CONFIG_KEY)
          ?.trim() ?? "")
      : "";

    if (scope === "login") {
      return withMiddleware(
        createLoginThrottleMiddleware({
          ...(redisUrl ? { redisUrl } : {}),
          maxAttempts: rateLimit.maxAttempts,
          decaySeconds: rateLimit.decaySeconds,
        }),
      )(handler);
    }

    if (redisUrl) {
      return withMiddleware(
        createThrottleMiddleware({
          redisUrl,
          maxAttempts: rateLimit.maxAttempts,
          decaySeconds: rateLimit.decaySeconds,
          keyPrefix: memoryKeyPrefix,
        }),
      )(handler);
    }

    return withMiddleware(
      createMemoryThrottleMiddleware({
        maxAttempts: rateLimit.maxAttempts,
        decaySeconds: rateLimit.decaySeconds,
        keyPrefix: memoryKeyPrefix,
      }),
    )(handler);
  }
}

function createHttpKernel(dependencies: AppDependencies): HttpKernel {
  return new HttpKernel(dependencies);
}

export type { MiddlewareGroupName, WebGuestHome };
export { createHttpKernel, HttpKernel };
