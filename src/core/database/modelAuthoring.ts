import type {
  AnyModelDefinition,
  ModelAttributeOptions,
  ModelBinding,
  ModelObserver,
  ModelState,
} from "@getstrata/core/database/definitions";
import {
  defineModel as defineDefinition,
  defineRepository,
} from "@getstrata/core/database/definitions";
import { BaseRepository, Model } from "#strata-orm-runtime";
import type { ServiceToken } from "../contracts/token";
import type { BaseRepository as Repository } from "./baseRepository";
import type { CastType } from "./modelAttributes";
import type { TableDefinition } from "./table";

const fieldBrand: unique symbol = Symbol("database.model.field");
declare const modelClassType: unique symbol;

/** A typed SQL attribute declaration. Migrations still own the database schema. */
interface ModelField<T> {
  readonly [fieldBrand]: T;
  readonly cast?: CastType;
  nullable(): ModelField<T | null>;
}
function modelField<T>(cast?: CastType): ModelField<T> {
  return Object.freeze({
    [fieldBrand]: undefined as T,
    ...(cast ? { cast } : {}),
    nullable: () => modelField<T | null>(cast),
  });
}
const field = Object.freeze({
  string: () => modelField<string>(),
  number: () => modelField<number>(),
  boolean: () => modelField<boolean | number>(),
  nullable: <T>(value: ModelField<T>): ModelField<T | null> => value.nullable(),
  timestamp: () => modelField<Date | string>(),
  date: () => modelField<Date | string>(),
  json: <T = unknown>() => modelField<T>("json"),
  binary: () => modelField<Uint8Array>(),
});
type ModelFields = Readonly<Record<string, ModelField<unknown>>>;
type InferModelFields<F extends ModelFields> = {
  -readonly [P in keyof F]: F[P] extends ModelField<infer T> ? T : never;
};
interface AuthoredModelClass<R extends object, K extends keyof R & string, M extends Model<R, K>> {
  new (state: ModelState<R>, binding: ModelBinding<R, K, Repository<R, K>>): M;
  readonly prototype: M;
  readonly [modelClassType]: { readonly row: R; readonly key: K };
}
/** Erased registration identity; generic session overloads recover the concrete class. */
interface AnyModelClass {
  readonly prototype: object;
  readonly [modelClassType]: { readonly row: object; readonly key: string };
}
type ClassModelRow<C extends AnyModelClass> = C[typeof modelClassType]["row"];
type ClassModelKey<C extends AnyModelClass> = C[typeof modelClassType]["key"] &
  keyof ClassModelRow<C> &
  string;
type ClassModelInstance<C extends AnyModelClass> = C["prototype"] &
  Model<ClassModelRow<C>, ClassModelKey<C>>;
type ModelClassOptions<
  F extends ModelFields,
  K extends keyof F & string = "id" & keyof F & string,
> = {
  table: string;
  fields: F;
  primaryKey?: K;
  name?: string;
  defaultOrderBy?: TableDefinition<InferModelFields<F>, K>["defaultOrderBy"];
  softDeletes?: TableDefinition<InferModelFields<F>, K>["softDeletes"];
} & ("id" extends keyof F ? unknown : { primaryKey: K });
interface ClassDeclaration {
  readonly table: TableDefinition<Record<string, unknown>, string>;
  readonly name?: string;
  readonly casts: Readonly<Record<string, CastType>>;
}
const declarations = new WeakMap<object, ClassDeclaration>();
function ownRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Model metadata must be a plain record.");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError("Model metadata must be a plain record.");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== "string" || !descriptor || !("value" in descriptor))
      throw new TypeError("Model metadata accessors are unsupported.");
    result[key] = descriptor.value;
  }
  return result;
}
function defineAuthoredModel<
  F extends ModelFields,
  K extends keyof F & string = "id" & keyof F & string,
