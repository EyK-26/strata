import { describe, expect, test } from "bun:test";
import { BadRequestError, ValidationError } from "../../src/core/errors/http";
import {
  parseCreateApiTokenBody,
  parseLoginBody,
  parseTokenIdParams,
} from "../../src/modules/user/requests";

describe("user requests", () => {
  test("parseLoginBody validates email and password", async () => {
    const request = new Request("http://example.test/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "user@workhub.test",
        password: "password123",
      }),
    });

    await expect(parseLoginBody(request)).resolves.toEqual({
      email: "user@workhub.test",
      password: "password123",
    });
  });

  test("parseLoginBody accepts optional mfa_code", async () => {
    const request = new Request("http://example.test/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "user@workhub.test",
        password: "password123",
        mfa_code: "123456",
      }),
    });

    await expect(parseLoginBody(request)).resolves.toEqual({
      email: "user@workhub.test",
      password: "password123",
      mfa_code: "123456",
    });
  });

  test("parseLoginBody rejects invalid payloads", async () => {
    const request = new Request("http://example.test/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bad", password: "short" }),
    });

    await expect(parseLoginBody(request)).rejects.toThrow(ValidationError);
  });

  test("parseCreateApiTokenBody validates token metadata", async () => {
    const request = new Request("http://example.test/auth/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "ci-token",
        abilities: ["tasks:read"],
        expires_in_days: 30,
      }),
    });

    await expect(parseCreateApiTokenBody(request)).resolves.toEqual({
      name: "ci-token",
      abilities: ["tasks:read"],
      expires_in_days: 30,
    });
  });

  test("parseCreateApiTokenBody omits optional fields when absent", async () => {
    const request = new Request("http://example.test/auth/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "minimal" }),
    });

    await expect(parseCreateApiTokenBody(request)).resolves.toEqual({ name: "minimal" });
  });

  test("parseCreateApiTokenBody ignores non-array abilities", async () => {
    const request = new Request("http://example.test/auth/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "broken",
        abilities: "tasks:read",
      }),
    });

    await expect(parseCreateApiTokenBody(request)).resolves.toEqual({ name: "broken" });
  });

  test("parseTokenIdParams parses positive integer ids", () => {
    expect(parseTokenIdParams({ id: "12" })).toEqual({ id: 12 });
  });

  test("parseTokenIdParams rejects invalid ids", () => {
    expect(() => parseTokenIdParams({ id: "0" })).toThrow(BadRequestError);
  });
});
