import { createAuthMiddleware } from "@getstrata/core/http/authMiddleware";
import { type Middleware, requestIdMiddleware } from "@getstrata/core/http/middleware";
import { CORE_AUTH_TOKEN } from "./config";
import type { AppDependencies } from "./contracts";

function createDefaultMiddleware(dependencies: AppDependencies): Middleware[] {
  const auth = dependencies.container.resolve(CORE_AUTH_TOKEN);

  return [requestIdMiddleware, createAuthMiddleware(auth)];
}

export { createDefaultMiddleware };
