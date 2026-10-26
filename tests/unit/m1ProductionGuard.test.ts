import { expect, test } from "bun:test";
import { collectProviders } from "@getstrata/bootstrap/context";
import { startGuardedApplication } from "../../src/bootstrap/m1/application";

const safe = {
  APP_ENV: "production",
  APP_URL: "https://forms.example.test",
  AUTH_DEV_HEADERS: "false",
  FRONTEND_MODE: "api",
  SESSION_SECRET: "owned-production-fixture-secret-32-characters",
  DATABASE_URL: "sqlite://:memory:",
  APP_DATABASE_URL: "sqlite://:memory:",
  // CI exports development tokens. This production fixture owns its token/SCIM settings.
  FEATURE_API_TOKENS: "true",
  FEATURE_SCIM: "true",
  ADMIN_API_TOKEN: "owned-production-admin-fixture",
  MEMBER_API_TOKEN: "owned-production-member-fixture",
  SCIM_BEARER_TOKEN: "owned-production-scim-fixture",
  TOKEN_HASH_PEPPER: "owned-production-token-fixture-pepper",
  API_TOKEN_DEFAULT_EXPIRY_DAYS: "30",
};
for (const [setting, value, message] of [
  ["SESSION_SECRET", "dev-session-secret-change-me-please-32ch", /placeholder/],
  ["AUTH_DEV_HEADERS", "true", /AUTH_DEV_HEADERS=false/],
  ["APP_URL", "http://localhost:3000", /public origin/],
  ["ADMIN_API_TOKEN", "strata-admin-test-token", /published test defaults/],
  ["MEMBER_API_TOKEN", "strata-member-test-token", /published test defaults/],
  ["SCIM_BEARER_TOKEN", "strata-scim-test-token", /SCIM_BEARER_TOKEN/],
  ["TOKEN_HASH_PEPPER", "", /TOKEN_HASH_PEPPER/],
  ["API_TOKEN_DEFAULT_EXPIRY_DAYS", "", /API_TOKEN_DEFAULT_EXPIRY_DAYS/],
] as const) {
  test(`M1 rejects unsafe production ${setting} before providers run`, async () => {
    const previous = new Map(Object.keys(safe).map((key) => [key, process.env[key]]));
    let acquired = 0;
    let app: Awaited<ReturnType<typeof startGuardedApplication>> | undefined;
    Object.assign(process.env, safe, { [setting]: value });
    try {
      await expect(
        startGuardedApplication({
          providers: [
            ...collectProviders([]).filter((provider) =>
              ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
                provider.name,
              ),
            ),
            {
              name: "untouched",
              register() {
                acquired++;
              },
            },
          ],
          modules: [],
        }).then((value) => {
          app = value;
          return value;
        }),
      ).rejects.toThrow(message);
      expect(acquired).toBe(0);
    } finally {
      await app?.shutdown();
      for (const [key, old] of previous) {
        if (old === undefined) delete process.env[key];
        else process.env[key] = old;
      }
    }
  });
}
test("valid production settings use the same providers and permit shutdown and corrected startup", async () => {
  const previous = new Map(Object.keys(safe).map((key) => [key, process.env[key]]));
  Object.assign(process.env, safe);
  try {
    const providers = collectProviders([]).filter((provider) =>
      ["core.config", "core.cache", "core.storage", "core.auth", "core.policy"].includes(
        provider.name,
      ),
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const app = await startGuardedApplication({ providers, modules: [] });
      expect(app.server.port).toBeGreaterThan(0);
      expect((await app.shutdown()).successful).toBe(true);
    }
  } finally {
    for (const [key, old] of previous) {
      if (old === undefined) delete process.env[key];
      else process.env[key] = old;
    }
  }
});
