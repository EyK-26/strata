import { expect, test } from "bun:test";
import { join } from "node:path";

for (const database of ["sqlite", "mysql", "postgres"])
  for (const tenancy of database === "postgres" ? ["none", "column", "rls"] : ["none", "column"])
    for (const webhooks of [false, true]) {
      test(`generated later-batch billing rollback ${database}/${tenancy}/webhooks=${webhooks} preserves unrelated data`, async () => {
        const child = Bun.spawn(
          [
            process.execPath,
            "scripts/verify-starter-billing-rollback.ts",
            `--database=${database}`,
            `--tenancy=${tenancy}`,
            ...(webhooks ? ["--webhooks"] : []),
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
