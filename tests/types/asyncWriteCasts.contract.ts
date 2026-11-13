import { createServiceToken } from "@getstrata/core/contracts/token";
/** Compiled against source and packed declarations; not executed. */
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  defineModel,
  defineRepository,
  type RepositoryHooks,
} from "@getstrata/core/database/definitions";
import { applyCasts, dehydrateValue, Model } from "@getstrata/core/database/model";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";

type Attributes = Record<string, unknown>;
type Row = { id: number; name: string };
class Entity extends Model<Row, "id"> {}
const table = defineTable<Row, "id">({
  name: "async_cast_contract",
  primaryKey: "id",
  columns: ["id", "name"],
});
const synchronous: RepositoryHooks<Row, "id"> = {
  transformWrite: (_action, attributes) => ({ ...attributes }),
};
const asynchronous: RepositoryHooks<Row, "id"> = {
  transformWrite: async (_action, attributes) => await Promise.resolve({ ...attributes }),
};
const SyncRepository = defineRepository({
  name: "sync-cast-contract",
  table,
  dependencies: [],
  hooks: synchronous,
  create: (binding) => new BaseRepository(binding),
});
const AsyncRepository = defineRepository({
  name: "async-cast-contract",
  table,
  dependencies: [],
  hooks: asynchronous,
  create: (binding) => new BaseRepository(binding),
});
const SyncModel = defineModel({
  name: "SyncModel",
  repository: SyncRepository,
  dependencies: [],
  attributes: { guarded: [] },
  construct: (state, binding) => new Entity(state, binding),
});
const AsyncModel = defineModel({
  name: "AsyncModel",
  repository: AsyncRepository,
  dependencies: [],
  attributes: { guarded: [] },
  construct: (state, binding) => new Entity(state, binding),
});
const Prefix = createServiceToken<string>("cast-prefix");
export const DependencyCastModel = defineModel({
  name: "DependencyCast",
  repository: SyncRepository,
  dependencies: [Prefix] as const,
  attributes: {
    guarded: [],
    dehydrate: async (values, prefix) => ({ ...values, name: `${prefix}${values.name ?? ""}` }),
  },
  construct: (state, binding) => new Entity(state, binding),
});
defineModel({
  name: "WrongDependencyCast",
  repository: SyncRepository,
  dependencies: [Prefix] as const,
  attributes: {
    // @ts-expect-error Attribute transformation receives exactly the declared dependency values.
    dehydrate: (values, prefix: number) => ({ ...values, name: String(prefix) }),
  },
  construct: (state, binding) => new Entity(state, binding),
});
export async function asyncWriteCastContracts(database: DatabaseSession): Promise<void> {
  const values = { password: "plain" };
  const hydrated: Attributes = applyCasts(values, { password: "hashed" }, "hydrate");
  const pending: Promise<Attributes> = applyCasts(values, { password: "hashed" }, "dehydrate");
  const written: Attributes = await pending;
  const hash: Promise<unknown> = dehydrateValue("plain", "hashed");
  // @ts-expect-error Write casting must finish before a record is used.
  const early: Attributes = applyCasts(values, { password: "hashed" }, "dehydrate");
  // @ts-expect-error A password hash is asynchronous.
  const earlyHash: string = dehydrateValue("plain", "hashed");
  await database.model(SyncModel).create({ name: "sync" });
  await database.model(AsyncModel).create({ name: "async" });
  void [hydrated, written, hash, early, earlyHash];
}
