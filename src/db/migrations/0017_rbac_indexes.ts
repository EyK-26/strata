import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0017_rbac_indexes",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("organization_member", (table) => {
        table.index(["user_id"], { name: "idx_organization_member_user_id" });
      });
    });
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("organization_member", (table) => {
        table.dropIndex("idx_organization_member_user_id");
      });
    });
  },
};

export default migration;
