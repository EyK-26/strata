/** Attribute transformations have no model registry, repository or query dependency. */
import { isDeepStrictEqual } from "node:util";
import { hashPassword } from "../auth/password.ts";

type CastType = "date" | "datetime" | "json" | "bool" | "boolean" | "integer" | "int" | "hashed";
type LoadedAttributes = Record<string, unknown>;
type ModelCasts = Partial<Record<string, CastType>>;

function snapshotAttributes(values: LoadedAttributes): LoadedAttributes {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      Buffer.isBuffer(value) ? Buffer.from(value) : structuredClone(value),
    ]),
  );
}

function changedAttributes(values: LoadedAttributes, original: LoadedAttributes): LoadedAttributes {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => !(key in original) || !isDeepStrictEqual(value, original[key]),
    ),
  );
}

const PASSWORD_HASH_PATTERN = /^\$(?:2[aby]?|argon2(?:i|d|id)?)\$/;

function isAlreadyHashed(value: string): boolean {
  return PASSWORD_HASH_PATTERN.test(value);
}

async function hashCastValue(value: unknown): Promise<unknown> {
  if (value === null || value === undefined) return value;
  const plain = String(value);

  if (isAlreadyHashed(plain)) {
    return plain;
  }

  return await hashPassword(plain);
}

function hydrateValue(value: unknown, cast: CastType): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  switch (cast) {
    case "date":
    case "datetime":
      return value instanceof Date ? value : new Date(String(value));
    case "json":
      return typeof value === "string" ? JSON.parse(value) : value;
    case "bool":
    case "boolean":
      return value === true || value === 1 || value === "1" || value === "true";
    case "integer":
    case "int":
      return value === "" ? null : Number(value);
    case "hashed":
      return value;
    default:
      return value;
  }
}

function dehydrateValue(value: unknown, cast: "hashed"): Promise<unknown>;
function dehydrateValue(value: unknown, cast: Exclude<CastType, "hashed">): unknown;
function dehydrateValue(value: unknown, cast: CastType): unknown;
function dehydrateValue(value: unknown, cast: CastType): unknown {
  if (cast === "hashed") return hashCastValue(value);
  if (value === null || value === undefined) {
    return value;
  }

  switch (cast) {
    case "date":
    case "datetime":
      return value instanceof Date ? value : new Date(String(value));
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "bool":
    case "boolean":
      return Boolean(value);
    case "integer":
    case "int":
      return value === "" ? null : Number(value);
    default:
      return value;
  }
}

function filterMassAssignable(
  fillable: readonly string[] | undefined,
  guarded: readonly string[] | true | undefined,
  input: LoadedAttributes,
): LoadedAttributes {
  if (fillable === undefined && guarded === undefined && Object.keys(input).length > 0) {
    throw new Error(
      "Mass assignment is not configured for this model. Declare static $fillable = [...] to allow specific columns, or static $guarded = [] to allow all of them.",
    );
  }

  const resolvedGuarded = guarded ?? true;

  if (fillable && fillable.length > 0) {
    const allowed = new Set(fillable);
    return Object.fromEntries(Object.entries(input).filter(([key]) => allowed.has(key)));
  }

  if (resolvedGuarded === true || resolvedGuarded.includes("*")) {
    return {};
  }

  const blocked = new Set(resolvedGuarded);
  return Object.fromEntries(Object.entries(input).filter(([key]) => !blocked.has(key)));
}

function applyCasts(
  values: LoadedAttributes,
  casts: ModelCasts,
  direction: "hydrate",
): LoadedAttributes;
function applyCasts(
  values: LoadedAttributes,
  casts: ModelCasts,
  direction: "dehydrate",
): Promise<LoadedAttributes>;
function applyCasts(
  values: LoadedAttributes,
  casts: ModelCasts,
  direction: "hydrate" | "dehydrate",
): LoadedAttributes | Promise<LoadedAttributes>;
function applyCasts(
  values: LoadedAttributes,
  casts: ModelCasts,
  direction: "hydrate" | "dehydrate",
): LoadedAttributes | Promise<LoadedAttributes> {
  const entries = Object.entries(casts);
  if (entries.length === 0) {
    return direction === "hydrate" ? values : Promise.resolve(values);
  }

  const result = { ...values };
  if (direction === "hydrate") {
    for (const [key, cast] of entries) {
      if (key in result && cast) result[key] = hydrateValue(result[key], cast);
    }
    return result;
  }

  return (async () => {
    const hashes: Array<Promise<void>> = [];

    for (const [key, cast] of entries) {
      if (!(key in result) || !cast) continue;
      if (cast === "hashed") {
        const current = result[key];
        hashes.push(
          hashCastValue(current).then((hashed) => {
            result[key] = hashed;
          }),
        );
        continue;
      }
      result[key] = dehydrateValue(result[key], cast);
    }

    await Promise.all(hashes);
    return result;
  })();
}

function applyTimestampsOnCreate(
  columns: readonly string[],
  values: LoadedAttributes,
  enabled: boolean,
): LoadedAttributes {
  if (!enabled) {
    return values;
  }

  const now = new Date();
  const result = { ...values };

  if (columns.includes("created_at")) {
    result.created_at = now;
  }

  if (columns.includes("updated_at")) {
    result.updated_at = now;
  }

  return result;
}

function applyTimestampsOnUpdate(
  columns: readonly string[],
  values: LoadedAttributes,
  enabled: boolean,
): LoadedAttributes {
  if (!enabled) {
    return values;
  }

  const result = { ...values };

  if (columns.includes("updated_at")) {
    result.updated_at = new Date();
  }

  return result;
}

export type { CastType, LoadedAttributes, ModelCasts };
export {
  applyCasts,
  applyTimestampsOnCreate,
  applyTimestampsOnUpdate,
  changedAttributes,
  dehydrateValue,
  filterMassAssignable,
  hydrateValue,
  snapshotAttributes,
};
