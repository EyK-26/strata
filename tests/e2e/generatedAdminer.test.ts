import { expect, test } from "bun:test";
import { join } from "node:path";

for (const database of ["mysql", "postgres"]) {
  test(`generated Adminer Compose profile and documented login work on ${database}`, async () => {
    const child = Bun.spawn(
      [process.execPath, "scripts/verify-starter-adminer.ts", `--database=${database}`],
      {
        cwd: join(import.meta.dir, "../.."),
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
        timeout: 300000,
        killSignal: "SIGTERM",
      },
    );
    expect(await child.exited).toBe(0);
  }, 310000);
}
