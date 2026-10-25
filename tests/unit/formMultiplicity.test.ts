import { expect, test } from "bun:test";
import { BadRequestError, ForbiddenError, ValidationError } from "@getstrata/core/errors/http";
import { formDataToRecord, parseFormBody } from "@getstrata/core/http/parseFormBody";
import { WebFormRequest } from "@getstrata/core/http/webFormRequest";

test("default conversion retains last text value and ignores files", () => {
  const form = new FormData();
  form.append("email", "first@example.test");
  form.append("email", new File(["file"], "email.txt"));
  form.append("email", "second@example.test");
  expect(formDataToRecord(form)).toEqual({ email: "second@example.test" });
});

test("opt-in conversion preserves all values in field order, including mixed files", async () => {
  const form = new FormData(),
    file = new File(["Žluťoučký"], "note.txt", { type: "text/plain" });
  form.append("email", "first@example.test");
  form.append("email", file);
  form.append("email", "second@example.test");
  form.append("single", "one");
  const values = formDataToRecord(form, { preserveRepeated: true });
  expect(values.email).toEqual(["first@example.test", file, "second@example.test"]);
  expect(values.single).toEqual(["one"]);
  expect(values.email?.[1]).toBeInstanceOf(File);
  const entry = values.email?.[1];
  if (!(entry instanceof File)) throw new Error("Expected preserved file");
  expect(await entry.text()).toBe("Žluťoučký");
});

test("preserved conversion handles prototype names as ordinary own data keys", () => {
  const form = new FormData();
  for (const key of ["__proto__", "constructor", "toString", ""]) form.append(key, "one");
  const values = formDataToRecord(form, { preserveRepeated: true });
  expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
  for (const key of ["__proto__", "constructor", "toString", ""]) {
    expect(Object.hasOwn(values, key)).toBe(true);
    expect(values[key]).toEqual(["one"]);
  }
});

test("urlencoded public parsing exposes counts without imposing a rejection policy", async () => {
  const request = new Request("http://example.test/form", {
    method: "POST",
    body: "email=first%40example.test&email=second%40example.test&tags%5B%5D=a&tags%5B%5D=b",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  expect(await parseFormBody(request, { preserveRepeated: true })).toEqual({
    email: ["first@example.test", "second@example.test"],
    "tags[]": ["a", "b"],
  });
  expect(request.bodyUsed).toBe(true);
});

test("multipart public parsing retains file/text multiplicity and file bytes", async () => {
  const form = new FormData();
  form.append("email", "one@example.test");
  form.append("email", new File(["owned fixture"], "email.txt", { type: "text/plain" }));
  form.append("attachment", new File(["A"], "one.txt"));
  form.append("attachment", new File(["B"], "two.txt"));
  const values = await parseFormBody(
    new Request("http://example.test/form", { method: "POST", body: form }),
    { preserveRepeated: true },
  );
  expect(values.email?.length).toBe(2);
  expect(values.email?.[0]).toBe("one@example.test");
  expect(values.email?.[1]).toBeInstanceOf(File);
  const entry = values.email?.[1];
  if (!(entry instanceof File)) throw new Error("Expected parsed file");
  expect(await entry.text()).toBe("owned fixture");
  expect(values.attachment?.length).toBe(2);
});

class SingleEmailRequest extends WebFormRequest<{ email: string }> {
  protected parse(payload: unknown): { email: string } {
    const values = (payload as Record<string, unknown>)?.email;
    if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== "string")
      throw new ValidationError("Ambiguous email submission", {
        email: ["Supply exactly one text value."],
      });
    return { email: values[0].trim().toLowerCase() };
  }
}

test("WebFormRequest opt-in supports a single-value app rule without changing authorize", async () => {
  const validator = new SingleEmailRequest({ preserveRepeated: true });
  function request(body: string) {
    return new Request("http://example.test/form", {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
    });
  }
  await expect(validator.validate(request("email=ONE%40example.test"))).resolves.toEqual({
    email: "one@example.test",
  });
  await expect(
    validator.validate(request("email=one%40example.test&email=two%40example.test")),
  ).rejects.toThrow(ValidationError);
  await expect(validator.validate(request(""))).rejects.toThrow(ValidationError);
  const form = new FormData();
  form.append("email", new File(["file"], "email.txt"));
  await expect(
    validator.validate(new Request("http://example.test/form", { method: "POST", body: form })),
  ).rejects.toThrow(ValidationError);
});

test("WebFormRequest retains authorization before any form read", async () => {
  class Denied extends SingleEmailRequest {
    override authorize() {
      return false;
    }
  }
  const request = new Request("http://example.test/form", {
    method: "POST",
    body: new URLSearchParams({ email: "one@example.test" }),
  });
  await expect(new Denied({ preserveRepeated: true }).validate(request)).rejects.toThrow(
    ForbiddenError,
  );
  expect(request.bodyUsed).toBe(false);
});

test("preservation does not reinterpret JSON or bypass the existing content-type guard", async () => {
  class Echo extends WebFormRequest<unknown> {
    protected parse(payload: unknown) {
      return payload;
    }
  }
  const validator = new Echo({ preserveRepeated: true });
  await expect(
    validator.validate(
      new Request("http://example.test/api/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"email":"one@example.test"}',
      }),
    ),
  ).resolves.toEqual({ email: "one@example.test" });
  await expect(
    parseFormBody(
      new Request("http://example.test/form", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { preserveRepeated: true },
    ),
  ).rejects.toThrow(BadRequestError);
});

test("empty preserved forms and generic entries remain lossless", () => {
  expect(formDataToRecord(new FormData(), { preserveRepeated: true })).toEqual({});
  expect(formDataToRecord(new Map([["count", 2]]), { preserveRepeated: true })).toEqual({
    count: [2],
  });
  expect(formDataToRecord(new Map([["count", 2]]))).toEqual({});
});
