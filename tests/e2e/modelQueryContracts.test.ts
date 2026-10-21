import { expect, test } from "bun:test";
import { join } from "node:path";

test("installed Model query facade keeps subclass, projection and cursor contracts", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "../../scripts/verify-repository-rebinding.ts"),
      "--database=sqlite",
      "--model-query-contracts",
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
