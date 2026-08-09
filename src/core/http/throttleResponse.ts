import { isViewsEnabled } from "../runtime/frontendMode";
import { htmlErrorResponse } from "../view/webErrorView";
import { requestPrefersJson } from "./contentNegotiation";

async function tooManyRequestsResponse(
  request: Request,
  message: string,
  decaySeconds: number,
): Promise<Response> {
  const retryAfter = { "retry-after": String(decaySeconds) };

  if (requestPrefersJson(request) || !isViewsEnabled()) {
    return Response.json(
      { error: message },
      {
        status: 429,
        headers: retryAfter,
      },
    );
  }

  const html = await htmlErrorResponse({
    status: 429,
    title: "Too Many Requests",
    message,
    request,
  });
  const headers = new Headers(html.headers);
  headers.set("retry-after", String(decaySeconds));
  return new Response(html.body, { status: 429, headers });
}

export { tooManyRequestsResponse };
