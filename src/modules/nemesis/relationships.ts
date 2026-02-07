import { belongsTo, hasMany } from "../../core/database";
import type { Character } from "../../types/character";
import type { Nemesis } from "../../types/nemesis";
import type { Secret } from "../../types/secret";

const nemesisBelongsToCharacter = belongsTo<Nemesis, Character>({
  name: "character",
  foreignKey: "character_id",
  ownerKey: "id",
});

const nemesisHasManySecrets = hasMany<Nemesis, Secret, "id", "nemesis_id">({
  name: "secrets",
  localKey: "id",
  foreignKey: "nemesis_id",
});

export { nemesisBelongsToCharacter, nemesisHasManySecrets };
