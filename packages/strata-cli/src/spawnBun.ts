import { bunExecutable, createBunChildSupervisor } from "./bunChildResource.ts";
import type { StrataAppConfig } from "./types.ts";

async function spawnBun(app: StrataAppConfig, bunArgs: string[]): Promise<number> {
  return await createBunChildSupervisor(app, bunArgs).run();
}

export { bunExecutable, spawnBun };
