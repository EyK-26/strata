import { expect, test } from "bun:test";
import { join } from "node:path";

test("installed CLI views render through public Eta without creating routes or migrations", async () => {
  const proc = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../../scripts/verify-view-generator.ts")],
    {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120000,
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect({ stdout, stderr, exit }).toMatchObject({ exit: 0 });
  expect(stdout).toContain('"installedViewGenerator":true');
  expect(stdout).toContain('"etaRendered":true');
  expect(stdout).toContain('"noImplicitRoutesOrMigrations":true');
}, 125000);
