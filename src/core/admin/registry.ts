import type { AdminResource, AdminResourceDefinition } from "./types.ts";

class AdminResourceRegistry {
  private readonly resources = new Map<string, AdminResource<object>>();

  constructor() {}

  register<TEntity extends object>(resource: AdminResource<TEntity>): void {
    if (this.resources.has(resource.name)) {
      throw new Error(`Admin resource "${resource.name}" is already registered.`);
    }

    this.resources.set(resource.name, resource as unknown as AdminResource<object>);
  }

  get(name: string): AdminResource<object> | undefined {
    return this.resources.get(name);
  }

  list(): AdminResourceDefinition[] {
    const definitions: AdminResourceDefinition[] = [];

    for (const resource of this.resources.values()) {
      const { handlers: _handlers, ...definition } = resource;
      definitions.push(definition);
    }

    return definitions;
  }

  all(): AdminResource<object>[] {
    return [...this.resources.values()];
  }

  clear(): void {
    this.resources.clear();
  }
}

export { AdminResourceRegistry };
