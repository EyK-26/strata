import { expect, test } from "bun:test";
import { join } from "node:path";

test("installed PostgreSQL migration status is read-only while explicit mutations retain grant repair", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "../../scripts/verify-migration-status-privileges.ts"),
    ],
    {
      cwd: join(import.meta.dir, "../.."),
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120000,
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ stdout, stderr, exit }).toMatchObject({ exit: 0 });
  expect(stdout).toContain('"installedMigrationStatusReadOnly":true');
  expect(stdout).toContain('"explicitMigrationAndRollbackGrantsRetained":true');
}, 125000);
