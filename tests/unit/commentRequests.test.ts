import { describe, expect, test } from "bun:test";
import { BadRequestError } from "../../src/core/errors/http";
import {
  parseCommentIdParams,
  parseCommentListQuery,
  parseCreateCommentBody,
  parseTaskCommentParams,
  parseUpdateCommentBody,
} from "../../src/modules/comment/requests";

describe("comment requests", () => {
  test("parseCommentIdParams parses positive integer ids", () => {
    expect(parseCommentIdParams({ id: "15" })).toEqual({ id: 15 });
  });

  test("parseCommentIdParams rejects invalid ids", () => {
    expect(() => parseCommentIdParams({ id: "0" })).toThrow(BadRequestError);
  });

  test("parseTaskCommentParams parses positive integer ids", () => {
    expect(parseTaskCommentParams({ id: "4" })).toEqual({ taskId: 4 });
  });

  test("parseTaskCommentParams rejects invalid ids", () => {
    expect(() => parseTaskCommentParams({ id: "bad" })).toThrow(BadRequestError);
  });

  test("parseCommentListQuery validates pagination", () => {
    const request = new Request("http://localhost/comments?page=2&per_page=20");

    expect(parseCommentListQuery(request)).toEqual({
      page: 2,
      perPage: 20,
    });
  });

  test("parseCreateCommentBody validates create payloads", async () => {
    const request = new Request("http://localhost/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Looks good to me." }),
    });

    await expect(parseCreateCommentBody(request)).resolves.toEqual({
      body: "Looks good to me.",
    });
  });

  test("parseUpdateCommentBody validates update payloads", async () => {
    const request = new Request("http://localhost/comments/1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Updated comment." }),
    });

    await expect(parseUpdateCommentBody(request)).resolves.toEqual({
      body: "Updated comment.",
    });
  });
});
