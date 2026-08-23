import type { StrataAppConfig } from "./types.ts";

function bunExecutable(): string {
  return process.execPath.includes("bun") ? process.execPath : "bun";
}

async function spawnBun(app: StrataAppConfig, bunArgs: string[]): Promise<number> {
  const proc = Bun.spawn([bunExecutable(), ...bunArgs], {
    cwd: app.root,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: process.env,
  });

  return await proc.exited;
}

export { bunExecutable, spawnBun };
