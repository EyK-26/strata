import { describe, expect, test } from "bun:test";
import {
  belongsToMany,
  getByRelationKey,
  hasManyThrough,
  hasOne,
  indexBelongsToManyRelation,
  indexHasManyThroughRelation,
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

describe("hasManyThrough indexing", () => {
  type Department = { id: number };
  type Application = { id: number; position_id: number; title: string };

  const relation = hasManyThrough<
    Department,
    Application,
    "id",
    "department_id",
    "id",
    "position_id"
  >({
    name: "applications",
    throughTable: "positions",
    localKey: "id",
    firstKey: "department_id",
    secondLocalKey: "id",
    secondKey: "position_id",
  });

  test("groups far rows by the through parent key", () => {
    const grouped = indexHasManyThroughRelation(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      [
        { id: 10, position_id: 4, title: "A", __through_parent_id: 1 },
        { id: 11, position_id: 5, title: "B", __through_parent_id: 1n },
        { id: 20, position_id: 6, title: "C", __through_parent_id: "2" },
        { id: 99, position_id: 7, title: "skip", __through_parent_id: null },
      ],
      relation,
    );

    expect(grouped.get(1)).toEqual([
      { id: 10, position_id: 4, title: "A" },
      { id: 11, position_id: 5, title: "B" },
    ]);
    expect(grouped.get(2)).toEqual([{ id: 20, position_id: 6, title: "C" }]);
    expect(grouped.get(3)).toEqual([]);
  });

  test("uses a custom throughParentKey when provided", () => {
    const custom = hasManyThrough<
      Department,
      Application,
      "id",
      "department_id",
      "id",
      "position_id"
    >({
      name: "applications",
      throughTable: "positions",
      localKey: "id",
      firstKey: "department_id",
      secondLocalKey: "id",
      secondKey: "position_id",
      throughParentKey: "department_id",
    });

    const grouped = indexHasManyThroughRelation(
      [{ id: 8 }],
      [{ id: 1, position_id: 2, title: "X", department_id: 8 }],
      custom,
    );

    expect(grouped.get(8)).toEqual([{ id: 1, position_id: 2, title: "X" }]);
  });
});
