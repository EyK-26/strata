import { expect, test } from "bun:test";
import { join } from "node:path";

test("installed candidate preserves repeated form fields through the public API", async () => {
  const proc = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../../scripts/verify-form-multiplicity.ts")],
    { cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe", timeout: 120000 },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect({ stdout, stderr, exit }).toMatchObject({ exit: 0 });
  expect(stdout).toContain('"installedFormContract":true');
}, 125000);
