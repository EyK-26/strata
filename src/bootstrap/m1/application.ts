/** LOCAL M1 REVIEW PROTOTYPE. Existing entry points keep their 2.x behavior. */

import {
  collectProviders,
  createAppContext,
  type InitializedAppContext,
} from "@getstrata/bootstrap/context";
import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import {
  LifecycleCoordinator,
  type ShutdownResult,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import {
  claimApplicationStartup,
  resolveApplicationDependencies,
} from "@getstrata/core/runtime/applicationRegistry";
import { CORE_VIEW_RENDERER_TOKEN } from "@getstrata/core/view";
import type { Server } from "bun";
import { buildModuleRoutes } from "../buildModuleRoutes";
import { buildWebModuleRoutes } from "../buildWebModuleRoutes";
import type { AppDependencies, AppModule, AppRouteMap, ServiceProvider } from "../contracts";
import { applyModuleRouteMiddleware } from "../moduleRouteMiddleware";
import { RouteRegistry, routeRegistry, snapshotRouteData } from "../routeRegistry";
import { createWebServer, type WebServerOptions } from "../web/server";
import { recordM1Diagnostic } from "./diagnostics";
import {
  type ApiRouteContext,
  type DocumentRenderer,
  type GuardedRouteMap,
  type PreparedApplicationRoutes,
  routeShape,
  validateGuardedRoutes,
  type WebRouteContext,
} from "./guardedRoutes";
import {
  createPublicArtifactResolver,
  type DocumentArtifactPlan,
  type PublicArtifactPolicy,
  prepareDocumentArtifacts,
} from "./publicArtifacts";
import { rejectAfterStartupCleanup, resolveStartupCleanupTimeoutMs } from "./startupCleanup";
import { dataArray, dataRecord, M1ConfigurationError } from "./validation";

export type GuardedModule<Data = unknown> = Omit<AppModule, "routes" | "webRoutes"> & {
  routes?(context: ApiRouteContext): GuardedRouteMap<Data> | PreparedApplicationRoutes<Data>;
  webRoutes?(context: WebRouteContext): GuardedRouteMap<Data> | PreparedApplicationRoutes<Data>;
};
export type M1ApplicationOptions<Data = unknown> = {
  modules: readonly GuardedModule<Data>[];
  /** Caller wait budget for failed-startup cleanup after context acquisition. */
  startupCleanupTimeoutMs?: number;
  providers?: readonly ServiceProvider[];
  apiPrefix?: string;
  documents?: DocumentRenderer;
  artifacts?: {
    manifest: unknown;
    policy: PublicArtifactPolicy;
    document?: DocumentArtifactPlan;
    allowHttpLoopback?: boolean;
  };
  transport?: Partial<
    Pick<WebServerOptions<Data>, "port" | "native" | "handle" | "onRequest" | "cors">
  >;
};
export type RouteDeclaration = Readonly<{
  owner: string;
  path: string;
  shape: string;
  explicitMethods: readonly string[];
  effectiveMethods: readonly string[];
}>;

function snapshotModules<Data>(modules: readonly GuardedModule<Data>[]): GuardedModule<Data>[] {
  const names = new Set<string>();
  return dataArray(modules, "modules").map((module) => {
    const data = dataRecord(module, "module");
    if (
      typeof data.name !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(data.name) ||
      names.has(data.name)
    )
      throw new M1ConfigurationError("invalid-module-name", "modules");
    names.add(data.name);
    for (const key of ["routes", "webRoutes"])
      if (data[key] !== undefined && typeof data[key] !== "function")
        throw new M1ConfigurationError("invalid-factory", key, data.name);
    if (data.providers !== undefined && !Array.isArray(data.providers))
      throw new M1ConfigurationError("invalid-providers", "providers", data.name);
    return {
      ...data,
      ...(data.openApi ? { openApi: snapshotRouteData(data.openApi) } : {}),
      providers:
        data.providers === undefined
          ? []
          : (dataArray(data.providers, "providers") as ServiceProvider[]),
    } as GuardedModule<Data>;
  });
}

function prepareDocuments(
  context: InitializedAppContext,
  supplied: DocumentRenderer | undefined,
  documentArtifacts: ReturnType<typeof prepareDocumentArtifacts> | undefined,
  requiresDocuments: boolean,
): DocumentRenderer | undefined {
  let documents =
    supplied ??
    (context.container.has(CORE_VIEW_RENDERER_TOKEN)
      ? context.container.resolve(CORE_VIEW_RENDERER_TOKEN)
      : undefined);
  if (
    documents &&
    (typeof documents.render !== "function" || typeof documents.renderHtmx !== "function")
  )
    throw new M1ConfigurationError("invalid-document-capability", "documents");
  if (documents && documentArtifacts) {
    const renderer = documents;
    documents = {
      render: (name, data, viewOptions) =>
        renderer.render(name, { ...data, publicArtifacts: documentArtifacts }, viewOptions),
      renderHtmx: (name, data, viewOptions) =>
        renderer.renderHtmx(name, { ...data, publicArtifacts: documentArtifacts }, viewOptions),
    };
  }
  if ((requiresDocuments || documentArtifacts) && !documents)
    throw new M1ConfigurationError("missing-document-capability", "documents");
  return documents;
}

function collectHttpCandidate<Data>(
  dependencies: AppDependencies,
  modules: GuardedModule<Data>[],
  prefix: string,
  renderer: DocumentRenderer | undefined,
) {
  const declarations: RouteDeclaration[] = [];
  const shapes = new Map<string, string>();
  function capture(value: unknown, owner: string, prefix: string) {
    const routes = validateGuardedRoutes(value, owner);
    for (const [path, methods] of Object.entries(routes)) {
      const fullPath = `${prefix}${path}`;
      const shape = routeShape(fullPath);
      const other = shapes.get(shape);
      if (other)
        throw new M1ConfigurationError(
          "route-collision",
          "routes",
          `${other} / ${owner}`,
          "collection",
        );
      shapes.set(shape, owner);
      const explicit = Object.keys(methods);
      declarations.push(
        Object.freeze({
          owner,
          path: fullPath,
          shape,
          explicitMethods: Object.freeze(explicit),
          effectiveMethods: Object.freeze([
            ...new Set([...explicit, ...(explicit.includes("GET") ? ["HEAD"] : []), "OPTIONS"]),
          ]),
        }),
      );
    }
    return routes;
  }
  const wrapped: AppModule[] = modules.map((module) => {
    const apiFactory = module.routes;
    const webFactory = module.webRoutes;
    return {
      ...module,
      routes: apiFactory
        ? (ctx) =>
            capture(apiFactory({ ...ctx, documents: renderer }), `api:${module.name}`, prefix)
        : undefined,
      webRoutes:
        webFactory && renderer
          ? (ctx) =>
              applyModuleRouteMiddleware(
                capture(webFactory({ ...ctx, documents: renderer }), `web:${module.name}`, ""),
                ctx.kernel.documentMiddleware(),
              )
          : undefined,
    };
  });
  const candidate = new RouteRegistry();
  const api = buildModuleRoutes(dependencies, {
    modules: wrapped,
    apiPrefix: prefix,
    registry: candidate,
  });
  const web = buildWebModuleRoutes(dependencies, {
    modules: wrapped,
    clearRegistry: false,
    registry: candidate,
  });
  const inventory = new Map<string, { methods: Set<string>; middleware: string[] }>();
  for (const row of candidate.list()) {
    const entry = inventory.get(row.path);
    if (entry) entry.methods.add(row.method);
    else inventory.set(row.path, { methods: new Set([row.method]), middleware: row.middleware });
  }
  for (const declaration of declarations) {
    const entry = inventory.get(declaration.path);
    for (const method of declaration.effectiveMethods) {
      if (entry?.methods.has(method)) continue;
      candidate.register({
        method,
        path: declaration.path,
        middleware: method === "OPTIONS" ? ["framework.preflight"] : (entry?.middleware ?? []),
      });
      entry?.methods.add(method);
    }
  }
  return {
    routes: { ...api, ...web } as AppRouteMap,
    metadata: candidate.list(),
    declarations: Object.freeze(declarations),
  };
}

export async function startGuardedApplication<Data = unknown>(options: M1ApplicationOptions<Data>) {
  assertProductionSecrets();
  const cleanupTimeoutMs = resolveStartupCleanupTimeoutMs(options.startupCleanupTimeoutMs);
  const modules = snapshotModules(options.modules);
  const prefix = options.apiPrefix ?? "";
  if (prefix && (routeShape(prefix) !== prefix || prefix.endsWith("/") || /[:*]/.test(prefix)))
    throw new M1ConfigurationError("invalid-api-prefix", "apiPrefix");
  const artifacts =
    options.artifacts &&
    createPublicArtifactResolver(options.artifacts.manifest, options.artifacts.policy, {
      allowHttpLoopback: options.artifacts.allowHttpLoopback,
    });
  const plan = options.artifacts?.document;
  const documentArtifacts =
    artifacts && plan ? prepareDocumentArtifacts(artifacts, plan) : undefined;
  const lifecycle = new LifecycleCoordinator();
  const release = claimApplicationStartup();
  let context: InitializedAppContext | undefined;
  let server: Server<Data> | undefined;
  let publication: { restore(): boolean } | undefined;
  let phase: "providers" | "collection" | "publication" | "bind" | "lifecycle" = "providers";
  try {
    context = await createAppContext([
      ...(options.providers ?? collectProviders([])),
      ...modules.flatMap((module) => module.providers ?? []),
    ]);
    const ownedContext = context;
    phase = "collection";
    const documents = prepareDocuments(
      context,
      options.documents,
      documentArtifacts,
      modules.some((module) => module.webRoutes),
    );
    const candidate = collectHttpCandidate(context.dependencies, modules, prefix, documents);
    if (resolveApplicationDependencies() !== context.dependencies)
      throw new M1ConfigurationError("context-ownership-changed", "context");
    phase = "publication";
    publication = routeRegistry.installSnapshot(candidate.metadata);
    // Registry hooks can change the active context after the collection check.
    if (resolveApplicationDependencies() !== context.dependencies)
      throw new M1ConfigurationError("context-ownership-changed", "context");
    phase = "bind";
    server = createWebServer<Data>({
      ...options.transport,
      port: options.transport?.port ?? 0,
      native: { hostname: "127.0.0.1", ...options.transport?.native },
      publicDir: false,
      routes: candidate.routes,
      lifecycle,
    });
    phase = "lifecycle";
    lifecycle.register("m1:providers:drain", () => ownedContext.drain(), "drain");
    lifecycle.register("m1:providers:flush", () => ownedContext.flush(), "flush");
    lifecycle.register("m1:providers:close", () => ownedContext.dispose(), "close");
    const installed = publication;
    let stopping: Promise<ShutdownResult> | undefined;
    return Object.freeze({
      context,
      server,
      artifacts,
      documentArtifacts,
      declarations: candidate.declarations,
      shutdown(reason = "MANUAL") {
        stopping ??= lifecycle.shutdown(reason).then((result) => {
          if (!result.successful) {
            for (const failure of result.errors)
              recordM1Diagnostic(failure.error, {
                stage: "shutdown",
                code: "shutdown-failed",
                field: failure.phase,
                owner: "application",
              });
            return result;
          }
          if (!installed.restore()) {
            const metadataFailure = new Error(
              "Route metadata ownership changed; previous snapshot was not restored.",
            );
            recordM1Diagnostic(metadataFailure, {
              stage: "shutdown",
              code: "metadata-ownership-changed",
              field: "routes",
              owner: "application",
            });
            return {
              ...result,
              successful: false,
              errors: [
                ...result.errors,
                {
                  name: "m1:metadata",
                  phase: "close" as const,
                  error: metadataFailure,
                },
              ],
            };
          }
          release();
          return result;
        });
        return stopping;
      },
    });
  } catch (error) {
    const labels = {
      providers: { code: "provider-initialization-failed", field: "providers" },
      collection: { code: "route-collection-failed", field: "routes" },
      publication: { code: "metadata-publication-failed", field: "routes" },
      bind: { code: "http-start-failed", field: "transport" },
      lifecycle: { code: "lifecycle-registration-failed", field: "lifecycle" },
    };
    recordM1Diagnostic(error, { stage: phase, ...labels[phase], owner: "application" });
    // Without a returned context, provider acquisition/cleanup disposition is not
    // observable through today's API. Keep the reservation rather than invent retry safety.
    if (!context) throw error;
    const ownedContext = context;
    const ownedServer = server;
    return rejectAfterStartupCleanup({
      primary: error,
      timeoutMs: cleanupTimeoutMs,
      stop: ownedServer ? () => ownedServer.stop(true) : undefined,
      dispose: () => ownedContext.dispose(),
      restore: publication?.restore,
      release,
    });
  }
}
