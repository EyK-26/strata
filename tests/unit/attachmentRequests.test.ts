import { describe, expect, test } from "bun:test";
import { BadRequestError } from "@getstrata/core/errors/http";
import {
  parseAttachmentIdParams,
  parseTaskAttachmentParams,
} from "../../src/modules/attachment/requests";

describe("attachment requests", () => {
  test("parseAttachmentIdParams parses positive integer ids", () => {
    expect(parseAttachmentIdParams({ id: "42" })).toEqual({ attachmentId: 42 });
  });

  test("parseAttachmentIdParams rejects invalid ids", () => {
    expect(() => parseAttachmentIdParams({ id: "0" })).toThrow(BadRequestError);
    expect(() => parseAttachmentIdParams({ id: "abc" })).toThrow(BadRequestError);
  });

  test("parseTaskAttachmentParams parses positive integer ids", () => {
    expect(parseTaskAttachmentParams({ id: "7" })).toEqual({ taskId: 7 });
  });

  test("parseTaskAttachmentParams rejects invalid ids", () => {
    expect(() => parseTaskAttachmentParams({ id: "-1" })).toThrow(BadRequestError);
  });
});
