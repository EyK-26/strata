import { BaseRepository } from "../../core/database";
import type { Nemesis } from "../../types/nemesis";
import type { SecretRepositoryLike } from "../../types/repositories";
import type { Secret } from "../../types/secret";
import { nemesisHasManySecrets } from "../nemesis/relationships";
import { secretTable } from "./table";

class SecretRepository
  extends BaseRepository<Secret, "id">
  implements SecretRepositoryLike
{
  constructor() {
    super(secretTable);
  }

  async findByNemesisId(nemesisId: number): Promise<Secret[]> {
    return await this.findByHasManyRelation(nemesisHasManySecrets, nemesisId);
  }

  async findByNemesisIds(nemesisIds: readonly number[]): Promise<Secret[]> {
    const uniqueNemesisIds = [...new Set(nemesisIds)];

    if (uniqueNemesisIds.length === 0) {
      return [];
    }

    return await this.findWhere({
      nemesis_id: uniqueNemesisIds,
    });
  }

  async loadByNemeses(
    nemeses: readonly Nemesis[],
  ): Promise<Map<number, Secret[]>> {
    return await this.loadHasManyForParents(nemeses, nemesisHasManySecrets);
  }
}

export default SecretRepository;
