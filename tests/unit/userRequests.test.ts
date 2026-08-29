import { describe, expect, test } from "bun:test";
import { BadRequestError, ValidationError } from "@getstrata/core/errors/http";
import {
  parseCreateApiTokenBody,
  parseForgotPasswordBody,
  parseLoginBody,
  parseRegisterBody,
  parseResetPasswordBody,
  parseTokenIdParams,
  parseTwoFactorChallengeBody,
  parseUpdatePasswordBody,
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

  test("parseLoginBody accepts recovery-code length mfa_code", async () => {
    const request = new Request("http://example.test/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "user@workhub.test",
        password: "password123",
        mfa_code: "abcd-efgh",
      }),
    });

    await expect(parseLoginBody(request)).resolves.toEqual({
      email: "user@workhub.test",
      password: "password123",
      mfa_code: "abcd-efgh",
    });
  });

  test("parseTwoFactorChallengeBody accepts code aliases", async () => {
    await expect(
      parseTwoFactorChallengeBody(
        new Request("http://example.test/auth/two-factor-challenge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recovery_code: "abcd-efgh",
            mfa_pending: "1.2.0.deadbeef",
          }),
        }),
      ),
    ).resolves.toEqual({
      code: "abcd-efgh",
      mfa_pending: "1.2.0.deadbeef",
    });
  });

  test("parseTwoFactorChallengeBody requires a code", async () => {
    await expect(
      parseTwoFactorChallengeBody(
        new Request("http://example.test/auth/two-factor-challenge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  test("parseLoginBody rejects invalid payloads", async () => {
    const request = new Request("http://example.test/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bad", password: "short" }),
    });

    await expect(parseLoginBody(request)).rejects.toThrow(ValidationError);
  });

  test("parseRegisterBody validates name, email, and confirmed password", async () => {
    const request = new Request("http://example.test/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: " Ada Lovelace ",
        email: "ada@workhub.test",
        password: "password123",
        password_confirmation: "password123",
      }),
    });

    await expect(parseRegisterBody(request)).resolves.toEqual({
      name: "Ada Lovelace",
      email: "ada@workhub.test",
      password: "password123",
    });
  });

  test("parseRegisterBody rejects mismatched confirmation", async () => {
    const request = new Request("http://example.test/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ada",
        email: "ada@workhub.test",
        password: "password123",
        password_confirmation: "password124",
      }),
    });

    await expect(parseRegisterBody(request)).rejects.toThrow(ValidationError);
  });

  test("parseForgotPasswordBody validates email", async () => {
    const request = new Request("http://example.test/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@workhub.test" }),
    });

    await expect(parseForgotPasswordBody(request)).resolves.toEqual({ email: "ada@workhub.test" });
  });

  test("parseResetPasswordBody validates token and confirmed password", async () => {
    const request = new Request("http://example.test/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "ada@workhub.test",
        token: "reset-token",
        password: "password123",
        password_confirmation: "password123",
      }),
    });

    await expect(parseResetPasswordBody(request)).resolves.toEqual({
      email: "ada@workhub.test",
      token: "reset-token",
      password: "password123",
    });
  });

  test("parseUpdatePasswordBody requires confirmation", async () => {
    await expect(
      parseUpdatePasswordBody(
        new Request("http://example.test/users/me/password", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            current_password: "password123",
            password: "new-password",
            password_confirmation: "new-password",
          }),
        }),
      ),
    ).resolves.toEqual({
      current_password: "password123",
      password: "new-password",
    });

    await expect(
      parseUpdatePasswordBody(
        new Request("http://example.test/users/me/password", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            current_password: "password123",
            password: "new-password",
            password_confirmation: "mismatch",
          }),
        }),
      ),
    ).rejects.toThrow(ValidationError);
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
