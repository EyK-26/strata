/** Public Factory composition and sync callback contracts; no runtime work. */
import { defineFactory as defineRootFactory, Factory as RootFactory } from "@getstrata/core";
import {
  defineFactory,
  Factory,
  type FactoryDefinition,
  type FactoryPersist,
} from "@getstrata/core/database/factory";

interface Row {
  id: number;
  name: string;
  parent_id?: number;
}
interface State {
  serial: number;
}
interface Dependencies {
  prefix: string;
  persist: FactoryPersist<Row>;
}
export const stateful = defineFactory<Row, Dependencies, State>({
  initialState: () => ({ serial: 0 }),
  forkState: (state) => ({ serial: state.serial }),
  construct: (state, dependencies) => ({
    definition: () => ({ id: 0, name: `${dependencies.prefix}${state.serial++}` }),
    persist: (values) => dependencies.persist(values),
  }),
});
export const inferred = defineFactory({
  initialState: (): State => ({ serial: 0 }),
  forkState: (state: Readonly<State>) => ({ serial: state.serial }),
  construct: (state: State, dependencies: Dependencies) => ({
    definition: (): Row => ({ id: 0, name: `${dependencies.prefix}${state.serial++}` }),
    persist: (values: Partial<Row>) => dependencies.persist(values),
  }),
});
export const pure = defineRootFactory<Row>({
  construct: () => ({ definition: () => ({ id: 0, name: "pure" }) }),
});
export function checkFactoryTypes(dependencies: Dependencies) {
  const factory = RootFactory.from(stateful, dependencies);
  const one: Row = factory.make();
  const many: Row[] = factory.count(1).state({ name: "counted" }).make();
  const created: Promise<Row> = factory.create();
  const createdMany: Promise<Row[]> = factory.count(2).create();
  const crossRoot: Row = Factory.from(pure).make();
  const crossInferred: Row = Factory.from(inferred, dependencies).make();
  factory.afterMaking((row) => {
    row.name = "sync";
  });
  factory.afterCreating(async (row) => {
    await dependencies.persist(row);
  });
  factory.for({ id: 1 }, "parent_id");
  factory.has(factory.count(1), "parent_id");
  // @ts-expect-error selected dependencies are required
  Factory.from(stateful);
  // @ts-expect-error dependency type must match
  Factory.from(stateful, { prefix: 3, persist: dependencies.persist });
  // @ts-expect-error persistence must return a complete Row
  Factory.from(stateful, { prefix: "x", persist: async () => ({ id: 1 }) });
  // @ts-expect-error counted result is always an array, including count(1)
  const wrongCount: Row = factory.count(1).make();
  // @ts-expect-error uncounted result is a single record
  const wrongSingle: Row[] = factory.make();
  // @ts-expect-error async afterMaking is unsupported
  factory.afterMaking(async (row) => {
    row.name = "async";
  });
  // @ts-expect-error numeric expression return is not synchronous undefined
  factory.afterMaking((row) => row.name.length);
  const voidCallback: (row: Row) => void = (row) => {
    row.name = "void";
  };
  // @ts-expect-error known void helpers must be wrapped explicitly
  factory.afterMaking(voidCallback);
  factory.afterMaking((row) => {
    voidCallback(row);
  });
  // @ts-expect-error unknown foreign key rejected without string widening
  factory.for({ id: 1 }, "missing");
  // @ts-expect-error relation-name shorthand remains outside the bounded key contract
  factory.for({ id: 1 }, "parent");
  // @ts-expect-error unknown record fields rejected
  factory.state({ missing: true });
  // @ts-expect-error Factory must be constructed through an explicit definition
  new Factory();
  void [one, many, created, createdMany, crossRoot, crossInferred, wrongCount, wrongSingle];
}
// Same dependency boundary emitted by make:factory; actual renderer is also
// exercised through an installed generated consumer by package acceptance.
interface GeneratedDependencies {
  definition: () => Row;
  persist?: FactoryPersist<Row>;
}
export const GeneratedFactory: FactoryDefinition<Row, GeneratedDependencies> = defineFactory<
  Row,
  GeneratedDependencies
>({
  construct: (dependencies) => ({
    definition: () => dependencies.definition(),
    persist: dependencies.persist,
  }),
});
export function checkGeneratedTypes() {
  const valid = Factory.from(GeneratedFactory, { definition: () => ({ id: 0, name: "complete" }) });
  // @ts-expect-error generated complete definition dependency is required
  Factory.from(GeneratedFactory, {});
  // @ts-expect-error generated definition must return all required fields
  Factory.from(GeneratedFactory, { definition: () => ({ id: 0 }) });
  Factory.from(GeneratedFactory, {
    definition: () => ({ id: 0, name: "x" }),
    // @ts-expect-error generated persistence must return complete rows
    persist: async () => ({ id: 1 }),
  });
  return valid.make();
}
