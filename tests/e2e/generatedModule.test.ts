import { expect, test } from "bun:test";
import { join } from "node:path";

const profiles = [
  ...["headers", "cookie", "token", "jwt", "cookie-token", "cookie-token-jwt"].map((auth) => ({
    name: `sqlite-${auth}`,
    flags: [`--auth=${auth}`, ...(auth === "cookie" ? ["--dev"] : [])],
  })),
  { name: "mysql-cookie-redis-smtp-security-extras", flags: ["--auth=cookie", "--mysql", "--dev"] },
  { name: "sqlite-token-with-web", flags: ["--auth=token", "--with-web", "--crud"] },
  {
    name: "sqlite-cookie-custom-prefix-with-web",
    flags: ["--auth=cookie", "--with-web", "--api-prefix=/backend/v2", "--dev"],
  },
  {
    name: "mysql-cookie-redis-with-web",
    flags: ["--auth=cookie", "--mysql", "--with-web", "--dev"],
  },
  {
    name: "mysql-token-with-web-scoped-crud",
    flags: ["--auth=token", "--mysql", "--with-web", "--crud"],
  },
  {
    name: "postgres-token-with-web-scoped-crud",
    flags: ["--auth=token", "--postgres", "--with-web", "--crud"],
  },
  { name: "sqlite-cookie-typed-handlers", flags: ["--auth=cookie", "--typed-handlers"] },
  {
    name: "sqlite-token-typed-handlers-with-web-scoped-crud",
    flags: ["--auth=token", "--with-web", "--crud", "--typed-handlers"],
  },
  {
    name: "sqlite-cookie-typed-handlers-custom-prefix",
    flags: ["--auth=cookie", "--with-web", "--api-prefix=/backend/v2", "--typed-handlers"],
  },
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
