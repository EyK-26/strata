import { expect, test } from "bun:test";
import { join } from "node:path";

test("generated Docker image migrates explicitly, serves with production RLS and shuts down cleanly", async () => {
  const child = Bun.spawn(["bun", "scripts/verify-docker-runtime.ts"], {
    cwd: join(import.meta.dir, "../.."),
    stdout: "inherit",
    stderr: "inherit",
    timeout: 580000,
    killSignal: "SIGTERM",
  });
  expect(await child.exited).toBe(0);
}, 600000);
