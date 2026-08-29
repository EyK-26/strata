type CspDirectiveValue = string | string[] | false;

interface ContentSecurityPolicyDirectives {
  [directive: string]: CspDirectiveValue;
}

interface ContentSecurityPolicyOptions {
  /** Full HTML Content-Security-Policy. Replaces the HTMX/SPA baseline. */
  csp?: string;
  /** Alias for `csp`. */
  htmlCsp?: string;
  /** Merge extra sources into the HTML baseline. `false` removes a directive. */
  directives?: ContentSecurityPolicyDirectives;
}

interface ResolveContentSecurityPolicyOptions extends ContentSecurityPolicyOptions {
  nonce?: string;
}

/** HTMX 2.0.4 default indicator CSS (line-continued string inside insertIndicatorStyles). */
const HTMX_2_0_4_INDICATOR_STYLE_HASH = "'sha256-bsV5JivYxvGywDAZ22EZJKBFip65Ng9xoJVLbBg7bdo='";

const API_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'none'"],
};

const HTMX_HTML_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "https://unpkg.com"],
  "style-src": ["'self'", HTMX_2_0_4_INDICATOR_STYLE_HASH],
  "connect-src": ["'self'"],
  "img-src": ["'self'", "data:", "https:"],
  "font-src": ["'self'"],
  "media-src": ["'self'", "https:"],
  "frame-src": [
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
    "https://player.vimeo.com",
  ],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
};

const SPA_HTML_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'"],
  "connect-src": ["'self'"],
  "img-src": ["'self'", "data:", "https:"],
  "font-src": ["'self'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
};

let configuredHtmlOptions: ContentSecurityPolicyOptions = {};

function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

function configureContentSecurityPolicy(options: ContentSecurityPolicyOptions): void {
  configuredHtmlOptions = { ...options };
}

function resetContentSecurityPolicyForTests(): void {
  configuredHtmlOptions = {};
}

function cloneDirectives(source: Record<string, string[]>): Record<string, string[]> {
  const copy: Record<string, string[]> = {};
  for (const [directive, values] of Object.entries(source)) {
    copy[directive] = [...values];
  }
  return copy;
}

function normalizeSources(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => item.split(/\s+/).filter(Boolean));
  }

  return value.split(/\s+/).filter(Boolean);
}

function mergeDirectives(
  base: Record<string, string[]>,
  extra?: ContentSecurityPolicyDirectives,
): Record<string, string[]> {
  const merged = cloneDirectives(base);

  for (const [directive, value] of Object.entries(extra ?? {})) {
    if (value === false) {
      delete merged[directive];
      continue;
    }

    const sources = normalizeSources(value);
    const existing = merged[directive] ?? [];
    merged[directive] = [...existing, ...sources.filter((source) => !existing.includes(source))];
  }

  return merged;
}

function serializeDirectives(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([directive, values]) =>
      values.length > 0 ? `${directive} ${values.join(" ")}` : directive,
    )
    .join("; ");
}

function applyNonce(
  directives: Record<string, string[]>,
  nonce?: string,
): Record<string, string[]> {
  if (!nonce) {
    return directives;
  }

  const token = `'nonce-${nonce}'`;
  const next = cloneDirectives(directives);

  for (const directive of ["script-src", "style-src"]) {
    const values = next[directive] ?? ["'self'"];
    if (!values.includes(token)) {
      next[directive] = [...values, token];
    }
  }

  return next;
}

function htmlBaselineDirectives(): Record<string, string[]> {
  const frontendMode = (process.env.FRONTEND_MODE ?? "api").trim();

  if (frontendMode === "server-htmx") {
    return cloneDirectives(HTMX_HTML_DIRECTIVES);
  }

  if (frontendMode === "spa-react") {
    return cloneDirectives(SPA_HTML_DIRECTIVES);
  }

  return cloneDirectives(API_DIRECTIVES);
}

function strictApiContentSecurityPolicy(): string {
  return serializeDirectives(API_DIRECTIVES);
}

function serverHtmxContentSecurityPolicy(nonce?: string): string {
  return serializeDirectives(applyNonce(cloneDirectives(HTMX_HTML_DIRECTIVES), nonce));
}

function spaContentSecurityPolicy(nonce?: string): string {
  return serializeDirectives(applyNonce(cloneDirectives(SPA_HTML_DIRECTIVES), nonce));
}

function resolveHtmlContentSecurityPolicy(
  options: ResolveContentSecurityPolicyOptions = {},
): string {
  const resolved: ContentSecurityPolicyOptions = {
    ...configuredHtmlOptions,
    ...options,
    directives: {
      ...configuredHtmlOptions.directives,
      ...options.directives,
    },
  };
  const override = resolved.htmlCsp ?? resolved.csp;

  if (override) {
    return override;
  }

  return serializeDirectives(
    applyNonce(mergeDirectives(htmlBaselineDirectives(), resolved.directives), options.nonce),
  );
}

function resolveContentSecurityPolicy(
  response: Response,
  options: ResolveContentSecurityPolicyOptions = {},
): string {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("text/html")) {
    return strictApiContentSecurityPolicy();
  }

  return resolveHtmlContentSecurityPolicy(options);
}

export type { ContentSecurityPolicyDirectives, ContentSecurityPolicyOptions };
export {
  configureContentSecurityPolicy,
  generateCspNonce,
  HTMX_2_0_4_INDICATOR_STYLE_HASH,
  resetContentSecurityPolicyForTests,
  resolveContentSecurityPolicy,
  resolveHtmlContentSecurityPolicy,
  serverHtmxContentSecurityPolicy,
  spaContentSecurityPolicy,
  strictApiContentSecurityPolicy,
};
