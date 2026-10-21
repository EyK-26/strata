import { expect, test } from "bun:test";
import { join } from "node:path";

for (const database of ["sqlite", "mysql", "postgres"]) {
  test(`installed model write hooks ${database}: protected serialization, failure and retry`, async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../../scripts/verify-repository-rebinding.ts"),
        `--database=${database}`,
        "--model-write-hooks",
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
