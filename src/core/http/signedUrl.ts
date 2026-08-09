import { createHmac } from "node:crypto";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { timingSafeCompareString } from "@getstrata/core/security/timingSafeCompare";
import { requireConfiguredSecret } from "../runtime/appKeyPrefix";
import type { Middleware } from "./middleware";

interface TemporarySignedUrlOptions {
  expiresInSeconds?: number;
  query?: Record<string, string | number>;
}

function resolveSignedUrlSecret(): string {
  return requireConfiguredSecret(
    ["SIGNED_URL_SECRET", "SESSION_SECRET", "OAUTH_STATE_SECRET"],
    "signed-url-secret",
  );
}

function resolveSignedUrlOrigin(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
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

function signCanonicalPayload(path: string, query: string): string {
  return createHmac("sha256", resolveSignedUrlSecret()).update(`${path}\n${query}`).digest("hex");
}

function buildSignedSearchParams(
  path: string,
  query: Record<string, string | number> = {},
  expiresAt?: number,
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

  params.set("signature", signCanonicalPayload(path, sortedQueryString(params)));

  return params;
}

function signedUrl(path: string, query: Record<string, string | number> = {}): string {
  const normalizedPath = normalizeSignedPath(path);
  const params = buildSignedSearchParams(normalizedPath, query);

  return `${normalizedPath}?${params.toString()}`;
}

function temporarySignedUrl(
  path: string,
  expiresInSeconds: number,
  query: Record<string, string | number> = {},
): string {
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error("Signed URL expiry must be a positive integer number of seconds.");
  }

  const normalizedPath = normalizeSignedPath(path);
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const params = buildSignedSearchParams(normalizedPath, query, expiresAt);

  return `${normalizedPath}?${params.toString()}`;
}

function absoluteTemporarySignedUrl(
  path: string,
  expiresInSeconds: number,
  query: Record<string, string | number> = {},
  origin = resolveSignedUrlOrigin(),
): string {
  return `${origin.replace(/\/$/, "")}${temporarySignedUrl(path, expiresInSeconds, query)}`;
}

function readSignedRequestUrl(input: Request | URL | string): URL {
  if (input instanceof URL) {
    return input;
  }

  if (typeof input === "string") {
    return new URL(input, resolveSignedUrlOrigin());
  }

  return new URL(input.url);
}

function hasValidSignature(input: Request | URL | string): boolean {
  const url = readSignedRequestUrl(input);
  const signature = url.searchParams.get("signature");

  if (!signature) {
    return false;
  }

  const expires = url.searchParams.get("expires");

  if (expires) {
    const expiresAt = Number.parseInt(expires, 10);

    if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
      return false;
    }
  }

  const expected = signCanonicalPayload(url.pathname, sortedQueryString(url.searchParams));

  return timingSafeCompareString(signature, expected);
}

function assertValidSignature(input: Request | URL | string): void {
  if (!hasValidSignature(input)) {
    throw new ForbiddenError("Invalid or expired signed URL.");
  }
}

function createValidateSignatureMiddleware(): Middleware {
  return async (request, next) => {
    assertValidSignature(request);
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
