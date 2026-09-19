import { registerAppOpenApiRoutes } from "@getstrata/cli/openapi";
import { bootstrapMonorepoOpenApiRoutes } from "./openApiBootstrap.ts";

async function registerOpenApiRoutes(): Promise<void> {
  await registerAppOpenApiRoutes(bootstrapMonorepoOpenApiRoutes);
}

export { registerOpenApiRoutes };
