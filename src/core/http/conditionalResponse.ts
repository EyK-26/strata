import { computeEtagFromJson, ifNoneMatchSatisfied, notModifiedResponse } from "./etag";

type JsonResponsePolicy = Readonly<{ etagEnabled: boolean }>;

function snapshotJsonResponsePolicy(policy: JsonResponsePolicy): JsonResponsePolicy {
  const descriptor = policy && Object.getOwnPropertyDescriptor(policy, "etagEnabled");
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "boolean") {
    throw new TypeError("JSON response policy requires an explicit etagEnabled boolean.");
  }
  return Object.freeze({ etagEnabled: descriptor.value });
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

function conditionalJsonResponse(
  request: Request | undefined,
  data: unknown,
  policy: JsonResponsePolicy,
  init: ResponseInit = {},
): Response {
  const { etagEnabled } = snapshotJsonResponsePolicy(policy);
  if (!request || !etagEnabled) {
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

export type { JsonResponsePolicy };
export { conditionalJsonResponse, snapshotJsonResponsePolicy };
