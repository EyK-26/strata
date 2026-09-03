function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function whenLoaded<T>(
  model: { loaded: (name: string) => unknown },
  relation: string,
  transform?: (value: unknown) => T,
): T | undefined {
  const value = model.loaded(relation);

  if (value === undefined) {
    return undefined;
  }

  return transform ? transform(value) : (value as T);
}

class JsonResource<T = unknown> {
  static wrap: string | null = "data";
  private extra: Record<string, unknown> = {};

  constructor(protected readonly resource: T) {}

  static make<TResource>(resource: TResource): JsonResource<TResource> {
    return new JsonResource(resource);
  }

  static collection<TResource>(items: readonly TResource[]): ResourceCollection<TResource> {
    return new ResourceCollection(items);
  }

  additional(data: Record<string, unknown>): this {
    this.extra = { ...this.extra, ...data };
    return this;
  }

  when<TValue>(condition: boolean, value: TValue): TValue | undefined {
    return condition ? value : undefined;
  }

  whenLoaded<TValue = unknown>(
    relation: string,
    transform?: (value: unknown) => TValue,
  ): TValue | undefined {
    const model = this.resource as { loaded?: (name: string) => unknown };

    if (typeof model.loaded !== "function") {
      return undefined;
    }

    return whenLoaded(model as { loaded: (name: string) => unknown }, relation, transform);
  }

  toArray(): Record<string, unknown> {
    if (this.resource && typeof this.resource === "object" && "toArray" in this.resource) {
      return (this.resource as { toArray: () => Record<string, unknown> }).toArray();
    }

    return { ...(this.resource as Record<string, unknown>) };
  }

  toResponse(): Record<string, unknown> {
    const wrap = (this.constructor as typeof JsonResource).wrap;
    const payload = this.toArray();

    if (wrap === null) {
      return { ...payload, ...this.extra };
    }

    return { [wrap]: payload, ...this.extra };
  }
}

class ResourceCollection<T> extends JsonResource<readonly T[]> {
  override toArray(): Record<string, unknown> {
    return {
      data: this.resource.map((item) =>
        item instanceof JsonResource ? item.toArray() : { ...(item as Record<string, unknown>) },
      ),
    };
  }
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

export {
  JsonResource,
  ResourceCollection,
  serializeDate,
  toPaginatedResourceCollection,
  toResourceCollection,
  whenLoaded,
};
