import { expect, test } from "bun:test";
import { join } from "node:path";

for (const engine of ["sqlite", "mysql", "postgres"]) {
  const cases: string[][] = [
    ["orm", "api", "sync"],
    ...["api", "spa-react", "hybrid"].map((frontend) => ["sso", frontend, "sync"]),
    ...["spa-react", "hybrid"].map((frontend) => ["http", frontend, "sync"]),
    ...["sync", "redis"].map((queue) => ["webhook", "api", queue]),
  ];
  for (const item of cases) {
    const [mode = "", frontend = "", queue = ""] = item;
    test(`installed combination ${mode}/${engine}/${frontend}/${queue}`, async () => {
      const child = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, "../../scripts/verify-starter-combinations.ts"),
          mode,
          engine,
          frontend,
          queue,
        ],
        {
          cwd: join(import.meta.dir, "../.."),
          env: process.env,
          stdout: "inherit",
          stderr: "inherit",
          timeout: 160000,
          killSignal: "SIGTERM",
        },
      );
      expect(await child.exited).toBe(0);
    }, 170000);
  }
}
