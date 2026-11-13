import type { StarterFeaturePlan } from "./featurePlan.ts";

function renderInitialAdminMigration(plan: StarterFeaturePlan): string | null {
  if (!plan.decisions.users) return null;
  const driver = plan.decisions.sqlDriver;
  return `import { Schema } from "@getstrata/core/database/schema";
import { guardMigrationRollback } from "@getstrata/core/database/migrations";
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
  async down(db, context) {
    await guardMigrationRollback(context, {
      hasHistory: async () => (await db.unsafe("SELECT id FROM initial_admin_provisioning")).length > 0,
      message: "Cannot discard a completed initial-admin provisioning claim.",
    });
    await Schema.run(db, "${driver}", schema => { schema.drop("initial_admin_provisioning"); });
  },
};
export default migration;
`;
}

function renderInitialAdminCommand(plan: StarterFeaturePlan): string | null {
  const layers = plan.layers;
  if (!plan.decisions.users) return null;
  const tenant = plan.decisions.tenantTable;
  const rls = plan.decisions.rls;
  const placeholder = layers.database === "postgres" ? "$1" : "?";
  const fields = ["name", "email", "password", "is_admin", ...(tenant ? ["tenant_id"] : [])];
  const placeholders = fields.map((_, index) =>
    layers.database === "postgres" ? `$${index + 1}` : "?",
  );
  return `import { runInitialAdminCommand } from "@getstrata/cli/initialAdmin";
import { hashPassword } from "@getstrata/core/auth/password";
import type { TransactionSession } from "@getstrata/core/database/session";
${rls ? 'import { assertRlsLiveDatabaseRole } from "@getstrata/bootstrap/secretsGuard";\n' : ""}import { bootstrapApp } from "../bootstrap/createApp.ts";

export async function initialAdminCommand(...args: string[]): Promise<void> {
  await runInitialAdminCommand(args, {
    tenantRequired: ${tenant},
    async provision(input) {
      // Hash before acquiring the database claim; only the official auth helper owns crypto.
      const passwordHash = await hashPassword(input.password);
      const app = await bootstrapApp({ migrate: false, mode: "command" });
      try {
        await app.invoke({ kind: "command", actor: { kind: "system", policy: "cli.initial-admin" } }, async ports => {
${rls ? '          await assertRlsLiveDatabaseRole({ ...process.env }, async () => { const rows = await ports.database.execute<{rolname:string;rolsuper:boolean;rolbypassrls:boolean}>({text:"SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",params:[]});return rows[0] ?? null; });\n' : ""}        const provision = async (db: TransactionSession) => {
          // The singleton primary key serializes bootstrap commands across all tenants/processes.
          await db.execute({text:"INSERT INTO initial_admin_provisioning (id, email) VALUES (1, ${placeholder})",params:[input.email]});
          if ((await db.execute({text:"SELECT id FROM users WHERE is_admin = ${layers.database === "postgres" ? "TRUE" : "1"} LIMIT 1",params:[]})).length) {
            throw new Error("An admin already exists.");
          }
          if ((await db.execute({text:"SELECT id FROM users WHERE LOWER(email) = ${placeholder}",params:[input.email]})).length) {
            throw new Error("The account already exists; provisioning never promotes accounts.");
          }
${
  tenant
    ? `          if (!(await db.execute({text:"SELECT id FROM tenant WHERE id = ${placeholder}",params:[input.tenantId]})).length) {
            throw new Error("The tenant does not exist.");
          }
`
    : ""
}          await db.execute({text:"INSERT INTO users (${fields.join(", ")}) VALUES (${placeholders.join(", ")})",params:[input.name, input.email, passwordHash, ${layers.database === "postgres" ? "true" : "1"}${tenant ? ", input.tenantId" : ""}]});
          // Verification and MFA stay unenrolled; normal application flows remain authoritative.
        };
        await ${rls ? 'ports.policy.run(ports.database, {kind:"bypass"}, provision)' : "ports.database.transaction(provision)"};
        });
      } finally {
        await app.context.dispose();
      }
    },
  });
  console.log("Initial admin provisioned. Complete email verification and MFA through the application.");
}
`;
}

export { renderInitialAdminCommand, renderInitialAdminMigration };
