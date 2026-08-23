import { resolve } from "node:path";
import { spawnBun } from "../spawnBun.ts";
import type { StrataAppConfig } from "../types.ts";

async function runCommand(app: StrataAppConfig, args: string[]): Promise<void> {
  const [file, ...rest] = args;
  if (!file) {
    throw new Error("run requires a file path. Example: strata run src/scripts/backfill.ts");
  }

  const filePath = resolve(app.root, file);
  const bunArgs = app.preload ? ["--preload", app.preload, filePath, ...rest] : [filePath, ...rest];
  const code = await spawnBun(app, bunArgs);
  if (code !== 0) {
    process.exitCode = code;
  }
}

export { runCommand };
