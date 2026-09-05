import { getDatabase, pingDatabase } from "../src/db/connection";
import { freshDatabase } from "../src/db/migrations/runner";
import { assertSafeTestDatabaseReset } from "./helpers/assertSafeTestDatabaseReset";

const skipFixtureBootstrap =
  process.env.HIROAPP_TEST === "1" || process.env.SKIP_FIXTURE_TEST_BOOTSTRAP === "1";

if (process.env.DATABASE_URL) {
  getDatabase();
}

if (!skipFixtureBootstrap && (await pingDatabase())) {
  assertSafeTestDatabaseReset();
  await freshDatabase({ seed: true });
}
