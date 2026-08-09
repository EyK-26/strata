interface MarkdownMailLayoutOptions {
  title?: string;
  preview?: string;
  footer?: string;
}

interface RenderedMarkdownMail {
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownToHtml(markdown: string): string {
  const escaped = markdown.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return escaped
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`)
    .replace(/```(\w+)?\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
    .split(/\n\n+/)
    .map((block) => {
      if (block.startsWith("<")) {
        return block;
      }

      return `<p>${block.replace(/\n/g, " ")}</p>`;
    })
    .join("\n");
}

function wrapMarkdownMailLayout(bodyHtml: string, options: MarkdownMailLayoutOptions = {}): string {
  const title = escapeHtml(options.title ?? "GetStrata");
  const preview = escapeHtml(options.preview ?? "");
  const footer = escapeHtml(options.footer ?? "Sent by GetStrata");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.5; color: #111827; background: #f9fafb; margin: 0; padding: 24px; }
    .container { max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
    .header { padding: 20px 24px; border-bottom: 1px solid #e5e7eb; font-weight: 600; }
    .content { padding: 24px; }
    .footer { padding: 16px 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px; }
    a { color: #2563eb; }
    code { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
    pre { background: #111827; color: #f9fafb; padding: 12px; border-radius: 6px; overflow-x: auto; }
  </style>
</head>
<body>
  ${preview ? `<span style="display:none;max-height:0;overflow:hidden;">${preview}</span>` : ""}
  <div class="container">
    <div class="header">${title}</div>
    <div class="content">${bodyHtml}</div>
    <div class="footer">${footer}</div>
  </div>
</body>
</html>`;
}

function renderMarkdownMail(
  markdown: string,
  options: MarkdownMailLayoutOptions = {},
): RenderedMarkdownMail {
  const bodyHtml = markdownToHtml(markdown.trim());
  const html = wrapMarkdownMailLayout(bodyHtml, options);
  const text = stripMarkdown(markdown);

  return { html, text };
}

export type { MarkdownMailLayoutOptions, RenderedMarkdownMail };
export { markdownToHtml, renderMarkdownMail, stripMarkdown, wrapMarkdownMailLayout };
