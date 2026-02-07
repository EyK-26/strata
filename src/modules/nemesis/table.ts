import { defineTable } from "../../core/database";
import type { Nemesis } from "../../types/nemesis";

const nemesisTable = defineTable<Nemesis, "id">({
  name: "nemesis",
  primaryKey: "id",
  columns: ["id", "is_alive", "years", "character_id"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export { nemesisTable };
