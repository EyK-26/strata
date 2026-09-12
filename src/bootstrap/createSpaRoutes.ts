import { join } from "node:path";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { jsonResponse } from "@getstrata/core/http/response";
import { isSpaEnabled, isViewsEnabled, readSpaPrefix } from "@getstrata/core/runtime/frontendMode";
import { assertPathUnderRoot } from "@getstrata/core/security/safePath";
import type { AppDependencies, AppRouteMap } from "./contracts";

const SPA_DIST_DIRECTORY = join(process.cwd(), "frontend/dist");

type SpaRouteOptions = {
  prefix?: string;
  distDirectory?: string;
  wrap?: (handler: RouteHandler) => RouteHandler;
};

function relativeSpaPath(pathname: string, prefix: string): string {
  if (pathname === prefix || pathname === `${prefix}/`) {
    return "";
  }
  if (pathname.startsWith(`${prefix}/`)) {
    return pathname.slice(prefix.length + 1);
  }
  return "";
}

function createSpaDocumentHandler(prefix: string, distDirectory: string): RouteHandler {
  const indexFilePath = join(distDirectory, "index.html");

  return async (request: Request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    const relativePath = relativeSpaPath(pathname, prefix);
    if (relativePath.length > 0) {
      try {
        const assetFile = Bun.file(assertPathUnderRoot(distDirectory, relativePath));
        if (await assetFile.exists()) {
          return new Response(assetFile);
        }
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }

    const indexFile = Bun.file(indexFilePath);

    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return jsonResponse(
      {
        error: "SPA build not found. Run `bun run frontend:build` in your app.",
      },
      { status: 503 },
    );
  };
}

function createSpaRoutes(
  _dependencies: AppDependencies,
  options: SpaRouteOptions = {},
): AppRouteMap {
  const prefix = options.prefix ?? readSpaPrefix();
  const distDirectory = options.distDirectory ?? SPA_DIST_DIRECTORY;
  const wrap = options.wrap ?? ((handler: RouteHandler) => handler);
  const handler = wrap(createSpaDocumentHandler(prefix, distDirectory));

  const routes: AppRouteMap = {
    [prefix]: handler,
    [`${prefix}/`]: handler,
    [`${prefix}/*`]: handler,
  };

  if (!isViewsEnabled()) {
    routes["/"] = async () => Response.redirect(`${prefix}/`, 302);
  }

  return routes;
}

function mergeSpaRoutes(
  dependencies: AppDependencies,
  routes: AppRouteMap,
  options?: SpaRouteOptions,
): AppRouteMap {
  if (!isSpaEnabled()) {
    return routes;
  }

  return {
    ...createSpaRoutes(dependencies, options),
    ...routes,
  };
}

export type { SpaRouteOptions };
export { createSpaRoutes, mergeSpaRoutes, SPA_DIST_DIRECTORY };
