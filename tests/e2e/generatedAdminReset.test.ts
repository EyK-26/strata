import { expect, test } from "bun:test";
import { join } from "node:path";

for (const database of ["sqlite", "mysql", "postgres"])
  for (const tenancy of database === "postgres" ? ["none", "column", "rls"] : ["none", "column"]) {
    test(`generated admin claim lifecycle ${database}/${tenancy} preserves rollback and production protections`, async () => {
      const child = Bun.spawn(
        [
          process.execPath,
          "scripts/verify-starter-admin-reset.ts",
          `--database=${database}`,
          `--tenancy=${tenancy}`,
        ],
        {
          cwd: join(import.meta.dir, "../.."),
          env: process.env,
          stdout: "inherit",
          stderr: "inherit",
          timeout: 180000,
          killSignal: "SIGTERM",
        },
      );
      expect(await child.exited).toBe(0);
    }, 190000);
  }
