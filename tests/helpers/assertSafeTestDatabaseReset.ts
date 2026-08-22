function databaseLooksLikeTest(databaseUrl: string): boolean {
  return /(?:^|[/_])(?:test|testing)(?:[/?#]|$)/i.test(databaseUrl);
}

function assertSafeTestDatabaseReset(env: Record<string, string | undefined> = process.env): void {
  if (env.WORKHUB_ALLOW_TEST_DB_RESET === "1") {
    return;
  }

  const appEnv = env.APP_ENV ?? "local";

  if (appEnv === "production") {
    throw new Error("Refusing migrate:fresh from test globalSetup when APP_ENV=production.");
  }

  const databaseUrl = env.DATABASE_URL ?? "";

  if (!databaseLooksLikeTest(databaseUrl)) {
    throw new Error(
      "Refusing migrate:fresh from test globalSetup: DATABASE_URL does not look like a test database. Set WORKHUB_ALLOW_TEST_DB_RESET=1 to override.",
    );
  }
}

export { assertSafeTestDatabaseReset, databaseLooksLikeTest };
