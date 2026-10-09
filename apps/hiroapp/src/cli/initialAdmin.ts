import { assertRlsLiveDatabaseRole } from "@getstrata/bootstrap/secretsGuard";
import { runInitialAdminCommand } from "@getstrata/cli/initialAdmin";
import { hashPassword } from "@getstrata/core/auth/password";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { isRlsTenancy } from "@getstrata/core/tenant/tenancyConfig";
import { closeDatabase, getSql } from "../bootstrap/database.ts";

export async function initialAdminCommand(...args: string[]): Promise<void> {
  await runInitialAdminCommand(args, {
    tenantRequired: true,
    async provision(input) {
      // Hash before acquiring the database claim; only the official auth helper owns crypto.
      const passwordHash = await hashPassword(input.password);
      try {
        getSql();
        if (!isRlsTenancy()) throw new Error("RLS configuration is required.");
        await assertRlsLiveDatabaseRole();
        const provision = () =>
          runInTransaction(async (db) => {
            // The singleton primary key serializes bootstrap commands across all tenants/processes.
            await db.unsafe("INSERT INTO initial_admin_provisioning (id, email) VALUES (1, $1)", [
              input.email,
            ]);
            if ((await db.unsafe("SELECT id FROM users WHERE is_admin = TRUE LIMIT 1")).length) {
              throw new Error("An admin already exists.");
            }
            if (
              (await db.unsafe("SELECT id FROM users WHERE LOWER(email) = $1", [input.email]))
                .length
            ) {
              throw new Error("The account already exists; provisioning never promotes accounts.");
            }
            if (
              !(await db.unsafe("SELECT id FROM tenant WHERE id = $1", [input.tenantId])).length
            ) {
              throw new Error("The tenant does not exist.");
            }
            await db.unsafe(
              "INSERT INTO users (name, email, password, is_admin, tenant_id) VALUES ($1, $2, $3, $4, $5)",
              [input.name, input.email, passwordHash, true, input.tenantId],
            );
            // Verification and MFA stay unenrolled; normal application flows remain authoritative.
          });
        await runWithMigrationBypass(provision);
      } finally {
        await closeDatabase();
      }
    },
  });
  console.log(
    "Initial admin provisioned. Complete email verification and MFA through the application.",
  );
}
