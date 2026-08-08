import type { AppDependencies } from "./contracts";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "./config";
import type { RouteMiddlewareGroup } from "../core/http/routeMiddlewareGroups";
import type { AuthManager } from "../core/auth/guard";
import type { Policy, PolicyGate } from "../core/auth/policy";
import { createAuthorizeMiddleware } from "../core/http/authorizeMiddleware";
import { createRequireAuthMiddleware } from "../core/http/requireAuthMiddleware";

function createRouteMiddleware(dependencies: AppDependencies): RouteMiddlewareGroup {
  const auth = dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);
  const gate = dependencies.container.resolve<PolicyGate>(CORE_POLICY_GATE_TOKEN);

  return {
    auth: createRequireAuthMiddleware(auth),
    can: (resource: string, action: keyof Policy) =>
      createAuthorizeMiddleware(gate, auth, resource, action),
  };
}

export { createRouteMiddleware };
