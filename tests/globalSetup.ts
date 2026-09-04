import { getDatabase, pingDatabase } from "../src/db/connection";
import { freshDatabase } from "../src/db/migrations/runner";
import { assertSafeTestDatabaseReset } from "./helpers/assertSafeTestDatabaseReset";

const skipWorkhubBootstrap =
  process.env.HIROAPP_TEST === "1" || process.env.WORKHUB_SKIP_TEST_BOOTSTRAP === "1";

if (process.env.DATABASE_URL) {
  getDatabase();
}

if (!skipWorkhubBootstrap && (await pingDatabase())) {
  assertSafeTestDatabaseReset();
  await freshDatabase({ seed: true });
}
