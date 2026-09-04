import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0018_add_user_security_fields",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.timestamp("email_verified_at").nullable();
        table.string("mfa_secret").nullable();
        table.boolean("mfa_enabled").default(false);
        table.text("mfa_recovery_codes").nullable();
        table.string("profile_photo_path").nullable();
        table.timestamp("session_valid_after").nullable();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.dropColumn("email_verified_at");
        table.dropColumn("mfa_secret");
        table.dropColumn("mfa_enabled");
        table.dropColumn("mfa_recovery_codes");
        table.dropColumn("profile_photo_path");
        table.dropColumn("session_valid_after");
      });
    });
  },
};

export default migration;
