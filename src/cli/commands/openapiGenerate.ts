import { createOpenApiGenerateCommand } from "@getstrata/cli/openapi";
import { bootstrapMonorepoOpenApiRoutes } from "./openApiBootstrap.ts";

const openapiGenerateCommand = createOpenApiGenerateCommand(bootstrapMonorepoOpenApiRoutes);

export { openapiGenerateCommand };
