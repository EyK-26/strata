import type { Application, ApplicationDefinition } from "@getstrata/core/contracts/application";
import { CORE_HTTP_CLEANUP_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { createApplication } from "@getstrata/core/runtime/application";
import {
  type AppContext,
  type AppModule,
  assertAppDependenciesComplete,
  ConfigStore,
  type MutableAppDependencies,
  type ProviderContext,
  ServiceContainer,
  type ServiceProvider,
} from "./contracts";
import { HTTP_PERSISTENCE_OPTIONS } from "./httpPersistence";
import { discoverModules, ensureModulesLoaded } from "./modules";
import type { HttpPersistenceOptions, PersistenceInvocation } from "./persistenceContracts";
import { createPersistenceInvocation } from "./persistenceInvocation";
import { coreProviders } from "./providers";

export type InitializedAppContext = AppContext & {
  readonly application: Application;
  readonly invoke: PersistenceInvocation;
  drain(): Promise<void>;
  flush(): Promise<void>;
  dispose(): Promise<void>;
};
export interface AppContextOptions {
  readonly definition: ApplicationDefinition;
  readonly connection: string;
  readonly http?: HttpPersistenceOptions;
  readonly providersFromScope?: (
    scope: import("@getstrata/core/contracts/application").ProviderScope,
  ) => readonly ServiceProvider[];
  readonly onConstructed?: (
    handle: Readonly<{ application: Application; invoke: PersistenceInvocation }>,
  ) => undefined;
}
export function collectProviders(modules: AppModule[] = discoverModules()): ServiceProvider[] {
  return [...coreProviders, ...modules.flatMap((module) => module.providers ?? [])];
}
export async function runProviderPhase(
  providers: readonly ServiceProvider[],
  phase: "register" | "boot",
  context: ProviderContext,
): Promise<void> {
  for (const provider of providers) await provider[phase]?.(context);
}

/** No provider or pool effects occur until the single canonical application starts. */
export interface ApplicationContextHandle {
  readonly application: Application;
  readonly invoke: PersistenceInvocation;
  start(): Promise<InitializedAppContext>;
}
export function createApplicationContext(
  providers: readonly ServiceProvider[],
  options: AppContextOptions,
): ApplicationContextHandle {
  if (!options) throw new TypeError("Explicit application definition and connection are required.");
  const configured = [...providers];
  const container = new ServiceContainer();
  const config = new ConfigStore();
  if (options.http) container.set(HTTP_PERSISTENCE_OPTIONS, Object.freeze({ ...options.http }));
  const cleanups: Record<"drain" | "flush" | "close", Array<() => void | Promise<void>>> = {
    drain: [],
    flush: [],
    close: [],
  };
  const started = new Set<string>();
  const results = new Map<string, Promise<void>>();
  const phase = (name: "drain" | "flush" | "close"): Promise<void> => {
    const old = results.get(name);
    if (old) return old;
    started.add(name);
    const result = Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      for (const callback of cleanups[name].splice(0).reverse()) {
        try {
          await callback();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, `Provider ${name} failed.`);
    });
    results.set(name, result);
    void result.catch(() => {});
    return result;
  };
  // These closures are used only after application is assigned, during start/run.
  let application: Application;
  const invoke: PersistenceInvocation = (envelope, work) =>
    createPersistenceInvocation(application, options.connection)(envelope, work);
  const dependencies: MutableAppDependencies = { container, invoke };
  const context: ProviderContext = {
    container,
    config,
    dependencies,
    invoke,
    onCleanup(callback, name = "close") {
      if (!["drain", "flush", "close"].includes(name))
        throw new TypeError("Unknown provider cleanup phase.");
      if (started.has("close"))
        throw new Error("Cannot register cleanup on a disposed application context.");
      if (started.has(name)) throw new Error("Cannot register cleanup after its phase started.");
      cleanups[name].push(callback);
    },
  };
  container.set(CORE_HTTP_CLEANUP_TOKEN, (callback: () => void | Promise<void>) =>
    context.onCleanup(callback),
  );
  application = createApplication({
    ...options.definition,
    providers: [
      ...options.definition.providers,
      {
        name: "bootstrap.providers",
        setup: async (scope) => {
          // Register resource ownership BEFORE register/boot may partially acquire anything.
          await scope.acquire({
            name: "bootstrap.providers",
            open: () => ({ ok: true, value: context }),
            drain: () => phase("drain"),
            flush: () => phase("flush"),
            close: () => phase("close"),
          });
          const selected = [...configured, ...(options.providersFromScope?.(scope) ?? [])];
          await runProviderPhase(selected, "register", context);
          await runProviderPhase(selected, "boot", context);
          assertAppDependenciesComplete(dependencies);
        },
      },
    ],
  });
  options.onConstructed?.(Object.freeze({ application, invoke }));
  let startup: Promise<InitializedAppContext> | undefined;
  return Object.freeze({
    application,
    invoke,
    start: () =>
      (startup ??= (async () => {
        await application.start();
        assertAppDependenciesComplete(dependencies);
        return Object.freeze({
          container,
          config,
          dependencies,
          application,
          invoke,
          drain: () => phase("drain"),
          flush: () => phase("flush"),
          dispose: async () => {
            const result = await application.stop();
            if (!result.successful) throw new Error("Application shutdown is incomplete.");
          },
        });
      })()),
  });
}

export async function createAppContext(
  providers: readonly ServiceProvider[] | undefined,
  options: AppContextOptions,
): Promise<InitializedAppContext> {
  if (!providers) await ensureModulesLoaded();
  return createApplicationContext(providers ?? collectProviders(), options).start();
}
