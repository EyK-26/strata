import { describe, expect, test } from "bun:test";
import {
  foreignKeyFromTable,
  pivotTableName,
  singularize,
} from "@getstrata/core/database/inflection";

describe("database inflection", () => {
  test("singularize handles regular, ies, and sibilant plurals", () => {
    expect(singularize("users")).toBe("user");
    expect(singularize("companies")).toBe("company");
    expect(singularize("statuses")).toBe("status");
    expect(singularize("addresses")).toBe("address");
    expect(singularize("boxes")).toBe("box");
    expect(singularize("quizzes")).toBe("quizz");
    expect(singularize("churches")).toBe("church");
    expect(singularize("dishes")).toBe("dish");
    expect(singularize("class")).toBe("class");
    expect(singularize("role")).toBe("role");
  });

  test("builds foreign keys and alpha-sorted pivot names", () => {
    expect(foreignKeyFromTable("users")).toBe("user_id");
    expect(foreignKeyFromTable("articles")).toBe("article_id");
    expect(pivotTableName("articles", "tags")).toBe("article_tag");
    expect(pivotTableName("tags", "articles")).toBe("article_tag");
  });
});
