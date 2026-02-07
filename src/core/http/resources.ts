function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toResourceCollection<TInput, TOutput>(
  items: readonly TInput[],
  transformer: (item: TInput) => TOutput,
): TOutput[] {
  return items.map(transformer);
}

export { serializeDate, toResourceCollection };
