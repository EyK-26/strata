import { APP_PORT_CONFIG_KEY, DEFAULT_APP_PORT } from "./config";
import { appContext } from "./context";
import { routes } from "./routes";
import { closeDatabase } from "../db/connection";
import {
  installGracefulShutdownSignals,
  registerShutdownHandler,
} from "../core/lifecycle/gracefulShutdown";

class App {
  private server?: ReturnType<typeof Bun.serve>;

  serve(): void {
    if (this.server) {
      return;
    }

    const port = this.resolvePort();

    this.server = Bun.serve({
      port,
      routes,
    });

    registerShutdownHandler("http-server", async () => {
      this.server?.stop(true);
    });
    registerShutdownHandler("database", async () => {
      await closeDatabase();
    });
    installGracefulShutdownSignals();

    console.log(`Listening on ${this.server.url}`);
  }

  stop(force = true): void {
    this.server?.stop(force);
  }

  private resolvePort(): number {
    return (
      appContext.config.get<number>(APP_PORT_CONFIG_KEY) ?? DEFAULT_APP_PORT
    );
  }
}

export default App;
