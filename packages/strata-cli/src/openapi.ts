import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { registerOpenApiRouteMap } from "@getstrata/bootstrap/buildModuleRoutes";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { generateOpenApiSpec, renderOpenApiDocument } from "@getstrata/core/openapi/generator";
import { validateOpenApiSpec } from "@getstrata/core/openapi/validate";

type AppBootstrap = () => Promise<{ routes: Record<string, unknown> }>;

function withoutSpaCatchAll(routes: Record<string, unknown>): Record<string, unknown> {
  const next = { ...routes };
  delete next["/*"];
  return next;
}

async function registerAppOpenApiRoutes(bootstrap: AppBootstrap): Promise<void> {
  const { routes } = await bootstrap();
  routeRegistry.clear();
  registerOpenApiRouteMap(withoutSpaCatchAll(routes), ["global", "api"]);
}

function createOpenApiGenerateCommand(bootstrap: AppBootstrap) {
  return async function openapiGenerateCommand(): Promise<void> {
    await registerAppOpenApiRoutes(bootstrap);

    const spec = generateOpenApiSpec(routeRegistry.list());
    const jsonPath = join(process.cwd(), "docs/openapi.json");
    await mkdir(dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, renderOpenApiDocument(spec), "utf8");

    console.log(`OpenAPI spec written to ${jsonPath} (${routeRegistry.list().length} routes).`);
  };
}

function createOpenApiValidateCommand(bootstrap: AppBootstrap) {
  return async function openapiValidateCommand(): Promise<void> {
    await registerAppOpenApiRoutes(bootstrap);

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
  };
}

function createOpenApiCheckCommand(bootstrap: AppBootstrap) {
  return async function openapiCheckCommand(): Promise<void> {
    await registerAppOpenApiRoutes(bootstrap);

    const spec = generateOpenApiSpec(routeRegistry.list());
    const errors = validateOpenApiSpec(spec);

    if (errors.length > 0) {
      console.error("OpenAPI validation failed:");
      for (const error of errors) {
        console.error(`- ${error}`);
      }
      process.exit(1);
    }

    const generated = renderOpenApiDocument(spec);
    const jsonPath = join(process.cwd(), "docs/openapi.json");
    const committed = await readFile(jsonPath, "utf8");

    if (committed !== generated) {
      console.error("OpenAPI spec drift detected.");
      console.error("Run `strata openapi:generate` and commit docs/openapi.json.");
      console.error(
        "Add that generate step next to `strata openapi:check` in CI so new routes cannot ship undocumented.",
      );
      process.exit(1);
    }

    console.log(`OpenAPI spec matches committed file (${routeRegistry.list().length} routes).`);
  };
}

export type { AppBootstrap };
export {
  createOpenApiCheckCommand,
  createOpenApiGenerateCommand,
  createOpenApiValidateCommand,
  registerAppOpenApiRoutes,
};
