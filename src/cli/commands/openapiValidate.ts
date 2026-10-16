import { createOpenApiValidateCommand } from "@getstrata/cli/openapi";
import { bootstrapFixtureRoutes } from "./registerOpenApiRoutes";

const openapiValidateCommand = createOpenApiValidateCommand(bootstrapFixtureRoutes);

export { openapiValidateCommand };
