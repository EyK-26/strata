import { expect, test } from "bun:test";
import { join } from "node:path";

for (const database of ["postgres", "sqlite", "mysql"]) {
  test(`generated OIDC ${database}: installed packages complete a real HTTP handshake`, async () => {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "../../scripts/verify-generated-oidc.ts"), database],
      {
        cwd: join(import.meta.dir, "../.."),
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
        timeout: 150000,
        killSignal: "SIGTERM",
      },
    );
    expect(await child.exited).toBe(0);
  }, 160000);
}
