import { createOpenApiCheckCommand } from "@getstrata/cli/openapi";
import { bootstrapMonorepoOpenApiRoutes } from "./openApiBootstrap.ts";

const openapiCheckCommand = createOpenApiCheckCommand(bootstrapMonorepoOpenApiRoutes);

export { openapiCheckCommand };
