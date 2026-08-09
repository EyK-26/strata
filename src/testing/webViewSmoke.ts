type WebViewSmokeOptions = {
  url: string;
  backend?: "chrome" | "webkit";
  width?: number;
  height?: number;
  selector?: string;
};

function resolveWebViewBackend(preferred?: "chrome" | "webkit"): "chrome" | "webkit" {
  if (preferred) {
    return preferred;
  }

  return process.platform === "darwin" ? "webkit" : "chrome";
}

async function fetchPageText(options: WebViewSmokeOptions): Promise<string> {
  await using view = new Bun.WebView({
    width: options.width ?? 800,
    height: options.height ?? 600,
    backend: resolveWebViewBackend(options.backend),
  });

  await view.navigate(options.url);

  const script = options.selector
    ? `document.querySelector(${JSON.stringify(options.selector)})?.textContent ?? ""`
    : 'document.body?.innerText ?? document.documentElement?.innerText ?? ""';

  return String(await view.evaluate(script));
}

export type { WebViewSmokeOptions };
export { fetchPageText, resolveWebViewBackend };
