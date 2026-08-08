function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toResourceCollection<TInput, TOutput>(
  items: readonly TInput[],
  transformer: (item: TInput) => TOutput,
): TOutput[] {
  return items.map(transformer);
}

function toPaginatedResourceCollection<TInput, TOutput, TMeta extends object>(
  items: readonly TInput[],
  meta: TMeta,
  transformer: (item: TInput) => TOutput,
): { data: TOutput[]; meta: TMeta } {
  return {
    data: toResourceCollection(items, transformer),
    meta,
  };
}

export { serializeDate, toPaginatedResourceCollection, toResourceCollection };
