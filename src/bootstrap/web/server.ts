import { resolveMaxBodyBytes } from "@getstrata/core/http/bodySizeLimitMiddleware";
import { type CorsOptions, createCorsMiddleware } from "@getstrata/core/http/corsMiddleware";
import { currentRequestMeta, runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import type { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
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
  lifecycle?: LifecycleCoordinator;
  routes?: AppRouteMap;
  publicDir?: string | false;
  /** Additional approved headers for synthesized route preflights; origins still use framework policy. */
  cors?: CorsOptions;
  // biome-ignore lint/suspicious/noConfusingVoidType: existing void callbacks remain compatible.
  onRequest?: (request: Request, server: Server<T>) => Promise<void | Response> | void | Response;
}

type TrackRequest = <T>(work: () => Promise<T>) => Promise<T>;

type BunRouteHandler<T = unknown> = (
  request: BunRequest,
  server: Server<T>,
) => Response | Promise<Response>;

type NativeRouteCallback<T> = (request: Request, server: Server<T>) => unknown;

function socketAddress<T>(server: Server<T> | undefined, request: Request): string | null {
  const address = server?.requestIP(request)?.address;
  return address ? address.replace(/^::ffff:/i, "") : null;
}

async function missingHtmlResponse(): Promise<Response> {
  return notFoundHtmlResponse();
}

function wrapRouteHandler<T>(
  handler: NativeRouteCallback<T>,
  path: string,
  onRequest?: WebServerOptions<T>["onRequest"],
  track: TrackRequest = (work) => work(),
): BunRouteHandler<T> {
  return async (request, server) => {
    return await track(
      async () =>
        await runWithRequestMeta(
          {
            ...currentRequestMeta(),
            request,
            routeTemplate: path,
            ipAddress: socketAddress(server, request),
            peerAddress: socketAddress(server, request),
            userAgent: request.headers.get("user-agent"),
          },
          async () => {
            const intercepted = await onRequest?.(request, server);
            if (intercepted instanceof Response) return intercepted;
            const response = await handler(request, server);
            return (response as Response | null | undefined) ?? (await missingHtmlResponse());
          },
        ),
    );
  };
}

function convertAppRoutesToBunRoutes<T = unknown>(
  routes: AppRouteMap,
  cors: CorsOptions = {},
  onRequest?: WebServerOptions<T>["onRequest"],
  track?: TrackRequest,
): Record<string, Record<string, BunRouteHandler<T>>> {
  const bunRoutes: Record<string, Record<string, BunRouteHandler<T>>> = {};
  const middleware = createCorsMiddleware(cors);
  const preflight = (request: Request) =>
    middleware(request, async () => new Response(null, { status: 405 }));

  for (const [path, handler] of Object.entries(routes)) {
    if (handler instanceof Response) {
      const methods: Record<string, BunRouteHandler<T>> = {};
      for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"]) {
        methods[method] = wrapRouteHandler(() => handler.clone(), path, onRequest, track);
      }
      methods.OPTIONS = wrapRouteHandler(preflight, path, onRequest, track);
      bunRoutes[path] = methods;
      continue;
    }

    if (typeof handler === "function") {
      bunRoutes[path] = {
        GET: wrapRouteHandler(handler as NativeRouteCallback<T>, path, onRequest, track),
        OPTIONS: wrapRouteHandler(preflight, path, onRequest, track),
      };
      continue;
    }

    if (handler && typeof handler === "object" && !Array.isArray(handler)) {
      const methods: Record<string, BunRouteHandler<T>> = {};

      for (const [method, methodHandler] of Object.entries(handler as Record<string, unknown>)) {
        if (methodHandler instanceof Response) {
          methods[method.toUpperCase()] = wrapRouteHandler(
            () => methodHandler.clone(),
            path,
            onRequest,
            track,
          );
          continue;
        }
        if (typeof methodHandler !== "function") {
          continue;
        }

        methods[method.toUpperCase()] = wrapRouteHandler(
          methodHandler as NativeRouteCallback<T>,
          path,
          onRequest,
          track,
        );
      }

      if (Object.keys(methods).length > 0) {
        methods.OPTIONS ??= wrapRouteHandler(preflight, path, onRequest, track);
        bunRoutes[path] = methods;
      }
    }
  }

  return bunRoutes;
}

