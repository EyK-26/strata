import { describe, expect, test } from "bun:test";
import { ValidationError } from "../../src/core/errors/http";
import { parseWebLoginBody } from "../../src/modules/user/webRequests";

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
});
