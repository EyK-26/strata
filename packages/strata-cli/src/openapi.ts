import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  compileRouteMap,
  getRouteInventory,
  type RegisteredRoute,
} from "@getstrata/bootstrap/routePlan";
import {
  generateOpenApiSpec,
  type OpenApiConfig,
  renderOpenApiDocument,
  resolveOpenApiConfig,
} from "@getstrata/core/openapi/generator";
import { validateOpenApiSpec } from "@getstrata/core/openapi/validate";
import { readSpaPrefix } from "@getstrata/core/runtime/frontendMode";

import { withCommandCleanup } from "./commandCleanup.ts";

type AppCleanup = () => void | Promise<void>;
type AppBootstrap = () => Promise<{ routes: Record<string, unknown> }>;

function isSpaDocumentedPath(path: string, spaPrefix: string): boolean {
  return path === "/*" || path === spaPrefix || path.startsWith(`${spaPrefix}/`);
}

function isWebOnlyPath(metadata: readonly RegisteredRoute[]): boolean {
  return (
    metadata.some((route) => route.middleware.includes("web")) &&
    !metadata.some((route) => route.middleware.includes("api"))
  );
}

function shouldKeepOpenApiPath(
  path: string,
  registered: readonly RegisteredRoute[],
  spaPrefix: string,
): boolean {
  if (isSpaDocumentedPath(path, spaPrefix)) {
    return false;
  }

  const metadata = registered.filter((route) => route.path === path);
  return !isWebOnlyPath(metadata);
}

async function registerAppOpenApiRoutes(
  bootstrap: AppBootstrap,
  spaPrefix = "/app",
): Promise<readonly RegisteredRoute[]> {
  const { routes } = await bootstrap();
  const registered = getRouteInventory(compileRouteMap(routes));
  return Object.freeze(
    registered.filter((route) => shouldKeepOpenApiPath(route.path, registered, spaPrefix)),
  );
}

function createOpenApiCommand(
  bootstrap: AppBootstrap,
  operation: (routes: readonly RegisteredRoute[]) => Promise<number | undefined>,
  close: AppCleanup | undefined,
  spaPrefix: string,
) {
  return async (): Promise<void> => {
    const exitCode = await withCommandCleanup(async () => {
      const routes = await registerAppOpenApiRoutes(bootstrap, spaPrefix);
      return operation(routes);
    }, close);
    if (exitCode === 1) process.exit(1);
  };
}

function createOpenApiGenerateCommand(
  bootstrap: AppBootstrap,
  close?: AppCleanup,
  config: OpenApiConfig = resolveOpenApiConfig(process.env),
  spaPrefix = readSpaPrefix(),
) {
  config = Object.freeze({ ...config });
  return createOpenApiCommand(
    bootstrap,
    async (routes) => {
      const spec = generateOpenApiSpec(routes, config);
      const jsonPath = join(process.cwd(), "docs/openapi.json");
      await mkdir(dirname(jsonPath), { recursive: true });
      await writeFile(jsonPath, renderOpenApiDocument(spec), "utf8");

      console.log(`OpenAPI spec written to ${jsonPath} (${routes.length} routes).`);
      return undefined;
    },
    close,
    spaPrefix,
  );
}

function createOpenApiValidateCommand(
  bootstrap: AppBootstrap,
  close?: AppCleanup,
  config: OpenApiConfig = resolveOpenApiConfig(process.env),
  spaPrefix = readSpaPrefix(),
) {
  config = Object.freeze({ ...config });
  return createOpenApiCommand(
    bootstrap,
    async (routes) => {
      const spec = generateOpenApiSpec(routes, config);
      const errors = validateOpenApiSpec(spec);

      if (errors.length > 0) {
        console.error("OpenAPI validation failed:");
        for (const error of errors) {
          console.error(`- ${error}`);
        }
        return 1;
      }

      console.log(`OpenAPI spec valid (${routes.length} routes).`);
      return undefined;
    },
    close,
    spaPrefix,
  );
}

function createOpenApiCheckCommand(
  bootstrap: AppBootstrap,
  close?: AppCleanup,
  config: OpenApiConfig = resolveOpenApiConfig(process.env),
  spaPrefix = readSpaPrefix(),
) {
  config = Object.freeze({ ...config });
  return createOpenApiCommand(
    bootstrap,
    async (routes) => {
      const spec = generateOpenApiSpec(routes, config);
      const errors = validateOpenApiSpec(spec);

      if (errors.length > 0) {
        console.error("OpenAPI validation failed:");
        for (const error of errors) {
          console.error(`- ${error}`);
        }
        return 1;
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
        return 1;
      }

      console.log(`OpenAPI spec matches committed file (${routes.length} routes).`);
      return undefined;
    },
    close,
    spaPrefix,
  );
}

export type { AppBootstrap, AppCleanup };
export {
  createOpenApiCheckCommand,
  createOpenApiGenerateCommand,
  createOpenApiValidateCommand,
  registerAppOpenApiRoutes,
};
