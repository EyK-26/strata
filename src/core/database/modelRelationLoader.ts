import type BaseRepository from "./baseRepository";
import type { AnyRelationQuery } from "./relationQuery";

/** Private nested relation loading: preserves concrete owners and absent morph targets. */
type RelationNameInput = string | readonly string[];

function flattenRelationNames(relations: ReadonlyArray<RelationNameInput>): string[] {
  const names: string[] = [];

  for (const item of relations) {
    if (typeof item === "string") {
      if (item.length > 0) {
        names.push(item);
      }
      continue;
    }

    if (Array.isArray(item)) {
      for (const nested of item) {
        if (typeof nested === "string" && nested.length > 0) {
          names.push(nested);
        }
      }
    }
  }

  return names;
}

function isLoadableModel(value: unknown): value is {
  load: (...names: string[]) => Promise<unknown>;
  loaded: (name: string) => unknown;
  constructor: object;
  getRepository: () => BaseRepository<Record<string, unknown>, "id">;
  toObject: () => object;
  setLoaded: (name: string, value: unknown) => unknown;
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { load?: unknown }).load === "function" &&
      typeof (value as { loaded?: unknown }).loaded === "function" &&
      typeof (value as { setLoaded?: unknown }).setLoaded === "function",
  );
}

function resolveModelRelation(model: object, name: string): AnyRelationQuery {
  const method = (model as Record<string, unknown>)[name];
  if (typeof method !== "function") {
    throw new Error(
      `${(model.constructor as { name: string }).name} has no relation method ${name}().`,
    );
  }
  return method.call(model) as AnyRelationQuery;
}

async function eagerLoadOnModels(
  models: Array<{
    loaded: (name: string) => unknown;
    constructor: object;
    getRepository: () => BaseRepository<Record<string, unknown>, "id">;
    toObject: () => object;
    setLoaded: (name: string, value: unknown) => unknown;
    load: (...names: string[]) => Promise<unknown>;
  }>,
  paths: string[],
  knownAbsentMorphRoots: ReadonlyMap<object, ReadonlySet<string>> = new Map(),
  preparedRoots: ReadonlyMap<object, ReadonlyMap<string, AnyRelationQuery>> = new Map(),
): Promise<void> {
  if (models.length === 0 || paths.length === 0) {
    return;
  }

  // A polymorphic edge can contain different concrete model types. Their next
  // relation methods and hydration owners cannot be borrowed from the first row.
  const byModel = new Map<object, typeof models>();
  for (const model of models) {
    const group = byModel.get(model.constructor) ?? [];
    group.push(model);
    byModel.set(model.constructor, group);
  }
  if (byModel.size > 1) {
    await Promise.all(
      [...byModel.values()].map((group) => eagerLoadOnModels(group, paths, knownAbsentMorphRoots)),
    );
    return;
  }

  const grouped = new Map<string, string[]>();

  for (const path of paths) {
    const [head, ...rest] = path.split(".");
    if (!head) {
      continue;
    }
    const nested = rest.join(".");
    const existing = grouped.get(head) ?? [];
    if (nested) {
      existing.push(nested);
    }
    grouped.set(head, existing);
  }

  await Promise.all(
    [...grouped.entries()].map(async ([head, nested]) => {
      // Skip only targets known absent for this model before retrieved observers.
      // An observer may explicitly invalidate a previously present relation.
      const unloaded = models.filter(
        (model) => model.loaded(head) === undefined && !knownAbsentMorphRoots.get(model)?.has(head),
      );

      const first = unloaded[0];
      if (first) {
        const relationQuery =
          preparedRoots.get(first)?.get(head) ?? resolveModelRelation(first, head);
        const query = first.getRepository().query();
        relationQuery.applyEagerLoad(query, head);
        const attached = await query.attachToRows(
          unloaded.map((model) => model.toObject() as Record<string, unknown>),
        );

        for (const [index, model] of unloaded.entries()) {
          const row = attached[index] ?? model.toObject();
          model.setLoaded(
            head,
            relationQuery.hydrateEager(row as Record<string, unknown>, head, nested.length > 0),
          );
        }
      }

      if (nested.length === 0) {
        return;
      }

      for (const model of models) {
        const value = model.loaded(head);
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          !isLoadableModel(value)
        ) {
          const relationQuery = resolveModelRelation(model, head);
          if (relationQuery.kind === "morphTo") {
            // A prior flat eager load caches records. Upgrade only when the
            // caller requests traversal, using those bytes without a refresh.
            model.setLoaded(
              head,
              relationQuery.hydrateEager({ ...model.toObject(), [head]: value }, head, true),
            );
          }
        }
      }

      const children = models.flatMap((model) => {
        const loaded = model.loaded(head);
        return Array.isArray(loaded) ? loaded : loaded ? [loaded] : [];
      });
      await eagerLoadOnModels(children.filter(isLoadableModel), nested);
    }),
  );
}

async function loadNested(
  model: {
    load: (...names: string[]) => Promise<unknown>;
    loaded: (name: string) => unknown;
    constructor: object;
    getRepository: () => BaseRepository<Record<string, unknown>, "id">;
    toObject: () => object;
    setLoaded: (name: string, value: unknown) => unknown;
  },
  path: string,
  preparedRoot?: AnyRelationQuery,
): Promise<void> {
  await eagerLoadOnModels(
    [model],
    [path],
    new Map(),
    preparedRoot
      ? new Map([[model, new Map([[path.split(".")[0] ?? path, preparedRoot]])]])
      : new Map(),
  );
}

export type { RelationNameInput };
export { eagerLoadOnModels, flattenRelationNames, isLoadableModel, loadNested };
