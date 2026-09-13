import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { BadRequestError } from "@getstrata/core/errors/http";
import { currentTenant } from "@getstrata/core/tenant/tenantContext";

function buildRequestCacheKey(fallbackPath: string, request?: Request): string {
  if (!request) {
    return fallbackPath;
  }

  const url = new URL(request.url);
  const user = currentAuthUser();
  const authScope = user ? `u:${user.id}` : "guest";
  const tenantScope = `t:${currentTenant()?.id ?? "none"}`;

  return `${authScope}|${tenantScope}|${url.pathname}${url.search}`;
}

function getQueryParams(request?: Request): URLSearchParams {
  if (!request) {
    return new URLSearchParams();
  }

  return new URL(request.url).searchParams;
}

function parseOptionalPositiveIntQueryParam(
  params: URLSearchParams,
  name: string,
): number | undefined {
  const value = params.get(name);

  if (value === null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestError(`Invalid query parameter "${name}". Expected a positive integer.`);
  }

  return parsed;
}

function parseOptionalBooleanQueryParam(
  params: URLSearchParams,
  name: string,
): boolean | undefined {
  const value = params.get(name);

  if (value === null || value.trim() === "") {
    return undefined;
  }

  switch (value.toLowerCase()) {
    case "true":
    case "1":
      return true;
    case "false":
    case "0":
      return false;
    default:
      throw new BadRequestError(`Invalid query parameter "${name}". Expected a boolean.`);
  }
}

function parseOptionalEnumQueryParam<TValue extends string>(
  params: URLSearchParams,
  name: string,
  allowedValues: readonly TValue[],
): TValue | undefined {
  const value = params.get(name);

  if (value === null || value.trim() === "") {
    return undefined;
  }

  if (!allowedValues.includes(value as TValue)) {
    throw new BadRequestError(
      `Invalid query parameter "${name}". Expected one of: ${allowedValues.join(", ")}.`,
    );
  }

  return value as TValue;
}

function expectObject(value: unknown, label: string = "request body"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestError(`${label} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

async function parseJsonBody<TValue>(
  request: Request,
  validator: (payload: unknown) => TValue,
): Promise<TValue> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    throw new BadRequestError("Request body must be valid JSON.");
  }

  return validator(payload);
}

function readRequiredString(
  payload: Record<string, unknown>,
  field: string,
  options: { minLength?: number; maxLength?: number; pattern?: RegExp } = {},
): string {
  const value = payload[field];

  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestError(`"${field}" is required and must be a string.`);
  }

  const trimmed = value.trim();

  if (options.minLength !== undefined && trimmed.length < options.minLength) {
    throw new BadRequestError(`"${field}" must be at least ${options.minLength} characters.`);
  }

  if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
    throw new BadRequestError(`"${field}" must be at most ${options.maxLength} characters.`);
  }

  if (options.pattern && !options.pattern.test(trimmed)) {
    throw new BadRequestError(`"${field}" has an invalid format.`);
  }

  return trimmed;
}

function readOptionalString(
  payload: Record<string, unknown>,
  field: string,
  options: { minLength?: number; maxLength?: number; pattern?: RegExp } = {},
): string | undefined {
  if (!(field in payload) || payload[field] === undefined) {
    return undefined;
  }

  return readRequiredString(payload, field, options);
}

function readRequiredEnum<TValue extends string>(
  payload: Record<string, unknown>,
  field: string,
  allowedValues: readonly TValue[],
): TValue {
  const value = readRequiredString(payload, field);

  if (!allowedValues.includes(value as TValue)) {
    throw new BadRequestError(`"${field}" must be one of: ${allowedValues.join(", ")}.`);
  }

  return value as TValue;
}

function readOptionalEnum<TValue extends string>(
  payload: Record<string, unknown>,
  field: string,
  allowedValues: readonly TValue[],
): TValue | undefined {
  if (!(field in payload) || payload[field] === undefined) {
    return undefined;
  }

  return readRequiredEnum(payload, field, allowedValues);
}

function readRequiredPositiveInt(payload: Record<string, unknown>, field: string): number {
  const value = payload[field];

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestError(`"${field}" is required and must be a positive integer.`);
  }

  return value;
}

function readOptionalPositiveInt(
  payload: Record<string, unknown>,
  field: string,
): number | undefined {
  if (!(field in payload) || payload[field] === undefined) {
    return undefined;
  }

  return readRequiredPositiveInt(payload, field);
}

function parsePositiveIntParam(value: string, name: string = "id"): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestError(`Invalid ${name}. Expected a positive integer.`);
  }

  return parsed;
}

export {
  buildRequestCacheKey,
  expectObject,
  getQueryParams,
  parseJsonBody,
  parseOptionalBooleanQueryParam,
  parseOptionalEnumQueryParam,
  parseOptionalPositiveIntQueryParam,
  parsePositiveIntParam,
  readOptionalEnum,
  readOptionalPositiveInt,
  readOptionalString,
  readRequiredEnum,
  readRequiredPositiveInt,
  readRequiredString,
};
