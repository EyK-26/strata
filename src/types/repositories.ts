import type { QueryOptions } from "../core/database";
import type { Genders } from "./JSONTree";
import type { Character } from "./character";
import type { Nemesis } from "./nemesis";
import type { Secret } from "./secret";

interface CharacterRepositoryLike {
  findAll(options?: QueryOptions<Character>): Promise<Character[]>;
  findById(id: number): Promise<Character | null>;
  findByIdOrThrow(
    id: number,
    errorFactory?: (id: number) => Error,
  ): Promise<Character>;
  count(): Promise<number>;
  averageWeight(): Promise<number>;
  averageAge(): Promise<number>;
  findAllAges(): Promise<number[]>;
  countByGenderGroup(): Promise<Genders>;
}

interface NemesisRepositoryLike {
  findAll(options?: QueryOptions<Nemesis>): Promise<Nemesis[]>;
  findById(id: number): Promise<Nemesis | null>;
  findByIdOrThrow(
    id: number,
    errorFactory?: (id: number) => Error,
  ): Promise<Nemesis>;
  findByCharacterId(characterId: number): Promise<Nemesis[]>;
  loadByCharacters(
    characters: readonly Character[],
  ): Promise<Map<number, Nemesis[]>>;
  averageAge(): Promise<number>;
  findAllAges(): Promise<number[]>;
}

interface SecretRepositoryLike {
  findAll(options?: QueryOptions<Secret>): Promise<Secret[]>;
  findById(id: number): Promise<Secret | null>;
  findByIdOrThrow(
    id: number,
    errorFactory?: (id: number) => Error,
  ): Promise<Secret>;
  findByNemesisId(nemesisId: number): Promise<Secret[]>;
  loadByNemeses(nemeses: readonly Nemesis[]): Promise<Map<number, Secret[]>>;
}

export type {
  CharacterRepositoryLike,
  NemesisRepositoryLike,
  SecretRepositoryLike,
};
