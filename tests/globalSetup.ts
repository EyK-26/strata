import { join } from "node:path";
import {
  configureModulesDirectory,
  ensureModulesLoaded,
} from "@getstrata/bootstrap/discoverModules";
import { configureMembershipLookup } from "@getstrata/core/auth/membershipContext";
import { getDatabase, pingDatabase } from "../src/db/connection";
import { freshDatabase } from "../src/db/migrations/runner";
import OrganizationMemberRepository from "../src/modules/organization/memberRepository";
import { assertSafeTestDatabaseReset } from "./helpers/assertSafeTestDatabaseReset";

const hiroapp =
  process.env.HIROAPP_TEST === "1" ||
  (process.env.DOGFOOD_APP ?? "").trim().toLowerCase() === "hiroapp";

if (!hiroapp) {
  configureModulesDirectory(join(import.meta.dir, "../src/modules"));
  await ensureModulesLoaded();
  configureMembershipLookup(new OrganizationMemberRepository());

  if (process.env.DATABASE_URL) {
    getDatabase();
  }

  // CI runs `migrate:fresh --seed` before tests; skip the duplicate reset there.
  if (process.env.WORKHUB_SKIP_TEST_BOOTSTRAP !== "1" && (await pingDatabase())) {
    assertSafeTestDatabaseReset();
    await freshDatabase({ seed: true });
  }
}
