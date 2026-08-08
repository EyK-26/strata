import type { AppDependencies } from "./contracts";
import { CORE_AUTH_TOKEN } from "./config";
import { createAuthMiddleware } from "../core/http/authMiddleware";
import {
  requestIdMiddleware,
  type Middleware,
} from "../core/http/middleware";
import type { AuthManager } from "../core/auth/guard";

function createDefaultMiddleware(dependencies: AppDependencies): Middleware[] {
  const auth = dependencies.container.resolve<AuthManager>(CORE_AUTH_TOKEN);

  return [requestIdMiddleware, createAuthMiddleware(auth)];
}

export { createDefaultMiddleware };
