import { currentRequestMeta, runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { assertUrlPathUnderRoot } from "@getstrata/core/security/safePath";
import { notFoundHtmlResponse } from "@getstrata/core/view";
import type { BunRequest, Server } from "bun";
import type { AppRouteMap } from "../contracts.ts";

export interface WebServerOptions {
  port: number;
  handle?: (request: Request) => Promise<Response | null> | Response | null;
  routes?: AppRouteMap;
  publicDir?: string;
  onRequest?: (request: Request) => Promise<void> | void;
}

type BunRouteHandler = (
  request: BunRequest,
  server: Server<unknown>,
) => Response | Promise<Response>;

function socketAddress(server: Server<unknown> | undefined, request: Request): string | null {
  const address = server?.requestIP(request)?.address;
  return address ? address.replace(/^::ffff:/i, "") : null;
}

async function missingHtmlResponse(): Promise<Response> {
  return notFoundHtmlResponse();
}

function wrapRouteHandler(handler: (request: Request) => unknown): BunRouteHandler {
  return async (request, server) => {
    return await runWithRequestMeta(
      {
        ...currentRequestMeta(),
        request,
        ipAddress: socketAddress(server, request),
        userAgent: request.headers.get("user-agent"),
      },
      async () => {
        const response = await handler(request);
        return (response as Response | null | undefined) ?? (await missingHtmlResponse());
      },
    );
  };
}

function convertAppRoutesToBunRoutes(
  routes: AppRouteMap,
): Record<string, Record<string, BunRouteHandler>> {
  const bunRoutes: Record<string, Record<string, BunRouteHandler>> = {};

  for (const [path, handler] of Object.entries(routes)) {
    if (typeof handler === "function") {
      bunRoutes[path] = { GET: wrapRouteHandler(handler as (request: Request) => unknown) };
      continue;
    }

    if (handler && typeof handler === "object" && !Array.isArray(handler)) {
      const methods: Record<string, BunRouteHandler> = {};

      for (const [method, methodHandler] of Object.entries(handler as Record<string, unknown>)) {
        if (typeof methodHandler !== "function") {
          continue;
        }

        methods[method.toUpperCase()] = wrapRouteHandler(
          methodHandler as (request: Request) => unknown,
        );
      }

      if (Object.keys(methods).length > 0) {
        bunRoutes[path] = methods;
      }
    }
  }

  return bunRoutes;
}

export function createWebServer(options: WebServerOptions) {
  const publicDir = options.publicDir ?? "./public";
  const bunRoutes = options.routes ? convertAppRoutesToBunRoutes(options.routes) : undefined;

  return Bun.serve({
    port: options.port,
    ...(bunRoutes ? { routes: bunRoutes } : {}),
    async fetch(request, server) {
      return await runWithRequestMeta(
        {
          ...currentRequestMeta(),
          request,
          ipAddress: socketAddress(server, request),
          userAgent: request.headers.get("user-agent"),
        },
        async () => {
          await options.onRequest?.(request);

          const url = new URL(request.url);
          if (url.pathname.startsWith("/assets/")) {
            try {
              const filePath = assertUrlPathUnderRoot(publicDir, url.pathname);
              const file = Bun.file(filePath);
              if (await file.exists()) {
                return new Response(file);
              }
            } catch {
              return await missingHtmlResponse();
            }
          }

          if (options.handle) {
            const response = await options.handle(request);
            return response ?? (await missingHtmlResponse());
          }

          return await missingHtmlResponse();
        },
      );
    },
  });
}

export { convertAppRoutesToBunRoutes };
