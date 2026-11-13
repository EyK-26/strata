import type { StopResult } from "@getstrata/core/contracts/application";
import {
  installGracefulShutdownSignals,
  LifecycleCoordinator,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import {
  type AppContextOptions,
  type ApplicationContextHandle,
  collectProviders,
  createApplicationContext,
} from "./context";
import { type AppRouteMap, assertAppDependenciesComplete, type ServiceProvider } from "./contracts";
import { createRoutes } from "./createRoutes";
import { createInProcessCronResource } from "./inProcessCron";
import { type NativeServerOptions, webServerResource } from "./web/server";
export interface AppOptions extends AppContextOptions {
  readonly providers?: readonly ServiceProvider[];
  readonly port: number;
  readonly native?: NativeServerOptions;
  readonly cron?: Readonly<{
    schedule: import("@getstrata/core/scheduler/schedule").Schedule;
    options: import("@getstrata/core/scheduler/schedule").SchedulerRunOptions;
  }>;
}
class App {
  private startup?: Promise<void>;
  private readonly owner: ApplicationContextHandle;
  private uninstallSignals?: () => void;
  constructor(options: AppOptions) {
    let routes: AppRouteMap | undefined;
    const cron = options.cron;
    const finalProvider: ServiceProvider = {
      name: "http.routes",
      boot: ({ dependencies }) => {
        assertAppDependenciesComplete(dependencies);
        routes = createRoutes(dependencies);
      },
    };
    const fromScope = options.providersFromScope;
    this.owner = createApplicationContext(options.providers ?? collectProviders(), {
      ...options,
      providersFromScope: (scope) => [...(fromScope?.(scope) ?? []), finalProvider],
      definition: {
        ...options.definition,
        transports: [
          ...(options.definition.transports ?? []),
          ...(cron
            ? [
                {
                  name: "scheduler.cron",
                  async setup(
                    scope: import("@getstrata/core/contracts/application").ProviderScope,
                  ) {
                    await scope.acquire(createInProcessCronResource(cron.schedule, cron.options));
                  },
                },
              ]
            : []),
          {
            name: "http",
            setup: async (scope) => {
              if (!routes)
                throw new Error("HTTP routes were not assembled before transport setup.");
              await scope.acquire(
                webServerResource({ port: options.port, native: options.native, routes }),
              );
            },
          },
        ],
      },
    });
  }
  get application() {
    return this.owner.application;
  }
  serve(): Promise<void> {
    if (this.startup) return this.startup;
    this.startup = (async () => {
      await this.owner.start();
      const lifecycle = new LifecycleCoordinator();
      lifecycle.register(
        "application",
        async () => {
          const result = await this.shutdown("SIGNAL");
          if (!result.successful) throw new Error("Application shutdown is incomplete.");
        },
        "stop",
      );
      this.uninstallSignals = installGracefulShutdownSignals(undefined, lifecycle);
    })();
    return this.startup;
  }
  shutdown(reason = "MANUAL"): Promise<StopResult> {
    this.uninstallSignals?.();
    return this.owner.application.stop({ reason });
  }
  stop(): Promise<StopResult> {
    return this.shutdown();
  }
}
export default App;
