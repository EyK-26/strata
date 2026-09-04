import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { generateOpenApiSpec } from "../../core/openapi/generator";
import { validateOpenApiSpec } from "../../core/openapi/validate";
import { registerOpenApiRoutes } from "./registerOpenApiRoutes";

async function openapiValidateCommand(): Promise<void> {
  await registerOpenApiRoutes();

  const spec = generateOpenApiSpec(routeRegistry.list());
  const errors = validateOpenApiSpec(spec);

  if (errors.length > 0) {
    console.error("OpenAPI validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`OpenAPI spec valid (${routeRegistry.list().length} routes).`);
}

export { openapiValidateCommand };
