import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { htmlResponse } from "./htmlResponse";

interface WebErrorViewInput {
  status: number;
  title: string;
  message: string;
  request?: Request;
  errors?: Record<string, string[]>;
}

interface WebErrorViewOptions {
  render?: (input: WebErrorViewInput) => Promise<string> | string;
}

let configuredErrorView: WebErrorViewOptions = {};

function configureWebErrorView(options: WebErrorViewOptions): void {
  configuredErrorView = { ...options };
}

function resetWebErrorViewForTests(): void {
  configuredErrorView = {};
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderKernelErrorChrome(input: WebErrorViewInput): string {
  const title = escapeHtml(input.title);
  const message = escapeHtml(input.message);
  const errorLines = Object.entries(input.errors ?? {})
    .flatMap(([field, messages]) => messages.map((item) => `${field}: ${item}`))
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");
  const details = errorLines ? `<ul class="error-list">${errorLines}</ul>` : "";
  const goBack =
    input.status === 422 ? `<p><a href="javascript:history.back()">Go back</a></p>` : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="stylesheet" href="/assets/app.css" />
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="/">Home</a>
    </header>
    <main class="site-main">
      <section class="page-header">
        <h1>${title}</h1>
        <p>${message}</p>
        ${details}
        ${goBack}
      </section>
    </main>
  </body>
</html>
`;
}

function errorTemplateName(status: number): string {
  if (status === 404) {
    return "errors/not-found";
  }

  if (status === 403) {
    return "errors/forbidden";
  }

  return "errors/error";
}

async function renderWebErrorHtml(input: WebErrorViewInput): Promise<string> {
  const render = configuredErrorView.render;

  if (!render) {
    return renderKernelErrorChrome(input);
  }

  try {
    return await render({
      ...input,
      request: input.request ?? currentRequestMeta().request,
    });
  } catch {
    return renderKernelErrorChrome(input);
  }
}

async function htmlErrorResponse(input: WebErrorViewInput & { status: number }): Promise<Response> {
  return htmlResponse(await renderWebErrorHtml(input), { status: input.status });
}

async function notFoundHtmlResponse(body?: string): Promise<Response> {
  if (body !== undefined) {
    return htmlResponse(body, { status: 404 });
  }

  return htmlErrorResponse({
    status: 404,
    title: "Not Found",
    message: "The page you requested was not found.",
  });
}

export type { WebErrorViewInput, WebErrorViewOptions };
export {
  configureWebErrorView,
  errorTemplateName,
  htmlErrorResponse,
  notFoundHtmlResponse,
  renderKernelErrorChrome,
  renderWebErrorHtml,
  resetWebErrorViewForTests,
};
