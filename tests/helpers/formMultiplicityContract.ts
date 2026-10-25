import assert from "node:assert/strict";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { ValidationError } from "@getstrata/core/errors/http";
import { parseFormBody } from "@getstrata/core/http/parseFormBody";
import { WebFormRequest } from "@getstrata/core/http/webFormRequest";

/** Application policy exercised over native HTTP, also copied into an installed consumer. */
export async function verifyFormMultiplicity() {
  class SingleEmail extends WebFormRequest<{ email: string }> {
    protected parse(payload: unknown) {
      const email = (payload as Record<string, unknown>).email;
      if (!Array.isArray(email) || email.length !== 1 || typeof email[0] !== "string")
        throw new ValidationError("Exactly one text email is required.", { email: ["Ambiguous"] });
      return { email: email[0] };
    }
  }
  const validator = new SingleEmail({ preserveRepeated: true });
  let accepted = 0;
  const server = createWebServer({
    port: 0,
    native: { hostname: "127.0.0.1" },
    handle: async (request) => {
      if (new URL(request.url).pathname === "/legacy")
        return Response.json(await parseFormBody(request));
      try {
        const email = await validator.validate(request);
        accepted++;
        return Response.json(email);
      } catch (error) {
        if (error instanceof ValidationError) return Response.json(error.details, { status: 422 });
        throw error;
      }
    },
  });
  async function submit(body: URLSearchParams | FormData, status: number, path = "/submit") {
    const response = await fetch(new URL(path, server.url), {
      method: "POST",
      headers: { accept: "text/html" },
      body,
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, status);
    return response.json();
  }
  try {
    assert.deepEqual(await submit(new URLSearchParams({ email: "one@example.test" }), 200), {
      email: "one@example.test",
    });
    const single = new FormData();
    single.append("email", "Žluťoučký@example.test");
    assert.deepEqual(await submit(single, 200), { email: "Žluťoučký@example.test" });
    await submit(
      new URLSearchParams([
        ["email", "one"],
        ["email", "two"],
      ]),
      422,
    );
    await submit(new URLSearchParams(), 422);
    for (const values of [
      ["one", "two"],
      ["one", new File(["x"], "mail.txt")],
      [new File(["x"], "mail.txt")],
    ]) {
      const multipart = new FormData();
      for (const value of values) multipart.append("email", value);
      await submit(multipart, 422);
    }
    assert.equal(accepted, 2, "ambiguous submissions must not reach the application effect");
    assert.deepEqual(
      await submit(
        new URLSearchParams([
          ["email", "one"],
          ["email", "two"],
        ]),
        200,
        "/legacy",
      ),
      { email: "two" },
    );
  } finally {
    await server.stop(true);
  }
  return { preservedForms: true, rejectedAmbiguity: true, legacyLastText: true };
}
