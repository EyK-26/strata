import type { BaseRepository } from "@getstrata/core/database/baseRepository";
import type { ModelQuery } from "@getstrata/core/database/model";
import {
  belongsTo,
  belongsToMany,
  hasMany,
  hasManyThrough,
  morphMany,
  morphOne,
  morphTo,
} from "@getstrata/core/database/relationships";
import type { QueryOptions } from "@getstrata/core/database/types";

type Parent = { id: number; parent_id: number; owner_type: string; owner_id: number };
type Child = { id: number; parent_id: number; owner_type: string; owner_id: number; label: string };
type Pivot = { parent_id: number; child_id: number };
declare const query: ModelQuery<{ toObject(): Parent }>;
declare const children: BaseRepository<Child, "id">;
declare const parents: BaseRepository<Parent, "id">;

function contracts() {
  const many = hasMany<Parent, Child>({
    name: "children",
    localKey: "id",
    foreignKey: "parent_id",
  });
  const one = belongsTo<Parent, Child>({ name: "parent", foreignKey: "parent_id", ownerKey: "id" });
  const pivot = belongsToMany<Parent, Child, Pivot>({
    name: "linked",
    pivotTable: "links",
    parentKey: "id",
    relatedKey: "id",
    foreignPivotKey: "parent_id",
    relatedPivotKey: "child_id",
  });
  const morphs = {
    name: "owned",
    localKey: "id",
    morphTypeKey: "owner_type",
    morphIdKey: "owner_id",
    morphType: "child",
  } as const;
  const through = hasManyThrough<Parent, Child>({
    name: "far",
    throughTable: "edges",
    localKey: "id",
    firstKey: "parent_id",
    secondLocalKey: "id",
    secondKey: "parent_id",
  });
  const same: typeof query = query.withHasMany("children", many, children);
  same.withBelongsTo("parent", one, children);
  same.withBelongsToMany("linked", pivot, children);
  same.withMorphMany("owned", morphMany<Parent, Child>(morphs), children);
  same.withMorphOne("ownedOne", morphOne<Parent, Child>(morphs), children);
  same.withMorphTo(
    "owner",
    morphTo<Parent>({ name: "owner", morphTypeKey: "owner_type", morphIdKey: "owner_id" }),
    new Map([["child", children]]),
    {},
    new Map<string, QueryOptions<Child>>([["child", { orderBy: { label: "asc" } }]]),
  );
  same.withHasManyThrough("far", through, children, { orderBy: { label: "desc" } });
  // @ts-expect-error A related repository remains required.
  query.withHasMany("children", many);
  // @ts-expect-error Related ordering belongs to Child, not an arbitrary record.
  query.withHasMany("children", many, children, { orderBy: { missing: "asc" } });
  query.withBelongsTo(
    "parent",
    belongsTo<Parent, { slug: string }>({
      name: "parent",
      foreignKey: "parent_id",
      ownerKey: "slug",
    }),
    // @ts-expect-error A string key is not the numeric child repository's primary key.
    children,
  );
  query.withMorphTo(
    "owner",
    morphTo<Parent>({ name: "owner", morphTypeKey: "owner_type", morphIdKey: "owner_id" }),
    new Map([["parent", parents]]),
    // @ts-expect-error A missing child label cannot satisfy a Child-specific relation option.
    { orderBy: { label: "asc" } },
  );
}
void contracts;
