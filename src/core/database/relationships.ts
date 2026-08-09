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
  const groups = new Map<TParent[LocalKey], TChild[]>();

  for (const parent of parents) {
    groups.set(parent[relation.localKey], []);
  }

  for (const child of children) {
    const key = child[relation.foreignKey] as unknown as TParent[LocalKey];
    const group = groups.get(key);

    if (!group) {
      continue;
    }

    group.push(child);
  }

  return groups;
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
    const matches = grouped.get(parent[relation.localKey]) ?? [];
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
  const parentsById = new Map<TParent[OwnerKey], TParent>();

  for (const parent of parents) {
    parentsById.set(parent[relation.ownerKey], parent);
  }

  const result = new Map<TChild[ForeignKey], TParent>();

  for (const child of children) {
    const foreignKey = child[relation.foreignKey];
    const parent = parentsById.get(foreignKey as unknown as TParent[OwnerKey]);

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
  const relatedById = new Map<TRelated[RelatedKey], TRelated>();

  for (const related of relatedRows) {
    relatedById.set(related[relation.relatedKey], related);
  }

  const groups = new Map<TParent[ParentKey], TRelated[]>();

  for (const parent of parents) {
    groups.set(parent[relation.parentKey], []);
  }

  for (const pivot of pivotRows) {
    const parentId = pivot[relation.foreignPivotKey] as unknown as TParent[ParentKey];
    const relatedId = pivot[relation.relatedPivotKey] as unknown as TRelated[RelatedKey];
    const group = groups.get(parentId);
    const related = relatedById.get(relatedId);

    if (!group || !related) {
      continue;
    }

    group.push(related);
  }

  return groups;
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
  const groups = new Map<TParent[LocalKey], TChild[]>();

  for (const parent of parents) {
    groups.set(parent[relation.localKey], []);
  }

  for (const child of children) {
    if (child[relation.morphTypeKey] !== relation.morphType) {
      continue;
    }

    const key = child[relation.morphIdKey] as unknown as TParent[LocalKey];
    const group = groups.get(key);

    if (!group) {
      continue;
    }

    group.push(child);
  }

  return groups;
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
    const matches = grouped.get(parent[relation.localKey]) ?? [];
    result.set(parent[relation.localKey], matches[0]);
  }

  return result;
}

function indexMorphToRelation<
  TChild,
  TParent extends object,
  MorphTypeKey extends keyof TChild & string,
  MorphIdKey extends keyof TChild & string,
  OwnerKey extends keyof TParent & string,
>(
  children: readonly TChild[],
  parentsByType: ReadonlyMap<string, ReadonlyMap<TParent[OwnerKey], TParent>>,
  relation: MorphToRelation<TChild, MorphTypeKey, MorphIdKey>,
): Map<TChild[MorphIdKey], TParent> {
  const result = new Map<TChild[MorphIdKey], TParent>();

  for (const child of children) {
    const morphType = String(child[relation.morphTypeKey]);
    const parents = parentsByType.get(morphType);

    if (!parents) {
      continue;
    }

    const parent = parents.get(child[relation.morphIdKey] as unknown as TParent[OwnerKey]);

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
  HasOneRelation,
  MorphManyRelation,
  MorphOneRelation,
  MorphToRelation,
};
export {
  belongsTo,
  belongsToMany,
  hasMany,
  hasOne,
  indexBelongsToManyRelation,
  indexBelongsToRelation,
  indexHasManyRelation,
  indexHasOneRelation,
  indexMorphManyRelation,
  indexMorphOneRelation,
  indexMorphToRelation,
  morphMany,
  morphOne,
  morphTo,
};
