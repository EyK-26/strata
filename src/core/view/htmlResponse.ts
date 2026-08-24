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

function notFoundHtmlResponse(body = "Not Found"): Response {
  return htmlResponse(body, { status: 404 });
}

function textResponse(body: string, init: { status?: number } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function xmlResponse(body: string, init: { status?: number } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}

export {
  htmlResponse,
  isHtmxRequest,
  notFoundHtmlResponse,
  redirectResponse,
  textResponse,
  xmlResponse,
};
