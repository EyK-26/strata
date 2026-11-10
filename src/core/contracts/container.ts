import { valueService } from "@getstrata/core/contracts/services";
import {
  type AnyServiceToken,
  assertServiceToken,
  createServiceToken,
  type ServiceToken,
  serviceTokenKey,
  serviceTokenName,
} from "@getstrata/core/contracts/token";

/** Transitional old-composition keys; new application scopes expose no string overload. */
type LegacyServiceKey = string;
type ServiceKey = AnyServiceToken | LegacyServiceKey;
type Key = symbol | string;
type ServiceFactory<T> = (container: ServiceContainer) => T;

interface ServiceContainerLike {
  has(key: ServiceKey): boolean;
  resolve<T>(key: ServiceToken<T>): T;
  resolve<T>(key: LegacyServiceKey): T;
}

function identity(key: ServiceKey): Key {
  if (typeof key === "string") return key;
  assertServiceToken(key);
  return serviceTokenKey(key);
}

function display(key: ServiceKey): string {
  return typeof key === "string" ? key : serviceTokenName(key);
}

/** One engine for cached values, legacy factories, aliases and eager initialization. */
class ServiceContainer implements ServiceContainerLike {
  private readonly services = new Map<Key, unknown>();
  private readonly singletonFactories = new Map<Key, ServiceFactory<unknown>>();
  private readonly bindings = new Map<Key, ServiceFactory<unknown>>();
  private readonly aliases = new Map<Key, ServiceKey>();
  private readonly initializations = new Map<Key, Promise<unknown>>();
  private readonly resolutionPath: ServiceKey[] = [];
  private sealed = false;

  constructor(private readonly parent?: ServiceContainer) {
    if (parent && !parent.sealed) throw new Error("Service container parent must be sealed.");
  }

  private mutable(): void {
    if (this.sealed) throw new Error("Service composition is sealed.");
  }

  private clearDefinition(key: Key): void {
    this.services.delete(key);
    this.singletonFactories.delete(key);
    this.bindings.delete(key);
    this.aliases.delete(key);
    this.initializations.delete(key);
  }

  set<T>(key: ServiceToken<T>, value: NoInfer<T>): T;
  set<T>(key: LegacyServiceKey, value: T): T;
  set<T>(key: ServiceKey, value: T): T {
    this.mutable();
    const id = identity(key);
    this.clearDefinition(id);
    this.services.set(id, value);
    return value;
  }

  singleton<T>(key: ServiceToken<T>, factory: ServiceFactory<NoInfer<T>>): void;
  singleton<T>(key: LegacyServiceKey, factory: ServiceFactory<T>): void;
  singleton<T>(key: ServiceKey, factory: ServiceFactory<T>): void {
    this.mutable();
    const id = identity(key);
    this.clearDefinition(id);
    this.singletonFactories.set(id, factory);
  }

  bind<T>(key: ServiceToken<T>, factory: ServiceFactory<NoInfer<T>>): void;
  bind<T>(key: LegacyServiceKey, factory: ServiceFactory<T>): void;
  bind<T>(key: ServiceKey, factory: ServiceFactory<T>): void {
    this.mutable();
    const id = identity(key);
    this.clearDefinition(id);
    this.bindings.set(id, factory);
  }

  /** Assembly-only: graph.start uses this engine's sole in-flight slot and value cache. */
  initialize<T>(
    key: ServiceToken<T>,
    factory: () => T | Promise<T>,
    signal: AbortSignal,
    checkpoint?: () => void,
  ): Promise<T> {
    const id = identity(key);
    const existing = this.initializations.get(id);
    if (existing) return existing as Promise<T>;
    this.mutable();
    const initializing = Promise.resolve()
      .then(() => {
        checkpoint?.();
        if (signal.aborted) throw signal.reason;
        return factory();
      })
      .then((value) => {
        checkpoint?.();
        if (signal.aborted) throw signal.reason;
        // Share the declaration validator; never freeze arbitrary service instances.
        valueService(key as ServiceToken<unknown>, value);
        // Payload reflection may cancel initialization or cross its execution deadline.
        checkpoint?.();
        if (signal.aborted) throw signal.reason;
        this.services.set(id, value);
        return value;
      });
    this.initializations.set(id, initializing);
    void initializing.catch(() => {});
    return initializing;
  }

