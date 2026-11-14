import { expect, test } from "bun:test";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { parseOptionalPositiveIntQueryParam } from "@getstrata/core/http/validation";
import { WebFormRequest } from "@getstrata/core/http/webFormRequest";
import type { CacheStore } from "../../src/core/cache/store";

class Input extends WebFormRequest<unknown> {
  protected parse(value: unknown) {
    return value;
  }
}
for (const accept of ["application/json", "text/html"]) {
  test(`request encoding is independent of response preference ${accept}`, async () => {
    expect(
      await new Input().validate(
        new Request("https://app.test/api/orders", {
          method: "POST",
          headers: { accept, "content-type": "application/x-www-form-urlencoded" },
          body: "name=A",
        }),
      ),
    ).toEqual({ name: "A" });
    for (const contentType of ["application/json", "application/merge-patch+json; charset=utf-8"]) {
      expect(
        await new Input().validate(
          new Request("https://app.test/orders", {
            method: "POST",
            headers: { accept, "content-type": contentType },
            body: '{"name":"A"}',
          }),
        ),
      ).toEqual({ name: "A" });
    }
  });
}
for (const Base of [FormRequest, WebFormRequest] as (typeof FormRequest)[]) {
  test(`${Base.name} authorizes before consuming and accepts only true`, async () => {
    let parses = 0;
    class Denied extends Base<unknown> {
      override authorize() {
        return "false" as unknown as boolean;
      }
      protected parse(value: unknown) {
        parses++;
        return value;
      }
    }
    const request = new Request("https://app.test", { method: "POST", body: "{}" });
    await expect(new Denied().validate(request)).rejects.toThrow();
    expect(request.bodyUsed).toBe(false);
    expect(parses).toBe(0);
  });
}
test("positive integer query parsing rejects partial and imprecise numbers", () => {
  for (const raw of ["1x", "1.5", "1e2", "0x10", "9007199254740993", "-1", "0"]) {
    expect(() =>
      parseOptionalPositiveIntQueryParam(new URLSearchParams({ page: raw }), "page"),
    ).toThrow();
  }
  expect(parseOptionalPositiveIntQueryParam(new URLSearchParams("page=12"), "page")).toBe(12);
});
test("a custom cache cannot advertise unsafe post-load tagging", () => {
  let effects = 0;
  const store = {
    getOrSet: async () => {
      effects++;
      return 1;
    },
    attachTags: async () => {
      effects++;
    },
  } as unknown as CacheStore;
  expect(() => new CacheRepository(store).tags("orders")).toThrow("atomic tagged");
  expect(effects).toBe(0);
});
