import { join } from "node:path";
import { jsonResponse } from "@getstrata/core/http/response";
import { isSpaEnabled } from "@getstrata/core/runtime/frontendMode";
import type { AppDependencies, AppRouteMap } from "./contracts";

const SPA_DIST_DIRECTORY = join(process.cwd(), "frontend/dist");
const SPA_INDEX_FILE = join(SPA_DIST_DIRECTORY, "index.html");

function createSpaRoutes(_dependencies: AppDependencies): AppRouteMap {
  return {
    "/app/*": async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      const relativePath = pathname.replace(/^\/app\//, "");
      const assetFile = Bun.file(join(SPA_DIST_DIRECTORY, relativePath));

      if (relativePath.length > 0 && (await assetFile.exists())) {
        return new Response(assetFile);
      }

      const indexFile = Bun.file(SPA_INDEX_FILE);

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
    },
    "/": async () => Response.redirect("/app/", 302),
  };
}

function mergeSpaRoutes(dependencies: AppDependencies, routes: AppRouteMap): AppRouteMap {
  if (!isSpaEnabled()) {
    return routes;
  }

  return {
    ...createSpaRoutes(dependencies),
    ...routes,
  };
}

export { createSpaRoutes, mergeSpaRoutes, SPA_DIST_DIRECTORY };
