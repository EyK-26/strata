declare const serviceTokenType: unique symbol;

/** Invariant service identity; its runtime value remains the existing string key. */
type ServiceToken<T> = string & { readonly [serviceTokenType]: (value: T) => T };
/** Prevent a typed token from falling back to an unchecked legacy overload. */
type LegacyServiceKey = string & { readonly [serviceTokenType]?: never };

function createServiceToken<T>(key: string): ServiceToken<T> {
  if (!key.trim()) throw new Error("Service token key must not be empty.");
  return key as ServiceToken<T>;
}

type ServiceFactory<T> = (container: ServiceContainer) => T;

interface ServiceContainerLike {
  has(key: string): boolean;
  resolve<T>(key: ServiceToken<T>): T;
  resolve<T>(key: LegacyServiceKey): T;
}

class ServiceContainer implements ServiceContainerLike {
  private readonly services = new Map<string, unknown>();
  private readonly singletonFactories = new Map<string, ServiceFactory<unknown>>();
  private readonly bindings = new Map<string, ServiceFactory<unknown>>();

  set<T>(key: ServiceToken<T>, value: NoInfer<T>): T;
  set<T>(key: LegacyServiceKey, value: T): T;
  set<T>(key: string, value: T): T {
    this.singletonFactories.delete(key);
    this.bindings.delete(key);
    this.services.set(key, value);
    return value;
  }

  singleton<T>(key: ServiceToken<T>, factory: ServiceFactory<NoInfer<T>>): void;
  singleton<T>(key: LegacyServiceKey, factory: ServiceFactory<T>): void;
  singleton<T>(key: string, factory: ServiceFactory<T>): void {
    this.bindings.delete(key);
    this.services.delete(key);
    this.singletonFactories.set(key, factory);
  }

  bind<T>(key: ServiceToken<T>, factory: ServiceFactory<NoInfer<T>>): void;
  bind<T>(key: LegacyServiceKey, factory: ServiceFactory<T>): void;
  bind<T>(key: string, factory: ServiceFactory<T>): void {
    this.singletonFactories.delete(key);
    this.services.delete(key);
    this.bindings.set(key, factory);
  }

  get<T>(key: ServiceToken<T>): T;
  get<T>(key: LegacyServiceKey): T;
  get<T>(key: string): T {
    if (this.services.has(key)) {
      return this.services.get(key) as T;
    }

    const singletonFactory = this.singletonFactories.get(key);

    if (singletonFactory) {
      const value = singletonFactory(this);
      this.services.set(key, value);
      return value as T;
    }

    const binding = this.bindings.get(key);

    if (binding) {
      return binding(this) as T;
    }

    throw new Error(`Service "${key}" is not registered.`);
  }

  resolve<T>(key: ServiceToken<T>): T;
  resolve<T>(key: LegacyServiceKey): T;
  resolve<T>(key: string): T {
    return this.get<T>(key);
  }

  make<T>(key: ServiceToken<T>): T;
  make<T>(key: LegacyServiceKey): T;
  make<T>(key: string): T {
    return this.resolve<T>(key);
  }

  instance<T>(key: ServiceToken<T>, value: NoInfer<T>): T;
  instance<T>(key: LegacyServiceKey, value: T): T;
  instance<T>(key: string, value: T): T {
    return this.set(key, value);
  }

  has(key: string): boolean {
    return this.services.has(key) || this.singletonFactories.has(key) || this.bindings.has(key);
  }
}

interface ConfigStoreLike {
  get<T>(key: string): T | undefined;
  require<T>(key: string): T;
  has(key: string): boolean;
}

class ConfigStore implements ConfigStoreLike {
  private readonly values = new Map<string, unknown>();

  set<T>(key: string, value: T): T {
    this.values.set(key, value);
    return value;
  }

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  require<T>(key: string): T {
    if (!this.values.has(key)) {
      throw new Error(`Config key "${key}" is not defined.`);
    }

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
