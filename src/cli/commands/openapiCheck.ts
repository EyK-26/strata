import { createOpenApiCheckCommand } from "@getstrata/cli/openapi";
import { bootstrapFixtureRoutes } from "./registerOpenApiRoutes";

const openapiCheckCommand = createOpenApiCheckCommand(bootstrapFixtureRoutes);

export { openapiCheckCommand };
