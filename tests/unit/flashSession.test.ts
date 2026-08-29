import { describe, expect, test } from "bun:test";
import {
  createFlashCookie,
  flashCookieName,
  flashResponse,
  pullFlash,
  withFlashClear,
} from "@getstrata/core/http/flashSession";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("flashSession", () => {
  test("stores and reads a flash message from cookies", () => {
    const cookie = createFlashCookie({ level: "success", message: "Saved." });
    const request = new Request("http://example.test/organizations", {
      headers: { cookie: cookie.split(";")[0] ?? "" },
    });

    expect(pullFlash(request)).toEqual({ level: "success", message: "Saved." });
  });

  test("flashResponse attaches a flash cookie to the response", () => {
    const response = flashResponse(Response.redirect("/organizations", 302), {
      level: "success",
      message: "Organization created.",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toContain("workhub_flash=");
  });

  test("withFlashClear removes the flash cookie", () => {
    const response = withFlashClear(new Response("ok"));

    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("FLASH_COOKIE_NAME overrides the default cookie", () => {
    const previous = process.env.FLASH_COOKIE_NAME;
    process.env.FLASH_COOKIE_NAME = "app_flash";

    try {
      expect(flashCookieName()).toBe("app_flash");
      expect(createFlashCookie({ level: "info", message: "Hi" })).toContain("app_flash=");
    } finally {
      restoreEnvVar("FLASH_COOKIE_NAME", previous);
    }
  });
});
