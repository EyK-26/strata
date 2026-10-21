import { expect, test } from "bun:test";
import { join } from "node:path";

test("installed API and web module cachedJson: cache, ETag, invalidation and failure recovery", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "../../scripts/verify-starter-module.ts"),
      "--auth=cookie",
      "--with-web",
      "--api-prefix=/backend/cache",
      "--cached-json",
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
