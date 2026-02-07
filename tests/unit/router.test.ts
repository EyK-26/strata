import { describe, expect, test } from "bun:test";
import type { AppDependencies } from "../../src/bootstrap/dependencies";
import { ServiceContainer } from "../../src/bootstrap/contracts";
import { createRoutes } from "../../src/bootstrap/createRoutes";
import SimpleCache from "../../src/core/cache/simpleCache";
import type { CharacterRecord, JSONTree } from "../../src/types/JSONTree";
import type { Character } from "../../src/types/character";
import type { Nemesis } from "../../src/types/nemesis";
import type { Secret } from "../../src/types/secret";
import type { Statistics } from "../../src/types/statistics";

function normalizeJson<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

function createTestDependencies(): {
  dependencies: AppDependencies;
  calls: { statistics: number; jsonTree: number };
  statistics: Statistics;
  jsonTree: JSONTree;
} {
  const character: Character = {
    id: 1,
    name: "Arthur Dent",
    gender: "male",
    ability: "panic",
    minimal_distance: "5m",
    weight: 82,
    born: new Date("1978-03-11T00:00:00.000Z"),
    in_space_since: new Date("2024-01-01T00:00:00.000Z"),
    beer_consumption: 3,
    knows_the_answer: false,
  };

  const nemesis: Nemesis = {
    id: 10,
    character_id: 1,
    is_alive: true,
    years: 120,
  };

  const secret: Secret = {
    id: 100,
    secret_code: "42",
    nemesis_id: 10,
  };

  const formattedCharacter: Character = {
    ...character,
    nemeses: [
      {
        ...nemesis,
        secrets: [secret],
      },
    ],
  };

  const characterTree: CharacterRecord = {
    data: character,
    children: {
      has_nemesis: {
        records: [
          {
            data: nemesis,
            children: {
              has_secret: {
                records: [{ data: secret }],
              },
            },
          },
        ],
      },
    },
  };

  const statistics: Statistics = {
    countOfCharacters: 1,
    averageWeightOfCharacters: 82,
    averageDOBOfCharacters: 47,
    averageAgeOfNemesis: 120,
    averageAgeOfAll: 84,
    genderCountOfCharacters: {
      female: 0,
      male: 1,
      other: 0,
    },
  };

  const jsonTree: JSONTree = {
    characters_count: 1,
    average_age: 84,
    average_weight: 82,
    genders: {
      female: 0,
      male: 1,
      other: 0,
    },
    characters: [characterTree],
  };

  const calls = {
    statistics: 0,
    jsonTree: 0,
  };

  async function getCharactersWithNemesisAndSecrets(): Promise<Character[]>;
  async function getCharactersWithNemesisAndSecrets(options: {
    asTree: false;
  }): Promise<Character[]>;
  async function getCharactersWithNemesisAndSecrets(options: {
    asTree: true;
  }): Promise<CharacterRecord[]>;
  async function getCharactersWithNemesisAndSecrets(
    options: { asTree?: boolean } = {},
  ): Promise<Character[] | CharacterRecord[]> {
    if (options.asTree) {
      return [characterTree];
    }

    return [formattedCharacter];
  }

  const dependencies: AppDependencies = {
    container: new ServiceContainer(),
    cache: new SimpleCache(60_000, 20),
    characterRepository: {
      findAll: async () => [character],
      findById: async (id: number) => (id === 1 ? character : null),
      findByIdOrThrow: async (
        id: number,
        errorFactory?: (id: number) => Error,
      ) => {
        const foundCharacter = id === 1 ? character : null;

        if (foundCharacter) {
          return foundCharacter;
        }

        throw errorFactory?.(id) ?? new Error(`Character ${id} not found.`);
      },
      count: async () => 1,
      averageWeight: async () => 82,
      averageAge: async () => 47,
      findAllAges: async () => [47],
      countByGenderGroup: async () => ({ female: 0, male: 1, other: 0 }),
    },
    nemesisRepository: {
      findAll: async () => [nemesis],
      findById: async (id: number) => (id === 10 ? nemesis : null),
      findByIdOrThrow: async (
        id: number,
        errorFactory?: (id: number) => Error,
      ) => {
        const foundNemesis = id === 10 ? nemesis : null;

        if (foundNemesis) {
          return foundNemesis;
        }

        throw errorFactory?.(id) ?? new Error(`Nemesis ${id} not found.`);
      },
      findByCharacterId: async (characterId: number) =>
        characterId === 1 ? [nemesis] : [],
      loadByCharacters: async (characters: readonly Character[]) =>
        new Map(
          characters.map((currentCharacter) => [
            currentCharacter.id,
            currentCharacter.id === 1 ? [nemesis] : [],
          ]),
        ),
      averageAge: async () => 120,
      findAllAges: async () => [120],
    },
    secretRepository: {
      findAll: async () => [secret],
      findById: async (id: number) => (id === 100 ? secret : null),
      findByIdOrThrow: async (
        id: number,
        errorFactory?: (id: number) => Error,
      ) => {
        const foundSecret = id === 100 ? secret : null;

        if (foundSecret) {
          return foundSecret;
        }

        throw errorFactory?.(id) ?? new Error(`Secret ${id} not found.`);
      },
      findByNemesisId: async (nemesisId: number) =>
        nemesisId === 10 ? [secret] : [],
      loadByNemeses: async (nemeses: readonly Nemesis[]) =>
        new Map(
          nemeses.map((currentNemesis) => [
            currentNemesis.id,
            currentNemesis.id === 10 ? [secret] : [],
          ]),
        ),
    },
    characterService: {
      getCharactersWithNemesisAndSecrets,
    },
    statisticsService: {
      getAverageWeightOfCharacters: async () => 82,
      getGroupedGenderCountOfCharacters: async () => ({
        female: 0,
        male: 1,
        other: 0,
      }),
      getAverageAgeOfAll: async () => 84,
      getStatistics: async () => {
        calls.statistics += 1;
        return statistics;
      },
    },
    jsonTreeService: {
      buildJSONTree: async () => {
        calls.jsonTree += 1;
        return jsonTree;
      },
    },
  };

  return { dependencies, calls, statistics, jsonTree };
}

