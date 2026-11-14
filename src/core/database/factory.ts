import { foreignKeyFromTable } from "./inflection.ts";

const construction: unique symbol = Symbol("factory.construction");
declare const definitionType: unique symbol;
type FactoryPersist<R extends object> = (values: Partial<R>) => Promise<R>;
interface FactoryBehavior<R extends object> {
  definition(): R;
  persist?: FactoryPersist<R>;
}
interface FactoryConstruction<R extends object, D, S> {
  initialState(): S;
  forkState(state: Readonly<S>): S;
  construct(state: S, dependencies: D): FactoryBehavior<R>;
}
interface StatelessFactoryConstruction<R extends object, D> {
  construct(dependencies: D): FactoryBehavior<R>;
}
interface ConstructedFactory<R extends object> {
  readonly behavior: FactoryBehavior<R>;
  fork(): ConstructedFactory<R>;
}
interface FactoryDefinition<R extends object, D> {
  readonly [definitionType]: {
    readonly record: (record: R) => R;
    readonly dependencies: (deps: D) => D;
  };
  readonly [construction]: (dependencies: D) => ConstructedFactory<R>;
}
function defineFactory<R extends object, D, S>(
  spec: FactoryConstruction<R, D, S>,
): FactoryDefinition<R, D>;
function defineFactory<R extends object, D = undefined>(
  spec: StatelessFactoryConstruction<R, D>,
): FactoryDefinition<R, D>;
function defineFactory<R extends object, D, S>(
  spec: FactoryConstruction<R, D, S> | StatelessFactoryConstruction<R, D>,
): FactoryDefinition<R, D> {
  let create: (dependencies: D) => ConstructedFactory<R>;
  if ("initialState" in spec) {
    const initialState = spec.initialState.bind(spec);
    const forkState = spec.forkState.bind(spec);
    const construct = spec.construct.bind(spec);
    create = (dependencies) => {
      const build = (state: S): ConstructedFactory<R> => ({
        behavior: construct(state, dependencies),
        fork: () => build(forkState(state)),
      });
      return build(initialState());
    };
  } else {
    const construct = spec.construct.bind(spec);
    create = (dependencies) => {
      const build = (): ConstructedFactory<R> => ({
        behavior: construct(dependencies),
        fork: build,
      });
      return build();
    };
  }
  return Object.freeze({ [construction]: create }) as FactoryDefinition<R, D>;
}

type FactoryParent = {
  id?: unknown;
  getRepository?: () => { getTable(): { name: string } };
};

type FactoryState<TRecord extends object> =
  | Partial<TRecord>
  | ((record: TRecord) => Partial<TRecord>);
type FactorySequence<TRecord extends object> =
  | Partial<TRecord>
  | ((index: number) => Partial<TRecord>);

type ParentAssociation<TRecord extends object> = {
  foreignKey: keyof TRecord & string;
  value: unknown;
};

type RelatedFactory = {
  factory: Factory<object>;
  foreignKey?: string;
};

type FactoryMakeResult<TRecord extends object, Counted extends boolean> = Counted extends true
  ? TRecord[]
  : TRecord;

function inferFactoryForeignKey<TRecord extends object>(
  parent: {
    getRepository?: () => { getTable(): { name: string } };
    constructor?: { name?: string };
  },
  explicit?: keyof TRecord & string,
): keyof TRecord & string {
  if (explicit) {
    if (explicit.endsWith("_id")) {
      return explicit;
    }

    return `${explicit}_id` as keyof TRecord & string;
  }

  if (typeof parent.getRepository === "function") {
    return foreignKeyFromTable(parent.getRepository().getTable().name) as keyof TRecord & string;
  }

  throw new Error("Factory.for() requires a foreign key or a parent Model.");
}

class Factory<TRecord extends object, Counted extends boolean = false> {
  private quantity = 1;
  private counted = false;
  private sequenceIndex = 0;
  private stateTransforms: Array<FactoryState<TRecord>> = [];
  private sequenceItems: Array<FactorySequence<TRecord>> = [];
  private parentAssociations: Array<ParentAssociation<TRecord>> = [];
  private children: RelatedFactory[] = [];
  private afterMakingCallbacks: Array<(record: TRecord) => undefined> = [];
  private afterCreatingCallbacks: Array<(record: TRecord) => void | Promise<void>> = [];
  private constructor(private readonly instance: ConstructedFactory<TRecord>) {}

  static from<R extends object>(definition: FactoryDefinition<R, undefined>): Factory<R>;
  static from<R extends object, D>(
    definition: FactoryDefinition<R, D>,
    dependencies: D,
  ): Factory<R>;
  static from<R extends object, D>(
    definition: FactoryDefinition<R, D>,
    dependencies?: D,
  ): Factory<R> {
    return new Factory(definition[construction](dependencies as D));
  }

  private fork(): Factory<TRecord, Counted> {
    const next = new Factory<TRecord, Counted>(this.instance.fork());
    next.quantity = this.quantity;
    next.counted = this.counted;
    next.sequenceIndex = this.sequenceIndex;
    next.stateTransforms = [...this.stateTransforms];
    next.sequenceItems = [...this.sequenceItems];
    next.parentAssociations = [...this.parentAssociations];
    next.children = this.children.map((child) => ({ ...child, factory: child.factory.fork() }));
    next.afterMakingCallbacks = [...this.afterMakingCallbacks];
    next.afterCreatingCallbacks = [...this.afterCreatingCallbacks];
    return next;
  }

  count(quantity: number): Factory<TRecord, true> {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error("Factory.count() requires a positive integer.");
    }

