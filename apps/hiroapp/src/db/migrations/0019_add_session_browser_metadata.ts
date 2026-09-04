import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";

const migration: Migration = {
  name: "0019_add_session_browser_metadata",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("sessions", (table) => {
        table.text("user_agent").nullable();
        table.text("ip_address").nullable();
        table.timestamp("last_active_at").nullable();
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("sessions", (table) => {
        table.dropColumn("user_agent");
        table.dropColumn("ip_address");
        table.dropColumn("last_active_at");
      });
    });
  },
};

export default migration;
