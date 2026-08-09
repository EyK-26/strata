import type { AuthManager } from "../core/auth/guard";
import { createAuthMiddleware } from "../core/http/authMiddleware";
import { type Middleware, requestIdMiddleware } from "../core/http/middleware";
import { CORE_AUTH_TOKEN } from "./config";
import type { AppDependencies } from "./contracts";

function createDefaultMiddleware(dependencies: AppDependencies): Middleware[] {
  const auth = dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);

  return [requestIdMiddleware, createAuthMiddleware(auth)];
}

export { createDefaultMiddleware };
