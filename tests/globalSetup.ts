import { freshDatabase } from "../src/db/migrations/runner";
import { assertSafeTestDatabaseReset } from "./helpers/assertSafeTestDatabaseReset";
import { fixtureDatabase } from "./helpers/fixtureDatabase";

const skipFixtureBootstrap = process.env.SKIP_FIXTURE_TEST_BOOTSTRAP === "1";

if (process.env.DATABASE_URL) {
  fixtureDatabase.connection();
}

if (!skipFixtureBootstrap && (await fixtureDatabase.ping())) {
  const target = { ...process.env };
  assertSafeTestDatabaseReset(target);
  await freshDatabase({ seed: true, databaseUrl: target.DATABASE_URL });
}
