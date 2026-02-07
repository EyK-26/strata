import { describe, expect, test } from "bun:test";
import {
  expectObject,
  parseJsonBody,
  parseOptionalBooleanQueryParam,
  parseOptionalEnumQueryParam,
  parseOptionalPositiveIntQueryParam,
} from "../../src/core/http";
import {
  parseCharacterIdParams,
  parseCharacterListQuery,
} from "../../src/modules/character/requests";
import { parseNemesisListQuery } from "../../src/modules/nemesis/requests";
import {
  toCharacterResource,
  toJSONTreeResource,
} from "../../src/modules/character/resources";
import type { JSONTree } from "../../src/types/JSONTree";
import type { Character } from "../../src/types/character";

describe("module request helpers", () => {
  test("parseCharacterIdParams returns a typed integer id", () => {
    expect(parseCharacterIdParams({ id: "42" })).toEqual({ id: 42 });
    expect(() => parseCharacterIdParams({ id: "nope" })).toThrow(
      "Invalid character id. Expected a positive integer.",
    );
  });

  test("parses validated query DTOs for character and nemesis lists", () => {
    const characterRequest = new Request(
      "http://example.test/characters?limit=1&gender=male",
    );
    const nemesisRequest = new Request(
      "http://example.test/nemesis?limit=2&isAlive=true",
    );

    expect(parseCharacterListQuery(characterRequest)).toEqual({
      limit: 1,
      gender: "male",
    });
    expect(parseNemesisListQuery(nemesisRequest)).toEqual({
      limit: 2,
      isAlive: true,
    });
  });
});

describe("http validation helpers", () => {
  test("validates primitive query helpers", () => {
    const params = new URLSearchParams("limit=3&isAlive=false&gender=female");

    expect(parseOptionalPositiveIntQueryParam(params, "limit")).toBe(3);
    expect(parseOptionalBooleanQueryParam(params, "isAlive")).toBe(false);
    expect(
      parseOptionalEnumQueryParam(params, "gender", [
        "female",
        "male",
        "other",
      ]),
    ).toBe("female");
  });

  test("parses JSON bodies through a DTO validator", async () => {
    const request = new Request("http://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Arthur Dent", active: true }),
    });

    const dto = await parseJsonBody(request, (payload) => {
      const body = expectObject(payload);
      const name = body.name;
      const active = body.active;

      if (typeof name !== "string" || name.length === 0) {
        throw new Error("name is required");
      }

      if (typeof active !== "boolean") {
        throw new Error("active must be boolean");
      }

      return { name, active };
    });

    expect(dto).toEqual({ name: "Arthur Dent", active: true });
  });
});

describe("module resources", () => {
  test("serializes character dates and nested relations", () => {
    const character: Character = {
      id: 1,
      name: "Arthur Dent",
      gender: "male",
      ability: "panic",
      minimal_distance: "5m",
      weight: 82,
      born: new Date("2000-01-01T00:00:00.000Z"),
      in_space_since: new Date("2024-01-01T00:00:00.000Z"),
      beer_consumption: 3,
      knows_the_answer: false,
      nemeses: [
        {
          id: 10,
          character_id: 1,
          is_alive: true,
          years: 120,
          secrets: [
            {
              id: 100,
              nemesis_id: 10,
              secret_code: "42",
            },
          ],
        },
      ],
    };

    expect(toCharacterResource(character)).toEqual({
      id: 1,
      name: "Arthur Dent",
      gender: "male",
      ability: "panic",
      minimal_distance: "5m",
      weight: 82,
      born: "2000-01-01T00:00:00.000Z",
      in_space_since: "2024-01-01T00:00:00.000Z",
      beer_consumption: 3,
      knows_the_answer: false,
      nemeses: [
        {
          id: 10,
          character_id: 1,
          is_alive: true,
          years: 120,
          secrets: [
            {
              id: 100,
              nemesis_id: 10,
              secret_code: "42",
            },
          ],
        },
      ],
    });
  });

  test("serializes the final JSON tree recursively", () => {
    const tree: JSONTree = {
      characters_count: 1,
      average_age: 84,
      average_weight: 82,
      genders: { female: 0, male: 1, other: 0 },
      characters: [
        {
          data: {
            id: 1,
            name: "Arthur Dent",
            gender: "male",
            ability: "panic",
            minimal_distance: "5m",
            weight: 82,
            born: new Date("2000-01-01T00:00:00.000Z"),
            in_space_since: new Date("2024-01-01T00:00:00.000Z"),
            beer_consumption: 3,
            knows_the_answer: false,
          },
          children: {
            has_nemesis: {
              records: [
                {
                  data: {
                    id: 10,
                    character_id: 1,
                    is_alive: true,
                    years: 120,
                  },
                  children: {
                    has_secret: {
                      records: [
                        {
                          data: {
                            id: 100,
                            nemesis_id: 10,
                            secret_code: "42",
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    };

    expect(toJSONTreeResource(tree)).toEqual({
      characters_count: 1,
      average_age: 84,
      average_weight: 82,
      genders: { female: 0, male: 1, other: 0 },
      characters: [
        {
          data: {
            id: 1,
            name: "Arthur Dent",
            gender: "male",
            ability: "panic",
            minimal_distance: "5m",
            weight: 82,
            born: "2000-01-01T00:00:00.000Z",
            in_space_since: "2024-01-01T00:00:00.000Z",
            beer_consumption: 3,
            knows_the_answer: false,
          },
          children: {
            has_nemesis: {
              records: [
                {
                  data: {
                    id: 10,
                    character_id: 1,
                    is_alive: true,
                    years: 120,
                  },
                  children: {
                    has_secret: {
                      records: [
                        {
                          data: {
                            id: 100,
                            nemesis_id: 10,
                            secret_code: "42",
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    });
  });
});
