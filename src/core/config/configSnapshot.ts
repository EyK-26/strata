import type { ApplicationConfigValue } from "../contracts/application";

function copyApplicationConfig(
  value: unknown,
  ancestors = new Set<object>(),
): ApplicationConfigValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new TypeError("Application config must contain acyclic plain data.");
  }
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== (array ? Array.prototype : Object.prototype) &&
    !(prototype === null && !array)
  ) {
    throw new TypeError("Application config must contain only plain objects and arrays.");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("Application config cannot contain symbol keys.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!(array && key === "length") && (!descriptor.enumerable || !("value" in descriptor))) {
      throw new TypeError("Application config cannot contain accessors or hidden properties.");
    }
  }
  ancestors.add(value);
  try {
    if (array) {
      // Every genuine array owns its nonconfigurable length data property.
      const length = (descriptors.length as PropertyDescriptor).value as number;
      if (Object.keys(descriptors).length !== length + 1) {
        throw new TypeError(
          "Application config arrays must be dense and have no extra properties.",
        );
      }
      const result: ApplicationConfigValue[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor) throw new TypeError("Application config arrays must be dense.");
        result.push(copyApplicationConfig(descriptor.value, ancestors));
      }
      return Object.freeze(result);
    }
    const result: Record<string, ApplicationConfigValue> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      Object.defineProperty(result, key, {
        value: copyApplicationConfig(descriptor.value, ancestors),
        enumerable: true,
      });
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

export { copyApplicationConfig };
