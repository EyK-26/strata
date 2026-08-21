import { resolveMaxBodyBytes } from "@getstrata/core/http/bodySizeLimitMiddleware";
import {
  installGracefulShutdownSignals,
  registerShutdownHandler,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { closeDatabase } from "../db/connection";
import { APP_PORT_CONFIG_KEY, DEFAULT_APP_PORT } from "./config";
import { appContext } from "./context";
import { startInProcessCronIfEnabled, stopInProcessCron } from "./inProcessCron";
import { buildRoutes } from "./routes";

class App {
  private server?: ReturnType<typeof Bun.serve>;

  serve(): void {
    if (this.server) {
      return;
    }

    const port = this.resolvePort();

    this.server = Bun.serve({
      port,
      routes: buildRoutes(),
      maxRequestBodySize: resolveMaxBodyBytes(),
    });

    registerShutdownHandler("http-server", async () => {
      this.server?.stop(true);
    });
    registerShutdownHandler("database", async () => {
      await closeDatabase();
    });
    registerShutdownHandler("in-process-cron", async () => {
      stopInProcessCron();
    });
    startInProcessCronIfEnabled();
    installGracefulShutdownSignals();

    console.log(`Listening on ${this.server.url}`);
  }

  stop(force = true): void {
    this.server?.stop(force);
  }

  private resolvePort(): number {
    return appContext.config.get<number>(APP_PORT_CONFIG_KEY) ?? DEFAULT_APP_PORT;
  }
}

export default App;
