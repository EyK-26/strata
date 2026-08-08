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

export type { BelongsToRelation, HasManyRelation };
export { belongsTo, hasMany, indexBelongsToRelation, indexHasManyRelation };
