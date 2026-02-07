import type { CharacterRecord, Genders, JSONTree } from "./JSONTree";
import type { Character } from "./character";
import type { Statistics } from "./statistics";

interface CacheLike {
  getOrSet<T>(key: string, loader: () => Promise<T>): Promise<T>;
  invalidate(key: string): boolean;
  clear(): void;
  size(): number;
}

interface CharacterServiceLike {
  getCharactersWithNemesisAndSecrets(): Promise<Character[]>;
  getCharactersWithNemesisAndSecrets(options: {
    asTree: false;
  }): Promise<Character[]>;
  getCharactersWithNemesisAndSecrets(options: {
    asTree: true;
  }): Promise<CharacterRecord[]>;
  getCharactersWithNemesisAndSecrets(options?: {
    asTree?: boolean;
  }): Promise<Character[] | CharacterRecord[]>;
}

interface StatisticsServiceLike {
  getAverageWeightOfCharacters(): Promise<number>;
  getGroupedGenderCountOfCharacters(): Promise<Genders>;
  getAverageAgeOfAll(): Promise<number>;
  getStatistics(): Promise<Statistics>;
}

interface JSONTreeServiceLike {
  buildJSONTree(): Promise<JSONTree>;
}

export type {
  CacheLike,
  CharacterServiceLike,
  JSONTreeServiceLike,
  StatisticsServiceLike,
};
