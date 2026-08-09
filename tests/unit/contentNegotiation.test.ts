import { describe, expect, test } from "bun:test";
import { requestPrefersJson } from "@getstrata/core/http/contentNegotiation";

describe("requestPrefersJson", () => {
  test("treats API paths as JSON by default", () => {
    const request = new Request("http://example.test/api/v1/organizations");

    expect(requestPrefersJson(request)).toBe(true);
  });

  test("treats HTML accept headers as non-JSON", () => {
    const request = new Request("http://example.test/organizations", {
      headers: { accept: "text/html" },
    });

    expect(requestPrefersJson(request)).toBe(false);
  });

  test("API paths stay JSON even when Accept is HTML", () => {
    const request = new Request("http://example.test/api/apply/me", {
      headers: { accept: "text/html" },
    });

    expect(requestPrefersJson(request)).toBe(true);
  });

  test("treats HTMX requests as non-JSON", () => {
    const request = new Request("http://example.test/organizations", {
      headers: { "HX-Request": "true" },
    });

    expect(requestPrefersJson(request)).toBe(false);
  });

  test("defaults to JSON when request is missing", () => {
    expect(requestPrefersJson()).toBe(true);
  });

  test("treats JSON accept headers as JSON", () => {
    const request = new Request("http://example.test/organizations", {
      headers: { accept: "application/json" },
    });

    expect(requestPrefersJson(request)).toBe(true);
  });

  test("treats form submissions as non-JSON", () => {
    const urlEncoded = new Request("http://example.test/organizations", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const multipart = new Request("http://example.test/organizations", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=abc" },
    });

    expect(requestPrefersJson(urlEncoded)).toBe(false);
    expect(requestPrefersJson(multipart)).toBe(false);
  });

  test("treats non-API HTML routes as non-JSON by default", () => {
    const request = new Request("http://example.test/organizations");

    expect(requestPrefersJson(request)).toBe(false);
  });
});
