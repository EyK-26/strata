import { expect, test } from "bun:test";
import { join } from "node:path";

test("installed PostgreSQL/RLS official outbox worker publishes, drains cancellation and recovers its default lease", async () => {
  const child = Bun.spawn([process.execPath, "scripts/verify-starter-outbox.ts"], {
    cwd: join(import.meta.dir, "../.."),
    stdout: "inherit",
    stderr: "inherit",
    timeout: 200000,
    killSignal: "SIGTERM",
  });
  expect(await child.exited).toBe(0);
}, 215000);
