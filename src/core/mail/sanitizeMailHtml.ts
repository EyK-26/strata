const ALLOWED_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isSafeHref(value: string): boolean {
  return /^(https?:|mailto:)/i.test(value.trim());
}

function sanitizeAttributes(tagName: string, rawAttributes: string): string {
  if (tagName !== "a") {
    return "";
  }

  const hrefMatch = rawAttributes.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const href = decodeBasicEntities(hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? "");

  if (!href || !isSafeHref(href)) {
    return "";
  }

  return ` href="${escapeHtml(href)}"`;
}

function sanitizeMailHtml(html: string): string {
  return html.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (match, tagName: string, rawAttributes: string) => {
      const name = tagName.toLowerCase();

      if (!ALLOWED_TAGS.has(name)) {
        return "";
      }

      if (match.startsWith("</")) {
        return `</${name}>`;
      }

      if (match.endsWith("/>") || name === "br" || name === "hr") {
        return `<${name}>`;
      }

      return `<${name}${sanitizeAttributes(name, rawAttributes)}>`;
    },
  );
}

export { sanitizeMailHtml };
