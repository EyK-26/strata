import { afterEach, describe, expect, test } from "bun:test";
import { ForbiddenError } from "@getstrata/core/errors/http";
import {
  absoluteTemporarySignedUrl,
  assertValidSignature,
  createValidateSignatureMiddleware,
  hasValidSignature,
  signedUrl,
  temporarySignedUrl,
} from "@getstrata/core/http/signedUrl";
import { restoreEnvVar } from "../helpers/restoreEnv";

const previousSecret = process.env.SIGNED_URL_SECRET;

afterEach(() => {
  restoreEnvVar("SIGNED_URL_SECRET", previousSecret);
});

describe("signed URLs", () => {
  test("temporarySignedUrl includes expiry and a valid HMAC", () => {
    process.env.SIGNED_URL_SECRET = "test-signed-url-secret";
    const url = temporarySignedUrl("/attachments/9/download", 120, { preview: "1" });

    expect(url.startsWith("/attachments/9/download?")).toBe(true);
    expect(url).toContain("expires=");
    expect(url).toContain("signature=");
    expect(hasValidSignature(`http://example.test${url}`)).toBe(true);
  });

  test("signedUrl without expiry stays valid", () => {
    process.env.SIGNED_URL_SECRET = "test-signed-url-secret";
    const path = signedUrl("/verify-email", { id: 4 });

    expect(hasValidSignature(new Request(`http://example.test${path}`))).toBe(true);
  });

  test("rejects tampered query params and expired links", () => {
    process.env.SIGNED_URL_SECRET = "test-signed-url-secret";
    const url = temporarySignedUrl("/reset-password", 60, { email: "a@workhub.test" });
    const tampered = url.replace("email=a%40workhub.test", "email=b%40workhub.test");

    expect(hasValidSignature(`http://example.test${tampered}`)).toBe(false);

    const expired = new URL(`http://example.test${temporarySignedUrl("/reset-password", 60)}`);
    expired.searchParams.set("expires", String(Math.floor(Date.now() / 1000) - 10));
    expect(hasValidSignature(expired)).toBe(false);
  });

  test("assertValidSignature throws ForbiddenError", () => {
    expect(() => assertValidSignature("http://example.test/reset-password")).toThrow(
      ForbiddenError,
    );
  });

  test("absoluteTemporarySignedUrl prefixes APP_URL", () => {
    process.env.SIGNED_URL_SECRET = "test-signed-url-secret";
    const absolute = absoluteTemporarySignedUrl("/login", 30, {}, "https://workhub.test");

    expect(absolute.startsWith("https://workhub.test/login?")).toBe(true);
    expect(hasValidSignature(absolute)).toBe(true);
  });

  test("rejects protocol-relative paths", () => {
    expect(() => signedUrl("//evil.test/phish")).toThrow("same-origin");
  });

  test("createValidateSignatureMiddleware rejects unsigned and expired links", async () => {
    process.env.SIGNED_URL_SECRET = "test-signed-url-secret";
    const middleware = createValidateSignatureMiddleware();

    await expect(
      middleware(new Request("http://example.test/reset-password"), async () => new Response("ok")),
    ).rejects.toThrow(ForbiddenError);

    const valid = new Request(
      `http://example.test${temporarySignedUrl("/reset-password", 60, { email: "a@workhub.test" })}`,
    );
    const response = await middleware(valid, async () => new Response("ok"));
    expect(response.status).toBe(200);
  });
});
