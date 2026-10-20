import { expect, test } from "bun:test";
import { join } from "node:path";

for (const database of ["sqlite", "mysql", "postgres"]) {
  test(`installed private-state repository ${database}: binding and native transactions`, async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../../scripts/verify-repository-rebinding.ts"),
        `--database=${database}`,
      ],
      {
        cwd: join(import.meta.dir, "../.."),
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
        timeout: 120000,
        killSignal: "SIGTERM",
      },
    );
    expect(await child.exited).toBe(0);
  }, 130000);
}
