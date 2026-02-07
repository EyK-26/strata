import { BadRequestError } from "../errors/http";

function buildRequestCacheKey(fallbackPath: string, request?: Request): string {
  if (!request) {
    return fallbackPath;
  }

  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
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
    throw new BadRequestError(
      `Invalid query parameter "${name}". Expected a positive integer.`,
    );
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
      throw new BadRequestError(
        `Invalid query parameter "${name}". Expected a boolean.`,
      );
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

function expectObject(
  value: unknown,
  label: string = "request body",
): Record<string, unknown> {
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

export {
  buildRequestCacheKey,
  expectObject,
  getQueryParams,
  parseJsonBody,
  parseOptionalBooleanQueryParam,
  parseOptionalEnumQueryParam,
  parseOptionalPositiveIntQueryParam,
};
