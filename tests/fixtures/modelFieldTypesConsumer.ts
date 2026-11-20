/** Compile against the installed archive, without framework source aliases. */
import type { ModelField as RootModelField } from "@getstrata/core";
import {
  type AnyModelClass,
  type AuthoredModelClass,
  defineModel,
  field,
  type InferModelFields,
  type Model,
  type ModelAttributes,
  type ModelClassOptions,
  type ModelField,
  type ModelFields,
} from "@getstrata/core/database/model";
import type { DatabaseSession } from "@getstrata/core/database/session";

type Expect<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type State = "pending" | "paid";
const fields = {
  id: field.number(),
  state: field.string() as ModelField<State>,
  reference: field.nullable(field.string()),
};
type Row = { id: number; state: State; reference: string | null };

export type PublicModelTypeContracts = [
  Expect<Equal<IsAny<ModelField<string>>, false>>,
  Expect<Equal<IsAny<RootModelField<string>>, false>>,
  Expect<Equal<IsAny<ModelFields>, false>>,
  Expect<Equal<IsAny<AnyModelClass>, false>>,
  Expect<Equal<IsAny<AuthoredModelClass<Row, "id", Model<Row, "id">>>, false>>,
  Expect<Equal<IsAny<ModelClassOptions<typeof fields>>, false>>,
  Expect<Equal<InferModelFields<typeof fields>, Row>>,
];

class Invoice extends defineModel({ table: "model_field_type_invoices", fields }) {}

export async function modelFieldTypeContracts(database: DatabaseSession): Promise<void> {
  const row: ModelAttributes<Invoice> = { id: 1, state: "pending", reference: null };
  const projected = await database.model(Invoice).repository().query().project(["state"]);
  const state: State | undefined = projected[0]?.state;
  await database.model(Invoice).repository().query().update({ state: "paid" });

  // @ts-expect-error
  const invalidField: ModelField<string> = 123;
  // @ts-expect-error
  const invalidRootField: RootModelField<string> = 123;
  // @ts-expect-error
  const invalidClass: AnyModelClass = {};
  // @ts-expect-error
  const invalidRow: ModelAttributes<Invoice> = { ...row, state: "refunded" };
  // @ts-expect-error
  await database.model(Invoice).repository().query().update({ state: "refunded" });
  // @ts-expect-error
  projected[0]?.reference;
  void [state, invalidField, invalidRootField, invalidClass, invalidRow];
}
