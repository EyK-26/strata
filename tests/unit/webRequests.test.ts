import { describe, expect, test } from "bun:test";
import { ValidationError } from "@getstrata/core/errors/http";
import {
  parseWebConfirmPasswordBody,
  parseWebCreateApiTokenBody,
  parseWebDeleteAccountBody,
  parseWebLoginBody,
  parseWebRegisterBody,
} from "../../src/modules/user/webRequests";

describe("webRequests", () => {
  test("parseWebLoginBody validates form login payloads", async () => {
    const request = new Request("http://example.test/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=user%40workhub.test&password=password123",
    });

    await expect(parseWebLoginBody(request)).resolves.toEqual({
      email: "user@workhub.test",
      password: "password123",
    });
  });

  test("parseWebLoginBody trims email and includes redirect when present", async () => {
    const request = new Request("http://example.test/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=%20user%40workhub.test%20&password=password123&redirect=%2Fprojects",
    });

    await expect(parseWebLoginBody(request)).resolves.toEqual({
      email: "user@workhub.test",
      password: "password123",
      redirect: "/projects",
    });
  });

  test("parseWebLoginBody rejects missing credentials", async () => {
    const request = new Request("http://example.test/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=&password=",
    });

    await expect(parseWebLoginBody(request)).rejects.toThrow(ValidationError);
  });

  test("parseWebRegisterBody accepts a confirmed password", async () => {
    const request = new Request("http://example.test/register", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Ada+Lovelace&email=ada%40workhub.test&password=password123&password_confirmation=password123",
    });

    await expect(parseWebRegisterBody(request)).resolves.toEqual({
      name: "Ada Lovelace",
      email: "ada@workhub.test",
      password: "password123",
    });
  });

  test("parseWebRegisterBody rejects a password confirmation mismatch", async () => {
    await expect(
      parseWebRegisterBody(
        new Request("http://example.test/register", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "name=Ada&email=ada%40workhub.test&password=password123&password_confirmation=nope",
        }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  test("parseWebCreateApiTokenBody accepts an optional expiry", async () => {
    const request = new Request("http://example.test/account/tokens", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=ci+bot&expires_in_days=14",
    });

    await expect(parseWebCreateApiTokenBody(request)).resolves.toEqual({
      name: "ci bot",
      expiresInDays: 14,
    });
  });

  test("parseWebConfirmPasswordBody accepts an optional redirect", async () => {
    await expect(
      parseWebConfirmPasswordBody(
        new Request("http://example.test/confirm-password", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "password=password123&redirect=%2Faccount%2Fexport",
        }),
      ),
    ).resolves.toEqual({
      password: "password123",
      redirect: "/account/export",
    });
  });

  test("parseWebDeleteAccountBody requires typing DELETE", async () => {
    await expect(
      parseWebDeleteAccountBody(
        new Request("http://example.test/account/delete", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "password=password&confirm=nope",
        }),
      ),
    ).rejects.toThrow(ValidationError);

    await expect(
      parseWebDeleteAccountBody(
        new Request("http://example.test/account/delete", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "password=password&confirm=DELETE",
        }),
      ),
    ).resolves.toEqual({ password: "password" });
  });
});
