import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { generateOpenApiSpec, renderOpenApiDocument } from "../../core/openapi/generator";
import { registerOpenApiRoutes } from "./registerOpenApiRoutes";

async function openapiGenerateCommand(): Promise<void> {
  await registerOpenApiRoutes();

  const spec = generateOpenApiSpec(routeRegistry.list());
  const jsonPath = join(process.cwd(), "docs/openapi.json");
  await writeFile(jsonPath, renderOpenApiDocument(spec), "utf8");

  console.log(`OpenAPI spec written to ${jsonPath} (${routeRegistry.list().length} routes).`);
}

export { openapiGenerateCommand };
