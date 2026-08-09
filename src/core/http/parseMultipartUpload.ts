import { isAllowedMimeType, resolveMaxUploadBytes } from "../../config/uploads";
import { BadRequestError, PayloadTooLargeError } from "../errors/http";

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

interface ParsedUpload {
  fileName: string;
  mimeType: string;
  size: number;
  contents: Uint8Array;
}

function sanitizeUploadFileName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() ?? "upload";
  const sanitized = base.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 200);

  return sanitized.length > 0 ? sanitized : "upload";
}

async function parseMultipartUpload(request: Request, fieldName = "file"): Promise<ParsedUpload> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("multipart/form-data")) {
    throw new BadRequestError("Expected multipart form data.");
  }

  const formData = await request.formData();
  const value = formData.get(fieldName);

  if (!(value instanceof File)) {
    throw new BadRequestError(`Missing upload field "${fieldName}".`);
  }

  if (value.size <= 0) {
    throw new BadRequestError("Uploaded file is empty.");
  }

  const maxBytes = resolveMaxUploadBytes();

  if (value.size > maxBytes) {
    throw new PayloadTooLargeError(`Upload exceeds the ${maxBytes} byte limit.`);
  }

  const mimeType = normalizeMimeType(value.type.trim() || "application/octet-stream");

  if (!isAllowedMimeType(mimeType)) {
    throw new BadRequestError(`File type "${mimeType}" is not allowed.`);
  }

  return {
    fileName: sanitizeUploadFileName(value.name),
    mimeType,
    size: value.size,
    contents: new Uint8Array(await value.arrayBuffer()),
  };
}

export type { ParsedUpload };
export { parseMultipartUpload, sanitizeUploadFileName };
