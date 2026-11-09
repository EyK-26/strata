interface EnvRule {
  required?: boolean;
  integer?: boolean;
  minimum?: number;
  maximum?: number;
  default?: string;
  pattern?: RegExp;
}

type EnvSchema = Record<string, EnvRule>;

function defineEnvSchema<const Schema extends EnvSchema>(schema: Schema): Schema {
  return schema;
}

function validateEnv(
  schema: EnvSchema,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [name, rule] of Object.entries(schema)) {
    if (rule.integer) {
      if (
        (rule.minimum !== undefined && !Number.isSafeInteger(rule.minimum)) ||
        (rule.maximum !== undefined && !Number.isSafeInteger(rule.maximum)) ||
        (rule.minimum !== undefined && rule.maximum !== undefined && rule.minimum > rule.maximum)
      ) {
        throw new TypeError(`Environment integer rule for "${name}" has invalid bounds.`);
      }
    }
    const rawValue = env[name];
    if (rawValue !== undefined && typeof rawValue !== "string") {
      throw new TypeError(`Environment variable "${name}" must be a string.`);
    }
    const value = rawValue === undefined || rawValue.trim() === "" ? rule.default : rawValue;

    if (value !== undefined && typeof value !== "string") {
      throw new TypeError(`Environment variable "${name}" must resolve to a string.`);
    }

    if (value === undefined || value.trim() === "") {
      if (rule.required) {
        throw new Error(`Missing required environment variable "${name}".`);
      }

      continue;
    }

    if (rule.integer) {
      const completeInteger = /^[+-]?\d+$/.test(value.trim());
      const parsed = Number.parseInt(value, 10);
      const minimum = rule.minimum ?? Number.NEGATIVE_INFINITY;

      const maximum = rule.maximum ?? Number.POSITIVE_INFINITY;

      if (
        !completeInteger ||
        !Number.isSafeInteger(parsed) ||
        parsed < minimum ||
        parsed > maximum
      ) {
        const comparison =
          minimum !== Number.NEGATIVE_INFINITY && maximum !== Number.POSITIVE_INFINITY
            ? `an integer between ${minimum} and ${maximum}`
            : maximum !== Number.POSITIVE_INFINITY
              ? `an integer <= ${maximum}`
              : minimum === Number.NEGATIVE_INFINITY
                ? "an integer"
                : `an integer >= ${minimum}`;
        throw new Error(`Environment variable "${name}" must be ${comparison}.`);
      }
    }

    if (rule.pattern && !new RegExp(rule.pattern.source, rule.pattern.flags).test(value)) {
      throw new Error(`Environment variable "${name}" has an invalid format.`);
    }

    Object.defineProperty(resolved, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return resolved;
}

export type { EnvRule, EnvSchema };
export { defineEnvSchema, validateEnv };
