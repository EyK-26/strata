import { BaseRepository, qualifyColumn } from "../../core/database";
import type { Genders } from "../../types/JSONTree";
import type { Character } from "../../types/character";
import type { CharacterRepositoryLike } from "../../types/repositories";
import { characterTable } from "./table";

class CharacterRepository
  extends BaseRepository<Character, "id">
  implements CharacterRepositoryLike
{
  constructor() {
    super(characterTable);
  }

  async count(): Promise<number> {
    return await this.countWhere();
  }

  async averageWeight(): Promise<number> {
    return await this.averageColumn("weight");
  }

  async averageAge(): Promise<number> {
    const bornColumn = qualifyColumn(characterTable.name, "born");

    return await this.averageExpression(
      `AVG(EXTRACT(YEAR FROM AGE(CURRENT_DATE, ${bornColumn})))`,
      "average_age",
    );
  }

  async findAllAges(): Promise<number[]> {
    const bornColumn = qualifyColumn(characterTable.name, "born");

    return await this.pluckNumberValues(
      `EXTRACT(YEAR FROM AGE(CURRENT_DATE, ${bornColumn}))`,
      "age",
    );
  }

  async countByGenderGroup(): Promise<Genders> {
    const rows = await this.countGroupedBy("gender");

    return rows.reduce<Genders>(
      (accumulator, { value, count }) => {
        switch (value?.toLowerCase()) {
          case "female":
          case "f":
            accumulator.female += count;
            break;
          case "male":
          case "m":
            accumulator.male += count;
            break;
          default:
            accumulator.other += count;
            break;
        }

        return accumulator;
      },
      { female: 0, male: 0, other: 0 },
    );
  }
}

export default CharacterRepository;
