import type { AppDependencies } from "./contracts";
import {
  CORE_AUTH_TOKEN,
  CORE_CONFIG_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  REDIS_URL_CONFIG_KEY,
} from "./config";
import type { ConfigStore } from "./contracts";
import { createAuthMiddleware } from "../core/http/authMiddleware";
import { createRequireAuthMiddleware } from "../core/http/requireAuthMiddleware";
import { createAuthorizeMiddleware } from "../core/http/authorizeMiddleware";
import { createThrottleMiddleware } from "../core/http/throttleMiddleware";
import { withMiddleware } from "../core/http/routeMiddleware";
import {
  requestIdMiddleware,
  type Middleware,
  type RouteHandler,
} from "../core/http/middleware";
import { createRequestLoggingMiddleware } from "../core/logging/requestLoggingMiddleware";
import { createCorsMiddleware } from "../core/http/corsMiddleware";
import { createSecurityHeadersMiddleware } from "../core/http/securityHeadersMiddleware";
import { createMetricsMiddleware } from "../core/http/metricsMiddleware";
import { createRequireAbilityMiddleware } from "../core/http/requireAbilityMiddleware";
import type { AuthManager } from "../core/auth/guard";
import type { Policy, PolicyGate } from "../core/auth/policy";
import { tokenServiceToken } from "../modules/user/provider";
import type TokenService from "../modules/user/tokenService";

type MiddlewareGroupName = "api" | "authenticated";

class HttpKernel {
  constructor(private readonly dependencies: AppDependencies) {}

  globalMiddleware(): Middleware[] {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);

    return [
      createCorsMiddleware(),
      createSecurityHeadersMiddleware(),
      createMetricsMiddleware(),
      createRequestLoggingMiddleware(),
      requestIdMiddleware,
      createAuthMiddleware(auth),
    ];
  }

  group(name: MiddlewareGroupName): Middleware[] {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);

    switch (name) {
      case "authenticated":
        return [createRequireAuthMiddleware(auth)];
      case "api": {
        if (!this.dependencies.container.has(CORE_CONFIG_TOKEN)) {
          return [];
        }

        const config =
          this.dependencies.container.resolve<ConfigStore>(CORE_CONFIG_TOKEN);
        const redisUrl = config.get<string>(REDIS_URL_CONFIG_KEY)?.trim() ?? "";

        if (!redisUrl) {
          return [];
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

  wrap(
    groups: MiddlewareGroupName | MiddlewareGroupName[],
    handler: RouteHandler,
  ): RouteHandler {
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

  wrapAuthenticated(handler: RouteHandler): RouteHandler {
    return this.wrap("authenticated", handler);
  }

  wrapAbility(ability: string, handler: RouteHandler): RouteHandler {
    const tokenService =
      this.dependencies.container.resolve<TokenService>(tokenServiceToken);
    const requireAbility = createRequireAbilityMiddleware(tokenService);
    const middleware = [
      ...this.group("authenticated"),
      requireAbility(ability),
    ];

    return withMiddleware(...middleware)(handler);
  }

  wrapPolicy(
    resource: string,
    action: keyof Policy,
    handler: RouteHandler,
  ): RouteHandler {
    const auth = this.dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);
    const gate =
      this.dependencies.container.resolve<PolicyGate>(CORE_POLICY_GATE_TOKEN);

    return withMiddleware(createAuthorizeMiddleware(gate, auth, resource, action))(
      handler,
    );
  }
}

function createHttpKernel(dependencies: AppDependencies): HttpKernel {
  return new HttpKernel(dependencies);
}

export { HttpKernel, createHttpKernel };
export type { MiddlewareGroupName };
