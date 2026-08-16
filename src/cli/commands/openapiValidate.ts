import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { createAppContext } from "../../bootstrap/context";
import { createRoutes } from "../../bootstrap/createRoutes";
import { generateOpenApiSpec } from "../../core/openapi/generator";
import { validateOpenApiSpec } from "../../core/openapi/validate";

async function openapiValidateCommand(): Promise<void> {
  const { dependencies } = createAppContext();
  createRoutes(dependencies);

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
