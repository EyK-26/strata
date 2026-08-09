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

export { htmlResponse, isHtmxRequest };
