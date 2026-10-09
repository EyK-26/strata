import { authNeedsUsers, type StarterLayers, usesTenantTable } from "./types.ts";

function renderInitialAdminMigration(layers: StarterLayers): string | null {
  if (!authNeedsUsers(layers.auth)) return null;
  const driver = layers.database === "postgres" ? "pgsql" : layers.database;
  return `import { Schema } from "@getstrata/core/database/schema";
import type { Migration } from "@getstrata/core/database/migrations/types";

const migration: Migration = {
  name: "0004_initial_admin_provisioning",
  async up(db) {
    await Schema.run(db, "${driver}", schema => {
      schema.create("initial_admin_provisioning", table => {
        table.integer("id").primary();
        table.text("email");
        table.timestamp("provisioned_at").defaultRaw("CURRENT_TIMESTAMP");
      });
    });
  },
  async down(db) {
    if ((await db.unsafe("SELECT id FROM initial_admin_provisioning")).length) {
      throw new Error("Cannot discard a completed initial-admin provisioning claim.");
    }
    await Schema.run(db, "${driver}", schema => { schema.drop("initial_admin_provisioning"); });
  },
};
export default migration;
`;
}

function renderInitialAdminCommand(layers: StarterLayers): string | null {
  if (!authNeedsUsers(layers.auth)) return null;
  const tenant = usesTenantTable(layers.tenancy);
  const rls = layers.tenancy === "rls";
  const placeholder = layers.database === "postgres" ? "$1" : "?";
  const fields = ["name", "email", "password", "is_admin", ...(tenant ? ["tenant_id"] : [])];
  const placeholders = fields.map((_, index) =>
    layers.database === "postgres" ? `$${index + 1}` : "?",
  );
  return `import { runInitialAdminCommand } from "@getstrata/cli/initialAdmin";
import { hashPassword } from "@getstrata/core/auth/password";
import { runInTransaction } from "@getstrata/core/database/transaction";
${rls ? 'import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";\nimport { isRlsTenancy } from "@getstrata/core/tenant/tenancyConfig";\nimport { assertRlsLiveDatabaseRole } from "@getstrata/bootstrap/secretsGuard";\n' : ""}import { getSql, closeDatabase } from "../bootstrap/database.ts";

export async function initialAdminCommand(...args: string[]): Promise<void> {
  await runInitialAdminCommand(args, {
    tenantRequired: ${tenant},
    async provision(input) {
      // Hash before acquiring the database claim; only the official auth helper owns crypto.
      const passwordHash = await hashPassword(input.password);
      try {
        getSql();
${rls ? '        if (!isRlsTenancy()) throw new Error("RLS configuration is required.");\n        await assertRlsLiveDatabaseRole();\n' : ""}        const provision = () => runInTransaction(async db => {
          // The singleton primary key serializes bootstrap commands across all tenants/processes.
          await db.unsafe("INSERT INTO initial_admin_provisioning (id, email) VALUES (1, ${placeholder})", [input.email]);
          if ((await db.unsafe("SELECT id FROM users WHERE is_admin = ${layers.database === "postgres" ? "TRUE" : "1"} LIMIT 1")).length) {
            throw new Error("An admin already exists.");
          }
          if ((await db.unsafe("SELECT id FROM users WHERE LOWER(email) = ${placeholder}", [input.email])).length) {
            throw new Error("The account already exists; provisioning never promotes accounts.");
          }
${
  tenant
    ? `          if (!(await db.unsafe("SELECT id FROM tenant WHERE id = ${placeholder}", [input.tenantId])).length) {
            throw new Error("The tenant does not exist.");
          }
`
    : ""
}          await db.unsafe("INSERT INTO users (${fields.join(", ")}) VALUES (${placeholders.join(", ")})", [input.name, input.email, passwordHash, ${layers.database === "postgres" ? "true" : "1"}${tenant ? ", input.tenantId" : ""}]);
          // Verification and MFA stay unenrolled; normal application flows remain authoritative.
        });
        await ${rls ? "runWithMigrationBypass(provision)" : "provision()"};
      } finally {
        await closeDatabase();
      }
    },
  });
  console.log("Initial admin provisioned. Complete email verification and MFA through the application.");
}
`;
}

export { renderInitialAdminCommand, renderInitialAdminMigration };