    const next = this.fork() as Factory<TRecord, true>;
    next.quantity = quantity;
    next.counted = true;
    return next;
  }

  state(state: FactoryState<TRecord>): Factory<TRecord, Counted> {
    const next = this.fork();
    next.stateTransforms = [
      ...this.stateTransforms,
      typeof state === "function" ? state : { ...state },
    ];
    return next;
  }

  sequence(...items: Array<FactorySequence<TRecord>>): Factory<TRecord, Counted> {
    if (items.length === 0) {
      throw new Error("Factory.sequence() requires at least one attribute set.");
    }

    const next = this.fork();
    next.sequenceItems = [
      ...this.sequenceItems,
      ...items.map((item) => (typeof item === "function" ? item : { ...item })),
    ];
    return next;
  }

  for(parent: FactoryParent, foreignKey?: keyof TRecord & string): Factory<TRecord, Counted> {
    if (parent.id === undefined || parent.id === null) {
      throw new Error("Factory.for() requires a parent with an id.");
    }

    const key = inferFactoryForeignKey<TRecord>(parent, foreignKey);
    const next = this.fork();
    next.parentAssociations = [...this.parentAssociations, { foreignKey: key, value: parent.id }];
    return next;
  }

  recycle(parent: FactoryParent, foreignKey?: keyof TRecord & string): Factory<TRecord, Counted> {
    return this.for(parent, foreignKey);
  }

  afterMaking(callback: (record: TRecord) => undefined): Factory<TRecord, Counted> {
    const next = this.fork();
    next.afterMakingCallbacks = [...this.afterMakingCallbacks, callback];
    return next;
  }

  afterCreating(callback: (record: TRecord) => void | Promise<void>): Factory<TRecord, Counted> {
    const next = this.fork();
    next.afterCreatingCallbacks = [...this.afterCreatingCallbacks, callback];
    return next;
  }

  has<TRelated extends object, RelatedCounted extends boolean>(
    factory: Factory<TRelated, RelatedCounted>,
    foreignKey?: keyof TRelated & string,
  ): Factory<TRecord, Counted> {
    const next = this.fork();
    next.children = [
      ...this.children,
      { factory: factory.fork() as unknown as Factory<object>, foreignKey },
    ];
    return next;
  }

  make(overrides: Partial<TRecord> = {}): FactoryMakeResult<TRecord, Counted> {
    if (!this.counted) {
      return this.makeOne(overrides) as FactoryMakeResult<TRecord, Counted>;
    }

    return Array.from({ length: this.quantity }, () =>
      this.makeOne(overrides),
    ) as FactoryMakeResult<TRecord, Counted>;
  }

  async create(overrides: Partial<TRecord> = {}): Promise<FactoryMakeResult<TRecord, Counted>> {
    if (!this.counted) {
      return (await this.createOne(overrides)) as FactoryMakeResult<TRecord, Counted>;
    }

    const records: TRecord[] = [];
    for (let index = 0; index < this.quantity; index += 1) {
      records.push(await this.createOne(overrides));
    }

    return records as FactoryMakeResult<TRecord, Counted>;
  }

  private makeOne(overrides: Partial<TRecord> = {}): TRecord {
    let record = { ...this.instance.behavior.definition() };

    for (const state of this.stateTransforms) {
      const patch = typeof state === "function" ? state(record) : state;
      record = { ...record, ...patch };
    }

    if (this.sequenceItems.length > 0) {
      const item = this.sequenceItems[this.sequenceIndex % this.sequenceItems.length];
      const patch = typeof item === "function" ? item(this.sequenceIndex) : item;
      record = { ...record, ...patch };
      this.sequenceIndex += 1;
    }

    for (const association of this.parentAssociations) {
      (record as Record<string, unknown>)[association.foreignKey] = association.value;
    }

    const made = {
      ...record,
      ...overrides,
    };

    for (const callback of this.afterMakingCallbacks) {
      callback(made);
    }

    return made;
  }

  private async createOne(overrides: Partial<TRecord> = {}): Promise<TRecord> {
    return this.persistCreated(this.makeOne(overrides));
  }

  private async persistCreated(record: TRecord): Promise<TRecord> {
    const created = await this.persist(this.insertable(record));

    // Validate every association before starting a child write. Every started
    // sibling is then joined, including synchronous invocation failures.
    const children = this.children.map((child) =>
      (child.factory as Factory<Record<string, unknown>>).for(
        created as FactoryParent,
        child.foreignKey,
      ),
    );
    const outcomes = await Promise.allSettled(
      children.map((child) => Promise.resolve().then(() => child.create())),
    );
    const errors = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason] : [],
    );
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Factory children failed.");

    for (const callback of this.afterCreatingCallbacks) {
      await callback(created);
    }

    return created;
  }

  private insertable(record: TRecord): Partial<TRecord> {
    const values = { ...record } as Record<string, unknown>;

    if (values.id === 0 || values.id === undefined || values.id === null) {
      delete values.id;
    }

    return values as Partial<TRecord>;
  }

  private async persist(values: Partial<TRecord>): Promise<TRecord> {
    if (!this.instance.behavior.persist)
      throw new Error("Factory.persist() must be supplied to use create().");
    return this.instance.behavior.persist(values);
  }
}

export type {
  FactoryBehavior,
  FactoryConstruction,
  FactoryDefinition,
  FactoryMakeResult,
  FactoryParent,
  FactoryPersist,
  StatelessFactoryConstruction,
};
export { defineFactory, Factory };

/** Create a factory with explicit persistence supplied by the active invocation. */
function createFactory<R extends object>(behavior: FactoryBehavior<R>): Factory<R> {
  return Factory.from(defineFactory<R>({ construct: () => behavior }));
}

export { createFactory };
