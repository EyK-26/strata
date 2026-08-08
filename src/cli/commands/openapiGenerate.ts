import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAppContext } from "../../bootstrap/context";
import { createRoutes } from "../../bootstrap/createRoutes";
import { routeRegistry } from "../../bootstrap/routeRegistry";
import {
  generateOpenApiSpec,
  renderOpenApiDocument,
} from "../../core/openapi/generator";

async function openapiGenerateCommand(): Promise<void> {
  const { dependencies } = createAppContext();
  createRoutes(dependencies);

  const spec = generateOpenApiSpec(routeRegistry.list());
  const jsonPath = join(process.cwd(), "docs/openapi.json");
  await writeFile(jsonPath, renderOpenApiDocument(spec), "utf8");

  console.log(`OpenAPI spec written to ${jsonPath} (${routeRegistry.list().length} routes).`);
}

export { openapiGenerateCommand };
