interface HasManyRelation<
  TParent,
  TChild,
  LocalKey extends keyof TParent & string = keyof TParent & string,
  ForeignKey extends keyof TChild & string = keyof TChild & string,
> {
  type: "hasMany";
  name: string;
  localKey: LocalKey;
  foreignKey: ForeignKey;
}

interface HasOneRelation<
  TParent,
  TChild,
  LocalKey extends keyof TParent & string = keyof TParent & string,
  ForeignKey extends keyof TChild & string = keyof TChild & string,
> {
  type: "hasOne";
  name: string;
  localKey: LocalKey;
  foreignKey: ForeignKey;
}

interface BelongsToRelation<
  TChild,
  TParent,
  ForeignKey extends keyof TChild & string = keyof TChild & string,
  OwnerKey extends keyof TParent & string = keyof TParent & string,
> {
  type: "belongsTo";
  name: string;
  foreignKey: ForeignKey;
  ownerKey: OwnerKey;
}

interface BelongsToManyRelation<
  TParent,
  TRelated,
  Pivot extends object,
  ParentKey extends keyof TParent & string = keyof TParent & string,
  RelatedKey extends keyof TRelated & string = keyof TRelated & string,
  ForeignPivotKey extends keyof Pivot & string = keyof Pivot & string,
  RelatedPivotKey extends keyof Pivot & string = keyof Pivot & string,
> {
  type: "belongsToMany";
  name: string;
  pivotTable: string;
  parentKey: ParentKey;
  relatedKey: RelatedKey;
  foreignPivotKey: ForeignPivotKey;
  relatedPivotKey: RelatedPivotKey;
}

interface HasManyThroughRelation<
  TParent,
  TFar,
  LocalKey extends keyof TParent & string = keyof TParent & string,
  FirstKey extends string = string,
  SecondLocalKey extends string = string,
  SecondKey extends keyof TFar & string = keyof TFar & string,
> {
  type: "hasManyThrough";
  name: string;
  throughTable: string;
  localKey: LocalKey;
  firstKey: FirstKey;
  secondLocalKey: SecondLocalKey;
  secondKey: SecondKey;
  throughParentKey?: string;
}

function hasMany<
  TParent,
  TChild,
  LocalKey extends keyof TParent & string = keyof TParent & string,
  ForeignKey extends keyof TChild & string = keyof TChild & string,
>(definition: {
  name: string;
  localKey: LocalKey;
  foreignKey: ForeignKey;
}): HasManyRelation<TParent, TChild, LocalKey, ForeignKey> {
  return {
    type: "hasMany",
    ...definition,
  };
}

function hasOne<
  TParent,
  TChild,
  LocalKey extends keyof TParent & string = keyof TParent & string,
  ForeignKey extends keyof TChild & string = keyof TChild & string,
>(definition: {
  name: string;
  localKey: LocalKey;
  foreignKey: ForeignKey;
}): HasOneRelation<TParent, TChild, LocalKey, ForeignKey> {
  return {
    type: "hasOne",
    ...definition,
  };
}

function belongsTo<
  TChild,
  TParent,
  ForeignKey extends keyof TChild & string = keyof TChild & string,
  OwnerKey extends keyof TParent & string = keyof TParent & string,
>(definition: {
  name: string;
  foreignKey: ForeignKey;
  ownerKey: OwnerKey;
}): BelongsToRelation<TChild, TParent, ForeignKey, OwnerKey> {
  return {
    type: "belongsTo",
    ...definition,
  };
}

function hasManyThrough<
  TParent,
  TFar,
  LocalKey extends keyof TParent & string = keyof TParent & string,
  FirstKey extends string = string,
  SecondLocalKey extends string = string,
  SecondKey extends keyof TFar & string = keyof TFar & string,
>(definition: {
  name: string;
  throughTable: string;
  localKey: LocalKey;
  firstKey: FirstKey;
  secondLocalKey: SecondLocalKey;
  secondKey: SecondKey;
  throughParentKey?: string;
}): HasManyThroughRelation<TParent, TFar, LocalKey, FirstKey, SecondLocalKey, SecondKey> {
  return {
    type: "hasManyThrough",
    throughParentKey: "__through_parent_id",
    ...definition,
  };
}

function belongsToMany<
  TParent,
  TRelated,
  Pivot extends object,
  ParentKey extends keyof TParent & string = keyof TParent & string,
  RelatedKey extends keyof TRelated & string = keyof TRelated & string,
  ForeignPivotKey extends keyof Pivot & string = keyof Pivot & string,
  RelatedPivotKey extends keyof Pivot & string = keyof Pivot & string,
