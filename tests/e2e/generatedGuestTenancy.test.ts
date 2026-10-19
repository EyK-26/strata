import { expect, test } from "bun:test";
import { join } from "node:path";

for (const [database, tenancy] of [
  ["sqlite", "column"],
  ["mysql", "column"],
  ["postgres", "column"],
  ["postgres", "rls"],
])
  test(`generated ${database}/${tenancy} header identities respect tenant policy without account tables`, async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "scripts/verify-starter-guest-tenancy.ts",
        `--database=${database}`,
        `--tenancy=${tenancy}`,
      ],
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
