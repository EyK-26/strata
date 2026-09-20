import { hashPassword } from "@getstrata/core/auth/password";
import { migrateDatabase } from "@getstrata/core/database/migrations/runner";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { closeDatabase, getSql } from "../bootstrap/database.ts";
import { ensureAppDatabase } from "../bootstrap/ensureDatabase.ts";
import { Note } from "../models/Note.ts";
import { User } from "../models/User.ts";
import { loadStarterMigrations, withMigrationDatabase } from "./migrationRuntime.ts";

export async function seed() {
  await ensureAppDatabase();
  const sql = getSql();
  await runWithMigrationBypass(async () => {
    const [{ count: tenantCount }] = await sql.unsafe<{ count: string | number }>(
      "SELECT COUNT(*) AS count FROM tenant",
    );
    if (Number(tenantCount) === 0) {
      await sql.unsafe("INSERT INTO tenant (slug, plan, region) VALUES ($1, $2, $3)", [
        "default",
        "free",
        "eu",
      ]);
    }
    if ((await Note.query().value("id")) === null) {
      await Note.create({ body: "Welcome to Strata!", tenant_id: 1 });
    }
    if ((await User.query().value("id")) === null) {
      const password = await hashPassword("StrataDemo!ChangeMe");
      await User.create({
        name: "Demo User",
        email: "demo@example.com",
        password,
        is_admin: false,
        email_verified_at: new Date().toISOString(),
      });
      await User.create({
        name: "Admin User",
        email: "admin@example.test",
        password,
        is_admin: true,
        email_verified_at: new Date().toISOString(),
      });
    }
  });
}

export async function migrate() {
  await ensureAppDatabase();
  await withMigrationDatabase(async (db) => {
    await migrateDatabase(db, await loadStarterMigrations());
  });
  await seed();
}

/** The CLI calls this after migrate() so pooled drivers do not hold the process open. */
export async function close() {
  await closeDatabase();
}

if (import.meta.main) {
  await migrate();
  console.log("Database migrated and seeded.");
  await close();
  process.exit(0);
}
