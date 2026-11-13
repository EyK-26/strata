import { resolve } from "node:path";
import { resolveMaxBodyBytes } from "@getstrata/core/http/bodySizeLimitMiddleware";
import {
  type CorsOptions,
  createCorsMiddleware,
  resolveCorsConfig,
} from "@getstrata/core/http/corsMiddleware";
import { currentRequestMeta, runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import type { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
import { assertUrlPathUnderRoot } from "@getstrata/core/security/safePath";
import type { WebErrorView } from "@getstrata/core/view";
import { notFoundHtmlResponse } from "@getstrata/core/view";
import type { BunRequest, Serve, Server } from "bun";
import { dispatchOwnedRoute } from "#strata-http-route";
import type { AppRouteMap } from "../contracts.ts";
import type { BusinessRequestPorts, BusinessRouteHandler } from "../persistenceContracts";
import { resolveHttpResponsePolicy } from "../providers/config";

export type NativeServerOptions<T = unknown> = Omit<Serve.HostnamePortServeOptions<T>, "port"> & {
  websocket?: Bun.WebSocketHandler<T>;
};

// biome-ignore lint/suspicious/noConfusingVoidType: native request hooks may return no interception.
type RequestInterception = Response | void;

export interface WebServerOptions<T = unknown> {
  port: number;
  /** Environment adapter input captured before transport acquisition. */
  env?: Readonly<Record<string, string | undefined>>;
  enter?: (request: Request, handler: BusinessRouteHandler) => Promise<Response>;
  handle?: (
    request: Request,
    server: Server<T>,
    ports?: BusinessRequestPorts,
  ) => Promise<Response | null | undefined> | Response | null | undefined;
  /** Bun transport options. Framework dispatch and route composition remain owned here. */
  native?: NativeServerOptions<T>;
  lifecycle?: Pick<LifecycleCoordinator, "isShuttingDown" | "register">;
  routes?: AppRouteMap;
  publicDir?: string;
  /** Owned renderer for transport fallbacks, including missing public assets. */
  errorView?: WebErrorView;
  /** Additional approved headers for synthesized route preflights; origins still use framework policy. */
  cors?: CorsOptions;
  onRequest?: (
    request: Request,
    server: Server<T>,
    ports?: BusinessRequestPorts,
  ) => Promise<RequestInterception> | RequestInterception;
}

type TrackRequest = <T>(work: () => Promise<T>) => Promise<T>;

type BunRouteHandler<T = unknown> = (
  request: BunRequest,
  server: Server<T>,
) => Response | Promise<Response>;

type NativeRouteCallback<T> = (
  request: Request,
  server: Server<T>,
  ports?: BusinessRequestPorts,
) => unknown;

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
  enter?: WebServerOptions<T>["enter"],
  validate?: (request: Request, server: Server<T>) => Response | undefined,
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
            const invalid = validate?.(request, server);
            if (invalid) return invalid;
            const owned = await dispatchOwnedRoute(handler, request, (ports) =>
              onRequest?.(request, server, ports),
            );
            if (owned) return owned;
            const work = async (_request: Request, ports?: BusinessRequestPorts) => {
              const intercepted = await onRequest?.(request, server, ports);
              if (intercepted instanceof Response) return intercepted;
              const response = await handler(request, server, ports);
              return (response as Response | null | undefined) ?? (await missingHtmlResponse());
            };
            return enter ? enter(request, work) : work(request);
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
  enter?: WebServerOptions<T>["enter"],
  validate?: (request: Request, server: Server<T>) => Response | undefined,
): Record<string, Record<string, BunRouteHandler<T>>> {
  const bunRoutes: Record<string, Record<string, BunRouteHandler<T>>> = {};
  const middleware = createCorsMiddleware(cors);
  const preflight = (request: Request) =>
    middleware(request, async () => new Response(null, { status: 405 }));

  for (const [path, handler] of Object.entries(routes)) {
    if (handler instanceof Response) {
      const methods: Record<string, BunRouteHandler<T>> = {};
      for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"]) {
        methods[method] = wrapRouteHandler(
          () => handler.clone(),
          path,
          onRequest,
          track,
          enter,
          validate,
        );
      }
      methods.OPTIONS = wrapRouteHandler(preflight, path, onRequest, track, enter, validate);
      bunRoutes[path] = methods;
      continue;
    }

    if (typeof handler === "function") {
      bunRoutes[path] = {
        GET: wrapRouteHandler(
          handler as NativeRouteCallback<T>,
          path,
          onRequest,
          track,
          enter,
          validate,
        ),
        OPTIONS: wrapRouteHandler(preflight, path, onRequest, track, enter, validate),
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
            enter,
            validate,
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
          enter,
          validate,
        );
      }

      if (Object.keys(methods).length > 0) {
        methods.OPTIONS ??= wrapRouteHandler(preflight, path, onRequest, track, enter, validate);
        bunRoutes[path] = methods;
      }
    }
  }

  return bunRoutes;
}

