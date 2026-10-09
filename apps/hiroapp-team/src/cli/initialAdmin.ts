import { runInitialAdminCommand } from "@getstrata/cli/initialAdmin";
import { hashPassword } from "@getstrata/core/auth/password";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { closeDatabase, getSql } from "../bootstrap/database.ts";

export async function initialAdminCommand(...args: string[]): Promise<void> {
  await runInitialAdminCommand(args, {
    tenantRequired: false,
    async provision(input) {
      // Hash before acquiring the database claim; only the official auth helper owns crypto.
      const passwordHash = await hashPassword(input.password);
      try {
        getSql();
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
            await db.unsafe(
              "INSERT INTO users (name, email, password, is_admin) VALUES ($1, $2, $3, $4)",
              [input.name, input.email, passwordHash, true],
            );
            // Verification and MFA stay unenrolled; normal application flows remain authoritative.
          });
        await provision();
      } finally {
        await closeDatabase();
      }
    },
  });
  console.log(
    "Initial admin provisioned. Complete email verification and MFA through the application.",
  );
}
