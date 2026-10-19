import { expect, test } from "bun:test";
import { join } from "node:path";

for (const tenancy of ["none", "column"])
  test(`generated MySQL ${tenancy} CLI uses migration privilege without granting runtime DDL`, async () => {
    const child = Bun.spawn(
      [process.execPath, "scripts/verify-starter-mysql-migration-role.ts", `--tenancy=${tenancy}`],
      {
        cwd: join(import.meta.dir, "../.."),
        stdout: "inherit",
        stderr: "inherit",
        timeout: 180000,
        killSignal: "SIGTERM",
      },
    );
    expect(await child.exited).toBe(0);
  }, 190000);
