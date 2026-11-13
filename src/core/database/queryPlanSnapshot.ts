import { assertDefinition } from "@getstrata/core/database/definitions";

/**
 * Detach an admitted terminal plan before hooks or SQL can yield. Only containers
 * and supported database values are copied; explicit services/callbacks retain
 * identity and are checked by the owning binding before use.
 */
function snapshotQueryPlan<T>(
  value: T,
  seen = new Map<object, unknown>(),
  opaque?: (value: object) => unknown,
): T {
  if (value === null || typeof value !== "object") return value;
  if (opaque) {
    const mapped = opaque(value);
    if (mapped !== value) return mapped as T;
  }
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  if (kind === "repository" || kind === "model") {
    try {
      assertDefinition(value, kind);
      return value;
    } catch {
      /* Ordinary row data. */
    }
  }
  const previous = seen.get(value);
  if (previous !== undefined) return previous as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const entry of value) copy.push(snapshotQueryPlan(entry, seen, opaque));
    return copy as T;
  }
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, entry] of value) copy.set(key, snapshotQueryPlan(entry, seen, opaque));
    return copy as T;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const copy = Object.create(prototype) as Record<PropertyKey, unknown>;
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) continue;
    if (!("value" in descriptor)) throw new TypeError("Query plans cannot contain accessors.");
    Object.defineProperty(copy, key, {
      value: snapshotQueryPlan(descriptor.value, seen, opaque),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copy as T;
}

export { snapshotQueryPlan };
