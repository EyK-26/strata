import { expect, test } from "bun:test";
import { join } from "node:path";

test("installed CLI models discover and persist through automatic repositories on all dialects", async () => {
  const proc = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../../scripts/verify-model-generator.ts")],
    {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 180000,
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect({ stdout, stderr, exit }).toMatchObject({ exit: 0 });
  expect(stdout).toContain('"installedModelGenerator":true');
  expect(stdout).toContain('"automaticRepositories":true');
  expect(stdout).toContain('"dialects":["sqlite","postgres","mysql"]');
}, 185000);
