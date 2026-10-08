import { resolveMaxBodyBytes } from "@getstrata/core/http/bodySizeLimitMiddleware";
import { type CorsOptions, createCorsMiddleware } from "@getstrata/core/http/corsMiddleware";
import { currentRequestMeta, runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { assertUrlPathUnderRoot } from "@getstrata/core/security/safePath";
import { notFoundHtmlResponse } from "@getstrata/core/view";
import type { BunRequest, Serve, Server } from "bun";
import type { AppRouteMap } from "../contracts.ts";

export type NativeServerOptions<T = unknown> = Omit<Serve.HostnamePortServeOptions<T>, "port"> & {
  websocket?: Bun.WebSocketHandler<T>;
};

export interface WebServerOptions<T = unknown> {
  port: number;
  handle?: (
    request: Request,
    server: Server<T>,
  ) => Promise<Response | null | undefined> | Response | null | undefined;
  /** Bun transport options. Framework dispatch and route composition remain owned here. */
  native?: NativeServerOptions<T>;
  routes?: AppRouteMap;
  publicDir?: string;
  /** Additional approved headers for synthesized route preflights; origins still use framework policy. */
  cors?: CorsOptions;
  // biome-ignore lint/suspicious/noConfusingVoidType: existing void callbacks remain compatible.
  onRequest?: (request: Request, server: Server<T>) => Promise<void | Response> | void | Response;
}

type BunRouteHandler<T = unknown> = (
  request: BunRequest,
  server: Server<T>,
) => Response | Promise<Response>;

function socketAddress<T>(server: Server<T> | undefined, request: Request): string | null {
  const address = server?.requestIP(request)?.address;
  return address ? address.replace(/^::ffff:/i, "") : null;
}

async function missingHtmlResponse(): Promise<Response> {
  return notFoundHtmlResponse();
}

function wrapRouteHandler<T>(
  handler: (request: Request) => unknown,
  path: string,
  onRequest?: WebServerOptions<T>["onRequest"],
): BunRouteHandler<T> {
  return async (request, server) => {
    return await runWithRequestMeta(
      {
        ...currentRequestMeta(),
        request,
        routeTemplate: path,
        ipAddress: socketAddress(server, request),
        userAgent: request.headers.get("user-agent"),
      },
      async () => {
        const intercepted = await onRequest?.(request, server);
        if (intercepted instanceof Response) return intercepted;
        const response = await handler(request);
        return (response as Response | null | undefined) ?? (await missingHtmlResponse());
      },
    );
  };
}

function convertAppRoutesToBunRoutes<T = unknown>(
  routes: AppRouteMap,
  cors: CorsOptions = {},
  onRequest?: WebServerOptions<T>["onRequest"],
): Record<string, Record<string, BunRouteHandler<T>>> {
  const bunRoutes: Record<string, Record<string, BunRouteHandler<T>>> = {};
  const middleware = createCorsMiddleware(cors);
  const preflight = (request: Request) =>
    middleware(request, async () => new Response(null, { status: 405 }));

  for (const [path, handler] of Object.entries(routes)) {
    if (typeof handler === "function") {
      bunRoutes[path] = {
        GET: wrapRouteHandler(handler as (request: Request) => unknown, path, onRequest),
        OPTIONS: wrapRouteHandler(preflight, path, onRequest),
      };
      continue;
    }

    if (handler && typeof handler === "object" && !Array.isArray(handler)) {
      const methods: Record<string, BunRouteHandler<T>> = {};

      for (const [method, methodHandler] of Object.entries(handler as Record<string, unknown>)) {
        if (typeof methodHandler !== "function") {
          continue;
        }

        methods[method.toUpperCase()] = wrapRouteHandler(
          methodHandler as (request: Request) => unknown,
          path,
          onRequest,
        );
      }

      if (Object.keys(methods).length > 0) {
        methods.OPTIONS ??= wrapRouteHandler(preflight, path, onRequest);
        bunRoutes[path] = methods;
      }
    }
  }

  return bunRoutes;
}

export function createWebServer<T = unknown>(options: WebServerOptions<T>): Server<T> {
  // Defend ownership even when callers bypass TypeScript (JS/config spreads).
  for (const field of ["fetch", "routes", "port", "unix"])
    if (options.native && field in options.native)
      throw new TypeError(`native.${field} is owned by createWebServer.`);
  const maxRequestBodySize = options.native?.maxRequestBodySize ?? resolveMaxBodyBytes();
  if (!Number.isSafeInteger(maxRequestBodySize) || maxRequestBodySize <= 0)
    throw new RangeError("maxRequestBodySize must be a positive safe integer.");
  const publicDir = options.publicDir ?? "./public";
  const bunRoutes = options.routes
    ? convertAppRoutesToBunRoutes(options.routes, options.cors, options.onRequest)
    : undefined;

  const { websocket, ...native } = options.native ?? {};
  const configuration = {
    ...native,
    maxRequestBodySize,
    port: options.port,
    ...(bunRoutes ? { routes: bunRoutes } : {}),
    async fetch(request: Request, server: Server<T>) {
      return await runWithRequestMeta(
        {
          ...currentRequestMeta(),
          request,
          ipAddress: socketAddress(server, request),
          userAgent: request.headers.get("user-agent"),
        },
        async () => {
          const intercepted = await options.onRequest?.(request, server);
          if (intercepted instanceof Response) return intercepted;

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
            const response = await options.handle(request, server);
            if (response === undefined && websocket) return undefined;
            return response ?? (await missingHtmlResponse());
          }

          return await missingHtmlResponse();
        },
      );
    },
  };
  if (websocket) return Bun.serve<T, string>({ ...configuration, websocket });
  return Bun.serve<T, string>({
    ...configuration,
    async fetch(request, server) {
      return (await configuration.fetch(request, server)) ?? (await missingHtmlResponse());
    },
  });
}

export { convertAppRoutesToBunRoutes };
