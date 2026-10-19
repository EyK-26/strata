import { expect, test } from "bun:test";
import { join } from "node:path";

for (const frontend of ["spa-react", "hybrid"])
  for (const prefix of ["/app", "/workspace", "/team/portal"]) {
    test(`generated ${frontend} prefix ${prefix} works in build/dev/preview without API fallback or private config`, async () => {
      const child = Bun.spawn(
        [
          process.execPath,
          "scripts/verify-starter-spa-prefix.ts",
          `--frontend=${frontend}`,
          `--prefix=${prefix}`,
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

test("generated hybrid Docker frontend builds with its nested SPA namespace", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "scripts/verify-starter-spa-prefix.ts",
      "--frontend=hybrid",
      "--prefix=/team/portal",
      "--docker",
    ],
    {
      cwd: join(import.meta.dir, "../.."),
      env: process.env,
      stdout: "inherit",
      stderr: "inherit",
      timeout: 300000,
      killSignal: "SIGTERM",
    },
  );
  expect(await child.exited).toBe(0);
}, 310000);
