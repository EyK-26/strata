import { defineTable } from "../../core/database";
import type { Character } from "../../types/character";

const characterTable = defineTable<Character, "id">({
  name: "character",
  primaryKey: "id",
  columns: [
    "id",
    "name",
    "gender",
    "ability",
    "minimal_distance",
    "weight",
    "born",
    "in_space_since",
    "beer_consumption",
    "knows_the_answer",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export { characterTable };
