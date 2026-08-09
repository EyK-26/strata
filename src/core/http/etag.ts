import { PreconditionFailedError } from "@getstrata/core/errors/http";
import { nonCryptographicDigest } from "../crypto/nonCryptographicHash.ts";

interface EtagVersioned {
  id?: number | string;
  updated_at?: Date | string | null;
  created_at?: Date | string | null;
}

function isEtagEnabled(): boolean {
  return (process.env.FEATURE_ETAG ?? "true") !== "false";
}

function formatWeakEtag(digest: string): string {
  return `W/"${digest}"`;
}

function computeEtagFromJson(data: unknown): string {
  const digest = nonCryptographicDigest(JSON.stringify(data)).slice(0, 32);

  return formatWeakEtag(digest);
}

function etagFromResource(resource: EtagVersioned): string {
  const version = resource.updated_at ?? resource.created_at ?? "";
  const versionText =
    version instanceof Date ? version.toISOString() : version ? String(version) : "0";
  const digest = nonCryptographicDigest(`${String(resource.id ?? "0")}:${versionText}`).slice(
    0,
    32,
  );

  return formatWeakEtag(digest);
}

function normalizeEtag(value: string): string {
  return value.trim();
}

function etagValuesMatch(left: string, right: string): boolean {
  return normalizeEtag(left) === normalizeEtag(right);
}

function parseEtagList(header: string | null): string[] {
  if (!header) {
    return [];
  }

  return header
    .split(",")
    .map((value) => normalizeEtag(value))
    .filter(Boolean);
}

function ifNoneMatchSatisfied(request: Request, etag: string): boolean {
  const header = request.headers.get("if-none-match");

  if (!header) {
    return false;
  }

  if (header.trim() === "*") {
    return true;
  }

  return parseEtagList(header).some((candidate) => etagValuesMatch(candidate, etag));
}

function ifMatchSatisfied(request: Request, etag: string): boolean {
  const header = request.headers.get("if-match");

  if (!header) {
    return false;
  }

  if (header.trim() === "*") {
    return true;
  }

  return parseEtagList(header).some((candidate) => etagValuesMatch(candidate, etag));
}

function assertIfMatch(request: Request, etag: string, options: { required?: boolean } = {}): void {
  const header = request.headers.get("if-match");

  if (!header) {
    if (options.required) {
      throw new PreconditionFailedError("If-Match header is required.");
    }

    return;
  }

  if (!ifMatchSatisfied(request, etag)) {
    throw new PreconditionFailedError("Resource ETag does not match If-Match.");
  }
}

function applyEtagHeaders(headers: Headers, etag: string): Headers {
  const next = new Headers(headers);
  next.set("ETag", etag);
  next.set("Cache-Control", "private, must-revalidate");
  next.append("Vary", "Authorization");
  next.append("Vary", "X-Tenant-Id");
  return next;
}

function notModifiedResponse(etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: applyEtagHeaders(new Headers(), etag),
  });
}

function applyConditionalGet(request: Request, response: Response, etag: string): Response {
  if (!isEtagEnabled()) {
    return response;
  }

  if (ifNoneMatchSatisfied(request, etag)) {
    return notModifiedResponse(etag);
  }

  const headers = applyEtagHeaders(new Headers(response.headers), etag);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export type { EtagVersioned };
export {
  applyConditionalGet,
  assertIfMatch,
  computeEtagFromJson,
  etagFromResource,
  etagValuesMatch,
  ifMatchSatisfied,
  ifNoneMatchSatisfied,
  isEtagEnabled,
  notModifiedResponse,
};
