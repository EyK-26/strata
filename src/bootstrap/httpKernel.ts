import { isViewsEnabled } from "../config/frontend";
import { resolveLoginRateLimit, resolveRegisterRateLimit } from "../config/rateLimit";
import type { AbilityChecker } from "../core/auth/abilityChecker";
import type { AuthManager } from "../core/auth/guard";
import { createMembershipMiddleware } from "../core/auth/membershipMiddleware";
import type { Policy, PolicyGate } from "../core/auth/policy";
import { createAuthMiddleware } from "../core/http/authMiddleware";
import { createAuthorizeMiddleware } from "../core/http/authorizeMiddleware";
import { createBodySizeLimitMiddleware } from "../core/http/bodySizeLimitMiddleware";
import { createCorsMiddleware } from "../core/http/corsMiddleware";
import { createCsrfMiddleware } from "../core/http/csrfMiddleware";
import { createFlashMiddleware } from "../core/http/flashMiddleware";
import { createLoginThrottleMiddleware } from "../core/http/loginThrottleMiddleware";
import { createMemoryThrottleMiddleware } from "../core/http/memoryThrottleMiddleware";
import { createMetricsMiddleware } from "../core/http/metricsMiddleware";
import { type Middleware, type RouteHandler, requestIdMiddleware } from "../core/http/middleware";
import { createRequireAbilityMiddleware } from "../core/http/requireAbilityMiddleware";
import { createRequireAuthMiddleware } from "../core/http/requireAuthMiddleware";
import { createRequireGlobalAdminMiddleware } from "../core/http/requireGlobalAdminMiddleware";
import { createRequireWebAuthMiddleware } from "../core/http/requireWebAuthMiddleware";
import { withMiddleware } from "../core/http/routeMiddleware";
import { createSecurityHeadersMiddleware } from "../core/http/securityHeadersMiddleware";
import { createThrottleMiddleware } from "../core/http/throttleMiddleware";
import { createRequestLoggingMiddleware } from "../core/logging/requestLoggingMiddleware";
import { isPublicReadsEnabled } from "../core/security/publicReads";
import { createTenantMiddleware } from "../core/tenant/tenantMiddleware";
import { createTracingMiddleware } from "../core/tracing/tracingMiddleware";
import {
  CORE_AUTH_TOKEN,
  CORE_CONFIG_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_TOKEN_SERVICE_TOKEN,
  REDIS_URL_CONFIG_KEY,
} from "./config";
import type { AppDependencies, ConfigStore } from "./contracts";

type MiddlewareGroupName = "api" | "authenticated" | "web";

class HttpKernel {
  constructor(private readonly dependencies: AppDependencies) {}

  globalMiddleware(): Middleware[] {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);

    return [
      createCorsMiddleware(),
      createSecurityHeadersMiddleware(),
      createBodySizeLimitMiddleware(),
      createTracingMiddleware(),
      createMetricsMiddleware(),
      createRequestLoggingMiddleware(),
      requestIdMiddleware,
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
        if (!this.dependencies.container.has(CORE_CONFIG_TOKEN)) {
          return [];
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
          ];
        }

        const maxAttempts = Number(process.env.RATE_LIMIT_PER_MINUTE ?? "120");

