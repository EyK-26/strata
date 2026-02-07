import type { Genders } from "../../types/JSONTree";
import type {
  CharacterRepositoryLike,
  NemesisRepositoryLike,
} from "../../types/repositories";
import type { Statistics } from "../../types/statistics";

class StatisticsService {
  constructor(
    private readonly characterRepository: CharacterRepositoryLike,
    private readonly nemesisRepository: NemesisRepositoryLike,
  ) {}

  async getAverageWeightOfCharacters(): Promise<number> {
    return await this.characterRepository.averageWeight();
  }

  async getGroupedGenderCountOfCharacters(): Promise<Genders> {
    return await this.characterRepository.countByGenderGroup();
  }

  async getAverageAgeOfAll(): Promise<number> {
    const [allAgesCharacters, allAgesNemesis] = await Promise.all([
      this.characterRepository.findAllAges(),
      this.nemesisRepository.findAllAges(),
    ]);
    const allAges = [...allAgesCharacters, ...allAgesNemesis];

    if (allAges.length === 0) {
      return 0;
    }

    return Math.round(
      allAges.reduce((sum, currentAge) => sum + currentAge, 0) / allAges.length,
    );
  }

  async getStatistics(): Promise<Statistics> {
    const [
      countOfCharacters,
      averageWeightOfCharacters,
      averageDOBOfCharacters,
      averageAgeOfNemesis,
      averageAgeOfAll,
      genderCountOfCharacters,
    ] = await Promise.all([
      this.characterRepository.count(),
      this.getAverageWeightOfCharacters(),
      this.characterRepository.averageAge(),
      this.nemesisRepository.averageAge(),
      this.getAverageAgeOfAll(),
      this.getGroupedGenderCountOfCharacters(),
    ]);

    return {
      countOfCharacters,
      averageWeightOfCharacters,
      averageDOBOfCharacters,
      averageAgeOfNemesis,
      averageAgeOfAll,
      genderCountOfCharacters,
    };
  }
}

export default StatisticsService;