>(definition: {
  name: string;
  pivotTable: string;
  parentKey: ParentKey;
  relatedKey: RelatedKey;
  foreignPivotKey: ForeignPivotKey;
  relatedPivotKey: RelatedPivotKey;
}): BelongsToManyRelation<
  TParent,
  TRelated,
  Pivot,
  ParentKey,
  RelatedKey,
  ForeignPivotKey,
  RelatedPivotKey
> {
  return {
    type: "belongsToMany",
    ...definition,
  };
}

function relationMatchKey(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value).toString();
  }

  return String(value);
}

function getByRelationKey<K, V>(map: ReadonlyMap<K, V>, key: unknown): V | undefined {
  if (map.has(key as K)) {
    return map.get(key as K);
  }

  const want = relationMatchKey(key);

  if (want === "") {
    return undefined;
  }

  for (const [existing, value] of map) {
    if (relationMatchKey(existing) === want) {
      return value;
    }
  }

  return undefined;
}

function indexHasManyRelation<
  TParent,
  TChild,
  LocalKey extends keyof TParent & string,
  ForeignKey extends keyof TChild & string,
>(
  parents: readonly TParent[],
  children: readonly TChild[],
  relation: HasManyRelation<TParent, TChild, LocalKey, ForeignKey>,
): Map<TParent[LocalKey], TChild[]> {
  const groups = new Map<string, TChild[]>();
  const originalKeys = new Map<string, TParent[LocalKey]>();

  for (const parent of parents) {
    const key = relationMatchKey(parent[relation.localKey]);
    if (!groups.has(key)) {
      groups.set(key, []);
      originalKeys.set(key, parent[relation.localKey]);
    }
  }

  for (const child of children) {
    const group = groups.get(relationMatchKey(child[relation.foreignKey]));

    if (!group) {
      continue;
    }

    group.push(child);
  }

  const result = new Map<TParent[LocalKey], TChild[]>();

  for (const [key, group] of groups) {
    const original = originalKeys.get(key);
    if (original !== undefined) {
      result.set(original, group);
    }
  }

  return result;
}

function indexHasOneRelation<
  TParent,
  TChild,
  LocalKey extends keyof TParent & string,
  ForeignKey extends keyof TChild & string,
>(
  parents: readonly TParent[],
  children: readonly TChild[],
  relation: HasOneRelation<TParent, TChild, LocalKey, ForeignKey>,
): Map<TParent[LocalKey], TChild | undefined> {
  const grouped = indexHasManyRelation(
    parents,
    children,
    relation as unknown as HasManyRelation<TParent, TChild, LocalKey, ForeignKey>,
  );

  const result = new Map<TParent[LocalKey], TChild | undefined>();

  for (const parent of parents) {
    const matches = getByRelationKey(grouped, parent[relation.localKey]) ?? [];
    result.set(parent[relation.localKey], matches[0]);
  }

  return result;
}

function indexBelongsToRelation<
  TChild,
  TParent,
  ForeignKey extends keyof TChild & string,
  OwnerKey extends keyof TParent & string,
>(
  children: readonly TChild[],
  parents: readonly TParent[],
  relation: BelongsToRelation<TChild, TParent, ForeignKey, OwnerKey>,
): Map<TChild[ForeignKey], TParent> {
  const parentsById = new Map<string, TParent>();

  for (const parent of parents) {
    parentsById.set(relationMatchKey(parent[relation.ownerKey]), parent);
  }

  const result = new Map<TChild[ForeignKey], TParent>();

  for (const child of children) {
    const foreignKey = child[relation.foreignKey];
    const parent = parentsById.get(relationMatchKey(foreignKey));

    if (parent) {
      result.set(foreignKey, parent);
    }
  }

  return result;
}

function indexBelongsToManyRelation<
  TParent,
  TRelated,
  Pivot extends object,
  ParentKey extends keyof TParent & string,
  RelatedKey extends keyof TRelated & string,
  ForeignPivotKey extends keyof Pivot & string,
  RelatedPivotKey extends keyof Pivot & string,
