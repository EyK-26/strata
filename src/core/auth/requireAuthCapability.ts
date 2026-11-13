/** Composition-time validation for explicitly selected authentication adapters. */
function requireAuthCapability<Capability>(
  value: unknown,
  methods: readonly (keyof Capability & string)[],
  mechanism: string,
): Capability {
  if (
    !value ||
    typeof value !== "object" ||
    methods.some((method) => typeof Reflect.get(value, method) !== "function")
  ) {
    throw new TypeError(`Missing ${mechanism} authentication capability: ${methods.join(", ")}.`);
  }
  return value as Capability;
}

export { requireAuthCapability };
