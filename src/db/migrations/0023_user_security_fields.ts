import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0023_user_security_fields",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.timestamp("email_verified_at").nullable().defaultRaw("NOW()");
        table.string("mfa_secret").nullable();
        table.boolean("mfa_enabled").default(false);
      });
    });

    await db.unsafe(
      `
      UPDATE users
      SET email_verified_at = COALESCE(email_verified_at, created_at)
      WHERE email_verified_at IS NULL
    `,
      [],
    );
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.dropColumn("email_verified_at");
        table.dropColumn("mfa_secret");
        table.dropColumn("mfa_enabled");
      });
    });
  },
};

export default migration;
