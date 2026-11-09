import {
  type AnyServiceToken,
  assertServiceToken,
  type ServiceToken,
} from "@getstrata/core/contracts/token";

type ServiceLifetime = "application" | "execution";
const serviceDeclarationType: unique symbol = Symbol("ServiceDeclaration");
interface DeclarationBrand {
  readonly [serviceDeclarationType]: object;
}
type DependencyValues<D extends readonly AnyServiceToken[]> = {
  [K in keyof D]: D[K] extends ServiceToken<infer T> ? T : never;
};
type CallableThenPayload<T> = T extends unknown
  ? "then" extends keyof T
    ? [Extract<T["then"], (...args: never[]) => unknown>] extends [never]
      ? never
      : T
    : never
  : never;
type NonPromisePayload<T> = unknown extends T
  ? unknown
  : [Extract<T, PromiseLike<unknown>> | CallableThenPayload<T>] extends [never]
    ? unknown
    : never;

interface ServiceOptions<T, D extends readonly AnyServiceToken[]> {
  readonly lifetime: ServiceLifetime;
  readonly dependencies: D;
  /** Async initialization yields T; PromiseLike<T> is not itself a service payload. */
  readonly create: (...dependencies: DependencyValues<D>) => NoInfer<T> | Promise<NoInfer<T>>;
}

interface FactoryServiceDeclaration extends DeclarationBrand {
  readonly kind: "factory";
  readonly token: AnyServiceToken;
  readonly lifetime: ServiceLifetime;
  readonly dependencies: readonly AnyServiceToken[];
  /** Erased assembly signature; callers use the typed service helper. */
  readonly create: (...dependencies: never[]) => unknown;
}

interface ValueServiceDeclaration extends DeclarationBrand {
  readonly kind: "value";
  readonly token: AnyServiceToken;
  readonly lifetime: "application";
  /** Caller-owned service values are neither copied nor deep-frozen. */
  readonly value: unknown;
}

interface AliasServiceDeclaration extends DeclarationBrand {
  readonly kind: "alias";
  readonly token: AnyServiceToken;
  readonly target: AnyServiceToken;
}

type ServiceDeclaration =
  | FactoryServiceDeclaration
  | ValueServiceDeclaration
  | AliasServiceDeclaration;

/** Authenticate original helper output; copied/spread fields cannot forge this identity. */
function isServiceDeclaration(value: unknown): value is ServiceDeclaration {
  if (value === null || typeof value !== "object") return false;
  const brand = Object.getOwnPropertyDescriptor(value, serviceDeclarationType);
  return Object.isFrozen(value) && brand !== undefined && "value" in brand && brand.value === value;
}

function declaration<T extends object>(value: T): Readonly<T> & DeclarationBrand {
  Object.defineProperty(value, serviceDeclarationType, { value });
  return Object.freeze(value) as Readonly<T> & DeclarationBrand;
}

/** PromiseLike payloads are not values; inspect descriptors without invoking then getters. */
function assertValue(value: unknown): void {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
  let current: object | null = value;
  const visited = new Set<object>();
  while (current !== null) {
    if (visited.has(current)) throw new TypeError("Unsupported service payload prototype shape.");
    visited.add(current);
    const then = Object.getOwnPropertyDescriptor(current, "then");
    if (then) {
      if (!("value" in then) || typeof then.value === "function") {
        throw new TypeError("PromiseLike service payloads are unsupported.");
      }
      return;
    }
    current = Object.getPrototypeOf(current);
  }
}

function service<T, const D extends readonly AnyServiceToken[]>(
  token: ServiceToken<T> & NonPromisePayload<T>,
  options: ServiceOptions<T, D>,
): FactoryServiceDeclaration {
  assertServiceToken(token);
  if (options.lifetime !== "application" && options.lifetime !== "execution") {
    throw new TypeError("Unsupported service lifetime declaration.");
  }
  if (!Array.isArray(options.dependencies) || typeof options.create !== "function") {
    throw new TypeError("Services must declare a dependency tuple and factory.");
  }
  for (const dependency of options.dependencies) assertServiceToken(dependency);
  return declaration({
    kind: "factory",
    token,
    lifetime: options.lifetime,
    dependencies: Object.freeze([...options.dependencies]),
    create: options.create,
  });
}

function valueService<T>(
  token: ServiceToken<T> & NonPromisePayload<T>,
  value: NoInfer<T>,
): ValueServiceDeclaration {
  assertServiceToken(token);
  assertValue(value);
  return declaration({
    kind: "value",
    token,
    lifetime: "application",
    value,
  });
}

function aliasService<T>(
  aliasToken: ServiceToken<T> & NonPromisePayload<T>,
  targetToken: ServiceToken<NoInfer<T>>,
): AliasServiceDeclaration {
  assertServiceToken(aliasToken);
  assertServiceToken(targetToken);
  return declaration({
    kind: "alias",
    token: aliasToken,
    target: targetToken,
  });
}

export type {
  AliasServiceDeclaration,
  DependencyValues,
  FactoryServiceDeclaration,
  ServiceDeclaration,
  ServiceLifetime,
  ServiceOptions,
  ValueServiceDeclaration,
};
export { aliasService, isServiceDeclaration, service, valueService };
