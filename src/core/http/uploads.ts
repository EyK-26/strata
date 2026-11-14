import { resolveEnv } from "../config/envSchema";

const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "application/json",
  "application/zip",
  "application/x-zip-compressed",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
]);

interface UploadPolicy {
  readonly maxBytes: number;
  readonly allowUnknownMime: boolean;
}

const DEFAULT_UPLOAD_POLICY: UploadPolicy = Object.freeze({
  maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
  allowUnknownMime: false,
});

function resolveMaxUploadBytes(value?: string): number {
  return resolveEnv(
    { MAX_UPLOAD_BYTES: { integer: true, minimum: 1, default: String(DEFAULT_MAX_UPLOAD_BYTES) } },
    { MAX_UPLOAD_BYTES: value },
  ).MAX_UPLOAD_BYTES;
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isAllowedMimeType(mimeType: string, allowUnknownMime = false): boolean {
  const normalized = normalizeMimeType(mimeType);

  if (!normalized || normalized === "application/octet-stream") {
    return allowUnknownMime;
  }

  return ALLOWED_UPLOAD_MIME_TYPES.has(normalized);
}

export type { UploadPolicy };
export {
  ALLOWED_UPLOAD_MIME_TYPES,
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_UPLOAD_POLICY,
  isAllowedMimeType,
  resolveMaxUploadBytes,
};
