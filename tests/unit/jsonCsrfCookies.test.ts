import { expect, test } from "bun:test";
import { mergeCookies } from "../helpers/jsonCsrf";

test("fixture browser jar deletes cleared cookies and retains the CSRF proof", () => {
  for (const header of [
    "session=; Path=/; Max-Age=0",
    "session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ]) {
    expect(
      mergeCookies(
        new Response(null, { headers: { "set-cookie": header } }),
        "session=old; csrf=proof",
      ),
    ).toBe("csrf=proof");
  }
});

test("valid Max-Age overrides Expires when their deletion instructions conflict", () => {
  const retained = new Response(null, {
    headers: { "set-cookie": "session=live; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT" },
  });
  expect(mergeCookies(retained, "session=old")).toBe("session=live");
  const removed = new Response(null, {
    headers: { "set-cookie": "session=gone; Max-Age=0; Expires=Fri, 01 Jan 2100 00:00:00 GMT" },
  });
  expect(mergeCookies(removed, "session=live")).toBe("");
});
