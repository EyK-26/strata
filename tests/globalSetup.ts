import { getDatabase, pingDatabase } from "../src/db/connection";
import { freshDatabase } from "../src/db/migrations/runner";
import { assertSafeTestDatabaseReset } from "./helpers/assertSafeTestDatabaseReset";

if (process.env.DATABASE_URL) {
  getDatabase();
}

// CI runs `migrate:fresh --seed` before tests; skip the duplicate reset there.
if (process.env.WORKHUB_SKIP_TEST_BOOTSTRAP !== "1" && (await pingDatabase())) {
  assertSafeTestDatabaseReset();
  await freshDatabase({ seed: true });
}
