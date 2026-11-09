import { validateEnv } from "@getstrata/core/config/envSchema";
import { copyApplicationConfig } from "./configSnapshot";
import type { EnvRule, EnvSchema } from "./envSchema";

type DeepReadonly<T> = T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;

type ValidatedEnvironment<Schema extends EnvSchema> = {
  readonly [Key in keyof Schema]: Schema[Key] extends { required: true } | { default: string }
    ? string
    : string | undefined;
};

interface ConfigIntegerBounds {
  readonly minimum?: number;
  readonly maximum?: number;
}

function invalidRule(field: string): never {
  throw new TypeError(`Configuration rule for "${field}" must contain valid own data fields.`);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Copy schema metadata without invoking declaration/rule accessors or inheriting rules. */
function schemaSnapshot(schema: EnvSchema): EnvSchema {
  if (!plainRecord(schema) || Object.getOwnPropertySymbols(schema).length) {
    throw new TypeError("Application configuration schema must be a plain rule map.");
  }
  const snapshot: EnvSchema = Object.create(null);
  for (const [field, declaration] of Object.entries(Object.getOwnPropertyDescriptors(schema))) {
    if (!declaration.enumerable || !("value" in declaration) || !plainRecord(declaration.value)) {
      invalidRule(field);
    }
    const rule = declaration.value;
    if (Object.getOwnPropertySymbols(rule).length) invalidRule(field);
    const copied: EnvRule = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(rule))) {
      if (!descriptor.enumerable || !("value" in descriptor)) invalidRule(field);
      const value: unknown = descriptor.value;
      if (!["required", "integer", "minimum", "maximum", "default", "pattern"].includes(key)) {
        invalidRule(field);
      }
      if (value === undefined) continue;
      if (key === "required" || key === "integer") {
        if (typeof value !== "boolean") invalidRule(field);
      } else if (key === "minimum" || key === "maximum") {
        if (typeof value !== "number") invalidRule(field);
      } else if (key === "default") {
        if (typeof value !== "string") invalidRule(field);
      } else if (
        !(value instanceof RegExp) ||
        Object.getPrototypeOf(value) !== RegExp.prototype ||
        Object.getOwnPropertySymbols(value).length ||
        Object.getOwnPropertyNames(value).some((name) => name !== "lastIndex")
      ) {
        invalidRule(field);
      }
      Object.defineProperty(copied, key, { value, enumerable: true });
    }
    if ((copied.minimum !== undefined || copied.maximum !== undefined) && !copied.integer) {
      invalidRule(field);
    }
    Object.defineProperty(snapshot, field, { value: copied, enumerable: true });
  }
  return snapshot;
}

/** Only selected own input data is read. Explicit process.env is a supported adapter. */
function inputSnapshot(
  schema: EnvSchema,
  input: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const snapshot: Record<string, string | undefined> = Object.create(null);
  for (const field of Object.keys(schema)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor) continue;
    if (!("value" in descriptor)) {
      throw new TypeError(`Configuration field "${field}" must be an own data property.`);
    }
    if (descriptor.value !== undefined && typeof descriptor.value !== "string") {
      throw new TypeError(`Configuration field "${field}" must be a string.`);
    }
    Object.defineProperty(snapshot, field, { value: descriptor.value, enumerable: true });
  }
  return snapshot;
}

/** Explicit input only. Conversion does not grant access to the host environment. */
function parseApplicationConfig<const Schema extends EnvSchema, Settings extends object>(
  schema: Schema,
  input: Readonly<Record<string, string | undefined>>,
  convert: (values: ValidatedEnvironment<Schema>) => Settings,
): DeepReadonly<Settings> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Application configuration input must be an explicit string map.");
  }
  const copiedSchema = schemaSnapshot(schema);
  const resolved = validateEnv(copiedSchema, inputSnapshot(copiedSchema, input));
  for (const [field, rule] of Object.entries(copiedSchema)) {
    if ((rule.required || rule.default !== undefined) && !Object.hasOwn(resolved, field)) {
      throw new TypeError(`Configuration field "${field}" must resolve to a nonempty string.`);
    }
  }
  // A null-prototype string map also gives optional prototype-named fields the correct absence.
  const values = Object.freeze(
    Object.assign(Object.create(null), resolved),
  ) as ValidatedEnvironment<Schema>;
  // Do not catch user conversion errors: even opaque/falsy thrown payloads retain identity.
  const copied = copyApplicationConfig(convert(values));
  if (copied === null || typeof copied !== "object" || Array.isArray(copied)) {
    throw new TypeError(
      "Application configuration conversion must return a plain settings object.",
    );
  }
  return copied as unknown as DeepReadonly<Settings>;
}

function configInteger(field: string, value: string, bounds: ConfigIntegerBounds = {}): number {
  const resolved = validateEnv(
    {
      [field]: { required: true, integer: true, minimum: bounds.minimum, maximum: bounds.maximum },
    },
    { [field]: value },
  );
  return Number(resolved[field]);
}

function configEnum<const Choices extends readonly [string, ...string[]]>(
  field: string,
  value: string,
  choices: Choices,
): Choices[number] {
  if (
    !Array.isArray(choices) ||
    !choices.length ||
    choices.some((choice) => typeof choice !== "string")
  ) {
    throw new TypeError(`Configuration field "${field}" has an invalid enum rule.`);
  }
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new TypeError(`Configuration field "${field}" must match an allowed enum value.`);
  }
  return value as Choices[number];
}

export type { ConfigIntegerBounds, DeepReadonly, ValidatedEnvironment };
export { configEnum, configInteger, parseApplicationConfig };
