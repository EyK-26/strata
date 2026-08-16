import {
  applyConditionalGet,
  assertIfMatch,
  type EtagVersioned,
  etagFromResource,
  isEtagEnabled,
} from "@getstrata/core/http/etag";
import { jsonResponse } from "@getstrata/core/http/response";

interface ScimResponseOptions {
  status?: number;
  request?: Request;
  etagSource?: EtagVersioned;
}

function scimResponse(data: unknown, options: ScimResponseOptions = {}): Response {
  const status = options.status ?? 200;
  const response = jsonResponse(data, {
    status,
    headers: {
      "content-type": "application/scim+json",
    },
  });

  if (!isEtagEnabled() || !options.etagSource) {
    return response;
  }

  const etag = etagFromResource(options.etagSource);

  if (options.request) {
    return applyConditionalGet(options.request, response, etag);
  }

  const headers = new Headers(response.headers);
  headers.set("ETag", etag);
  headers.set("Cache-Control", "private, must-revalidate");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function assertScimIfMatch(request: Request, etagSource: EtagVersioned): void {
  if (!isEtagEnabled()) {
    return;
  }

  assertIfMatch(request, etagFromResource(etagSource), { required: true });
}

export type { ScimResponseOptions };
export { assertScimIfMatch, scimResponse };
