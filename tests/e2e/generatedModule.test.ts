import { expect, test } from "bun:test";
import { join } from "node:path";

const profiles = [
  ...["headers", "cookie", "token", "jwt", "cookie-token", "cookie-token-jwt"].map((auth) => ({
    name: `sqlite-${auth}`,
    flags: [`--auth=${auth}`, ...(auth === "cookie" ? ["--dev"] : [])],
  })),
  { name: "mysql-cookie-redis-smtp-security-extras", flags: ["--auth=cookie", "--mysql", "--dev"] },
];
for (const profile of profiles) {
  test(`installed make:module ${profile.name}: boot, API-only OpenAPI and denied writes`, async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../../scripts/verify-starter-module.ts"),
        ...profile.flags,
      ],
      {
        cwd: join(import.meta.dir, "../.."),
        env: process.env,
        stdout: "inherit",
        stderr: "inherit",
        timeout: 120000,
        killSignal: "SIGTERM",
      },
    );
    expect(await child.exited).toBe(0);
  }, 130000);
}
