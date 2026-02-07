import type { Character } from "./character";
import type { Nemesis } from "./nemesis";
import type { Secret } from "./secret";

export interface SecretRecord {
  data: Secret;
}

export interface NemesisChildren {
  has_secret: {
    records: SecretRecord[];
  };
}

export interface NemesisRecord {
  data: Nemesis;
  children: NemesisChildren;
}

export interface CharacterChildren {
  has_nemesis: {
    records: NemesisRecord[];
  };
}

export interface CharacterRecord {
  data: Character;
  children: CharacterChildren;
}

export interface Genders {
  female: number;
  male: number;
  other: number;
}

export interface JSONTree {
  characters_count: number;
  average_age: number;
  average_weight: number;
  genders: Genders;
  characters: CharacterRecord[];
}
