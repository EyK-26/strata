import { BadRequestError, PayloadTooLargeError } from "@getstrata/core/errors/http";
import { isAllowedMimeType, resolveMaxUploadBytes } from "./uploads";

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

async function validateUploadFile(file: File, fieldName = "file"): Promise<ParsedUpload> {
  if (!(file instanceof File)) {
    throw new BadRequestError(`Missing upload field "${fieldName}".`);
  }

  if (file.size <= 0) {
    throw new BadRequestError("Uploaded file is empty.");
  }

  const maxBytes = resolveMaxUploadBytes();

  if (file.size > maxBytes) {
    throw new PayloadTooLargeError(`Upload exceeds the ${maxBytes} byte limit.`);
  }

  const mimeType = normalizeMimeType(file.type.trim() || "application/octet-stream");

  if (!isAllowedMimeType(mimeType)) {
    throw new BadRequestError(`File type "${mimeType}" is not allowed.`);
  }

  return {
    fileName: sanitizeUploadFileName(file.name),
    mimeType,
    size: file.size,
    contents: new Uint8Array(await file.arrayBuffer()),
  };
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

  return validateUploadFile(value, fieldName);
}

export type { ParsedUpload };
export { parseMultipartUpload, sanitizeUploadFileName, validateUploadFile };