>(
  parents: readonly TParent[],
  pivotRows: readonly Pivot[],
  relatedRows: readonly TRelated[],
  relation: BelongsToManyRelation<
    TParent,
    TRelated,
    Pivot,
    ParentKey,
    RelatedKey,
    ForeignPivotKey,
    RelatedPivotKey
  >,
): Map<TParent[ParentKey], TRelated[]> {
  const relatedById = new Map<string, TRelated>();

  for (const related of relatedRows) {
    relatedById.set(relationMatchKey(related[relation.relatedKey]), related);
  }

  const groups = new Map<string, TRelated[]>();
  const originalKeys = new Map<string, TParent[ParentKey]>();

  for (const parent of parents) {
    const key = relationMatchKey(parent[relation.parentKey]);
    if (!groups.has(key)) {
      groups.set(key, []);
      originalKeys.set(key, parent[relation.parentKey]);
    }
  }

  for (const pivot of pivotRows) {
    const group = groups.get(relationMatchKey(pivot[relation.foreignPivotKey]));
    const related = relatedById.get(relationMatchKey(pivot[relation.relatedPivotKey]));

    if (!group || !related) {
      continue;
    }

    group.push(related);
  }

  const result = new Map<TParent[ParentKey], TRelated[]>();

  for (const [key, group] of groups) {
    const original = originalKeys.get(key);
    if (original !== undefined) {
      result.set(original, group);
    }
  }

  return result;
}

interface MorphManyRelation<
  TParent,
  TChild,
  LocalKey extends keyof TParent & string = keyof TParent & string,
  MorphTypeKey extends keyof TChild & string = keyof TChild & string,
  MorphIdKey extends keyof TChild & string = keyof TChild & string,
> {
  type: "morphMany";
  name: string;
  localKey: LocalKey;
  morphTypeKey: MorphTypeKey;
  morphIdKey: MorphIdKey;
  morphType: string;
}

interface MorphOneRelation<
  TParent,
  TChild,
  LocalKey extends keyof TParent & string = keyof TParent & string,
  MorphTypeKey extends keyof TChild & string = keyof TChild & string,
  MorphIdKey extends keyof TChild & string = keyof TChild & string,
> {
  type: "morphOne";
  name: string;
  localKey: LocalKey;
  morphTypeKey: MorphTypeKey;
  morphIdKey: MorphIdKey;
  morphType: string;
}

interface MorphToRelation<
  TChild,
  MorphTypeKey extends keyof TChild & string = keyof TChild & string,
  MorphIdKey extends keyof TChild & string = keyof TChild & string,
> {
  type: "morphTo";
  name: string;
  morphTypeKey: MorphTypeKey;
  morphIdKey: MorphIdKey;
}

function morphMany<
  TParent,
  TChild,
  LocalKey extends keyof TParent & string = keyof TParent & string,
  MorphTypeKey extends keyof TChild & string = keyof TChild & string,
  MorphIdKey extends keyof TChild & string = keyof TChild & string,
>(definition: {
  name: string;
  localKey: LocalKey;
  morphTypeKey: MorphTypeKey;
  morphIdKey: MorphIdKey;
  morphType: string;
}): MorphManyRelation<TParent, TChild, LocalKey, MorphTypeKey, MorphIdKey> {
  return {
    type: "morphMany",
    ...definition,
  };
}

function morphOne<
  TParent,
  TChild,
  LocalKey extends keyof TParent & string = keyof TParent & string,
  MorphTypeKey extends keyof TChild & string = keyof TChild & string,
  MorphIdKey extends keyof TChild & string = keyof TChild & string,
>(definition: {
  name: string;
  localKey: LocalKey;
  morphTypeKey: MorphTypeKey;
  morphIdKey: MorphIdKey;
  morphType: string;
}): MorphOneRelation<TParent, TChild, LocalKey, MorphTypeKey, MorphIdKey> {
  return {
    type: "morphOne",
    ...definition,
  };
}

function morphTo<
  TChild,
  MorphTypeKey extends keyof TChild & string = keyof TChild & string,
  MorphIdKey extends keyof TChild & string = keyof TChild & string,
>(definition: {
  name: string;
  morphTypeKey: MorphTypeKey;
  morphIdKey: MorphIdKey;
}): MorphToRelation<TChild, MorphTypeKey, MorphIdKey> {
  return {
    type: "morphTo",
    ...definition,
  };
}

function indexMorphManyRelation<
  TParent,
  TChild,
  LocalKey extends keyof TParent & string,
  MorphTypeKey extends keyof TChild & string,
  MorphIdKey extends keyof TChild & string,
