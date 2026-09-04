import type { SessionCreateMeta } from "@getstrata/bootstrap/web/session";

export function withCookies(response: Response, cookies: string[]): Response {
  if (cookies.length === 0) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function redirectWithCookies(location: string, cookies: string[], status = 302): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(null, { status, headers });
}

export function sessionMetaFromRequest(request: Request): SessionCreateMeta {
  const forwarded = request.headers.get("x-forwarded-for");
  const ipAddress =
    forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || null;
  const userAgent = request.headers.get("user-agent")?.trim() || null;
  return { userAgent, ipAddress };
}