  alias<T>(key: ServiceToken<T>, target: ServiceToken<NoInfer<T>>): void;
  alias(key: AnyServiceToken, target: AnyServiceToken): void {
    this.mutable();
    const id = identity(key);
    this.clearDefinition(id);
    identity(target);
    this.aliases.set(id, target);
  }

  seal(): void {
    this.sealed = true;
  }

  get<T>(key: ServiceToken<T>): T;
  get<T>(key: LegacyServiceKey): T;
  get<T>(key: ServiceKey): T {
    const id = identity(key);
    if (this.services.has(id)) return this.services.get(id) as T;
    const target = this.aliases.get(id);
    if (target !== undefined) {
      return this.resolveFactory(key, () => this.get(target as ServiceToken<T>));
    }
    const singletonFactory = this.singletonFactories.get(id);
    if (singletonFactory) {
      const value = this.resolveFactory(key, singletonFactory);
      this.services.set(id, value);
      return value as T;
    }
    const binding = this.bindings.get(id);
    if (binding) return this.resolveFactory(key, binding) as T;
    if (typeof key !== "string" && this.parent) return this.parent.get(key as ServiceToken<T>);
    throw new Error(`Service "${display(key)}" is not registered.`);
  }

  private resolveFactory<T>(key: ServiceKey, factory: ServiceFactory<T>): T {
    if (this.resolutionPath.some((entry) => identity(entry) === identity(key))) {
      throw new Error(
        `Circular service dependency: ${[...this.resolutionPath, key].map(display).join(" -> ")}.`,
      );
    }
    this.resolutionPath.push(key);
    try {
      return factory(this);
    } finally {
      this.resolutionPath.pop();
    }
  }

  resolve<T>(key: ServiceToken<T>): T;
  resolve<T>(key: LegacyServiceKey): T;
  resolve<T>(key: ServiceKey): T {
    return this.get(key as ServiceToken<T>);
  }

  make<T>(key: ServiceToken<T>): T;
  make<T>(key: LegacyServiceKey): T;
  make<T>(key: ServiceKey): T {
    return this.resolve(key as ServiceToken<T>);
  }

  instance<T>(key: ServiceToken<T>, value: NoInfer<T>): T;
  instance<T>(key: LegacyServiceKey, value: T): T;
  instance<T>(key: ServiceKey, value: T): T {
    return this.set(key as ServiceToken<T>, value);
  }

  has(key: ServiceKey): boolean {
    const id = identity(key);
    return (
      this.services.has(id) ||
      this.singletonFactories.has(id) ||
      this.bindings.has(id) ||
      this.aliases.has(id) ||
      (typeof key !== "string" && this.parent !== undefined && this.parent.has(key))
    );
  }
}

interface ConfigStoreLike {
  get<T>(key: string): T | undefined;
  getRequired<T>(key: string): T;
  has(key: string): boolean;
}

/** Legacy mutable configuration; target applications inject validated immutable settings. */
class ConfigStore implements ConfigStoreLike {
  private readonly values = new Map<string, unknown>();

  set<T>(key: string, value: T): T {
    this.values.set(key, value);
    return value;
  }

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  getRequired<T>(key: string): T {
    if (!this.values.has(key)) throw new Error(`Config key "${key}" is not defined.`);
    return this.values.get(key) as T;
  }

  has(key: string): boolean {
    return this.values.has(key);
  }
}

export type {
  ConfigStoreLike,
  LegacyServiceKey,
  ServiceContainerLike,
  ServiceFactory,
  ServiceToken,
};
export { ConfigStore, createServiceToken, ServiceContainer };
