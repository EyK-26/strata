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
}

export { Factory };
