import { spawnBun } from "../spawnBun.ts";
import type { StrataAppConfig } from "../types.ts";

async function devCommand(app: StrataAppConfig): Promise<void> {
  if (!app.server) {
    throw new Error(
      "No server entry found. Add src/bootstrap/server.ts or set server in strata.config.ts.",
    );
  }

  const args = app.preload
    ? ["--preload", app.preload, "--watch", app.server]
    : ["--watch", app.server];
  const code = await spawnBun(app, args);
  if (code !== 0) {
    process.exitCode = code;
  }
}

export { devCommand };
