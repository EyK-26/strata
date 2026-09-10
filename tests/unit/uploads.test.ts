import { describe, expect, test } from "bun:test";
import { sanitizeUploadFileName } from "@getstrata/core/http/parseMultipartUpload";
import { isAllowedMimeType, resolveMaxUploadBytes } from "../../src/config/uploads";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("upload helpers", () => {
  test("sanitizeUploadFileName strips path segments and unsafe characters", () => {
    expect(sanitizeUploadFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeUploadFileName("report final.pdf")).toBe("report final.pdf");
  });

  test("resolveMaxUploadBytes falls back to five megabytes", () => {
    const previous = process.env.MAX_UPLOAD_BYTES;
    delete process.env.MAX_UPLOAD_BYTES;
    delete process.env.MAX_REQUEST_BODY_BYTES;

    expect(resolveMaxUploadBytes()).toBe(5 * 1024 * 1024);

    if (previous === undefined) {
      delete process.env.MAX_UPLOAD_BYTES;
    } else {
      restoreEnvVar("MAX_UPLOAD_BYTES", previous);
    }
  });

  test("isAllowedMimeType accepts common upload types", () => {
    expect(isAllowedMimeType("image/png")).toBe(true);
    expect(isAllowedMimeType("application/x-msdownload")).toBe(false);
  });

  test("isAllowedMimeType rejects an undeclared type unless explicitly opted in", () => {
    const previous = process.env.UPLOAD_ALLOW_UNKNOWN_MIME;
    process.env.UPLOAD_ALLOW_UNKNOWN_MIME = undefined as unknown as string;
    delete process.env.UPLOAD_ALLOW_UNKNOWN_MIME;

    expect(isAllowedMimeType("application/octet-stream")).toBe(false);
    expect(isAllowedMimeType("")).toBe(false);

    process.env.UPLOAD_ALLOW_UNKNOWN_MIME = "true";
    expect(isAllowedMimeType("application/octet-stream")).toBe(true);

    if (previous === undefined) {
      delete process.env.UPLOAD_ALLOW_UNKNOWN_MIME;
    } else {
      process.env.UPLOAD_ALLOW_UNKNOWN_MIME = previous;
    }
  });
});
