import { describe, expect, test } from "bun:test";
import { BadRequestError, ForbiddenError, ValidationError } from "../../src/core/errors/http";
import { WebFormRequest } from "../../src/core/http/webFormRequest";

class CreateWidgetRequest extends WebFormRequest<{ name: string }> {
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

class ValidatedWidgetRequest extends WebFormRequest<{ name: string }> {
  protected parse(): { name: string } {
    throw new ValidationError("Validation failed", { name: ["is required"] });
  }
}

class BrokenWidgetRequest extends WebFormRequest<{ name: string }> {
  protected parse(): { name: string } {
    throw new Error("unexpected parser failure");
  }
}

class DefaultAuthorizedWidgetRequest extends WebFormRequest<{ name: string }> {
  protected parse(payload: unknown): { name: string } {
    return { name: String((payload as { name: string }).name) };
  }
}

describe("WebFormRequest", () => {
  test("validatePayload parses without authorize", () => {
    class GuestOnlyRequest extends WebFormRequest<{ name: string }> {
      override authorize(): boolean {
        return false;
      }

      protected parse(payload: unknown): { name: string } {
        return { name: String((payload as { name: string }).name) };
      }
    }

    expect(new GuestOnlyRequest().validatePayload({ name: "Relay" })).toEqual({ name: "Relay" });
  });

  test("allows requests by default when authorize is not overridden", async () => {
    const request = new Request("http://example.test/api/v1/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Relay" }),
    });

    await expect(new DefaultAuthorizedWidgetRequest().validate(request)).resolves.toEqual({
      name: "Relay",
    });
  });

  test("authorize defaults to true", () => {
    const instance = new DefaultAuthorizedWidgetRequest();
    const request = new Request("http://example.test/widgets");

    expect(instance.authorize(request)).toBe(true);
  });

  test("supports async authorize implementations", async () => {
    class AsyncWidgetRequest extends WebFormRequest<{ name: string }> {
      override authorize(): Promise<boolean> {
        return Promise.resolve(true);
      }

      protected parse(payload: unknown): { name: string } {
        return { name: String((payload as { name: string }).name) };
      }
    }

    const request = new Request("http://example.test/api/v1/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Relay" }),
    });

    await expect(new AsyncWidgetRequest().validate(request)).resolves.toEqual({
      name: "Relay",
    });
  });

  test("validates JSON bodies after authorize succeeds", async () => {
    const request = new Request("http://example.test/api/v1/widgets", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ name: "Relay" }),
    });

    await expect(new CreateWidgetRequest().validate(request)).resolves.toEqual({
      name: "Relay",
    });
  });

  test("validates form bodies for HTML requests", async () => {
    const request = new Request("http://example.test/widgets", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: "name=Relay",
    });

    await expect(new CreateWidgetRequest().validate(request)).resolves.toEqual({
      name: "Relay",
    });
  });

  test("rejects unauthorized requests before parsing the body", async () => {
    const request = new Request("http://example.test/api/v1/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Relay" }),
    });

    await expect(new CreateWidgetRequest(false).validate(request)).rejects.toThrow(ForbiddenError);
  });

  test("rethrows ValidationError from parse", async () => {
    const request = new Request("http://example.test/api/v1/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Relay" }),
    });

    await expect(new ValidatedWidgetRequest().validate(request)).rejects.toThrow(ValidationError);
  });

  test("rethrows non-validation errors from parse", async () => {
    const request = new Request("http://example.test/api/v1/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Relay" }),
    });

    await expect(new BrokenWidgetRequest().validate(request)).rejects.toThrow(
      "unexpected parser failure",
    );
  });
});
