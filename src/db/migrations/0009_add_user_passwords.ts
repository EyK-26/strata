import { Schema } from "../../framework/public-api.ts";
import type { Migration } from "./types";

const migration: Migration = {
  name: "0009_add_user_passwords",
  async up(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.string("password_hash").nullable();
      });
    });
    await db.unsafe(
      `
      UPDATE users
      SET password_hash = ''
      WHERE password_hash IS NULL
    `,
      [],
    );
    await db.unsafe(
      `
      ALTER TABLE users
      ALTER COLUMN password_hash SET NOT NULL
    `,
      [],
    );
  },
  async down(db) {
    await Schema.run(db, "pgsql", (schema) => {
      schema.table("users", (table) => {
        table.dropColumn("password_hash");
      });
    });
  },
};

export default migration;
