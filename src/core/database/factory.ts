import { foreignKeyFromTable } from "./inflection.ts";

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
  private afterMakingCallbacks: Array<(record: TRecord) => void> = [];
  private afterCreatingCallbacks: Array<(record: TRecord) => void | Promise<void>> = [];
  protected model?: {
    create(attributes: Record<string, unknown>): Promise<{ toObject(): object }>;
  };

  protected definition(): TRecord {
    throw new Error("Factory definition must be implemented by subclass.");
  }

  protected clone(): this {
    const next = Object.create(Object.getPrototypeOf(this)) as this;
    Object.assign(next, this);
    next.stateTransforms = [...this.stateTransforms];
    next.sequenceItems = [...this.sequenceItems];
    next.parentAssociations = [...this.parentAssociations];
    next.children = [...this.children];
    next.afterMakingCallbacks = [...this.afterMakingCallbacks];
    next.afterCreatingCallbacks = [...this.afterCreatingCallbacks];
    return next;
  }

  count(quantity: number): Factory<TRecord, true> {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error("Factory.count() requires a positive integer.");
    }

    const next = this.clone() as Factory<TRecord, true>;
    next.quantity = quantity;
    next.counted = true;
    return next;
  }

  state(state: FactoryState<TRecord>): Factory<TRecord, Counted> {
    const next = this.clone();
    next.stateTransforms = [...this.stateTransforms, state];
    return next;
  }

  sequence(...items: Array<FactorySequence<TRecord>>): Factory<TRecord, Counted> {
    if (items.length === 0) {
      throw new Error("Factory.sequence() requires at least one attribute set.");
    }

    const next = this.clone();
    next.sequenceItems = [...this.sequenceItems, ...items];
    return next;
  }

  for(
    parent: { id?: unknown; getRepository?: () => { getTable(): { name: string } } },
    foreignKey?: keyof TRecord & string,
  ): Factory<TRecord, Counted> {
    if (parent.id === undefined || parent.id === null) {
      throw new Error("Factory.for() requires a parent with an id.");
    }

    const key = inferFactoryForeignKey<TRecord>(parent, foreignKey);
    const next = this.clone();
    next.parentAssociations = [...this.parentAssociations, { foreignKey: key, value: parent.id }];
    return next;
  }

  recycle(
    parent: { id?: unknown; getRepository?: () => { getTable(): { name: string } } },
    foreignKey?: keyof TRecord & string,
  ): Factory<TRecord, Counted> {
    return this.for(parent, foreignKey);
  }

  afterMaking(callback: (record: TRecord) => void): Factory<TRecord, Counted> {
    const next = this.clone();
    next.afterMakingCallbacks = [...this.afterMakingCallbacks, callback];
    return next;
  }

  afterCreating(callback: (record: TRecord) => void | Promise<void>): Factory<TRecord, Counted> {
    const next = this.clone();
    next.afterCreatingCallbacks = [...this.afterCreatingCallbacks, callback];
    return next;
  }

  has<TRelated extends object, RelatedCounted extends boolean>(
    factory: Factory<TRelated, RelatedCounted>,
    foreignKey?: keyof TRelated & string,
  ): Factory<TRecord, Counted> {
    const next = this.clone();
    next.children = [
      ...this.children,
      { factory: factory as unknown as Factory<object>, foreignKey },
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

    // Persist in sequence so autoincrement ids match make() order. Seeders and
    // Factories depend on that (first sequence row is id 1).
    const records: TRecord[] = [];
    for (let index = 0; index < this.quantity; index += 1) {
      records.push(await this.createOne(overrides));
    }

    return records as FactoryMakeResult<TRecord, Counted>;
  }

  protected makeOne(overrides: Partial<TRecord> = {}): TRecord {
    let record = { ...this.definition() };

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

  protected async createOne(overrides: Partial<TRecord> = {}): Promise<TRecord> {
    return this.persistCreated(this.makeOne(overrides));
  }

  protected async persistCreated(record: TRecord): Promise<TRecord> {
    const created = await this.persist(this.insertable(record));

    await Promise.all(
      this.children.map((child) =>
        (child.factory as Factory<Record<string, unknown>>)
          .for(created as { id?: unknown }, child.foreignKey)
          .create(),
      ),
    );

    for (const callback of this.afterCreatingCallbacks) {
      await callback(created);
    }

    return created;
  }

  protected insertable(record: TRecord): Partial<TRecord> {
    const values = { ...record } as Record<string, unknown>;

    if (values.id === 0 || values.id === undefined || values.id === null) {
      delete values.id;
    }

    return values as Partial<TRecord>;
  }

  protected async persist(values: Partial<TRecord>): Promise<TRecord> {
    if (this.model) {
      const created = await this.model.create(values as Record<string, unknown>);
      if (created && typeof created.toObject === "function") {
        return created.toObject() as TRecord;
      }
      return created as TRecord;
    }

    throw new Error("Factory.persist() must be implemented to use create().");
  }
}

export type { FactoryMakeResult };
export { Factory };
