import {
  BaseRepository,
  type QueryWhere,
  qualifyColumn,
} from "../../core/database";
import type { Character } from "../../types/character";
import type { Nemesis } from "../../types/nemesis";
import type { NemesisRepositoryLike } from "../../types/repositories";
import { characterHasManyNemeses } from "../character/relationships";
import { nemesisTable } from "./table";

const livingNemesisWhere = {
  is_alive: true,
  years: { gt: 0 },
} satisfies QueryWhere<Nemesis>;

class NemesisRepository
  extends BaseRepository<Nemesis, "id">
  implements NemesisRepositoryLike
{
  constructor() {
    super(nemesisTable);
  }

  async findByCharacterId(characterId: number): Promise<Nemesis[]> {
    return await this.findByHasManyRelation(
      characterHasManyNemeses,
      characterId,
    );
  }

  async findByCharacterIds(
    characterIds: readonly number[],
  ): Promise<Nemesis[]> {
    const uniqueCharacterIds = [...new Set(characterIds)];

    if (uniqueCharacterIds.length === 0) {
      return [];
    }

    return await this.findWhere({
      character_id: uniqueCharacterIds,
    });
  }

  async loadByCharacters(
    characters: readonly Character[],
  ): Promise<Map<number, Nemesis[]>> {
    return await this.loadHasManyForParents(
      characters,
      characterHasManyNemeses,
    );
  }

  async averageAge(): Promise<number> {
    return await this.averageColumn("years", livingNemesisWhere);
  }

  async findAllAges(): Promise<number[]> {
    return await this.pluckNumberValues(
      qualifyColumn(nemesisTable.name, "years"),
      "years",
      { where: livingNemesisWhere },
    );
  }
}

export default NemesisRepository;
