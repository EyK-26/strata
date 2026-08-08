import { defineTable } from "../../core/database";
import type { UserRecord } from "./types";

const userTable = defineTable<UserRecord, "id">({
  name: "users",
  primaryKey: "id",
  columns: ["id", "name", "email", "role", "created_at", "updated_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export { userTable };
