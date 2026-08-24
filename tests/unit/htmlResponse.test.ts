import { describe, expect, test } from "bun:test";
import {
  htmlResponse,
  isHtmxRequest,
  notFoundHtmlResponse,
  redirectResponse,
  textResponse,
  xmlResponse,
} from "@getstrata/core/view";

describe("html response helpers", () => {
  test("htmlResponse sets the HTML content type", async () => {
    const response = htmlResponse("<p>ok</p>");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("<p>ok</p>");
  });

  test("isHtmxRequest detects the HX-Request header", () => {
    expect(isHtmxRequest(new Request("http://example.test/"))).toBe(false);
    expect(
      isHtmxRequest(new Request("http://example.test/", { headers: { "HX-Request": "true" } })),
    ).toBe(true);
  });

  test("redirectResponse sets Location", () => {
    const response = redirectResponse("/login", 303);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
  });

  test("notFoundHtmlResponse returns HTML 404", async () => {
    const response = notFoundHtmlResponse();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  test("textResponse and xmlResponse set content types", async () => {
    const text = textResponse("hello");
    expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await text.text()).toBe("hello");

    const xml = xmlResponse("<feed />");
    expect(xml.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(await xml.text()).toBe("<feed />");
  });
});