>(
  parents: readonly TParent[],
  children: readonly TChild[],
  relation: MorphManyRelation<TParent, TChild, LocalKey, MorphTypeKey, MorphIdKey>,
): Map<TParent[LocalKey], TChild[]> {
  const groups = new Map<string, TChild[]>();
  const originalKeys = new Map<string, TParent[LocalKey]>();

  for (const parent of parents) {
    const key = relationMatchKey(parent[relation.localKey]);
    if (!groups.has(key)) {
      groups.set(key, []);
      originalKeys.set(key, parent[relation.localKey]);
    }
  }

  for (const child of children) {
    if (child[relation.morphTypeKey] !== relation.morphType) {
      continue;
    }

    const group = groups.get(relationMatchKey(child[relation.morphIdKey]));

    if (!group) {
      continue;
    }

    group.push(child);
  }

  const result = new Map<TParent[LocalKey], TChild[]>();

  for (const [key, group] of groups) {
    const original = originalKeys.get(key);
    if (original !== undefined) {
      result.set(original, group);
    }
  }

  return result;
}

function indexMorphOneRelation<
  TParent,
  TChild,
  LocalKey extends keyof TParent & string,
  MorphTypeKey extends keyof TChild & string,
  MorphIdKey extends keyof TChild & string,
>(
  parents: readonly TParent[],
  children: readonly TChild[],
  relation: MorphOneRelation<TParent, TChild, LocalKey, MorphTypeKey, MorphIdKey>,
): Map<TParent[LocalKey], TChild | undefined> {
  const grouped = indexMorphManyRelation(
    parents,
    children,
    relation as unknown as MorphManyRelation<TParent, TChild, LocalKey, MorphTypeKey, MorphIdKey>,
  );
  const result = new Map<TParent[LocalKey], TChild | undefined>();

  for (const parent of parents) {
    const matches = getByRelationKey(grouped, parent[relation.localKey]) ?? [];
    result.set(parent[relation.localKey], matches[0]);
  }

  return result;
}

function indexHasManyThroughRelation<
  TParent,
  TFar,
  LocalKey extends keyof TParent & string,
  FirstKey extends string,
  SecondLocalKey extends string,
  SecondKey extends keyof TFar & string,
>(
  parents: readonly TParent[],
  children: readonly (TFar & Record<string, unknown>)[],
  relation: HasManyThroughRelation<TParent, TFar, LocalKey, FirstKey, SecondLocalKey, SecondKey>,
): Map<TParent[LocalKey], TFar[]> {
  const throughKey = relation.throughParentKey ?? "__through_parent_id";
  const grouped = new Map<string, TFar[]>();

  for (const child of children) {
    const key = relationMatchKey(child[throughKey]);
    if (key === "") {
      continue;
    }
    const existing = grouped.get(key) ?? [];
    const { [throughKey]: _through, ...far } = child;
    existing.push(far as TFar);
    grouped.set(key, existing);
  }

  const result = new Map<TParent[LocalKey], TFar[]>();
  for (const parent of parents) {
    const key = relationMatchKey(parent[relation.localKey]);
    result.set(parent[relation.localKey], grouped.get(key) ?? []);
  }

  return result;
}

function indexMorphToRelation<
  TChild,
  TParent extends object,
  MorphTypeKey extends keyof TChild & string,
  MorphIdKey extends keyof TChild & string,
  _OwnerKey extends keyof TParent & string = keyof TParent & string,
>(
  children: readonly TChild[],
  parentsByType: ReadonlyMap<string, ReadonlyMap<unknown, TParent>>,
  relation: MorphToRelation<TChild, MorphTypeKey, MorphIdKey>,
): Map<TChild[MorphIdKey], TParent> {
  const result = new Map<TChild[MorphIdKey], TParent>();

  for (const child of children) {
    const morphType = String(child[relation.morphTypeKey]);
    const parents = parentsByType.get(morphType);

    if (!parents) {
      continue;
    }

    const parent = getByRelationKey(parents, child[relation.morphIdKey]);

    if (parent) {
      result.set(child[relation.morphIdKey], parent);
    }
  }

  return result;
}

export type {
  BelongsToManyRelation,
  BelongsToRelation,
  HasManyRelation,
  HasManyThroughRelation,
  HasOneRelation,
  MorphManyRelation,
  MorphOneRelation,
  MorphToRelation,
};
export {
  belongsTo,
  belongsToMany,
  getByRelationKey,
  hasMany,
  hasManyThrough,
  hasOne,
  indexBelongsToManyRelation,
  indexBelongsToRelation,
  indexHasManyRelation,
  indexHasManyThroughRelation,
  indexHasOneRelation,
  indexMorphManyRelation,
  indexMorphOneRelation,
  indexMorphToRelation,
  morphMany,
  morphOne,
  morphTo,
  relationMatchKey,
};
