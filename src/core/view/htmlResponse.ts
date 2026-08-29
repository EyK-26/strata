function withCharset(contentType: string): string {
  return contentType.includes("charset=") ? contentType : `${contentType}; charset=utf-8`;
}

function htmlResponse(html: string, init: { status?: number; statusText?: string } = {}): Response {
  return new Response(html, {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

function isHtmxRequest(request: Request): boolean {
  return request.headers.get("HX-Request") === "true";
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: {
      Location: location,
    },
  });
}

function textResponse(body: string, init: { status?: number } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function xmlResponse(body: string, init: { status?: number; contentType?: string } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "Content-Type": withCharset(init.contentType ?? "application/xml"),
    },
  });
}

function rssResponse(body: string, init: { status?: number } = {}): Response {
  return xmlResponse(body, { ...init, contentType: "application/rss+xml" });
}

export { htmlResponse, isHtmxRequest, redirectResponse, rssResponse, textResponse, xmlResponse };
