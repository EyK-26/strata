import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { generateOpenApiSpec, renderOpenApiDocument } from "../../core/openapi/generator";
import { validateOpenApiSpec } from "../../core/openapi/validate";
import { registerOpenApiRoutes } from "./registerOpenApiRoutes";

async function openapiCheckCommand(): Promise<void> {
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

  const jsonPath = join(process.cwd(), "docs/openapi.json");
  const committed = await readFile(jsonPath, "utf8");
  const generated = renderOpenApiDocument(spec);

  if (committed !== generated) {
    console.error("OpenAPI spec drift detected.");
    console.error("Run `strata openapi:generate` and commit docs/openapi.json.");
    process.exit(1);
  }

  console.log(`OpenAPI spec matches committed file (${routeRegistry.list().length} routes).`);
}

export { openapiCheckCommand };
