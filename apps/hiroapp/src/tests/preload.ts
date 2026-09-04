import { join } from "node:path";
import {
  configureModulesDirectory,
  ensureModulesLoaded,
} from "@getstrata/bootstrap/discoverModules";
import { freshDatabase, loadMigrationsFromDirectory } from "@getstrata/core/database/migrations";
import { assertSafeTestDatabaseReset } from "../../../../tests/helpers/assertSafeTestDatabaseReset.ts";
import { bindDatabase } from "../bootstrap/database.ts";
import { ensureHiroappDatabase } from "../db/ensureDatabase.ts";
import { runAppSeeders } from "../db/seeder.ts";

process.env.HIROAPP_TEST = "1";
process.env.APP_ENV ??= "testing";
process.env.DOGFOOD_APP = "hiroapp";
process.env.APP_KEY_PREFIX = "hiroapp";
process.env.APP_NAME = "HiroApp";
process.env.FRONTEND_MODE ??= "server-htmx";
process.env.QUEUE_DRIVER ??= "sync";
process.env.MAIL_DRIVER ??= "log";
process.env.CACHE_DRIVER ??= "array";
process.env.HIROAPP_SEED_SCALE ??= "demo";
process.env.FEATURE_ETAG ??= "true";
process.env.TENANCY_DRIVER ??= "rls";
process.env.SCIM_BEARER_TOKEN ??= "hiroapp-scim-test-token";
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_hiroapp_test";

await ensureHiroappDatabase();
assertSafeTestDatabaseReset();

configureModulesDirectory(join(import.meta.dir, "../modules"));
await ensureModulesLoaded();

if (process.env.HIROAPP_SKIP_TEST_BOOTSTRAP !== "1") {
  const db = bindDatabase();
  const migrations = await loadMigrationsFromDirectory(join(import.meta.dir, "../db/migrations"));
  await freshDatabase(db, migrations, { advisoryLock: true });
  await runAppSeeders();
}
