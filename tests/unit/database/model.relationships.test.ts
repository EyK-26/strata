import { describe, expect, test } from "bun:test";
import {
  belongsToMany,
  getByRelationKey,
  hasOne,
  indexBelongsToManyRelation,
  indexHasOneRelation,
  relationMatchKey,
} from "@getstrata/core/database/relationships";

describe("relation key matching", () => {
  test("normalizes number, bigint, and numeric string to the same key", () => {
    expect(relationMatchKey(10)).toBe("10");
    expect(relationMatchKey(10n)).toBe("10");
    expect(relationMatchKey("10")).toBe("10");
    expect(relationMatchKey("01")).toBe("1");
    expect(relationMatchKey(null)).toBe("");
    expect(relationMatchKey(undefined)).toBe("");
    expect(relationMatchKey("office")).toBe("office");
    expect(relationMatchKey(Number.NaN)).toBe("NaN");
  });

  test("looks up Map values across int4/int8/string keys", () => {
    const byNumber = new Map<number, string>([[10, "alpha"]]);

    expect(getByRelationKey(byNumber, 10)).toBe("alpha");
    expect(getByRelationKey(byNumber, 10n)).toBe("alpha");
    expect(getByRelationKey(byNumber, "10")).toBe("alpha");
    expect(getByRelationKey(byNumber, null)).toBeUndefined();
    expect(getByRelationKey(byNumber, 99)).toBeUndefined();
  });
});

describe("hasOne indexing", () => {
  test("returns the first child per parent", () => {
    type Parent = { id: number };
    type Child = { id: number; parent_id: number; label: string };

    const relation = hasOne<Parent, Child, "id", "parent_id">({
      name: "profile",
      localKey: "id",
      foreignKey: "parent_id",
    });

    const indexed = indexHasOneRelation(
      [{ id: 1 }, { id: 2 }],
      [
        { id: 10, parent_id: 1, label: "first" },
        { id: 11, parent_id: 1, label: "second" },
        { id: 20, parent_id: 2, label: "only" },
      ],
      relation,
    );

    expect(indexed.get(1)).toEqual({ id: 10, parent_id: 1, label: "first" });
    expect(indexed.get(2)).toEqual({ id: 20, parent_id: 2, label: "only" });
  });

  test("matches int4 parent keys to int8 child foreign keys", () => {
    type Parent = { id: number };
    type Child = { id: number; parent_id: bigint; label: string };

    const relation = hasOne<Parent, Child, "id", "parent_id">({
      name: "profile",
      localKey: "id",
      foreignKey: "parent_id",
    });

    const indexed = indexHasOneRelation(
      [{ id: 1 }],
      [{ id: 10, parent_id: 1n, label: "first" }],
      relation,
    );

    expect(indexed.get(1)).toEqual({ id: 10, parent_id: 1n, label: "first" });
  });
});

describe("belongsToMany indexing", () => {
  test("groups related models through pivot rows", () => {
    type Tag = { id: number; name: string };
    type Post = { id: number; title: string };
    type Pivot = { post_id: number; tag_id: number };

    const relation = belongsToMany<Post, Tag, Pivot, "id", "id", "post_id", "tag_id">({
      name: "tags",
      pivotTable: "post_tag",
      parentKey: "id",
      relatedKey: "id",
      foreignPivotKey: "post_id",
      relatedPivotKey: "tag_id",
    });

    const grouped = indexBelongsToManyRelation(
      [{ id: 1, title: "Hello" }],
      [
        { post_id: 1, tag_id: 10 },
        { post_id: 1, tag_id: 20 },
      ],
      [
        { id: 10, name: "bun" },
        { id: 20, name: "typescript" },
      ],
      relation,
    );

    expect(grouped.get(1)).toEqual([
      { id: 10, name: "bun" },
      { id: 20, name: "typescript" },
    ]);
  });

  test("matches int4 keys to int8 pivot ids", () => {
    type Tag = { id: number; name: string };
    type Post = { id: number; title: string };
    type Pivot = { post_id: bigint; tag_id: bigint };

    const relation = belongsToMany<Post, Tag, Pivot, "id", "id", "post_id", "tag_id">({
      name: "tags",
      pivotTable: "post_tag",
      parentKey: "id",
      relatedKey: "id",
      foreignPivotKey: "post_id",
      relatedPivotKey: "tag_id",
    });

    const grouped = indexBelongsToManyRelation(
      [{ id: 1, title: "Hello" }],
      [{ post_id: 1n, tag_id: 10n }],
      [{ id: 10, name: "bun" }],
      relation,
    );

    expect(grouped.get(1)).toEqual([{ id: 10, name: "bun" }]);
  });
});
