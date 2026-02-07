import { belongsTo } from "../../core/database";
import type { Nemesis } from "../../types/nemesis";
import type { Secret } from "../../types/secret";

const secretBelongsToNemesis = belongsTo<Secret, Nemesis>({
  name: "nemesis",
  foreignKey: "nemesis_id",
  ownerKey: "id",
});

export { secretBelongsToNemesis };
