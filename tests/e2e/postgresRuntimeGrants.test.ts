import { expect, test } from "bun:test";
import { join } from "node:path";

test("installed generated Postgres role reserves maintenance while fresh/upgraded runtime operations work", async () => {
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../../scripts/verify-postgres-runtime-grants.ts")],
    { cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe", timeout: 180000 },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ stdout, stderr, exit }).toMatchObject({ exit: 0 });
  expect(stdout).toContain('"installedPostgresRuntimeGrants":true');
  expect(stdout).toContain('"repairedByCli":true');
  expect(stdout).toContain('"emittedInitAndRepeatableSql":true');
}, 185000);
