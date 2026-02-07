import type { Genders } from "./JSONTree";

interface Statistics {
  countOfCharacters: number;
  averageWeightOfCharacters: number;
  averageDOBOfCharacters: number;
  averageAgeOfNemesis: number;
  averageAgeOfAll: number;
  genderCountOfCharacters: Genders;
}

export type { Statistics };
