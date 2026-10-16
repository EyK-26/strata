import { createOpenApiGenerateCommand } from "@getstrata/cli/openapi";
import { bootstrapFixtureRoutes } from "./registerOpenApiRoutes";

const openapiGenerateCommand = createOpenApiGenerateCommand(bootstrapFixtureRoutes);

export { openapiGenerateCommand };
