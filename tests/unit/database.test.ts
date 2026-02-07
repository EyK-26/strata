import { describe, expect, test } from "bun:test";
import {
  buildSelectQuery,
  buildWhereClause,
  defineTable,
  indexHasManyRelation,
} from "../../src/core/database";
import { characterHasManyNemeses } from "../../src/modules/character/relationships";
import { nemesisHasManySecrets } from "../../src/modules/nemesis/relationships";
import type { Character } from "../../src/types/character";
import type { Nemesis } from "../../src/types/nemesis";
import type { Secret } from "../../src/types/secret";

describe("database query helpers", () => {
  test("builds where clauses with equality, ranges, and IN filters", () => {
    const { clause, params } = buildWhereClause<Nemesis>("nemesis", {
      is_alive: true,
      years: { gt: 0, lte: 300 },
      character_id: [1, 2],
    });

    expect(clause).toBe(
      ' WHERE "nemesis"."is_alive" = $1 AND "nemesis"."years" > $2 AND "nemesis"."years" <= $3 AND "nemesis"."character_id" IN ($4, $5)',
    );
    expect(params).toEqual([true, 0, 300, 1, 2]);
  });

  test("builds select queries with table metadata defaults", () => {
    const userTable = defineTable<{ id: number; name: string }, "id">({
      name: "user_account",
      primaryKey: "id",
      columns: ["id", "name"],
      defaultOrderBy: { column: "id", direction: "DESC" },
    });

    const { text, params } = buildSelectQuery(userTable, {
      where: { id: { gte: 10 } },
      limit: 5,
    });

    expect(text).toBe(
      'SELECT "user_account"."id", "user_account"."name" FROM "user_account" WHERE "user_account"."id" >= $1 ORDER BY "user_account"."id" DESC LIMIT 5',
    );
    expect(params).toEqual([10]);
  });
});

describe("database relationship helpers", () => {
  test("indexes hasMany relations while preserving empty parent groups", () => {
    const characters: Character[] = [
      {
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
      {
        id: 2,
        name: "Ford Prefect",
        gender: "male",
        ability: "improvise",
        minimal_distance: "10m",
        weight: 75,
        born: new Date("1990-01-01T00:00:00.000Z"),
        in_space_since: new Date("2020-01-01T00:00:00.000Z"),
        beer_consumption: 7,
        knows_the_answer: true,
      },
    ];

    const nemeses: Nemesis[] = [
      { id: 1, character_id: 1, is_alive: true, years: 120 },
      { id: 2, character_id: 1, is_alive: false, years: 0 },
    ];

    const secrets: Secret[] = [
      { id: 1, nemesis_id: 1, secret_code: "42" },
      { id: 2, nemesis_id: 1, secret_code: "DON'T PANIC" },
    ];

    const nemesesByCharacterId = indexHasManyRelation(
      characters,
      nemeses,
      characterHasManyNemeses,
    );
    const secretsByNemesisId = indexHasManyRelation(
      nemeses,
      secrets,
      nemesisHasManySecrets,
    );

    expect(nemesesByCharacterId.get(1)).toEqual(nemeses);
    expect(nemesesByCharacterId.get(2)).toEqual([]);
    expect(secretsByNemesisId.get(1)).toEqual(secrets);
    expect(secretsByNemesisId.get(2)).toEqual([]);
  });
});
