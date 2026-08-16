import { describe, expect, test } from "bun:test";
import { BadRequestError } from "@getstrata/core/errors/http";
import { formDataToRecord, parseFormBody } from "../../src/core/http/parseFormBody";

describe("parseFormBody", () => {
  test("rejects requests without a form content type", async () => {
    const request = new Request("http://example.test/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Relay" }),
    });

    await expect(parseFormBody(request)).rejects.toThrow(BadRequestError);
    await expect(parseFormBody(request)).rejects.toThrow("Expected a form submission.");
  });

  test("parses urlencoded form bodies", async () => {
    const request = new Request("http://example.test/widgets", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Relay&status=active",
    });

    await expect(parseFormBody(request)).resolves.toEqual({
      name: "Relay",
      status: "active",
    });
  });

  test("parses multipart form bodies", async () => {
    const formData = new FormData();
    formData.set("name", "Relay");
    formData.set("status", "active");

    const request = new Request("http://example.test/widgets", {
      method: "POST",
      body: formData,
    });

    await expect(parseFormBody(request)).resolves.toEqual({
      name: "Relay",
      status: "active",
    });
  });

  test("treats missing content type as invalid", async () => {
    const request = new Request("http://example.test/widgets", {
      method: "POST",
      body: "name=Relay",
    });

    await expect(parseFormBody(request)).rejects.toThrow(BadRequestError);
  });
});

describe("formDataToRecord", () => {
  test("keeps string values and ignores non-string entries", () => {
    const formData = {
      entries(): Iterable<[string, unknown]> {
        return [
          ["name", "Relay"],
          ["avatar", new Blob(["image"])],
          ["count", 42],
        ];
      },
    };

    expect(formDataToRecord(formData)).toEqual({ name: "Relay" });
  });
});
