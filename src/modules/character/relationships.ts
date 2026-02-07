import { hasMany } from "../../core/database";
import type { Character } from "../../types/character";
import type { Nemesis } from "../../types/nemesis";

const characterHasManyNemeses = hasMany<
  Character,
  Nemesis,
  "id",
  "character_id"
>({
  name: "nemeses",
  localKey: "id",
  foreignKey: "character_id",
});

export { characterHasManyNemeses };
