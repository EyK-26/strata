import { APP_PORT_CONFIG_KEY, DEFAULT_APP_PORT } from "./config";
import { appContext } from "./context";
import { routes } from "./routes";

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

    console.log(`Listening on ${this.server.url}`);
  }

  private resolvePort(): number {
    return (
      appContext.config.get<number>(APP_PORT_CONFIG_KEY) ?? DEFAULT_APP_PORT
    );
  }
}

export default App;
