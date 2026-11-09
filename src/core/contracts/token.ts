const serviceTokenIdentity: unique symbol = Symbol("ServiceToken.identity");
declare const serviceTokenType: unique symbol;

/** Erased identity shared by heterogeneous tokens without weakening their value invariance. */
interface AnyServiceToken {
  readonly name: string;
  readonly [serviceTokenIdentity]: symbol;
}

/** Opaque application service identity. The function property makes T invariant. */
type ServiceToken<T> = AnyServiceToken & {
  readonly [serviceTokenType]: (value: T) => T;
};

function createServiceToken<T>(name: string): ServiceToken<T> {
  if (typeof name !== "string" || !name.trim()) {
    throw new TypeError("Service token name must be a nonempty string.");
  }
  return Object.freeze({ name, [serviceTokenIdentity]: Symbol(name) }) as ServiceToken<T>;
}

/** Shape validation is not a security boundary against arbitrary casts or reflective code. */
function isServiceToken(value: unknown): value is AnyServiceToken {
  if (value === null || typeof value !== "object") return false;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype || !Object.isFrozen(value)) return false;
    const name = Object.getOwnPropertyDescriptor(value, "name");
    const identity = Object.getOwnPropertyDescriptor(value, serviceTokenIdentity);
    return (
      name !== undefined &&
      "value" in name &&
      typeof name.value === "string" &&
      name.value.trim().length > 0 &&
      identity !== undefined &&
      "value" in identity &&
      typeof identity.value === "symbol"
    );
  } catch {
    return false;
  }
}

function assertServiceToken(value: unknown): asserts value is AnyServiceToken {
  if (!isServiceToken(value)) throw new TypeError("Expected an opaque service token.");
}

function serviceTokenKey(token: AnyServiceToken): symbol {
  assertServiceToken(token);
  return token[serviceTokenIdentity];
}

function serviceTokenName(token: AnyServiceToken): string {
  assertServiceToken(token);
  return token.name;
}

export type { AnyServiceToken, ServiceToken };
export {
  assertServiceToken,
  createServiceToken,
  isServiceToken,
  serviceTokenKey,
  serviceTokenName,
};