export function createWebServer<T = unknown>(options: WebServerOptions<T>): Server<T> {
  if (options.lifecycle?.isShuttingDown) throw new Error("Cannot start HTTP during shutdown.");
  let abortedDuringShutdown = 0;
  const onRequest: WebServerOptions<T>["onRequest"] = (request, server) => {
    if (options.lifecycle?.isShuttingDown)
      return new Response("Service Unavailable", { status: 503 });
    // Bun can expose a relative URL for a malformed wire Host. Reject it before
    // application callbacks or middleware can interpret invalid transport metadata.
    if (!URL.canParse(request.url))
      return new Response("Bad Request", {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    if (options.lifecycle && !options.native?.websocket) {
      // A handler returning a Response does not mean its body reached the transport.
      // Bun's stop(false) also resolves when a busy connection aborts. Observe the
      // admitted request's native signal without retaining completed requests here.
      // With WebSockets enabled, the SDK also aborts upgraded request signals on
      // normal close and exposes no per-request upgrade/completion marker. Keep
      // the existing mixed-server behavior rather than misreporting normal closes.
      request.signal.addEventListener(
        "abort",
        () => {
          if (options.lifecycle?.isShuttingDown) abortedDuringShutdown++;
        },
        { once: true },
      );
    }
    return options.onRequest?.(request, server);
  };
  // Defend ownership even when callers bypass TypeScript (JS/config spreads).
  for (const field of ["fetch", "routes", "port", "unix"])
    if (options.native && field in options.native)
      throw new TypeError(`native.${field} is owned by createWebServer.`);
  const maxRequestBodySize = options.native?.maxRequestBodySize ?? resolveMaxBodyBytes();
  if (!Number.isSafeInteger(maxRequestBodySize) || maxRequestBodySize <= 0)
    throw new RangeError("maxRequestBodySize must be a positive safe integer.");
  const active = new Set<Promise<unknown>>();
  const track: TrackRequest = (work) => {
    if (!options.lifecycle) return work();
    const running = work();
    active.add(running);
    return running.finally(() => {
      active.delete(running);
    });
  };
  const publicDir = options.publicDir ?? "./public";
  const bunRoutes = options.routes
    ? convertAppRoutesToBunRoutes(options.routes, options.cors, onRequest, track)
    : undefined;

  const { websocket, ...native } = options.native ?? {};
  const configuration = {
    ...native,
    maxRequestBodySize,
    port: options.port,
    ...(bunRoutes ? { routes: bunRoutes } : {}),
    async fetch(request: Request, server: Server<T>) {
      return await track(
        async () =>
          await runWithRequestMeta(
            {
              ...currentRequestMeta(),
              request,
              ipAddress: socketAddress(server, request),
              peerAddress: socketAddress(server, request),
              userAgent: request.headers.get("user-agent"),
            },
            async () => {
              const intercepted = await onRequest(request, server);
              if (intercepted instanceof Response) return intercepted;

              const url = new URL(request.url);
              if (publicDir !== false && url.pathname.startsWith("/assets/")) {
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
          ),
      );
    },
  };
  // Prepare fallible lifecycle ownership before acquiring the native listener.
  // Until this function returns, failed acquisition must leave no live socket.
  let server: Server<T> | undefined;
  const unregister: Array<() => void> = [];
  try {
    if (options.lifecycle) {
      const lifecycle = options.lifecycle;
      const name = `http:${crypto.randomUUID()}`;
      let draining: Promise<void> | undefined;
      unregister.push(
        lifecycle.register(
          `${name}:stop`,
          () => {
            draining ??= server?.stop(false);
            void draining?.catch(() => {});
          },
          "stop",
        ),
      );
      unregister.push(
        lifecycle.register(
          `${name}:drain`,
          async () => {
            await draining;
            // A disconnected socket does not imply its async business handler finished.
            await Promise.allSettled([...active]);
            if (abortedDuringShutdown > 0) {
              throw new Error(
                `${abortedDuringShutdown} admitted HTTP request(s) aborted during shutdown; response completion is unconfirmed.`,
              );
            }
          },
          "drain",
        ),
      );
      unregister.push(lifecycle.register(`${name}:force`, () => server?.stop(true), "force"));
    }
    if (options.lifecycle?.isShuttingDown) throw new Error("Cannot start HTTP during shutdown.");
    server = websocket
      ? Bun.serve<T, string>({ ...configuration, websocket })
      : Bun.serve<T, string>({
          ...configuration,
          async fetch(request, server) {
            return (await configuration.fetch(request, server)) ?? (await missingHtmlResponse());
          },
        });
    return server;
  } catch (error) {
    const failures: unknown[] = [];
    for (const remove of unregister.reverse()) {
      try {
        remove();
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        "HTTP acquisition and lifecycle cleanup failed.",
        { cause: error },
      );
    throw error;
  }
}

export { convertAppRoutesToBunRoutes };
