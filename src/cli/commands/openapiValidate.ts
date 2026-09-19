import { createOpenApiValidateCommand } from "@getstrata/cli/openapi";
import { bootstrapMonorepoOpenApiRoutes } from "./openApiBootstrap.ts";

const openapiValidateCommand = createOpenApiValidateCommand(bootstrapMonorepoOpenApiRoutes);

export { openapiValidateCommand };