export function createWebServer<T = unknown>(options: WebServerOptions<T>): Server<T> {
  return openWebServer(options);
}

/** Private acquisition witness; no application callbacks run between return and capture. */
function openWebServer<T>(
  options: WebServerOptions<T>,
  ownership?: { acquired(server: Server<T>): void; bindRejected(): void },
): Server<T> {
  if (options.lifecycle?.isShuttingDown) throw new Error("Cannot start HTTP during shutdown.");
  let abortedDuringShutdown = 0;
  const validate = (request: Request, _server: Server<T>): Response | undefined => {
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
  };
  const onRequest = options.onRequest;
  // Defend ownership even when callers bypass TypeScript (JS/config spreads).
  for (const field of ["fetch", "routes", "port", "unix"])
    if (options.native && field in options.native)
      throw new TypeError(`native.${field} is owned by createWebServer.`);
  const responsePolicy = resolveHttpResponsePolicy(
    Object.freeze({ ...(options.env ?? process.env) }),
  );
  if (options.cors) resolveCorsConfig(options.cors);
  const cors: CorsOptions = {
    ...responsePolicy.cors,
    ...options.cors,
    additionalAllowedHeaders: [
      ...(responsePolicy.cors?.additionalAllowedHeaders ?? []),
      ...(options.cors?.additionalAllowedHeaders ?? []),
    ],
  };
  const maxRequestBodySize =
    options.native?.maxRequestBodySize ?? responsePolicy.maxBodyBytes ?? resolveMaxBodyBytes();
  if (!Number.isSafeInteger(maxRequestBodySize) || maxRequestBodySize <= 0)
    throw new RangeError("maxRequestBodySize must be a positive safe integer.");
  const renderError = options.errorView;
  const active = new Set<Promise<unknown>>();
  const trackOwned: TrackRequest = (work) => {
    if (!options.lifecycle) return work();
    const running = work();
    active.add(running);
    return running.finally(() => {
      active.delete(running);
    });
  };
  const track: TrackRequest = (work) =>
    trackOwned(
      async () =>
        await runWithRequestMeta({ ...currentRequestMeta(), webErrorView: renderError }, work),
    );
  const publicDir = resolve(options.publicDir ?? "./public");
  const bunRoutes = options.routes
    ? convertAppRoutesToBunRoutes(options.routes, cors, onRequest, track, options.enter, validate)
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
              const invalid = validate(request, server);
              if (invalid) return invalid;
              const url = new URL(request.url);
              let assetAdmission = false;
              if (url.pathname.startsWith("/assets/")) {
                const intercepted = await onRequest?.(request, server);
                if (intercepted instanceof Response) return intercepted;
                assetAdmission = true;
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
                const owned = await dispatchOwnedRoute(options.handle, request, (ports) =>
                  assetAdmission ? undefined : onRequest?.(request, server, ports),
                );
                if (owned) return owned;
                if (websocket && !options.enter) {
                  const intercepted = assetAdmission
                    ? undefined
                    : await onRequest?.(request, server);
                  if (intercepted instanceof Response) return intercepted;
                  return (await options.handle(request, server)) ?? undefined;
                }
                const work = async (_request: Request, ports?: BusinessRequestPorts) => {
                  const intercepted = assetAdmission
                    ? undefined
                    : await onRequest?.(request, server, ports);
                  if (intercepted instanceof Response) return intercepted;
                  return (
                    (await options.handle?.(request, server, ports)) ??
                    (await missingHtmlResponse())
                  );
                };
                if (options.enter) return options.enter(request, work);
                const response = await work(request);
                if (response === undefined && websocket) return undefined;
                return response ?? (await missingHtmlResponse());
              }

              return await missingHtmlResponse();
            },
          ),
      );
    },
  };
  // Construct/spread user configuration before the native-only failure boundary.
  const nativeOptions = websocket
    ? { ...configuration, websocket }
    : {
        ...configuration,
        async fetch(request: Request, server: Server<T>) {
          return (await configuration.fetch(request, server)) ?? (await missingHtmlResponse());
        },
      };
  // Only scalar caller options establish that the native call cannot execute a
  // nested accessor/coercion which spoofs listen metadata. TLS/WebSocket/callback
  // configuration remains supported, but failed acquisition there stays unknown.
  const provenScalarOptions =
    typeof configuration.port === "number" &&
    Number.isSafeInteger(configuration.port) &&
    configuration.port >= 0 &&
    configuration.port <= 65535 &&
    websocket === undefined &&
    scalarNativeOptions(native);
  let server: Server<T>;
  try {
    server = Bun.serve<T, string>(nativeOptions);
  } catch (error) {
    if (provenScalarOptions && isNativeListenConflict(error)) ownership?.bindRejected();
    throw error;
  }
  ownership?.acquired(server);

  if (options.lifecycle) {
    const lifecycle = options.lifecycle;
    const name = `http:${crypto.randomUUID()}`;
    let draining: Promise<void> | undefined;
    lifecycle.register(
      `${name}:stop`,
      () => {
        draining ??= server.stop(false);
        void draining.catch(() => {});
      },
      "stop",
    );
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
    );
    lifecycle.register(`${name}:force`, () => server.stop(true), "force");
  }
  return server;
}

