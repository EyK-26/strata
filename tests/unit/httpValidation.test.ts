import { describe, expect, test } from "bun:test";
import { BadRequestError } from "@getstrata/core/errors/http";
import {
  buildRequestCacheKey,
  expectObject,
  getQueryParams,
  parseJsonBody,
  parseOptionalBooleanQueryParam,
  parseOptionalEnumQueryParam,
  parseOptionalPositiveIntQueryParam,
  parsePositiveIntParam,
  readOptionalEnum,
  readOptionalPositiveInt,
  readOptionalString,
  readRequiredEnum,
  readRequiredPositiveInt,
  readRequiredString,
} from "../../src/core/http/validation";

describe("getQueryParams", () => {
  test("returns empty params when request is omitted", () => {
    expect([...getQueryParams().entries()]).toEqual([]);
  });

  test("returns search params from the request url", () => {
    const request = new Request("http://example.test/widgets?page=2");

    expect(getQueryParams(request).get("page")).toBe("2");
  });
});

describe("buildRequestCacheKey", () => {
  test("falls back to the provided path when request is omitted", () => {
    expect(buildRequestCacheKey("/projects")).toBe("/projects");
  });
});

describe("parseOptionalPositiveIntQueryParam", () => {
  test("returns undefined for missing values", () => {
    expect(parseOptionalPositiveIntQueryParam(new URLSearchParams(), "page")).toBeUndefined();
  });

  test("rejects invalid integers", () => {
    expect(() => parseOptionalPositiveIntQueryParam(new URLSearchParams("page=0"), "page")).toThrow(
      BadRequestError,
    );
  });
});

describe("parseOptionalBooleanQueryParam", () => {
  test("parses supported boolean strings", () => {
    expect(parseOptionalBooleanQueryParam(new URLSearchParams("enabled=true"), "enabled")).toBe(
      true,
    );
    expect(parseOptionalBooleanQueryParam(new URLSearchParams("enabled=0"), "enabled")).toBe(false);
  });

  test("rejects invalid booleans", () => {
    expect(() =>
      parseOptionalBooleanQueryParam(new URLSearchParams("enabled=maybe"), "enabled"),
    ).toThrow(BadRequestError);
  });
});

describe("parseOptionalEnumQueryParam", () => {
  test("rejects unsupported enum values", () => {
    expect(() =>
      parseOptionalEnumQueryParam(new URLSearchParams("status=deleted"), "status", [
        "draft",
        "active",
      ]),
    ).toThrow(BadRequestError);
  });
});

describe("parseJsonBody", () => {
  test("rejects invalid JSON payloads", async () => {
    const request = new Request("http://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    await expect(parseJsonBody(request, (payload) => payload)).rejects.toThrow(
      "Request body must be valid JSON.",
    );
  });
});

describe("expectObject", () => {
  test("rejects non-object payloads", () => {
    expect(() => expectObject(null)).toThrow(BadRequestError);
    expect(() => expectObject([])).toThrow("request body must be a JSON object.");
  });
});

describe("parsePositiveIntParam", () => {
  test("parses positive integer route params", () => {
    expect(parsePositiveIntParam("12", "widget id")).toBe(12);
  });

  test("rejects invalid route params", () => {
    expect(() => parsePositiveIntParam("0", "widget id")).toThrow(
      "Invalid widget id. Expected a positive integer.",
    );
  });
});

describe("readRequiredString", () => {
  test("trims and validates required strings", () => {
    expect(
      readRequiredString({ name: "  Relay  " }, "name", {
        minLength: 2,
        maxLength: 10,
      }),
    ).toBe("Relay");
  });

  test("rejects missing or blank strings", () => {
    expect(() => readRequiredString({ name: "   " }, "name")).toThrow(
      '"name" is required and must be a string.',
    );
  });

  test("rejects values outside length bounds", () => {
    expect(() => readRequiredString({ name: "a" }, "name", { minLength: 2 })).toThrow(
      '"name" must be at least 2 characters.',
    );
    expect(() => readRequiredString({ name: "abcdefghijk" }, "name", { maxLength: 5 })).toThrow(
      '"name" must be at most 5 characters.',
    );
  });

  test("rejects values that fail pattern checks", () => {
    expect(() =>
      readRequiredString({ slug: "Bad Slug" }, "slug", { pattern: /^[a-z-]+$/ }),
    ).toThrow('"slug" has an invalid format.');
  });
});

describe("readOptionalString", () => {
  test("returns undefined when the field is absent", () => {
    expect(readOptionalString({}, "name")).toBeUndefined();
  });

  test("validates present optional strings", () => {
    expect(readOptionalString({ name: "Relay" }, "name")).toBe("Relay");
  });
});

describe("readRequiredEnum", () => {
  test("accepts allowed enum values", () => {
    expect(readRequiredEnum({ status: "active" }, "status", ["draft", "active"])).toBe("active");
  });

  test("rejects values outside the allowed set", () => {
    expect(() => readRequiredEnum({ status: "deleted" }, "status", ["draft", "active"])).toThrow(
      '"status" must be one of: draft, active.',
    );
  });
});

describe("readOptionalEnum", () => {
  test("returns undefined when the field is absent", () => {
    expect(readOptionalEnum({}, "status", ["draft", "active"])).toBeUndefined();
  });
});

describe("readRequiredPositiveInt", () => {
  test("accepts positive integers", () => {
    expect(readRequiredPositiveInt({ count: 3 }, "count")).toBe(3);
  });

  test("rejects invalid integers", () => {
    expect(() => readRequiredPositiveInt({ count: 0 }, "count")).toThrow(
      '"count" is required and must be a positive integer.',
    );
  });
});

describe("readOptionalPositiveInt", () => {
  test("returns undefined when the field is absent", () => {
    expect(readOptionalPositiveInt({}, "count")).toBeUndefined();
  });

  test("rejects invalid optional integers", () => {
    expect(() => readOptionalPositiveInt({ count: -1 }, "count")).toThrow(BadRequestError);
  });
});
