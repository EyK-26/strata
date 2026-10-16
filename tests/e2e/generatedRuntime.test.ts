import { expect, test } from "bun:test";
import { join } from "node:path";

// Keep cwd/env/module/SQL registries isolated from the security suite. The child
// verifier owns the generated install, CLI server, database and their cleanup.
for (const [name, flags] of [
  ["OpenAPI preserves API-only scope and the runtime inventory", ["--openapi"]],
  ["HTTP boot, readiness, metrics and shutdown", ["--http"]],
  ["SQLite column-tenancy packaged CLI, OpenAPI and HTTP", ["--sqlite", "--openapi", "--http"]],
  ["MySQL column-tenancy packaged CLI, OpenAPI and HTTP", ["--mysql", "--openapi", "--http"]],
] as const) {
  test(`generated-runtime: ${name}`, async () => {
    const repoRoot = join(import.meta.dir, "../..");
    const child = Bun.spawn(
      [process.execPath, "run", join(repoRoot, "scripts/verify-generated-runtime.ts"), ...flags],
      {
        cwd: repoRoot,
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
        timeout: 170000,
        killSignal: "SIGTERM",
      },
    );
    expect(await child.exited).toBe(0);
  }, 180000);
}