export { convertAppRoutesToBunRoutes };

function scalarNativeOptions(options: object): boolean {
  try {
    for (const key of Reflect.ownKeys(options)) {
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      if (!descriptor || !("value" in descriptor)) return false;
      const value: unknown = descriptor.value;
      if (
        value !== null &&
        value !== undefined &&
        !["string", "number", "boolean"].includes(typeof value)
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Read only own data metadata: arbitrary errors may contain accessors/proxies. */
function isNativeListenConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  try {
    const code = Object.getOwnPropertyDescriptor(error, "code");
    const syscall = Object.getOwnPropertyDescriptor(error, "syscall");
    return (
      code !== undefined &&
      "value" in code &&
      code.value === "EADDRINUSE" &&
      syscall !== undefined &&
      "value" in syscall &&
      syscall.value === "listen"
    );
  } catch {
    return false;
  }
}

/** Native transport descriptor owned by the same Application journal as persistence. */
export function webServerResource<T = unknown>(
  options: Omit<WebServerOptions<T>, "lifecycle">,
): import("@getstrata/core/contracts/application").ResourceSpec<Server<T>> {
  type Hook = Parameters<LifecycleCoordinator["register"]>[1];
  type Phase = NonNullable<Parameters<LifecycleCoordinator["register"]>[2]>;
  const hooks = new Map<Phase, Hook[]>();
  let stopping = false;
  const lifecycle: Pick<LifecycleCoordinator, "isShuttingDown" | "register"> = {
    get isShuttingDown() {
      return stopping;
    },
    register(_name, handler, phase = "close") {
      const group = hooks.get(phase) ?? [];
      group.push(handler);
      hooks.set(phase, group);
      return () => {
        const index = group.indexOf(handler);
        if (index >= 0) group.splice(index, 1);
      };
    },
  };
  const run = async (
    phase: Phase,
    context: import("@getstrata/core/contracts/application").CleanupContext,
  ) => {
    for (const hook of hooks.get(phase) ?? []) await hook(context);
  };
  return {
    name: "http.server",
    open: async () => {
      let acquired: Server<T> | undefined;
      let bindRejected = false;
      try {
        const server = openWebServer(
          { ...options, lifecycle },
          {
            acquired: (server) => {
              acquired = server;
            },
            bindRejected: () => {
              bindRejected = true;
            },
          },
        );
        return { ok: true, value: server };
      } catch (error) {
        if (acquired) {
          try {
            await acquired.stop(true);
            return { ok: false, error, disposition: "cleaned" };
          } catch (cleanupError) {
            return { ok: false, error, disposition: "unknown", cleanupErrors: [cleanupError] };
          }
        }
        if (bindRejected) return { ok: false, error, disposition: "not-acquired" };
        throw error;
      }
    },
    stop: async (_server, context) => {
      stopping = true;
      await run("stop", context);
    },
    drain: (_server, context) => run("drain", context),
    close: (_server, context) => run("close", context),
  };
}
