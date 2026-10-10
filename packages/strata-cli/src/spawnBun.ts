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

  // The CLI owns this child. A container signals its supervisor, not the server.
  const signals = ["SIGINT", "SIGTERM"] as const;
  const relays = signals.map((signal) => {
    const relay = () => {
      if (proc.exitCode === null) proc.kill(signal);
    };
    process.on(signal, relay);
    return () => process.off(signal, relay);
  });
  try {
    return await proc.exited;
  } finally {
    for (const remove of relays) remove();
  }
}

export { bunExecutable, spawnBun };