        return [
          createThrottleMiddleware({
            redisUrl,
            maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : 120,
            decaySeconds: 60,
          }),
        ];
      }
      default:
        throw new Error(`Unknown middleware group "${name}".`);
    }
  }

  wrap(groups: MiddlewareGroupName | MiddlewareGroupName[], handler: RouteHandler): RouteHandler {
    const names = Array.isArray(groups) ? groups : [groups];
    const middleware = names.flatMap((name) => this.group(name));

    if (middleware.length === 0) {
      return handler;
    }

    return withMiddleware(...middleware)(handler);
  }

  wrapApi(handler: RouteHandler): RouteHandler {
    return this.wrap(["api", "authenticated"], handler);
  }

  wrapWeb(handler: RouteHandler): RouteHandler {
    return handler;
  }

  wrapWebPublicRead(handler: RouteHandler): RouteHandler {
    if (isPublicReadsEnabled()) {
      return this.wrapWeb(handler);
    }

    return this.wrapWebAuthenticated(handler);
  }

  wrapWebAuthenticated(handler: RouteHandler): RouteHandler {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);

    return withMiddleware(createRequireWebAuthMiddleware(auth))(handler);
  }

  wrapWebAbility(ability: string, handler: RouteHandler): RouteHandler {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);
    const abilityChecker =
      this.dependencies.container.resolve<AbilityChecker>(CORE_TOKEN_SERVICE_TOKEN);
    const requireAbility = createRequireAbilityMiddleware(abilityChecker);
    const middleware = [createRequireWebAuthMiddleware(auth), requireAbility(ability)];

    return withMiddleware(...middleware)(handler);
  }

  wrapWebGlobalAdmin(handler: RouteHandler): RouteHandler {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);
    const middleware = [createRequireWebAuthMiddleware(auth), createRequireGlobalAdminMiddleware()];

    return withMiddleware(...middleware)(handler);
  }

  wrapAuthenticated(handler: RouteHandler): RouteHandler {
    return this.wrap("authenticated", handler);
  }

  wrapPublicRead(handler: RouteHandler): RouteHandler {
    if (isPublicReadsEnabled()) {
      return handler;
    }

    return this.wrapAuthenticated(handler);
  }

  wrapGlobalAdmin(handler: RouteHandler): RouteHandler {
    const middleware = [...this.group("authenticated"), createRequireGlobalAdminMiddleware()];

    return withMiddleware(...middleware)(handler);
  }

  wrapAbility(ability: string, handler: RouteHandler): RouteHandler {
    const abilityChecker =
      this.dependencies.container.resolve<AbilityChecker>(CORE_TOKEN_SERVICE_TOKEN);
    const requireAbility = createRequireAbilityMiddleware(abilityChecker);
    const middleware = [...this.group("authenticated"), requireAbility(ability)];

    return withMiddleware(...middleware)(handler);
  }

  wrapPolicy(resource: string, action: keyof Policy, handler: RouteHandler): RouteHandler {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);
    const gate = this.dependencies.container.resolve<PolicyGate>(CORE_POLICY_GATE_TOKEN);

    return withMiddleware(createAuthorizeMiddleware(gate, auth, resource, action))(handler);
  }

  wrapLogin(handler: RouteHandler): RouteHandler {
    return this.wrapThrottle("login", resolveLoginRateLimit(), handler);
  }

  wrapRegister(handler: RouteHandler): RouteHandler {
    return this.wrapThrottle("register", resolveRegisterRateLimit(), handler);
  }

  private wrapThrottle(
    scope: "login" | "register",
    rateLimit: { maxAttempts: number; decaySeconds: number },
    handler: RouteHandler,
  ): RouteHandler {
    const middleware: Middleware[] = [];
    const memoryKeyPrefix = scope === "login" ? "login-throttle:" : "register-throttle:";

    if (this.dependencies.container.has(CORE_CONFIG_TOKEN)) {
      const config = this.dependencies.container.resolve<ConfigStore>(CORE_CONFIG_TOKEN);
      const redisUrl = config.get<string>(REDIS_URL_CONFIG_KEY)?.trim() ?? "";

      if (redisUrl) {
        const throttle =
          scope === "login"
            ? createLoginThrottleMiddleware({
                redisUrl,
                maxAttempts: rateLimit.maxAttempts,
                decaySeconds: rateLimit.decaySeconds,
              })
            : createThrottleMiddleware({
                redisUrl,
                maxAttempts: rateLimit.maxAttempts,
                decaySeconds: rateLimit.decaySeconds,
                keyPrefix: memoryKeyPrefix,
              });

        middleware.push(throttle);
      } else {
        middleware.push(
          createMemoryThrottleMiddleware({
            maxAttempts: rateLimit.maxAttempts,
            decaySeconds: rateLimit.decaySeconds,
            keyPrefix: memoryKeyPrefix,
          }),
        );
      }
    } else {
      middleware.push(
        createMemoryThrottleMiddleware({
          maxAttempts: rateLimit.maxAttempts,
          decaySeconds: rateLimit.decaySeconds,
          keyPrefix: memoryKeyPrefix,
        }),
      );
    }

    if (middleware.length === 0) {
      return handler;
    }

    return withMiddleware(...middleware)(handler);
  }
}

function createHttpKernel(dependencies: AppDependencies): HttpKernel {
  return new HttpKernel(dependencies);
}

export type { MiddlewareGroupName };
export { createHttpKernel, HttpKernel };
