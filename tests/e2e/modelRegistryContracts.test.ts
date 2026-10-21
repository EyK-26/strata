import { expect, test } from "bun:test";
import { join } from "node:path";

test("installed public Model registration preserves repository and observer ownership", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "../../scripts/verify-repository-rebinding.ts"),
      "--database=sqlite",
      "--model-registry-contracts",
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
