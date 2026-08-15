import { createAuthMiddleware, type Middleware, requestIdMiddleware } from "@getstrata/core";
import type { AuthManager } from "@getstrata/core/auth/guard";
import { CORE_AUTH_TOKEN } from "./config";
import type { AppDependencies } from "./contracts";

function createDefaultMiddleware(dependencies: AppDependencies): Middleware[] {
  const auth = dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);

  return [requestIdMiddleware, createAuthMiddleware(auth)];
}

export { createDefaultMiddleware };
