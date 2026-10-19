import { expect, test } from "bun:test";
import { runWithAuthContext } from "@getstrata/core/auth/authContext";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { createCsrfMiddleware } from "@getstrata/core/http/csrfMiddleware";
import { restoreEnvVar } from "../helpers/restoreEnv";

for (const [mode, flag, user, source, allowed] of [
  ["local", "true", true, "guest", true],
  ["test", "true", true, "guest", true],
  ["local", "false", true, "guest", false],
  ["local", "TRUE", true, "guest", false],
  ["local", "1", true, "guest", false],
  ["production", "true", true, "guest", false],
  ["staging", "true", true, "guest", false],
  ["local", "true", false, "guest", false],
  ["local", "true", false, null, false],
  ["local", "true", true, "session", false],
] as const)
  test(`development-header CSRF policy ${mode}/${flag}/${user}/${source} preserves cookie and anonymous protections`, async () => {
    const app = process.env.APP_ENV,
      dev = process.env.AUTH_DEV_HEADERS;
    Object.assign(process.env, { APP_ENV: mode, AUTH_DEV_HEADERS: flag });
    try {
      const middleware = createCsrfMiddleware();
      const response = () =>
        runWithAuthContext(user ? { id: 42 } : null, source, () =>
          middleware(
            new Request("https://app.example.test/api/notes", {
              method: "POST",
              headers: { "x-credential-source": "guest", "x-authenticated-user-id": "42" },
            }),
            async () => Response.json({ ok: true }),
          ),
        );
      if (allowed) expect((await response()).status).toBe(200);
      else await expect(response()).rejects.toThrow(ForbiddenError);
    } finally {
      restoreEnvVar("APP_ENV", app);
      restoreEnvVar("AUTH_DEV_HEADERS", dev);
    }
  });
