import { createHmac } from "node:crypto";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { timingSafeCompareString } from "@getstrata/core/security/timingSafeCompare";

import type { Middleware } from "./middleware";

interface TemporarySignedUrlOptions {
  expiresInSeconds?: number;
  query?: Record<string, string | number>;
}

function missingSignedUrlSecret(): never {
  throw new TypeError("Explicit signed URL secret is required.");
}
function normalizeSignedPath(path: string): string {
  const trimmed = path.trim();

  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    throw new Error("Signed URLs must use a same-origin absolute path.");
  }

  if (trimmed.includes("://")) {
    throw new Error("Signed URLs must use a same-origin absolute path.");
  }

  return trimmed;
}

function sortedQueryString(params: URLSearchParams): string {
  const entries = [...params.entries()]
    .filter(([key]) => key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right));

  return new URLSearchParams(entries).toString();
}

function signCanonicalPayload(path: string, query: string, secret?: string): string {
  return createHmac("sha256", secret ?? missingSignedUrlSecret())
    .update(`${path}\n${query}`)
    .digest("hex");
}

function buildSignedSearchParams(
  path: string,
  query: Record<string, string | number> = {},
  expiresAt?: number,
  secret?: string,
): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (key === "signature" || key === "expires") {
      continue;
    }

    params.set(key, String(value));
  }

  if (expiresAt !== undefined) {
    params.set("expires", String(expiresAt));
  }

  params.set("signature", signCanonicalPayload(path, sortedQueryString(params), secret));

  return params;
}

function signedUrl(
  path: string,
  query: Record<string, string | number> = {},
  secret?: string,
): string {
  const normalizedPath = normalizeSignedPath(path);
  const params = buildSignedSearchParams(normalizedPath, query, undefined, secret);

  return `${normalizedPath}?${params.toString()}`;
}

function temporarySignedUrl(
  path: string,
  expiresInSeconds: number,
  query: Record<string, string | number> = {},
  secret?: string,
): string {
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error("Signed URL expiry must be a positive integer number of seconds.");
  }

  const normalizedPath = normalizeSignedPath(path);
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const params = buildSignedSearchParams(normalizedPath, query, expiresAt, secret);

  return `${normalizedPath}?${params.toString()}`;
}

function absoluteTemporarySignedUrl(
  path: string,
  expiresInSeconds: number,
  query: Record<string, string | number> = {},
  origin: string,
  secret?: string,
): string {
  return `${origin.replace(/\/$/, "")}${temporarySignedUrl(path, expiresInSeconds, query, secret)}`;
}

function readSignedRequestUrl(input: Request | URL | string): URL {
  if (input instanceof URL) {
    return input;
  }

  if (typeof input === "string") {
    return new URL(input, "http://signed-url.invalid");
  }

  return new URL(input.url);
}

function hasValidSignature(input: Request | URL | string, secret?: string): boolean {
  const url = readSignedRequestUrl(input);
  const signature = url.searchParams.get("signature");

  if (!signature) {
    return false;
  }

  const expires = url.searchParams.get("expires");

  if (!expires) {
    return false;
  }

  const expiresAt = Number.parseInt(expires, 10);

  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = signCanonicalPayload(url.pathname, sortedQueryString(url.searchParams), secret);

  return timingSafeCompareString(signature, expected);
}

function assertValidSignature(input: Request | URL | string, secret?: string): void {
  if (!hasValidSignature(input, secret)) {
    throw new ForbiddenError("Invalid or expired signed URL.");
  }
}

function createValidateSignatureMiddleware(options: { readonly secret: string }): Middleware {
  const secret = options?.secret ?? missingSignedUrlSecret();
  return async (request, next) => {
    assertValidSignature(request, secret);
    return await next();
  };
}

export type { TemporarySignedUrlOptions };
export {
  absoluteTemporarySignedUrl,
  assertValidSignature,
  createValidateSignatureMiddleware,
  hasValidSignature,
  signedUrl,
  temporarySignedUrl,
};
