import {
  computeEtagFromJson,
  ifNoneMatchSatisfied,
  isEtagEnabled,
  notModifiedResponse,
} from "./etag";

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

function conditionalJsonResponse(
  request: Request | undefined,
  data: unknown,
  init: ResponseInit = {},
): Response {
  if (!request || !isEtagEnabled()) {
    return jsonResponse(data, init);
  }

  const etag = computeEtagFromJson(data);

  if (ifNoneMatchSatisfied(request, etag)) {
    return notModifiedResponse(etag);
  }

  const response = jsonResponse(data, init);
  const headers = new Headers(response.headers);
  headers.set("ETag", etag);
  headers.set("Cache-Control", "private, must-revalidate");
  headers.append("Vary", "Authorization");
  headers.append("Vary", "X-Tenant-Id");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export { conditionalJsonResponse };