describe("routes", () => {
  test("returns JSON for an existing character", async () => {
    const { dependencies } = createTestDependencies();
    const routes = createRoutes(dependencies);

    const response = await routes["/characters/:id"]({ params: { id: "1" } });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual(
      normalizeJson(await dependencies.characterRepository.findById(1)),
    );
  });

  test("returns 400 for an invalid character id", async () => {
    const { dependencies } = createTestDependencies();
    const routes = createRoutes(dependencies);

    const response = await routes["/characters/:id"]({ params: { id: "abc" } });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid character id. Expected a positive integer.",
    });
  });

  test("returns 404 when a character does not exist", async () => {
    const { dependencies } = createTestDependencies();
    const routes = createRoutes(dependencies);

    const response = await routes["/characters/:id"]({ params: { id: "999" } });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Character 999 not found.",
    });
  });

  test("caches the statistics response", async () => {
    const { dependencies, calls, statistics } = createTestDependencies();
    const routes = createRoutes(dependencies);

    const firstResponse = await routes["/statistics"]();
    const secondResponse = await routes["/statistics"]();

    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual(normalizeJson(statistics));
    expect(await secondResponse.json()).toEqual(normalizeJson(statistics));
    expect(calls.statistics).toBe(1);
  });

  test("returns the final JSON tree as JSON", async () => {
    const { dependencies, calls, jsonTree } = createTestDependencies();
    const routes = createRoutes(dependencies);

    const response = await routes["/final-json-tree"]();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual(normalizeJson(jsonTree));
    expect(calls.jsonTree).toBe(1);
  });
});
