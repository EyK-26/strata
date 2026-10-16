import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { registerOpenApiRouteMap } from "@getstrata/bootstrap/buildModuleRoutes";
import { type RegisteredRoute, routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { generateOpenApiSpec, renderOpenApiDocument } from "@getstrata/core/openapi/generator";
import { validateOpenApiSpec } from "@getstrata/core/openapi/validate";
import { readSpaPrefix } from "@getstrata/core/runtime/frontendMode";

import { withCommandCleanup } from "./commandCleanup.ts";

type AppCleanup = () => void | Promise<void>;
type AppBootstrap = () => Promise<{ routes: Record<string, unknown> }>;

function isSpaDocumentedPath(path: string, spaPrefix: string): boolean {
  return path === "/*" || path === spaPrefix || path.startsWith(`${spaPrefix}/`);
}

function isWebOnlyPath(metadata: RegisteredRoute[]): boolean {
  return (
    metadata.some((route) => route.middleware.includes("web")) &&
    !metadata.some((route) => route.middleware.includes("api"))
  );
}

function shouldKeepOpenApiPath(
  path: string,
  registered: RegisteredRoute[],
  spaPrefix: string,
): boolean {
  if (isSpaDocumentedPath(path, spaPrefix)) {
    return false;
  }

  const metadata = registered.filter((route) => route.path === path);
  return !isWebOnlyPath(metadata);
}

async function registerAppOpenApiRoutes(bootstrap: AppBootstrap): Promise<void> {
  routeRegistry.clear();
  const { routes } = await bootstrap();
  const registered = routeRegistry.list();
  const spaPrefix = readSpaPrefix();
  const keepPaths = new Set<string>();

  for (const path of Object.keys(routes)) {
    if (shouldKeepOpenApiPath(path, registered, spaPrefix)) {
      keepPaths.add(path);
    }
  }

  const keptRegistered = registered.filter((route) => keepPaths.has(route.path));
  const registeredKeepPaths = new Set(keptRegistered.map((route) => route.path));
  const unregisteredKeepers: Record<string, unknown> = {};

  for (const path of keepPaths) {
    if (!registeredKeepPaths.has(path)) {
      unregisteredKeepers[path] = routes[path];
    }
  }

  routeRegistry.clear();
  for (const route of keptRegistered) {
    routeRegistry.register(route);
  }
  registerOpenApiRouteMap(unregisteredKeepers, ["global", "api"]);
}

function createOpenApiCommand(
  bootstrap: AppBootstrap,
  operation: () => Promise<number | undefined>,
  close?: AppCleanup,
) {
  return async (): Promise<void> => {
    const exitCode = await withCommandCleanup(async () => {
      await registerAppOpenApiRoutes(bootstrap);
      return operation();
    }, close);
    if (exitCode === 1) process.exit(1);
  };
}

function createOpenApiGenerateCommand(bootstrap: AppBootstrap, close?: AppCleanup) {
  return createOpenApiCommand(
    bootstrap,
    async () => {
      const spec = generateOpenApiSpec(routeRegistry.list());
      const jsonPath = join(process.cwd(), "docs/openapi.json");
      await mkdir(dirname(jsonPath), { recursive: true });
      await writeFile(jsonPath, renderOpenApiDocument(spec), "utf8");

      console.log(`OpenAPI spec written to ${jsonPath} (${routeRegistry.list().length} routes).`);
      return undefined;
    },
    close,
  );
}

function createOpenApiValidateCommand(bootstrap: AppBootstrap, close?: AppCleanup) {
  return createOpenApiCommand(
    bootstrap,
    async () => {
      const spec = generateOpenApiSpec(routeRegistry.list());
      const errors = validateOpenApiSpec(spec);

      if (errors.length > 0) {
        console.error("OpenAPI validation failed:");
        for (const error of errors) {
          console.error(`- ${error}`);
        }
        return 1;
      }

      console.log(`OpenAPI spec valid (${routeRegistry.list().length} routes).`);
      return undefined;
    },
    close,
  );
}

function createOpenApiCheckCommand(bootstrap: AppBootstrap, close?: AppCleanup) {
  return createOpenApiCommand(
    bootstrap,
    async () => {
      const spec = generateOpenApiSpec(routeRegistry.list());
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

      console.log(`OpenAPI spec matches committed file (${routeRegistry.list().length} routes).`);
      return undefined;
    },
    close,
  );
}

export type { AppBootstrap, AppCleanup };
export {
  createOpenApiCheckCommand,
  createOpenApiGenerateCommand,
  createOpenApiValidateCommand,
  registerAppOpenApiRoutes,
};
