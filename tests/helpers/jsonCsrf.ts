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

function csrfCookieValue(cookieHeader: string): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const name = part.slice(0, idx).trim().toLowerCase();
    if (!name.includes("csrf")) {
      continue;
    }
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return part.slice(idx + 1).trim();
    }
  }
  return undefined;
}

async function jsonCsrfHeaders(
  origin: string,
  previousCookie = "",
): Promise<{ token: string; cookie: string; headers: Record<string, string> }> {
  const response = await fetch(`${origin}/api/v1/auth/csrf`);
  const raw = await response.text();
  if (response.status !== 200) {
    throw new Error(`GET /api/v1/auth/csrf returned ${response.status}: ${raw}`);
  }
  const body = JSON.parse(raw) as { token?: string };
  const cookie = mergeCookies(response, previousCookie);
  const cookieToken = csrfCookieValue(cookie);
  if (!body.token) {
    throw new Error("GET /api/v1/auth/csrf JSON omitted token.");
  }
  if (cookieToken !== body.token) {
    throw new Error(
      `CSRF JSON token did not match the CSRF cookie on that response (nested middleware minted a second token).`,
    );
  }
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

export { csrfCookieValue, jsonCsrfHeaders, mergeCookies };
