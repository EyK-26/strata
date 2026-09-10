import { envFlagEnabled } from "../runtime/appEnv.ts";

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

function resolveMaxUploadBytes(): number {
  const raw = process.env.MAX_UPLOAD_BYTES?.trim() ?? process.env.MAX_REQUEST_BODY_BYTES?.trim();

  if (!raw) {
    return DEFAULT_MAX_UPLOAD_BYTES;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MAX_UPLOAD_BYTES;
  }

  return parsed;
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isAllowedMimeType(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);

  if (!normalized || normalized === "application/octet-stream") {
    return envFlagEnabled(process.env.UPLOAD_ALLOW_UNKNOWN_MIME);
  }

  return ALLOWED_UPLOAD_MIME_TYPES.has(normalized);
}

export {
  ALLOWED_UPLOAD_MIME_TYPES,
  DEFAULT_MAX_UPLOAD_BYTES,
  isAllowedMimeType,
  resolveMaxUploadBytes,
};
