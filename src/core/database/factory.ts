abstract class Factory<TRecord extends object> {
  protected abstract definition(): TRecord;

  make(overrides: Partial<TRecord> = {}): TRecord {
    return {
      ...this.definition(),
      ...overrides,
    };
  }
}

export { Factory };
