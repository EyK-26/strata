import { join } from "node:path";
import { setActiveApplicationContext } from "@getstrata/bootstrap/applicationRegistry";
import { runProviderPhase } from "@getstrata/bootstrap/context";
import {
  type AppContext,
  type AppRouteMap,
  assertAppDependenciesComplete,
  type MutableAppDependencies,
} from "@getstrata/bootstrap/contracts";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { createHealthRoutes } from "@getstrata/bootstrap/health";
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import { ConfigStore, ServiceContainer } from "@getstrata/core/contracts/container";
import { isSpaEnabled, isViewsEnabled } from "@getstrata/core/runtime/frontendMode";
import { ensureHiroappDatabase } from "../db/ensureDatabase.ts";
import { bindHttpContainer } from "../http/currentUser.ts";
import { wrapSpaDocument } from "../http/wrap.ts";
import { bindDatabase } from "./database.ts";
import { authProvider } from "./providers/auth.ts";
import { cacheProvider } from "./providers/cache.ts";
import { configProvider } from "./providers/config.ts";
import { listenersProvider } from "./providers/listeners.ts";
import { policyProvider } from "./providers/policy.ts";
import { queueProvider } from "./providers/queue.ts";
import { storageProvider } from "./providers/storage.ts";
import { viewProvider } from "./providers/view.ts";

export async function createApp(): Promise<{ context: AppContext; routes: AppRouteMap }> {
  await ensureHiroappDatabase();
  bindDatabase();

  const container = new ServiceContainer();
  const config = new ConfigStore();
  const dependencies: MutableAppDependencies = { container };
  const providerContext = { container, config, dependencies };

  const modules = await ensureModulesLoaded();
  const providers = [
    configProvider,
    cacheProvider,
    storageProvider,
    queueProvider,
    authProvider,
    policyProvider,
    viewProvider,
    listenersProvider,
    ...modules.flatMap((module) => module.providers ?? []),
  ];
  runProviderPhase(providers, "register", providerContext);
  runProviderPhase(providers, "boot", providerContext);
  assertAppDependenciesComplete(dependencies);
  bindHttpContainer(container);

  const context: AppContext = { container, config, dependencies };
  setActiveApplicationContext(context);

  const { createHttpKernel } = await import("@getstrata/bootstrap/httpKernel");
  const kernel = createHttpKernel(dependencies);
  const routes: AppRouteMap = {
    ...createHealthRoutes(dependencies),
    ...createMetricsRoutes(),
  };

  for (const module of modules) {
    Object.assign(
      routes,
      module.routes?.({ dependencies, cachedJson: async () => new Response(), kernel }) ?? {},
    );
    if (isViewsEnabled()) {
      Object.assign(
        routes,
        module.webRoutes?.({ dependencies, cachedJson: async () => new Response(), kernel }) ?? {},
      );
    }
  }

  if (isSpaEnabled()) {
    Object.assign(routes, spaCatchAll());
  }

  return { context, routes };
}

function spaCatchAll(): AppRouteMap {
  const dist = join(import.meta.dir, "../../frontend/dist");
  const handler = wrapSpaDocument(async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const asset = Bun.file(`${dist}/${relative}`);
    if (relative !== "index.html" && (await asset.exists())) {
      return new Response(asset);
    }
    const index = Bun.file(`${dist}/index.html`);
    if (await index.exists()) {
      return new Response(index, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return Response.json(
      { error: "SPA build not found. Run `bun run frontend:build`." },
      { status: 503 },
    );
  });

  return {
    "/*": {
      GET: handler,
    },
  };
}
