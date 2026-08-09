import type { BunRequest } from "bun";

type CookieReadableRequest = Request & {
  cookies?: {
    get(name: string): string | null | undefined;
  };
};

function readRequestCookie(request: Request, name: string): string | null {
  const cookies = (request as CookieReadableRequest).cookies;

  if (cookies && typeof cookies.get === "function") {
    const value = cookies.get(name);
    if (value) {
      return value;
    }
  }

  const header = request.headers.get("cookie");

  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;

    const cookieName = part.slice(0, idx).trim();
    if (cookieName !== name) continue;

    return decodeURIComponent(part.slice(idx + 1).trim());
  }

  return null;
}

function readBunRequestCookie(request: BunRequest, name: string): string | null {
  return request.cookies.get(name) ?? readRequestCookie(request, name);
}

export { readBunRequestCookie, readRequestCookie };
