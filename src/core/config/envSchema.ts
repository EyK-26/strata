interface EnvRule {
  required?: boolean;
  integer?: boolean;
  minimum?: number;
  default?: string;
  pattern?: RegExp;
}

type EnvSchema = Record<string, EnvRule>;

function defineEnvSchema(schema: EnvSchema): EnvSchema {
  return schema;
}

function validateEnv(
  schema: EnvSchema,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [name, rule] of Object.entries(schema)) {
    const rawValue = env[name];
    const value =
      rawValue === undefined || rawValue.trim() === ""
        ? rule.default
        : rawValue;

    if (value === undefined || value.trim() === "") {
      if (rule.required) {
        throw new Error(`Missing required environment variable "${name}".`);
      }

      continue;
    }

    if (rule.integer) {
      const parsed = Number.parseInt(value, 10);
      const minimum = rule.minimum ?? Number.NEGATIVE_INFINITY;

      if (!Number.isInteger(parsed) || parsed < minimum) {
        const comparison =
          minimum === Number.NEGATIVE_INFINITY
            ? "an integer"
            : `an integer >= ${minimum}`;
        throw new Error(`Environment variable "${name}" must be ${comparison}.`);
      }
    }

    if (rule.pattern && !rule.pattern.test(value)) {
      throw new Error(
        `Environment variable "${name}" has an invalid format.`,
      );
    }

    resolved[name] = value;
  }

  return resolved;
}

export { defineEnvSchema, validateEnv };
export type { EnvRule, EnvSchema };
