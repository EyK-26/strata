import {
  installGracefulShutdownSignals,
  LifecycleCoordinator,
  type ShutdownResult,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { closeDatabase, ensureDatabaseConnection, pingDatabase } from "../db/connection";
import { APP_PORT_CONFIG_KEY, DEFAULT_APP_PORT } from "./config";
import { appContext, createAppContext, type InitializedAppContext } from "./context";
import { createRoutes } from "./createRoutes";
import {
  drainInProcessCron,
  startInProcessCronIfEnabled,
  stopInProcessCron,
} from "./inProcessCron";
import { assertProductionSecrets } from "./secretsGuard";
import { createWebServer } from "./web/server";

class App {
  private server?: ReturnType<typeof Bun.serve>;

  private startup?: Promise<void>;
  private lifecycle?: LifecycleCoordinator;
  private uninstallSignals?: () => void;

  async serve(): Promise<void> {
    this.startup ??= this.start();
    try {
      await this.startup;
    } catch (error) {
      this.startup = undefined;
      throw error;
    }
  }

  private async start(): Promise<void> {
    if (this.server) {
      return;
    }

    assertProductionSecrets();
    let context: InitializedAppContext | undefined;
    try {
      await ensureDatabaseConnection();
      if (!(await pingDatabase())) throw new Error("Database is not ready.");
      context = await createAppContext();

      const port = this.resolvePort();

      const lifecycle = new LifecycleCoordinator();
      this.lifecycle = lifecycle;
      this.server = createWebServer({
        port,
        routes: createRoutes(context.dependencies),
        lifecycle,
      });

      lifecycle.register("in-process-cron:stop", stopInProcessCron, "stop");
      lifecycle.register("in-process-cron:drain", drainInProcessCron, "drain");
      lifecycle.register("providers:drain", () => context?.drain(), "drain");
      lifecycle.register("providers:flush", () => context?.flush(), "flush");
      lifecycle.register("providers:close", () => context?.dispose(), "close");
      lifecycle.register("database", closeDatabase, "close");
      startInProcessCronIfEnabled();
      this.uninstallSignals = installGracefulShutdownSignals(undefined, lifecycle);

      console.log(`Listening on ${this.server.url}`);
    } catch (error) {
      this.server?.stop(true);
      this.server = undefined;
      const failures: unknown[] = [];
      for (const cleanup of [() => context?.dispose(), closeDatabase]) {
        try {
          await cleanup();
        } catch (failure) {
          failures.push(failure);
        }
      }
      if (failures.length)
        throw new AggregateError([error, ...failures], "Application startup and cleanup failed.", {
          cause: error,
        });
      throw error;
    }
  }

  async shutdown(reason = "MANUAL"): Promise<ShutdownResult> {
    await this.startup;
    const result = await this.lifecycle?.shutdown(reason);
    this.uninstallSignals?.();
    return result ?? { successful: true, timedOut: false, errors: [] };
  }

  // Transport-only compatibility API. Use shutdown() to drain and close providers.
  stop(force = true): void {
    this.server?.stop(force);
  }

  private resolvePort(): number {
    return appContext.config.get<number>(APP_PORT_CONFIG_KEY) ?? DEFAULT_APP_PORT;
  }
}

export default App;
