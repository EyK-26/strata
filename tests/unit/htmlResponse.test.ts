import { describe, expect, test } from "bun:test";
import {
  htmlResponse,
  isHtmxRequest,
  notFoundHtmlResponse,
  redirectResponse,
  rssResponse,
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
    const response = await notFoundHtmlResponse();
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('href="/assets/app.css"');
    expect(html).toContain("Not Found");
  });

  test("textResponse and xmlResponse set content types", async () => {
    const text = textResponse("hello");
    expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await text.text()).toBe("hello");

    const xml = xmlResponse("<feed />");
    expect(xml.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(await xml.text()).toBe("<feed />");
  });

  test("xmlResponse accepts a contentType override and rssResponse uses RSS", async () => {
    const custom = xmlResponse("<rss />", { contentType: "application/rss+xml" });
    expect(custom.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");

    const alreadyHasCharset = xmlResponse("<rss />", {
      contentType: "application/rss+xml; charset=utf-8",
    });
    expect(alreadyHasCharset.headers.get("content-type")).toBe(
      "application/rss+xml; charset=utf-8",
    );

    const rss = rssResponse("<rss />", { status: 200 });
    expect(rss.status).toBe(200);
    expect(rss.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(await rss.text()).toBe("<rss />");
  });
});
