import { resolveMaxBodyBytes } from "@getstrata/core/http/bodySizeLimitMiddleware";
import {
  installGracefulShutdownSignals,
  registerShutdownHandler,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { closeDatabase, ensureDatabaseConnection, pingDatabase } from "../db/connection";
import { APP_PORT_CONFIG_KEY, DEFAULT_APP_PORT } from "./config";
import { appContext, createAppContext, type InitializedAppContext } from "./context";
import { createRoutes } from "./createRoutes";
import { startInProcessCronIfEnabled, stopInProcessCron } from "./inProcessCron";
import { assertProductionSecrets } from "./secretsGuard";

class App {
  private server?: ReturnType<typeof Bun.serve>;

  private startup?: Promise<void>;

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

      this.server = Bun.serve({
        port,
        routes: createRoutes(context.dependencies),
        maxRequestBodySize: resolveMaxBodyBytes(),
      });

      registerShutdownHandler("http-server", async () => {
        this.server?.stop(true);
        this.server = undefined;
      });
      registerShutdownHandler("providers", () => context?.dispose());
      registerShutdownHandler("database", async () => {
        await closeDatabase();
      });
      registerShutdownHandler("in-process-cron", async () => {
        stopInProcessCron();
      });
      startInProcessCronIfEnabled();
      installGracefulShutdownSignals();

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

  stop(force = true): void {
    this.server?.stop(force);
  }

  private resolvePort(): number {
    return appContext.config.get<number>(APP_PORT_CONFIG_KEY) ?? DEFAULT_APP_PORT;
  }
}

export default App;
