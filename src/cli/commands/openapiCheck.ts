import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createAppContext } from "../../bootstrap/context";
import { createRoutes } from "../../bootstrap/createRoutes";
import { routeRegistry } from "../../bootstrap/routeRegistry";
import { generateOpenApiSpec, renderOpenApiDocument } from "../../core/openapi/generator";
import { validateOpenApiSpec } from "../../core/openapi/validate";

async function openapiCheckCommand(): Promise<void> {
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

  const jsonPath = join(process.cwd(), "docs/openapi.json");
  const committed = await readFile(jsonPath, "utf8");
  const generated = renderOpenApiDocument(spec);

  if (committed !== generated) {
    console.error("OpenAPI spec drift detected.");
    console.error("Run `bun run cli openapi:generate` and commit docs/openapi.json.");
    process.exit(1);
  }

  console.log(`OpenAPI spec matches committed file (${routeRegistry.list().length} routes).`);
}

export { openapiCheckCommand };
