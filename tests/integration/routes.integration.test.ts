import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { JSONTree } from "../../src/types/JSONTree";
import type { Character } from "../../src/types/character";
import type { Statistics } from "../../src/types/statistics";

const TEST_DATABASE_URL = process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running integration tests.");
}

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

function getCurrentYear(): number {
  return new Date().getFullYear();
}

function getExpectedStatistics() {
  const currentYear = getCurrentYear();
  const characterAges = [currentYear - 2000, currentYear - 1980];
  const aliveNemesisAges = [120, 220];
  const allAges = [...characterAges, ...aliveNemesisAges];

  return {
    countOfCharacters: 2,
    averageWeightOfCharacters: 71,
    averageDOBOfCharacters: Math.round(
      characterAges.reduce((sum, age) => sum + age, 0) / characterAges.length,
    ),
    averageAgeOfNemesis: 170,
    averageAgeOfAll: Math.round(
      allAges.reduce((sum, age) => sum + age, 0) / allAges.length,
    ),
    genderCountOfCharacters: {
      female: 1,
      male: 1,
      other: 0,
    },
  };
}

async function getJson<T>(pathname: string): Promise<{
  response: Response;
  body: T;
}> {
  const response = await fetch(`${baseUrl}${pathname}`);
  return {
    response,
    body: (await response.json()) as T,
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  const [{ createAppDependencies }, { createRoutes }] = await Promise.all([
    import("../../src/bootstrap/dependencies"),
    import("../../src/bootstrap/createRoutes"),
  ]);

  server = Bun.serve({
    port: 0,
    routes: createRoutes(createAppDependencies()),
  });

  baseUrl = server.url.toString().replace(/\/$/, "");
});

afterAll(() => {
  server.stop(true);
});

describe("integration routes with postgres", () => {
  test("GET /characters returns seeded characters as JSON", async () => {
    const { response, body } = await getJson<Character[]>("/characters");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      id: 1,
      name: "Arthur Dent",
      gender: "male",
    });
    expect(body[1]).toMatchObject({
      id: 2,
      name: "Trillian Astra",
      gender: "female",
    });
  });

  test("GET /characters supports validated query DTO filters", async () => {
    const { response, body } = await getJson<Character[]>(
      "/characters?limit=1&gender=male",
    );

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: 1,
      gender: "male",
    });
  });

  test("GET /nemesis supports validated boolean query filters", async () => {
    const { response, body } = await getJson<Array<{ is_alive: boolean }>>(
      "/nemesis?isAlive=true&limit=2",
    );

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body.every((nemesis) => nemesis.is_alive)).toBe(true);
  });

  test("GET /characters/:id returns 400 for invalid ids", async () => {
    const { response, body } = await getJson<{ error: string }>(
      "/characters/not-a-number",
    );

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "Invalid character id. Expected a positive integer.",
    });
  });

  test("GET /characters returns 400 for invalid query params", async () => {
    const { response, body } = await getJson<{ error: string }>(
      "/characters?limit=0",
    );

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'Invalid query parameter "limit". Expected a positive integer.',
    });
  });

  test("GET /characters/:id returns 404 for missing rows", async () => {
    const { response, body } = await getJson<{ error: string }>(
      "/characters/999",
    );

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: "Character 999 not found.",
    });
  });

  test("GET /statistics returns computed values from postgres", async () => {
    const { response, body } = await getJson<Statistics>("/statistics");

    expect(response.status).toBe(200);
    expect(body).toEqual(getExpectedStatistics());
  });

  test("GET /final-json-tree returns the nested graph shape", async () => {
    const { response, body } = await getJson<JSONTree>("/final-json-tree");

    expect(response.status).toBe(200);
    expect(body.characters_count).toBe(2);
    expect(body.genders).toEqual({ female: 1, male: 1, other: 0 });
    expect(body.characters).toHaveLength(2);
    expect(body.characters[0]).toMatchObject({
      data: {
        id: 1,
        name: "Arthur Dent",
      },
      children: {
        has_nemesis: {
          records: [
            {
              data: {
                id: 1,
                character_id: 1,
              },
            },
            {
              data: {
                id: 2,
                character_id: 1,
              },
            },
          ],
        },
      },
    });
    const firstCharacter = body.characters[0];
    expect(firstCharacter).toBeDefined();

    const firstNemesis = firstCharacter?.children.has_nemesis.records[0];
    expect(firstNemesis).toBeDefined();

    expect(firstNemesis?.children.has_secret.records).toEqual([
      {
        data: {
          id: 1,
          secret_code: "DON'T PANIC",
          nemesis_id: 1,
        },
      },
      {
        data: {
          id: 2,
          secret_code: "42",
          nemesis_id: 1,
        },
      },
    ]);
  });
});
