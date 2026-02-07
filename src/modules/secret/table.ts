import { defineTable } from "../../core/database";
import type { Secret } from "../../types/secret";

const secretTable = defineTable<Secret, "id">({
  name: "secret",
  primaryKey: "id",
  columns: ["id", "secret_code", "nemesis_id"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export { secretTable };
