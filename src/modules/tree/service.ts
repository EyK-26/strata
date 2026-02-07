import type { JSONTree as JSONTreeType } from "../../types/JSONTree";
import type { CharacterRepositoryLike } from "../../types/repositories";
import type {
  CharacterServiceLike,
  StatisticsServiceLike,
} from "../../types/services";

class JSONTreeService {
  constructor(
    private readonly characterRepository: CharacterRepositoryLike,
    private readonly statisticsService: StatisticsServiceLike,
    private readonly characterService: CharacterServiceLike,
  ) {}

  async buildJSONTree(): Promise<JSONTreeType> {
    const [characters_count, average_age, average_weight, genders, characters] =
      await Promise.all([
        this.characterRepository.count(),
        this.statisticsService.getAverageAgeOfAll(),
        this.statisticsService.getAverageWeightOfCharacters(),
        this.statisticsService.getGroupedGenderCountOfCharacters(),
        this.characterService.getCharactersWithNemesisAndSecrets({
          asTree: true,
        }),
      ]);

    return {
      characters_count,
      average_age,
      average_weight,
      genders,
      characters,
    };
  }
}

export default JSONTreeService;
