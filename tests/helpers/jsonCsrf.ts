function mergeCookies(response: Response, previous = ""): string {
  const jar = new Map<string, string>();
  for (const part of previous
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)) {
    const [name, ...rest] = part.split("=");
    if (name) {
      jar.set(name, rest.join("="));
    }
  }
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";")[0] ?? "";
    const [name, ...rest] = pair.split("=");
    if (name) {
      jar.set(name, rest.join("="));
    }
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function jsonCsrfHeaders(
  origin: string,
  previousCookie = "",
): Promise<{ token: string; cookie: string; headers: Record<string, string> }> {
  const response = await fetch(`${origin}/api/v1/auth/csrf`);
  const body = (await response.json()) as { token: string };
  const cookie = mergeCookies(response, previousCookie);
  return {
    token: body.token,
    cookie,
    headers: {
      "content-type": "application/json",
      "x-csrf-token": body.token,
      cookie,
    },
  };
}

export { jsonCsrfHeaders, mergeCookies };
