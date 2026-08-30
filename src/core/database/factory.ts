class Factory<TRecord extends object> {
  constructor() {}

  protected definition(): TRecord {
    throw new Error("Factory definition must be implemented by subclass.");
  }

  make(overrides: Partial<TRecord> = {}): TRecord {
    return {
      ...this.definition(),
      ...overrides,
    };
  }

  async create(overrides: Partial<TRecord> = {}): Promise<TRecord> {
    return this.persist(this.insertable(this.make(overrides)));
  }

  protected insertable(record: TRecord): Partial<TRecord> {
    const values = { ...record } as Record<string, unknown>;

    if (values.id === 0 || values.id === undefined || values.id === null) {
      delete values.id;
    }

    return values as Partial<TRecord>;
  }

  protected persist(_values: Partial<TRecord>): Promise<TRecord> {
    throw new Error("Factory.persist() must be implemented to use create().");
  }
}

export { Factory };
