import { describe, expect, test } from "bun:test";
import { isAllowedMimeType, resolveMaxUploadBytes } from "../../src/config/uploads";
import { sanitizeUploadFileName } from "../../src/core/http/parseMultipartUpload";

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
      process.env.MAX_UPLOAD_BYTES = previous;
    }
  });

  test("isAllowedMimeType accepts common upload types", () => {
    expect(isAllowedMimeType("image/png")).toBe(true);
    expect(isAllowedMimeType("application/octet-stream")).toBe(true);
    expect(isAllowedMimeType("application/x-msdownload")).toBe(false);
  });
});
