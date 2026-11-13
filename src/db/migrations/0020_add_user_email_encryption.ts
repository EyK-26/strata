import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0020_add_user_email_encryption",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.string("email_lookup").nullable();
        table.partialIndex(["email_lookup"], "email_lookup IS NOT NULL", {
          name: "idx_users_email_lookup",
          unique: true,
        });
      });
    });

    await db.unsafe(
      `
      UPDATE users
      SET email_lookup = LOWER(TRIM(email))
      WHERE email_lookup IS NULL
    `,
      [],
    );
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.dropIndex("idx_users_email_lookup");
        table.dropColumn("email_lookup");
      });
    });
  },
};

export default migration;
