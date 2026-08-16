import { describe, expect, test } from "bun:test";
import { BadRequestError, ForbiddenError } from "@getstrata/core/errors/http";
import { FormRequest, QueryFormRequest } from "../../src/core/http/formRequest";

class CreateWidgetRequest extends FormRequest<{ name: string }> {
  constructor(private readonly allowed: boolean = true) {
    super();
  }

  override authorize(): boolean {
    return this.allowed;
  }

  protected parse(payload: unknown): { name: string } {
    if (
      payload === null ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof (payload as { name?: unknown }).name !== "string" ||
      (payload as { name: string }).name.trim() === ""
    ) {
      throw new BadRequestError('"name" is required and must be a string.');
    }

    return { name: (payload as { name: string }).name.trim() };
  }
}

class WidgetListQueryRequest extends QueryFormRequest<{ page: number }> {
  protected parseQuery(request?: Request): { page: number } {
    const value = new URL(request?.url ?? "http://example.test/widgets").searchParams.get("page");

    if (value === null) {
      return { page: 1 };
    }

    const page = Number.parseInt(value, 10);

    if (!Number.isInteger(page) || page <= 0) {
      throw new BadRequestError('Invalid query parameter "page". Expected a positive integer.');
    }

    return { page };
  }
}

describe("FormRequest", () => {
  test("validates JSON bodies after authorize succeeds", async () => {
    const request = new Request("http://example.test/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Relay" }),
    });

    await expect(new CreateWidgetRequest().validate(request)).resolves.toEqual({
      name: "Relay",
    });
  });

  test("rejects unauthorized requests before parsing the body", async () => {
    const request = new Request("http://example.test/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Relay" }),
    });

    await expect(new CreateWidgetRequest(false).validate(request)).rejects.toThrow(ForbiddenError);
  });
});

describe("QueryFormRequest", () => {
  test("parses query strings into typed DTOs", () => {
    const request = new Request("http://example.test/widgets?page=2");

    expect(new WidgetListQueryRequest().validate(request)).toEqual({ page: 2 });
  });
});