>(
  options: ModelClassOptions<F, K>,
): AuthoredModelClass<InferModelFields<F>, K, Model<InferModelFields<F>, K>> {
  const values = ownRecord(options);
  if (
    Object.keys(values).some(
      (key) =>
        !["table", "fields", "primaryKey", "name", "defaultOrderBy", "softDeletes"].includes(key),
    )
  )
    throw new TypeError("Unknown class model option.");
  if (typeof values.table !== "string" || !values.table.trim())
    throw new TypeError("Model table must be a nonempty string.");
  const fields = ownRecord(values.fields);
  const columns = Object.keys(fields);
  const casts: Record<string, CastType> = Object.create(null);
  for (const [name, value] of Object.entries(fields)) {
    if (
      !name ||
      !value ||
      typeof value !== "object" ||
      !Object.isFrozen(value) ||
      !Object.hasOwn(value, fieldBrand)
    )
      throw new TypeError("Expected a typed model field.");
    const cast = (value as ModelField<unknown>).cast;
    if (cast) casts[name] = cast;
  }
  const primaryKey = values.primaryKey ?? "id";
  if (typeof primaryKey !== "string" || !columns.includes(primaryKey))
    throw new TypeError("Model primary key must be a declared field.");
  // Reuse definition validation and table snapshotting; this repository has no session.
  const repository = defineRepository({
    name: `${values.table}.declaration`,
    table: {
      name: values.table,
      primaryKey,
      columns,
      defaultOrderBy: values.defaultOrderBy,
      softDeletes: values.softDeletes,
    } as TableDefinition<Record<string, unknown>, string>,
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
  });
  if (values.name !== undefined && (typeof values.name !== "string" || !values.name.trim()))
    throw new TypeError("Model name must be a nonempty string.");
  class AuthoredModel extends Model<InferModelFields<F>, K> {}
  declarations.set(
    AuthoredModel,
    Object.freeze({
      table: repository.table,
      ...(values.name === undefined ? {} : { name: values.name as string }),
      casts: Object.freeze(casts),
    }),
  );
  return AuthoredModel as unknown as AuthoredModelClass<
    InferModelFields<F>,
    K,
    Model<InferModelFields<F>, K>
  >;
}
function declarationFor(value: unknown): ClassDeclaration | undefined {
  if (typeof value !== "function") return undefined;
  for (
    let current: object | null = value;
    typeof current === "function";
    current = Object.getPrototypeOf(current)
  ) {
    const declaration = declarations.get(current);
    if (declaration) return declaration;
  }
  return undefined;
}
function isModelClass(value: unknown): value is AnyModelClass {
  return declarationFor(value) !== undefined;
}
function staticValue(model: object, key: string): unknown {
  for (
    let current: object | null = model;
    typeof current === "function";
    current = Object.getPrototypeOf(current)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!("value" in descriptor))
        throw new TypeError("Model metadata accessors are unsupported.");
      return descriptor.value;
    }
  }
  return undefined;
}
/** Called once per registry snapshot, never during session lookup or relation resolution. */
function createClassModelDefinition(model: AnyModelClass): AnyModelDefinition {
  const declaration = declarationFor(model);
  if (!declaration) throw new TypeError("Expected an authored model class.");
  const name = declaration.name ?? (staticValue(model, "name") as string);
  const repository = defineRepository({
    name: `${name}.repository`,
    table: declaration.table,
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
  });
  const attributes: Record<string, unknown> = { timestamps: true, casts: declaration.casts };
  for (const key of [
    "fillable",
    "guarded",
    "casts",
    "timestamps",
    "hidden",
    "visible",
    "appends",
  ]) {
    const value = staticValue(model, `$${key}`);
    if (value !== undefined)
      attributes[key] = key === "casts" ? { ...declaration.casts, ...ownRecord(value) } : value;
  }
  const Class = model as unknown as AuthoredModelClass<
    Record<string, unknown>,
    string,
    Model<Record<string, unknown>, string>
  >;
  return defineDefinition({
    name,
    repository,
    dependencies: [],
    attributes: attributes as ModelAttributeOptions<Record<string, unknown>>,
    aliases: staticValue(model, "$aliases") as readonly string[] | undefined,
    observers: staticValue(model, "$observers") as
      | readonly ServiceToken<ModelObserver<Model<Record<string, unknown>, string>>>[]
      | undefined,
    // Static scopes are deliberately not executed or copied into runtime metadata.
    construct: (state, binding) => new Class(state, binding),
  });
}

/** Immutable table declaration for bootstrap integrations; performs no database work. */
function modelTable<C extends AnyModelClass>(
  model: C,
): Readonly<TableDefinition<ClassModelRow<C>, ClassModelKey<C>>> {
  const declaration = declarationFor(model);
  if (!declaration) throw new TypeError("Expected an authored model class.");
  return declaration.table as Readonly<TableDefinition<ClassModelRow<C>, ClassModelKey<C>>>;
}

export type {
  AnyModelClass,
  AuthoredModelClass,
  ClassModelInstance,
  ClassModelKey,
  ClassModelRow,
  InferModelFields,
  ModelClassOptions,
  ModelField,
  ModelFields,
};
export { createClassModelDefinition, defineAuthoredModel, field, isModelClass, modelTable };
