import { expect, test } from "bun:test";
import { join } from "node:path";

for (const database of ["mysql", "postgres", "sqlite"]) {
  test(`literal generated onboarding waits for ${database}/Redis/SMTP and rejects unhealthy dependencies`, async () => {
    const child = Bun.spawn(
      [process.execPath, "scripts/verify-starter-readiness.ts", `--database=${database}`],
      {
        cwd: join(import.meta.dir, "../.."),
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
        timeout: 350000,
        killSignal: "SIGTERM",
      },
    );
    expect(await child.exited).toBe(0);
  }, 360000);
}
